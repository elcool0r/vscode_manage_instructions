import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
const fetch = require('node-fetch');

interface GistFile {
    filename?: string;
    content?: string;
}

interface GistData {
    files: { [key: string]: GistFile };
    description?: string;
}

interface GistResponse {
    id: string;
    files: { [key: string]: GistFile };
    description: string;
    html_url: string;
    updated_at: string;
}

interface InstructionsMetadata {
    version: string;
    lastModified: string;
}

// Global timer for periodic sync
let periodicSyncTimer: NodeJS.Timeout | undefined;

// File system watchers and debouncing for real-time sync
let fileSystemWatchers: vscode.FileSystemWatcher[] = [];
let syncDebounceTimer: NodeJS.Timeout | undefined;
const SYNC_DEBOUNCE_DELAY = 2000; // 2 seconds debounce delay

// Output channel for logging
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    // Initialize output channel
    outputChannel = vscode.window.createOutputChannel('Copilot Instructions');
    context.subscriptions.push(outputChannel);

    // Register commands
    const syncCommand = vscode.commands.registerCommand('copilot-instructions.sync', syncInstructions);
    const configureCommand = vscode.commands.registerCommand('copilot-instructions.configure', configureSettings);
    const openConfigCommand = vscode.commands.registerCommand('copilot-instructions.openConfigPage', openConfigurationPage);

    context.subscriptions.push(syncCommand, configureCommand, openConfigCommand);

    // Check for auto-download on startup
    setTimeout(() => checkForAutoDownload(), 2000);
    
    // Initialize periodic sync
    initializePeriodicSync(context);
    
    // Initialize file system watchers for real-time sync
    initializeFileSystemWatchers(context);

    // Listen for configuration changes to restart periodic sync and file watchers
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('copilotInstructions.periodicSyncEnabled') ||
            event.affectsConfiguration('copilotInstructions.periodicSyncInterval') ||
            event.affectsConfiguration('copilotInstructions.realTimeSyncEnabled')) {
            outputChannel.appendLine(`[${new Date().toISOString()}] Configuration changed, restarting sync systems`);
            initializePeriodicSync(context);
            initializeFileSystemWatchers(context);
        }
    });
    
    context.subscriptions.push(configChangeListener);
}

async function uploadToGist(uri?: vscode.Uri) {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken');
        let gistId = config.get<string>('gistId');

        if (!githubToken) {
            const action = await vscode.window.showErrorMessage(
                'GitHub token not configured. Please configure your GitHub Personal Auth Token.',
                'Configure Now'
            );
            if (action === 'Configure Now') {
                await configureSettings();
            }
            return;
        }

        // Find copilot-instructions.md file
        let filePath: string;
        if (uri && uri.fsPath.endsWith('copilot-instructions.md')) {
            filePath = uri.fsPath;
        } else {
            // Search for the file in workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            const possiblePaths = [
                path.join(workspaceFolders[0].uri.fsPath, '.github', 'copilot-instructions.md'),
                path.join(workspaceFolders[0].uri.fsPath, 'copilot-instructions.md')
            ];

            filePath = possiblePaths.find(p => fs.existsSync(p)) || '';
            
            if (!filePath) {
                vscode.window.showErrorMessage('copilot-instructions.md file not found in workspace.');
                return;
            }
        }

        const originalContent = fs.readFileSync(filePath, 'utf8');
        let content = originalContent;
        let shouldUpdateVersion = false;
        
        // Check remote version if gist exists
        if (gistId) {
            const versionComparison = await checkRemoteVersion(githubToken, gistId, originalContent);
            
            if (versionComparison === 'newer') {
                const action = await vscode.window.showWarningMessage(
                    'The remote file has been updated more recently than your local file. Do you want to overwrite it?',
                    'Overwrite Remote',
                    'Cancel',
                    'Download Remote First'
                );
                
                if (action === 'Cancel') {
                    return;
                } else if (action === 'Download Remote First') {
                    await downloadFromGist(uri);
                    return;
                } else if (action === 'Overwrite Remote') {
                    // When overwriting newer remote, increment to mark as new version
                    shouldUpdateVersion = true;
                }
            } else if (versionComparison === 'same') {
                const action = await vscode.window.showInformationMessage(
                    'Local and remote files have identical content. No upload needed.',
                    'Force Upload Anyway',
                    'OK'
                );
                
                if (action !== 'Force Upload Anyway') {
                    return;
                } else {
                    // When force uploading, increment to distinguish this upload
                    shouldUpdateVersion = true;
                }
            } else {
                // Local content is different and newer, increment normally
                shouldUpdateVersion = true;
            }
        } else {
            // No gist exists yet, this is a new upload - increment version
            shouldUpdateVersion = true;
        }
        
        // Update version number in content before upload only when appropriate
        if (shouldUpdateVersion) {
            content = updateVersionInContent(originalContent);
        }
        
        // Write the updated content back to the file only if version was updated
        if (shouldUpdateVersion && content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
        
        const gistData: GistData = {
            description: 'Copilot Instructions',
            files: {
                'copilot-instructions.md': {
                    content: content
                }
            }
        };

        let url: string;
        let method: string;

        if (gistId) {
            // Update existing gist
            url = `https://api.github.com/gists/${gistId}`;
            method = 'PATCH';
        } else {
            // Create new gist
            url = 'https://api.github.com/gists';
            method = 'POST';
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `token ${githubToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            },
            body: JSON.stringify(gistData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json() as GistResponse;

        if (!gistId) {
            // Save the gist ID for future updates
            await config.update('gistId', result.id, vscode.ConfigurationTarget.Global);
        }

        vscode.window.showInformationMessage(
            `Successfully ${gistId ? 'updated' : 'created'} gist: ${result.html_url}`,
            'Open in Browser'
        ).then(action => {
            if (action === 'Open in Browser') {
                vscode.env.openExternal(vscode.Uri.parse(result.html_url));
            }
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to upload to gist: ${error}`);
        console.error('Upload error:', error);
    }
}

