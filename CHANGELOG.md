# Changelog

## [1.6.4] - 2025-05-29

### Added
- **⚙️ Real-time Sync Control**: Added configuration option to enable/disable real-time file change detection
  - New setting: `copilotInstructions.realTimeSyncEnabled` (default: true)
  - Independent control from periodic sync - can disable real-time sync while keeping periodic sync
  - Configuration available in Settings UI, Configuration Page, and Command Line setup
  - Dynamic updates - changes take effect immediately without extension reload

### Enhanced
- **🔍 Enhanced Debug Command**: Updated debug status to show both periodic and real-time sync configuration
  - Shows status of both sync mechanisms with clear enable/disable indicators
  - Displays sync interval and file watcher count for comprehensive troubleshooting
  - Improved console logging with emoji indicators for better visibility

### Technical
- Added `initializeFileSystemWatchers()` check for `realTimeSyncEnabled` setting
- Updated configuration change listener to restart file watchers when real-time sync setting changes
- Added output channel initialization and proper logging infrastructure
- Enhanced configuration page HTML with real-time sync toggle and description

## [1.6.3] - 2025-05-28

### Fixed
- **🚀 Automatic Upload of Newer Local Files**: Fixed periodic sync to automatically upload local files when they are newer than remote versions
  - Removed conservative "skip upload" behavior that prevented automatic synchronization
  - Periodic sync now performs true bidirectional sync: downloads newer remote files AND uploads newer local files
  - Silent operation - no user prompts or confirmations required for automatic uploads
  - Maintains user workflow without interruptions while ensuring files stay synchronized

### Enhanced
- **🐛 Debug Command**: Added `copilot-instructions.debugSync` command for troubleshooting sync issues
  - Provides comprehensive status report of sync configuration
  - Shows file system watcher status and sync timer information
  - Helpful for diagnosing sync problems and verifying configuration

## [1.6.2] - 2025-05-28

### Added
- **🔄 Real-time File Sync**: Implemented file system watchers for immediate sync when copilot-instructions.md files change
  - Automatic sync triggers when files are saved or modified
  - Debounced sync (2-second delay) to prevent excessive API calls during multiple rapid saves
  - Monitors both `.github/copilot-instructions.md` and `copilot-instructions.md` locations
  - Works alongside existing periodic sync for comprehensive coverage
- **⚡ Enhanced Sync Architecture**: Improved sync system with better responsiveness
  - Real-time change detection complements timer-based periodic sync
  - Proper cleanup and disposal of file system watchers
  - Configuration changes now restart both periodic sync and file watchers

### Fixed
- **📁 Periodic Sync Issues**: Resolved issue where periodic sync only ran on timer intervals
  - Files now sync immediately when changed, not just every 30 minutes
  - Better user experience with immediate feedback on file modifications
  - Maintains silent operation with proper error handling and logging

### Technical
- Added `initializeFileSystemWatchers()`, `triggerDebouncedSync()`, and `performFileChangeSync()` functions
- Implemented proper file system watcher disposal in `deactivate()` function
- Added debouncing mechanism to prevent sync storms during rapid file changes
- Enhanced configuration change listener to restart file watchers when settings change

## [1.6.1] - 2025-05-28

### Changed
- **Simplified UI**: Removed individual upload and download commands from context menus and command palette
  - Only the unified "Sync Copilot Instructions" command is now available
  - Cleaner, more intuitive user interface with single sync entry point
- **Enhanced Periodic Sync**: Modified periodic sync behavior for better user experience
  - No longer prompts or automatically uploads when local file is newer than remote
  - Periodic sync now only downloads newer remote content automatically
  - Users must use manual sync command to upload local changes

### Removed
- Upload and download commands from context menus
- Upload and download commands from command palette

## [1.6.0] - 2025-05-28

### Added
- **🔄 Unified Sync Command**: New intelligent sync command that consolidates upload and download functionality
  - Single "Sync Copilot Instructions" command that automatically determines the best sync action
  - Smart analysis of local vs remote file states with user-friendly prompts
  - Handles all sync scenarios: create template, download remote, upload local, resolve conflicts
  - Added to command palette, context menus, and keyboard shortcuts
- **🤖 Intelligent Sync Logic**: Advanced decision-making for synchronization
  - Automatic detection when files are already synchronized
  - Version comparison with smart conflict resolution prompts
  - Content-aware sync that preserves user intent
  - Graceful handling of edge cases (missing files, network errors)
- **⚡ Enhanced Periodic Sync**: Updated background sync to use unified logic
  - Bidirectional sync capability (was previously download-only)
  - Automatic upload of newer local files during periodic checks
  - Improved logging and error handling for background operations
  - Silent operation with optional user notifications

### Changed
- **📁 Menu Organization**: Restructured context menus with logical groupings
  - Group 1: Sync operations (unified sync)
  - Group 2: Upload operations  
  - Group 3: Download operations
  - Group 4: Settings and configuration
- **🔧 Periodic Sync Enhancement**: Background sync now handles both upload and download scenarios
- **💡 User Experience**: More intuitive prompts and clearer messaging for sync operations

### Technical
- Implemented comprehensive `syncInstructions()` function with 140+ lines of sync logic
- Enhanced `performPeriodicSync()` to use unified sync approach with `performAutoSync()` helper
- Updated command registration to include new sync command
- Improved error handling and user feedback throughout sync operations
- Added extensive logging for debugging and monitoring sync activities

## [1.5.0] - 2025-05-28

### Added
- **Periodic Sync**: Automatic background synchronization that checks for changes at configurable intervals
  - Default interval: 30 minutes (configurable from 1-1440 minutes)
  - Enabled by default for seamless operation
  - Smart sync that only updates when remote content is newer