async function downloadFromGist(uri?: vscode.Uri) {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken');
        const gistId = config.get<string>('gistId');

        if (!githubToken || !gistId) {
            const action = await vscode.window.showErrorMessage(
                'GitHub token or Gist ID not configured. Please configure your settings.',
                'Configure Now'
            );
            if (action === 'Configure Now') {
                await configureSettings();
            }
            return;
        }

        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const gist = await response.json() as GistResponse;
        const instructionsFile = gist.files['copilot-instructions.md'];

        if (!instructionsFile || !instructionsFile.content) {
            // Create template if no file found in gist
            const shouldCreateTemplate = await vscode.window.showWarningMessage(
                'copilot-instructions.md not found in the gist. Would you like to create a template?',
                'Create Template',
                'Cancel'
            );
            
            if (shouldCreateTemplate === 'Create Template') {
                await createTemplateFile(uri);
            }
            return;
        }

        // Determine target directory
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        let targetDir: string;
        if (uri && uri.scheme === 'file') {
            // Right-clicked on a folder
            targetDir = uri.fsPath;
        } else {
            // Use workspace root
            targetDir = workspaceFolders[0].uri.fsPath;
        }

        // Create .github directory if it doesn't exist
        const githubDir = path.join(targetDir, '.github');
        if (!fs.existsSync(githubDir)) {
            fs.mkdirSync(githubDir, { recursive: true });
        }

        const filePath = path.join(githubDir, 'copilot-instructions.md');
        fs.writeFileSync(filePath, instructionsFile.content);

        // Auto-manage .gitignore if enabled
        const autoManageGitignore = config.get<boolean>('autoManageGitignore', true);
        if (autoManageGitignore) {
            await manageGitignore(targetDir);
        }

        vscode.window.showInformationMessage(
            `Successfully downloaded copilot-instructions.md to ${filePath}`,
            'Open File'
        ).then(action => {
            if (action === 'Open File') {
                vscode.window.showTextDocument(vscode.Uri.file(filePath));
            }
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to download from gist: ${error}`);
        console.error('Download error:', error);
    }
}

function updateVersionInContent(content: string): string {
    const now = new Date();
    const timestamp = now.toISOString();
    const version = getNextVersion(content);
    
    // Check if version metadata already exists
    const versionRegex = /<!--\s*VERSION:\s*([^\s]+)\s*LAST_MODIFIED:\s*([^\s]+)\s*-->/;
    const match = content.match(versionRegex);
    
    if (match) {
        // Update existing version metadata
        return content.replace(versionRegex, `<!-- VERSION: ${version} LAST_MODIFIED: ${timestamp} -->`);
    } else {
        // Add version metadata at the top
        return `<!-- VERSION: ${version} LAST_MODIFIED: ${timestamp} -->\n${content}`;
    }
}

function getNextVersion(currentContent?: string): string {
    // Extract current version from content if available
    let baseVersion = "1.0.0";
    
    if (currentContent) {
        const metadata = extractVersionFromContent(currentContent);
        if (metadata && metadata.version) {
            const parts = metadata.version.split('.');
            if (parts.length >= 3) {
                const major = parseInt(parts[0]) || 1;
                const minor = parseInt(parts[1]) || 0;
                const patch = parseInt(parts[2]) || 0;
                baseVersion = `${major}.${minor}.${patch + 1}`;
            } else if (parts.length === 2) {
                const major = parseInt(parts[0]) || 1;
                const minor = parseInt(parts[1]) || 0;
                baseVersion = `${major}.${minor + 1}.0`;
            } else {
                const major = parseInt(parts[0]) || 1;
                baseVersion = `${major + 1}.0.0`;
            }
        }
    }
    
    return baseVersion;
}

function extractVersionFromContent(content: string): InstructionsMetadata | null {
    const versionRegex = /<!--\s*VERSION:\s*([^\s]+)\s*LAST_MODIFIED:\s*([^\s]+)\s*-->/;
    const match = content.match(versionRegex);
    
    if (match) {
        return {
            version: match[1],
            lastModified: match[2]
        };
    }
    
    return null;
}

function getContentChecksum(content: string): string {
    // Remove version metadata to get the actual content checksum
    const normalizedContent = content.replace(/<!--\s*VERSION:\s*[^\s]+\s*LAST_MODIFIED:\s*[^\s]+\s*-->\n?/, '').trim();
    return crypto.createHash('sha256').update(normalizedContent, 'utf8').digest('hex');
}

function areContentsEqual(content1: string, content2: string): boolean {
    return getContentChecksum(content1) === getContentChecksum(content2);
}

async function checkRemoteVersion(githubToken: string, gistId: string, localContent: string): Promise<'newer' | 'same' | 'older'> {
    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            }
        });

        if (!response.ok) {
            console.warn('Could not fetch remote version, proceeding with upload');
            return 'older'; // Default to allowing upload
        }

        const gist = await response.json() as GistResponse;
        const instructionsFile = gist.files['copilot-instructions.md'];

        if (!instructionsFile || !instructionsFile.content) {
            return 'older'; // No remote file, proceed with upload
        }

        const remoteContent = instructionsFile.content;
        
        // Compare actual content (excluding version metadata)
        if (areContentsEqual(localContent, remoteContent)) {
            return 'same';
        }
        
        // If contents are different, compare timestamps as a fallback
        const localMetadata = extractVersionFromContent(localContent);
        const remoteMetadata = extractVersionFromContent(remoteContent);
        
        if (localMetadata && remoteMetadata) {
            const localTime = new Date(localMetadata.lastModified).getTime();
            const remoteTime = new Date(remoteMetadata.lastModified).getTime();
            
            if (remoteTime > localTime) {
                return 'newer';
            } else {
                return 'older';
            }
        }
        
        // If we can't determine, assume local is newer to allow upload
        return 'older';
    } catch (error) {
        console.warn('Error checking remote version:', error);
        return 'older'; // Default to allowing upload on error
    }
}

async function checkForAutoDownload(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const autoDownload = config.get<boolean>('autoDownloadOnStartup', true);
        
        if (!autoDownload) {
            return;
        }

        const githubToken = config.get<string>('githubToken');
        const gistId = config.get<string>('gistId');

        if (!githubToken || !gistId) {
            return; // No configuration, skip auto-download
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Check if local file exists
        const possiblePaths = [
            path.join(workspaceFolders[0].uri.fsPath, '.github', 'copilot-instructions.md'),
            path.join(workspaceFolders[0].uri.fsPath, 'copilot-instructions.md')
        ];

        const localFilePath = possiblePaths.find(p => fs.existsSync(p));
        
        // Get remote version
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            }
        });

        if (!response.ok) {
            return; // Failed to fetch, skip auto-download
        }

        const gist = await response.json() as GistResponse;
        const remoteFile = gist.files['copilot-instructions.md'];

        if (!remoteFile || !remoteFile.content) {
            return; // No remote file
        }

        const remoteMetadata = extractVersionFromContent(remoteFile.content);
        const remoteLastModified = new Date(gist.updated_at);

        if (localFilePath) {
            // Local file exists, check if remote is newer
            const localContent = fs.readFileSync(localFilePath, 'utf8');
            const localMetadata = extractVersionFromContent(localContent);
            const localStats = fs.statSync(localFilePath);
            
            let shouldUpdate = false;
            
            if (remoteMetadata && localMetadata) {
                // Compare versions
                const remoteDate = new Date(remoteMetadata.lastModified);
                const localDate = new Date(localMetadata.lastModified);
                shouldUpdate = remoteDate > localDate;
            } else {
                // Fallback to file modification time
                shouldUpdate = remoteLastModified > localStats.mtime;
            }
            
            if (shouldUpdate) {
                const config = vscode.workspace.getConfiguration('copilotInstructions');
                const showNotifications = config.get<boolean>('showNotifications', false);
                
                if (showNotifications) {
                    const action = await vscode.window.showInformationMessage(
                        'A newer version of copilot-instructions.md is available in your gist. Update?',
                        'Update',
                        'Not Now',
                        'Disable Auto-Check'
                    );
                    
                    if (action === 'Update') {
                        await downloadFromGist();
                    } else if (action === 'Disable Auto-Check') {
                        await config.update('autoDownloadOnStartup', false, vscode.ConfigurationTarget.Global);
                    }
                } else {
                    // Silent update when notifications are disabled
                    await downloadFromGist();
                }
            }
        } else {
            // No local file, suggest download
            const config = vscode.workspace.getConfiguration('copilotInstructions');
            const showNotifications = config.get<boolean>('showNotifications', false);
            
            if (showNotifications) {
                const action = await vscode.window.showInformationMessage(
                    'No copilot-instructions.md found in workspace. Download from your gist?',
                    'Download',
                    'Not Now',
                    'Disable Auto-Check'
                );
                
                if (action === 'Download') {
                    await downloadFromGist();
                } else if (action === 'Disable Auto-Check') {
                    await config.update('autoDownloadOnStartup', false, vscode.ConfigurationTarget.Global);
                }
            }
        }

    } catch (error) {
        console.warn('Auto-download check failed:', error);
    }
}

function initializePeriodicSync(context: vscode.ExtensionContext): void {
    // Clear existing timer
    if (periodicSyncTimer) {
        clearInterval(periodicSyncTimer);
        periodicSyncTimer = undefined;
    }

    const config = vscode.workspace.getConfiguration('copilotInstructions');
    const syncEnabled = config.get<boolean>('periodicSyncEnabled', true);
    
    if (!syncEnabled) {
        return;
    }

    const syncInterval = config.get<number>('periodicSyncInterval', 30);
    const intervalMs = syncInterval * 60 * 1000; // Convert minutes to milliseconds

    periodicSyncTimer = setInterval(async () => {
        await performPeriodicSync();
    }, intervalMs);

    // Store timer in context subscriptions for cleanup
    context.subscriptions.push({
        dispose: () => {
            if (periodicSyncTimer) {
                clearInterval(periodicSyncTimer);
                periodicSyncTimer = undefined;
            }
        }
    });
}

async function performPeriodicSync(): Promise<void> {
    try {
        outputChannel.appendLine(`[${new Date().toISOString()}] Starting periodic sync check`);
        
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken');
        const gistId = config.get<string>('gistId');

        if (!githubToken || !gistId) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Check if local file exists
        const possiblePaths = [
            path.join(workspaceFolders[0].uri.fsPath, '.github', 'copilot-instructions.md'),
            path.join(workspaceFolders[0].uri.fsPath, 'copilot-instructions.md')
        ];

        const localFilePath = possiblePaths.find(p => fs.existsSync(p));

        if (!localFilePath) {
            return;
        }

        // Use the unified sync function for periodic sync
        // For periodic sync, we'll create a special version that handles auto-sync logic
        await performAutoSync(localFilePath);

    } catch (error) {
        console.warn('Periodic sync failed:', error);
        // No notifications for periodic sync failures - they're logged for debugging
    }
}

async function performAutoSync(localFilePath: string): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken')!;
        const gistId = config.get<string>('gistId')!;

        // Fetch remote content
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            }
        });

        if (!response.ok) {
            console.warn('performAutoSync: Failed to check remote version');
            return;
        }

        const gist = await response.json() as GistResponse;
        const remoteFile = gist.files['copilot-instructions.md'];

        if (!remoteFile || !remoteFile.content) {
            return;
        }

        const localContent = fs.readFileSync(localFilePath, 'utf8');
        const remoteContent = remoteFile.content;

        // Check if files are already synchronized
        if (areContentsEqual(localContent, remoteContent)) {
            return;
        }

        // Determine which file is newer
        const versionComparison = await checkRemoteVersion(githubToken, gistId, localContent);

        if (versionComparison === 'newer') {
            // Remote is newer - download it silently
            await downloadFromGist();
        } else if (versionComparison === 'older') {
            // Local is newer - upload it silently
            await uploadToGist();
        }

    } catch (error) {
        console.warn('Auto sync failed:', error);
        throw error; // Re-throw to be handled by performPeriodicSync
    }
}

// File system watcher functions for real-time sync
function initializeFileSystemWatchers(context: vscode.ExtensionContext): void {
    // Clear existing watchers
    disposeFileSystemWatchers();

    const config = vscode.workspace.getConfiguration('copilotInstructions');
    const syncEnabled = config.get<boolean>('periodicSyncEnabled', true);
    const realTimeSyncEnabled = config.get<boolean>('realTimeSyncEnabled', true);
    
    if (!syncEnabled || !realTimeSyncEnabled) {
        outputChannel.appendLine(`[${new Date().toISOString()}] Real-time sync disabled in configuration`);
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    // Create watchers for copilot-instructions.md files in all possible locations
    for (const folder of workspaceFolders) {
        // Watch for changes in .github/copilot-instructions.md
        const githubWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, '.github/copilot-instructions.md'),
            true, // ignore create events (handled by periodic sync)
            false, // don't ignore change events
            true // ignore delete events (handled by periodic sync)
        );

        // Watch for changes in copilot-instructions.md at workspace root
        const rootWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, 'copilot-instructions.md'),
            true, // ignore create events
            false, // don't ignore change events
            true // ignore delete events
        );

        // Set up change handlers with debouncing
        githubWatcher.onDidChange(uri => {
            triggerDebouncedSync(uri.fsPath);
        });

        rootWatcher.onDidChange(uri => {
            triggerDebouncedSync(uri.fsPath);
        });

        fileSystemWatchers.push(githubWatcher, rootWatcher);
        context.subscriptions.push(githubWatcher, rootWatcher);
    }
}

function triggerDebouncedSync(filePath: string): void {
    // Clear existing debounce timer
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
    }

    // Set new debounce timer
    syncDebounceTimer = setTimeout(async () => {
        try {
            await performFileChangeSync(filePath);
        } catch (error) {
            console.warn('File change sync failed:', error);
        }
    }, SYNC_DEBOUNCE_DELAY);
}

async function performFileChangeSync(filePath: string): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken');
        const gistId = config.get<string>('gistId');

        if (!githubToken || !gistId) {
            return;
        }

        // Verify file still exists (might have been deleted after debounce delay)
        if (!fs.existsSync(filePath)) {
            return;
        }

        // Use the same auto-sync logic as periodic sync
        await performAutoSync(filePath);

    } catch (error) {
        console.warn('File change sync failed:', error);
    }
}

function disposeFileSystemWatchers(): void {
    // Dispose all existing watchers
    fileSystemWatchers.forEach(watcher => {
        try {
            watcher.dispose();
        } catch (error) {
            console.warn('Error disposing file system watcher:', error);
        }
    });
    fileSystemWatchers = [];

    // Clear debounce timer
    if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = undefined;
    }
}

async function createTemplateFile(uri?: vscode.Uri): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        let targetDir: string;
        if (uri && uri.scheme === 'file') {
            targetDir = uri.fsPath;
        } else {
            targetDir = workspaceFolders[0].uri.fsPath;
        }

        // Create .github directory if it doesn't exist
        const githubDir = path.join(targetDir, '.github');
        if (!fs.existsSync(githubDir)) {
            fs.mkdirSync(githubDir, { recursive: true });
        }

        const filePath = path.join(githubDir, 'copilot-instructions.md');
        const templateContent = createTemplateContent();
        
        fs.writeFileSync(filePath, templateContent);

        vscode.window.showInformationMessage(
            `Created copilot-instructions.md template at ${filePath}`,
            'Open File',
            'Upload to Gist'
        ).then(action => {
            if (action === 'Open File') {
                vscode.window.showTextDocument(vscode.Uri.file(filePath));
            } else if (action === 'Upload to Gist') {
                uploadToGist(vscode.Uri.file(filePath));
            }
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create template: ${error}`);
        console.error('Template creation error:', error);
    }
}

function createTemplateContent(): string {
    const now = new Date();
    const timestamp = now.toISOString();
    const version = "1.0.0";
    
    return `<!-- VERSION: ${version} LAST_MODIFIED: ${timestamp} -->
# Copilot Instructions

## Core Principles
- Use descriptive variable and function names
- Write clear, concise comments for complex logic
- Prioritize readability and maintainability
- Separate concerns (models, views, controllers, etc.)

## Version Control

### Git Workflow
- Always stage (\`git add\`) and commit all changes when finishing a task
- When committing new changes, increment the project version as appropriate
- Add large files/directories to \`.gitignore\` to avoid committing unnecessary data

### Commit Message Format
- Use conventional commit format:
  - **New features**: \`git commit -m "feat: add new feature"\`
  - **Bug fixes**: \`git commit -m "fix: fix issue"\`
  - **Maintenance**: \`git commit -m "chore: update dependencies"\`
  - **Documentation**: \`git commit -m "docs: update documentation"\`

## Code Quality Standards

### General Standards
- Always run linters before committing:
  - JavaScript/TypeScript: \`eslint\` and \`prettier\`
  - Python: \`flake8\`, \`black\`, \`mypy\`
  - Go: \`golint\` and \`go vet\`
  - Java: \`checkstyle\`, \`spotbugs\`
- Validate and sanitize all user inputs
- Use parameterized statements to prevent SQL injection
- Provide meaningful error messages

### Naming Conventions
- Python: Use \`snake_case\` for variables and functions, \`PascalCase\` for classes
- JavaScript/TypeScript: Use \`camelCase\` for variables and functions, \`PascalCase\` for classes
- Java: Use \`camelCase\` for variables and methods, \`PascalCase\` for classes
- Go: Use \`camelCase\` for variables, \`PascalCase\` for exported functions
- REST endpoints: Use plural nouns (e.g., \`/users\`, \`/projects\`)

## Language-Specific Guidelines

### JavaScript/TypeScript
\`\`\`javascript
// Use modern ES6+ features
// Example: Async/await instead of callbacks
async function fetchData(url) {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Use TypeScript interfaces for type safety
interface User {
    id: number;
    name: string;
    email: string;
}
\`\`\`

### Python
\`\`\`python
# Use type hints and docstrings
def calculate_total(items: list[dict], tax_rate: float = 0.08) -> float:
    """
    Calculate total price including tax.
    
    Args:
        items: List of item dictionaries with 'price' key
        tax_rate: Tax rate as decimal (default 0.08 for 8%)
    
    Returns:
        Total price including tax
    """
    subtotal = sum(item['price'] for item in items)
    return subtotal * (1 + tax_rate)

# Use context managers for resource handling
with open('file.txt', 'r') as f:
    content = f.read()
\`\`\`

### Go
\`\`\`go
// Handle errors explicitly
func ReadConfig(filename string) (*Config, error) {
    data, err := os.ReadFile(filename)
    if err != nil {
        return nil, fmt.Errorf("failed to read config file: %w", err)
    }
    
    var config Config
    if err := json.Unmarshal(data, &config); err != nil {
        return nil, fmt.Errorf("failed to parse config: %w", err)
    }
    
    return &config, nil
}
\`\`\`

### Java
\`\`\`java
// Use proper exception handling and resource management
public class DatabaseService {
    public List<User> getUsers() throws SQLException {
        String sql = "SELECT id, name, email FROM users";
        
        try (Connection conn = dataSource.getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            
            List<User> users = new ArrayList<>();
            while (rs.next()) {
                users.add(new User(
                    rs.getLong("id"),
                    rs.getString("name"),
                    rs.getString("email")
                ));
            }
            return users;
        }
    }
}
\`\`\`

## Database Operations
\`\`\`sql
-- Use proper indexing for performance
CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_order_date ON orders(created_at);

-- Use transactions for data consistency
BEGIN TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
\`\`\`

## Docker Guidelines

### Docker Compose
\`\`\`yaml
# Use docker compose (with space), not docker-compose
# No version field (deprecated in newer versions)
services:
  web:
    image: node:latest
    container_name: myapp-web
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - TZ=Europe/Berlin
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
\`\`\`

### Dockerfile Best Practices
\`\`\`dockerfile
# Multi-stage build for smaller images
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S nextjs -u 1001
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
\`\`\`

## Performance Guidelines

### Database Optimization
- Use proper indexing strategies
- Implement connection pooling
- Use prepared statements
- Optimize queries with EXPLAIN/ANALYZE

### Caching Strategies
\`\`\`javascript
// Example: Redis caching
const redis = require('redis');
const client = redis.createClient();

async function getCachedData(key) {
    try {
        const cached = await client.get(key);
        if (cached) {
            return JSON.parse(cached);
        }
        
        const data = await fetchFromDatabase(key);
        await client.setex(key, 3600, JSON.stringify(data)); // 1 hour TTL
        return data;
    } catch (error) {
        console.error('Cache error:', error);
        return await fetchFromDatabase(key); // Fallback
    }
}
\`\`\`

## Security Considerations

### Input Validation
\`\`\`javascript
// Always validate and sanitize inputs
const validator = require('validator');

function validateUserInput(data) {
    const errors = [];
    
    if (!validator.isEmail(data.email)) {
        errors.push('Invalid email format');
    }
    
    if (!validator.isLength(data.password, { min: 8 })) {
        errors.push('Password must be at least 8 characters');
    }
    
    return { isValid: errors.length === 0, errors };
}
\`\`\`

### Environment Variables
\`\`\`bash
# Never commit sensitive data
# Use environment variables for configuration
export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
export JWT_SECRET="your-secret-key"
export API_KEY="your-api-key"
\`\`\`

## Testing Guidelines

### Unit Testing
\`\`\`javascript
// Example: Jest testing
describe('UserService', () => {
    test('should create user with valid data', async () => {
        const userData = { name: 'John', email: 'john@example.com' };
        const user = await userService.create(userData);
        
        expect(user.id).toBeDefined();
        expect(user.name).toBe(userData.name);
        expect(user.email).toBe(userData.email);
    });
    
    test('should throw error for invalid email', async () => {
        const userData = { name: 'John', email: 'invalid-email' };
        
        await expect(userService.create(userData))
            .rejects toThrow('Invalid email format');
    });
});
\`\`\`

## Monitoring and Logging

### Structured Logging
\`\`\`javascript
// Use structured logging with correlation IDs
const winston = require('winston');

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ]
});

// Log with context
logger.info('User created', {
    userId: user.id,
    correlationId: req.headers['x-correlation-id'],
    userAgent: req.headers['user-agent']
});
\`\`\`

### Health Checks
\`\`\`javascript
// Implement health check endpoints
app.get('/health', async (req, res) => {
    try {
        // Check database connection
        await db.ping();
        
        // Check external services
        await redis.ping();
        
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});
\`\`\`

## Documentation Standards

### API Documentation
\`\`\`yaml
# OpenAPI/Swagger example
/users/{id}:
  get:
    summary: Get user by ID
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    responses:
      200:
        description: User found
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/User'
      404:
        description: User not found
\`\`\`

### Code Documentation
- Add docstrings to all functions and classes
- Keep comments up-to-date with code changes
- Document complex algorithms and business logic
- Include usage examples in documentation

## Best Practices Summary

1. **Security First**: Always validate inputs, use parameterized queries, handle errors gracefully
2. **Performance**: Use caching, optimize database queries, implement proper indexing
3. **Maintainability**: Write clean, readable code with good separation of concerns
4. **Testing**: Write comprehensive tests, use TDD when appropriate
5. **Documentation**: Keep documentation current and comprehensive
6. **Monitoring**: Implement proper logging, health checks, and alerting
7. **Version Control**: Use meaningful commit messages, proper branching strategies
8. **Deployment**: Use containerization, infrastructure as code, automated CI/CD

## Project-Specific Notes
<!-- Add any project-specific guidelines here -->

## Resources
- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Security Guidelines](https://owasp.org/www-project-top-ten/)
`;

}