- **Notification Control**: Configurable notification system
  - Disabled by default for silent, unobtrusive operation
  - When disabled, updates happen automatically in background
  - When enabled, prompts user before updating
- **Enhanced Configuration UI**: Updated settings page with new options for periodic sync and notifications
- **Smart Background Updates**: Silent updates when notifications are disabled, user prompts when enabled

### Changed
- **Default Behavior**: Notifications are now disabled by default for better user experience
- **Auto-sync Logic**: Enhanced to work with periodic sync and notification preferences
- **Configuration Options**: Extended with periodic sync and notification settings

### Technical
- Added `periodicSyncTimer` for background sync operations
- Implemented `initializePeriodicSync()` and `performPeriodicSync()` functions
- Enhanced configuration page with new form fields and validation
- Updated cleanup in `deactivate()` to clear periodic timer
- Configuration changes now restart periodic sync automatically

## [1.3.2] - 2025-05-28

### Fixed
- **Content Comparison Bug**: Fixed critical issue where content comparison failed because version metadata was modified before comparing with remote content
- **Checksum Implementation**: Now uses SHA256 checksums of normalized content (excluding version metadata) for accurate content comparison
- **Upload Workflow**: Modified to compare original content first, then update version only when actually needed

### Technical
- Implemented `getContentChecksum()` and `areContentsEqual()` functions using crypto.createHash('sha256')
- Fixed upload workflow to preserve original content for comparison before modification
- Updated `checkRemoteVersion()` to use content-based comparison instead of timestamp comparison
- Removed duplicate `extension.ts` file in root directory that was causing compilation issues

## [1.3.1] - 2025-05-28

### Fixed
- **Version Management Bug**: Fixed issue where version was incorrectly incremented without proper gist version checking
- **Versioning Logic**: Instructions file now uses independent versioning system instead of modifying extension VERSION file
- **Smart Upload Logic**: Version increment now only occurs when logically appropriate:
  - Skip increment when canceling upload or downloading remote first
  - Increment when overwriting newer remote (user choice to upload local content)
  - Increment when force uploading same version (to distinguish the upload)
  - Increment when local is newer than remote (normal behavior)
  - Increment for new uploads (no existing gist)

### Technical
- Separated instructions file versioning from extension versioning
- Improved `getNextVersion()` to use semantic versioning based on current content
- Enhanced upload workflow to conditionally update versions

## [1.3.0] - 2025-05-28

### Added
- **Enhanced .gitignore Management**: Comprehensive best practice patterns including Node.js, VS Code, OS files, IDE files, logs, coverage, temporary files, Docker, and security-related patterns
- **Smart Version Checking**: Enhanced upload workflow with intelligent version comparison
  - Check remote version before upload
  - Prompt user when remote is newer with options to overwrite, cancel, or download remote first
  - Skip upload when versions are same unless forced
  - Auto-increment version when local is newer
- **Configuration Page**: Professional webview-based configuration interface
  - HTML/CSS/JavaScript UI with VS Code theming
  - Token validation with GitHub API testing
  - Form handling for all extension settings
  - Right-click menu access via "Open Configuration Page" command

### Enhanced
- **Upload Workflow**: Pre-upload version checking with user prompts for version conflicts
- **User Experience**: More intuitive configuration with visual feedback
- **Security**: Fixed token placeholder patterns to prevent false security warnings

### Technical
- Added `checkRemoteVersion()` function with GitHub API integration
- Enhanced `uploadToGist()` with version conflict resolution
- Implemented webview-based configuration with message passing
- Added new command `copilot-instructions.openConfigPage`

## [1.2.0] - 2025-05-27

### Added
- **Version Management**: Automatic version tracking and increment on upload
- **Auto-Download on Startup**: Automatically check for newer instructions files (enabled by default)
- **Template Creation**: Create comprehensive template when no file exists in gist
- **Enhanced Configuration**: New setting for auto-download behavior

### Features
- Version metadata embedded in instruction files with timestamps
- Smart version comparison using metadata and file modification times
- Comprehensive template with examples for all major languages and frameworks
- User prompts for update decisions with option to disable auto-checking
- Automatic VERSION file management

### Template Includes
- JavaScript/TypeScript, Python, Go, Java examples
- Docker and Docker Compose best practices
- Security guidelines and input validation
- Performance optimization strategies
- Testing patterns and monitoring examples
- Git workflows and documentation standards

## [1.1.1] - 2025-05-26

### Improved
- Enhanced context menu organization with dedicated "Copilot Instructions" submenu
- Better placement of upload/download commands in right-click menu
- Added configuration option to the context submenu for easier access
- Cleaner menu structure with proper grouping and ordering

## [1.1.0] - 2025-05-26

### Added
- Auto-manage .gitignore feature: Automatically adds `.github/copilot-instructions.md` to `.gitignore` when downloading from gist
- New configuration option `autoManageGitignore` (enabled by default)
- Enhanced configuration dialog to include .gitignore management preferences
- Smart .gitignore detection to avoid duplicate entries

### Changed
- Configuration dialog now includes .gitignore management option
- Improved user experience with better feedback for .gitignore operations

## [1.0.0] - 2025-05-26

### Added
- Initial release of Copilot Instructions Manager
- Upload copilot-instructions.md to GitHub Gist via right-click context menu
- Download copilot-instructions.md from GitHub Gist to .github directory
- Configuration for GitHub Personal Access Token and Gist ID
- Automatic creation of .github directory when downloading
- Support for creating new Gists or updating existing ones
- Command Palette integration for all operations