async function manageGitignore(workspaceDir: string): Promise<void> {
    const gitignorePath = path.join(workspaceDir, '.gitignore');
    const gitignoreEntry = '.github/copilot-instructions.md';
    
    try {
        let gitignoreContent = '';
        let fileExists = false;
        
        // Check if .gitignore exists and read its content
        if (fs.existsSync(gitignorePath)) {
            fileExists = true;
            gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            
            // Check if entry already exists (exact match or as part of a broader pattern)
            const lines = gitignoreContent.split('\n');
            const hasEntry = lines.some(line => {
                const trimmedLine = line.trim();
                return trimmedLine === gitignoreEntry || 
                       trimmedLine === 'copilot-instructions.md' ||
                       trimmedLine === '.github/' ||
                       trimmedLine === '.github/*';
            });
            
            if (hasEntry) {
                console.log('copilot-instructions.md already covered in .gitignore');
                return;
            }
        }
        
        // Add entry to .gitignore
        const newContent = fileExists 
            ? gitignoreContent + (gitignoreContent.endsWith('\n') ? '' : '\n') + gitignoreEntry + '\n'
            : gitignoreEntry + '\n';
            
        fs.writeFileSync(gitignorePath, newContent, 'utf8');
        
        const action = fileExists ? 'updated' : 'created';
        console.log(`Successfully ${action} .gitignore with copilot-instructions.md entry`);
        
    } catch (error) {
        console.error('Failed to manage .gitignore:', error);
        // Don't throw error as this is a non-critical feature
    }
}

async function configureSettings() {
    const config = vscode.workspace.getConfiguration('copilotInstructions');
    
    // Configure GitHub Token
    const currentToken = config.get<string>('githubToken');
    const token = await vscode.window.showInputBox({
        prompt: 'Enter your GitHub Personal Auth Token (with gist scope)',
        value: currentToken,
        password: true,
        placeHolder: 'Enter your GitHub Personal Access Token',
        validateInput: (value) => {
            if (!value) {
                return 'Token is required';
            }
            const prefix1 = 'gh' + 'p_';
            const prefix2 = 'git' + 'hub_pat_';
            if (!value.startsWith(prefix1) && !value.startsWith(prefix2)) {
                return 'Invalid token format';
            }
            return null;
        }
    });

    if (token === undefined) {
        return; // User cancelled
    }

    await config.update('githubToken', token, vscode.ConfigurationTarget.Global);

    // Configure Gist ID (optional)
    const currentGistId = config.get<string>('gistId');
    const gistId = await vscode.window.showInputBox({
        prompt: 'Enter existing Gist ID (optional - leave empty to create new gist on first upload)',
        value: currentGistId,
        placeHolder: 'abc123def456...',
        validateInput: (value) => {
            if (value && !/^[a-f0-9]+$/.test(value)) {
                return 'Invalid Gist ID format';
            }
            return null;
        }
    });

    if (gistId !== undefined) {
        await config.update('gistId', gistId, vscode.ConfigurationTarget.Global);
    }

    // Configure auto-manage .gitignore option
    const currentAutoManage = config.get<boolean>('autoManageGitignore', true);
    const autoManageOptions = ['Yes', 'No'];
    const autoManageChoice = await vscode.window.showQuickPick(autoManageOptions, {
        placeHolder: 'Automatically add copilot-instructions.md to .gitignore when downloading?',
        title: 'Auto-manage .gitignore',
        ignoreFocusOut: true,
        canPickMany: false
    });

    if (autoManageChoice !== undefined) {
        const autoManageValue = autoManageChoice === 'Yes';
        await config.update('autoManageGitignore', autoManageValue, vscode.ConfigurationTarget.Global);
    }

    // Configure auto-download on startup option
    const currentAutoDownload = config.get<boolean>('autoDownloadOnStartup', true);
    const autoDownloadOptions = ['Yes', 'No'];
    const autoDownloadChoice = await vscode.window.showQuickPick(autoDownloadOptions, {
        placeHolder: 'Automatically check for newer instructions on startup?',
        title: 'Auto-download on startup',
        ignoreFocusOut: true,
        canPickMany: false
    });

    if (autoDownloadChoice !== undefined) {
        const autoDownloadValue = autoDownloadChoice === 'Yes';
        await config.update('autoDownloadOnStartup', autoDownloadValue, vscode.ConfigurationTarget.Global);
    }

    // Configure periodic sync option
    const currentPeriodicSync = config.get<boolean>('periodicSyncEnabled', true);
    const periodicSyncOptions = ['Yes', 'No'];
    const periodicSyncChoice = await vscode.window.showQuickPick(periodicSyncOptions, {
        placeHolder: 'Enable automatic periodic synchronization?',
        title: 'Periodic sync',
        ignoreFocusOut: true,
        canPickMany: false
    });

    if (periodicSyncChoice !== undefined) {
        const periodicSyncValue = periodicSyncChoice === 'Yes';
        await config.update('periodicSyncEnabled', periodicSyncValue, vscode.ConfigurationTarget.Global);
        
        if (periodicSyncValue) {
            // Configure sync interval
            const currentInterval = config.get<number>('periodicSyncInterval', 30);
            const intervalString = await vscode.window.showInputBox({
                prompt: 'Enter sync interval in minutes (1-1440)',
                value: currentInterval.toString(),
                placeHolder: '30',
                validateInput: (value) => {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 1 || num > 1440) {
                        return 'Please enter a number between 1 and 1440';
                    }
                    return null;
                }
            });

            if (intervalString !== undefined) {
                const intervalValue = parseInt(intervalString);
                await config.update('periodicSyncInterval', intervalValue, vscode.ConfigurationTarget.Global);
            }
        }
    }

    // Configure real-time sync option
    const currentRealTimeSync = config.get<boolean>('realTimeSyncEnabled', true);
    const realTimeSyncOptions = ['Yes', 'No'];
    const realTimeSyncChoice = await vscode.window.showQuickPick(realTimeSyncOptions, {
        placeHolder: 'Enable real-time file change detection and sync?',
        title: 'Real-time sync',
        ignoreFocusOut: true,
        canPickMany: false
    });

    if (realTimeSyncChoice !== undefined) {
        const realTimeSyncValue = realTimeSyncChoice === 'Yes';
        await config.update('realTimeSyncEnabled', realTimeSyncValue, vscode.ConfigurationTarget.Global);
    }

    vscode.window.showInformationMessage('Configuration updated successfully!');
}

async function openConfigurationPage(context?: vscode.ExtensionContext): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'copilotInstructionsConfig',
        'Copilot Instructions Settings',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    const config = vscode.workspace.getConfiguration('copilotInstructions');

    panel.webview.html = getConfigurationPageHTML(config);

    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'save':
                    try {
                        await config.update('githubToken', message.data.githubToken, vscode.ConfigurationTarget.Global);
                        await config.update('gistId', message.data.gistId, vscode.ConfigurationTarget.Global);
                        await config.update('autoManageGitignore', message.data.autoManageGitignore, vscode.ConfigurationTarget.Global);
                        await config.update('autoDownloadOnStartup', message.data.autoDownloadOnStartup, vscode.ConfigurationTarget.Global);
                        await config.update('periodicSyncEnabled', message.data.periodicSyncEnabled, vscode.ConfigurationTarget.Global);
                        await config.update('realTimeSyncEnabled', message.data.realTimeSyncEnabled, vscode.ConfigurationTarget.Global);
                        await config.update('periodicSyncInterval', message.data.periodicSyncInterval, vscode.ConfigurationTarget.Global);
                        
                        vscode.window.showInformationMessage('Configuration saved successfully!');
                        panel.webview.postMessage({ command: 'saved' });
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to save configuration: ${error}`);
                    }
                    break;
                case 'test':
                    try {
                        if (!message.data.githubToken) {
                            throw new Error('GitHub token is required for testing');
                        }
                        
                        const response = await fetch('https://api.github.com/user', {
                            headers: {
                                'Authorization': `token ${message.data.githubToken}`,
                                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
                            }
                        });
                        
                        if (response.ok) {
                            const user = await response.json();
                            vscode.window.showInformationMessage(`✅ Token valid! Connected as: ${user.login}`);
                            panel.webview.postMessage({ command: 'testResult', success: true, message: `Connected as: ${user.login}` });
                        } else {
                            throw new Error(`API returned ${response.status}: ${response.statusText}`);
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`❌ Token test failed: ${error}`);
                        panel.webview.postMessage({ command: 'testResult', success: false, message: `${error}` });
                    }
                    break;
                case 'openTokenPage':
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/tokens/new?scopes=gist&description=Copilot%20Instructions%20Manager'));
                    break;
            }
        }
    );
}

function getConfigurationPageHTML(config: vscode.WorkspaceConfiguration): string {
    const githubToken = config.get<string>('githubToken', '');
    const gistId = config.get<string>('gistId', '');
    const autoManageGitignore = config.get<boolean>('autoManageGitignore', true);
    const autoDownloadOnStartup = config.get<boolean>('autoDownloadOnStartup', true);
    const periodicSyncEnabled = config.get<boolean>('periodicSyncEnabled', true);
    const periodicSyncInterval = config.get<number>('periodicSyncInterval', 30);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copilot Instructions Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-textPreformat-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: var(--vscode-input-foreground);
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            box-sizing: border-box;
        }
        input[type="checkbox"] {
            margin-right: 8px;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
        }
        .description {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        .button-group {
            margin-top: 30px;
            display: flex;
            gap: 10px;
        }
        button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .primary-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .secondary-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .test-result {
            margin-top: 10px;
            padding: 8px;
            border-radius: 4px;
            display: none;
        }
        .test-success {
            background-color: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-inputValidation-infoForeground);
        }
        .test-error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }
        .link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .link:hover {
            color: var(--vscode-textLink-activeForeground);
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Copilot Instructions Manager Settings</h1>
        
        <div class="form-group">
            <label for="githubToken">GitHub Personal Access Token *</label>
            <input type="password" id="githubToken" placeholder="Enter your GitHub token here" value="${githubToken}">
            <div class="description">
                A GitHub Personal Access Token with 'gist' scope is required. 
                <a href="#" class="link" onclick="openTokenPage()">Create one here</a>
            </div>
            <button type="button" class="secondary-button" onclick="testToken()">Test Token</button>
            <div id="testResult" class="test-result"></div>
        </div>

        <div class="form-group">
            <label for="gistId">Gist ID (Optional)</label>
            <input type="text" id="gistId" placeholder="Leave empty to create new gist on first upload" value="${gistId}">
            <div class="description">
                If you have an existing gist, enter its ID here. Otherwise, a new gist will be created automatically.
            </div>
        </div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="autoManageGitignore" ${autoManageGitignore ? 'checked' : ''}>
                <label for="autoManageGitignore">Auto-manage .gitignore</label>
            </div>
            <div class="description">
                Automatically add copilot-instructions.md to .gitignore when downloading from gist to prevent committing sensitive instructions.
            </div>
        </div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="autoDownloadOnStartup" ${autoDownloadOnStartup ? 'checked' : ''}>
                <label for="autoDownloadOnStartup">Auto-download on startup</label>
            </div>
            <div class="description">
                Automatically check for newer instructions when opening workspaces and prompt to download updates.
            </div>
        </div>

        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="realTimeSyncEnabled" ${config.get<boolean>('realTimeSyncEnabled', true) ? 'checked' : ''}>
                <label for="realTimeSyncEnabled">Enable real-time sync</label>
            </div>
            <div class="description">
                Automatically sync when files are modified (immediate response to file changes).
            </div>
        </div>
        
        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="periodicSyncEnabled" ${periodicSyncEnabled ? 'checked' : ''}>
                <label for="periodicSyncEnabled">Enable periodic sync</label>
            </div>
            <div class="description">
                Automatically check for changes at regular intervals and sync with the remote gist.
            </div>
        </div>

        <div class="form-group">
            <label for="periodicSyncInterval">Sync interval (minutes)</label>
            <input type="number" id="periodicSyncInterval" min="1" max="1440" value="${periodicSyncInterval}">
            <div class="description">
                How often to check for changes (1-1440 minutes). Default is 30 minutes.
            </div>
        </div>



        <div class="button-group">
            <button type="button" class="primary-button" onclick="saveSettings()">Save Settings</button>
            <button type="button" class="secondary-button" onclick="window.close()">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function saveSettings() {
            const data = {
                githubToken: document.getElementById('githubToken').value,
                gistId: document.getElementById('gistId').value,
                autoManageGitignore: document.getElementById('autoManageGitignore').checked,
                autoDownloadOnStartup: document.getElementById('autoDownloadOnStartup').checked,
                periodicSyncEnabled: document.getElementById('periodicSyncEnabled').checked,
                realTimeSyncEnabled: document.getElementById('realTimeSyncEnabled').checked,
                periodicSyncInterval: parseInt(document.getElementById('periodicSyncInterval').value)
            };

            vscode.postMessage({
                command: 'save',
                data: data
            });
        }

        function testToken() {
            const token = document.getElementById('githubToken').value;
            const resultDiv = document.getElementById('testResult');
            
            if (!token) {
                showTestResult(false, 'Please enter a GitHub token first');
                return;
            }

            resultDiv.textContent = 'Testing token...';
            resultDiv.className = 'test-result';
            resultDiv.style.display = 'block';

            vscode.postMessage({
                command: 'test',
                data: { githubToken: token }
            });
        }

        function openTokenPage() {
            vscode.postMessage({
                command: 'openTokenPage'
            });
        }

        function showTestResult(success, message) {
            const resultDiv = document.getElementById('testResult');
            resultDiv.textContent = message;
            resultDiv.className = 'test-result ' + (success ? 'test-success' : 'test-error');
            resultDiv.style.display = 'block';
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'saved':
                    // Could show a success message or close the panel
                    break;
                case 'testResult':
                    showTestResult(message.success, message.message);
                    break;
            }
        });
    </script>
</body>
</html>`;
}

export function deactivate() {
    // Cleanup periodic sync timer
    if (periodicSyncTimer) {
        clearInterval(periodicSyncTimer);
        periodicSyncTimer = undefined;
    }

    // Cleanup file system watchers and debounce timers
    disposeFileSystemWatchers();
}

async function syncInstructions(uri?: vscode.Uri): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('copilotInstructions');
        const githubToken = config.get<string>('githubToken');
        const gistId = config.get<string>('gistId');

        if (!githubToken || !gistId) {
            const action = await vscode.window.showErrorMessage(
                'GitHub token or Gist ID not configured. Please configure your settings.',
                'Configure Now'
            ) as string | undefined;
            if (action === 'Configure Now') {
                await configureSettings();
            }
            return;
        }

        // Check workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        // Find local file paths
        const possiblePaths = [
            path.join(workspaceFolders[0].uri.fsPath, '.github', 'copilot-instructions.md'),
            path.join(workspaceFolders[0].uri.fsPath, 'copilot-instructions.md')
        ];

        let localFilePath: string | undefined;
        let localContent: string | undefined;

        // Check if local file exists and get content
        if (uri && uri.fsPath.endsWith('copilot-instructions.md')) {
            localFilePath = uri.fsPath;
            if (fs.existsSync(localFilePath)) {
                localContent = fs.readFileSync(localFilePath, 'utf8');
            }
        } else {
            localFilePath = possiblePaths.find(p => fs.existsSync(p));
            if (localFilePath) {
                localContent = fs.readFileSync(localFilePath, 'utf8');
            }
        }

        // Fetch remote content
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'VSCode-Copilot-Instructions-Manager'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const gist = await response.json() as GistResponse;
        const remoteFile = gist.files['copilot-instructions.md'];
        let remoteContent: string | undefined = remoteFile?.content;

        // Determine sync action based on local and remote state
        if (!localContent && !remoteContent) {
            // Neither exists - offer to create template
            const action = await vscode.window.showInformationMessage(
                'No copilot-instructions.md found locally or in gist. Create template?',
                'Create Template',
                'Cancel'
            ) as string | undefined;
            
            if (action === 'Create Template') {
                await createTemplateFile(uri);
            }
            return;
        }

        if (!localContent && remoteContent) {
            // Remote exists, local doesn't - download
            await downloadFromGist(uri);
            vscode.window.showInformationMessage('Sync complete: Downloaded from remote.');
            return;
        }

        if (localContent && !remoteContent) {
            // Local exists, remote doesn't - upload
            await uploadToGist(uri);
            vscode.window.showInformationMessage('Sync complete: Uploaded local file.');
            return;
        }

        if (localContent && remoteContent) {
            // Both exist - compare and sync
            
            if (areContentsEqual(localContent, remoteContent)) {
                vscode.window.showInformationMessage('Sync complete: Files are already synchronized.');
                return;
            }

            // Contents differ - determine which is newer
            const versionComparison = await checkRemoteVersion(githubToken, gistId, localContent);
            
            if (versionComparison === 'newer') {
                // Remote is newer
                const action = await vscode.window.showInformationMessage(
                    'Remote file is newer. Download the latest version?',
                    'Download',
                    'Upload Local Instead',
                    'Cancel'
                ) as string | undefined;
                
                if (action === 'Download') {
                    await downloadFromGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Downloaded newer remote version.');
                } else if (action === 'Upload Local Instead') {
                    await uploadToGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Uploaded local version.');
                }
            } else if (versionComparison === 'older') {
                // Local is newer
                const action = await vscode.window.showInformationMessage(
                    'Local file is newer. Upload to remote?',
                    'Upload',
                    'Download Remote Instead',
                    'Cancel'
                ) as string | undefined;
                
                if (action === 'Upload') {
                    await uploadToGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Uploaded newer local version.');
                } else if (action === 'Download Remote Instead') {
                    await downloadFromGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Downloaded remote version.');
                }
            } else {
                // Same version but different content
                const action = await vscode.window.showWarningMessage(
                    'Files have same version but different content. Choose sync direction:',
                    'Upload Local',
                    'Download Remote',
                    'Cancel'
                ) as string | undefined;
                
                if (action === 'Upload Local') {
                    await uploadToGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Uploaded local version.');
                } else if (action === 'Download Remote') {
                    await downloadFromGist(uri);
                    vscode.window.showInformationMessage('Sync complete: Downloaded remote version.');
                }
            }
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Sync failed: ${error}`);
        console.error('Sync error:', error);
    }
}
