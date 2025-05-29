# Copilot Instructions Manager

[![CI](https://github.com/username/vscode_manage_instructions/actions/workflows/ci.yml/badge.svg)](https://github.com/username/vscode_manage_instructions/actions/workflows/ci.yml)
[![Release](https://github.com/username/vscode_manage_instructions/actions/workflows/release.yml/badge.svg)](https://github.com/username/vscode_manage_instructions/actions/workflows/release.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/publisher.copilot-instructions-manager)](https://marketplace.visualstudio.com/items?itemName=publisher.copilot-instructions-manager)

A VS Code extension for managing your `copilot-instructions.md` file with GitHub Gists. This extension allows you to easily upload and download your Copilot instructions to/from a GitHub Gist, keeping them synchronized across different projects and machines.

## ✨ Features

- **🚀 One-click Upload**: Right-click on `copilot-instructions.md` to upload it to a GitHub Gist
- **📥 Easy Download**: Right-click in the file explorer to download the latest version
- **📁 Auto-create directories**: Automatically creates `.github` directory when downloading
- **🔒 Auto-manage .gitignore**: Automatically adds `copilot-instructions.md` to `.gitignore` when downloading (configurable)
- **🔄 Version Management**: Automatic version tracking and increment on each upload
- **🎯 Auto-Download on Startup**: Automatically checks for newer instructions files when opening workspaces (enabled by default)
- **⏰ Periodic Sync**: Automatically checks for changes at configurable intervals (30 minutes default, enabled by default)
- **📋 Template Creation**: Creates comprehensive instruction templates when no file exists in gist
- **⚙️ Simple Configuration**: Easy setup for GitHub token, Gist ID, and behavior preferences
- **🔄 Smart Updates**: Automatically updates existing Gists or creates new ones
- **🎯 Command Palette**: Full integration with VS Code Command Palette
- **🔕 Silent Operation**: Configurable notifications (disabled by default for unobtrusive operation)
- **🔒 Secure**: Your GitHub token is stored securely in VS Code's configuration

## 🆕 What's New in v1.6.2

- **🔄 Real-time File Sync**: Automatic sync when files change
  - Immediate sync triggers when you save copilot-instructions.md files
  - Debounced sync (2-second delay) prevents excessive API calls
  - Monitors both `.github/copilot-instructions.md` and root `copilot-instructions.md`
  - Works alongside periodic sync for comprehensive coverage
- **⚡ Enhanced Responsiveness**: No more waiting for timer intervals
  - Files sync immediately when modified, not just every 30 minutes
  - Better user experience with instant feedback on changes
  - Silent operation with proper error handling and logging

### Previous Features (v1.6.1)

- **🎯 Simplified Interface**: Streamlined UI with single sync command
  - Removed separate upload/download buttons for cleaner interface
  - Only unified "Sync Copilot Instructions" command available
- **🔄 Smarter Periodic Sync**: Enhanced automatic sync behavior
  - Periodic sync only downloads newer remote content
  - No automatic uploads when local file is newer (use manual sync for uploads)
  - More predictable and less intrusive background operation

### Previous Features (v1.6.0)

- **🔄 Unified Sync Command**: New intelligent sync command that automatically determines the best action
  - Single command handles all sync scenarios: create, upload, download, and conflict resolution
  - Smart analysis of local vs remote file states with user-friendly prompts
  - Added to command palette, context menus, and keyboard shortcuts
- **⚡ Enhanced Periodic Sync**: Background sync now handles both upload and download scenarios automatically
- **🤖 Intelligent Sync Logic**: Advanced decision-making with content-aware synchronization
- **📁 Improved Menu Organization**: Restructured context menus with logical groupings

### Previous Features (v1.5.0)

- **⏰ Periodic Sync**: Automatic background synchronization checks at configurable intervals (1-1440 minutes)
- **🔕 Notification Control**: Configurable notifications - disabled by default for silent operation
- **🎯 Enhanced Auto-Sync**: Smarter background updates that work silently when notifications are off
- **⚙️ Improved Configuration**: New settings for sync intervals and notification preferences

- **📊 Version Tracking**: Each upload automatically increments version numbers with timestamps
- **🔄 Smart Auto-Updates**: Extension checks for newer versions on startup and prompts for updates
- **📋 Rich Templates**: When no instructions exist, creates comprehensive templates with examples for:
  - JavaScript/TypeScript, Python, Go, Java
  - Docker and Docker Compose
  - Security best practices
  - Performance optimization
  - Testing strategies
  - Git workflows and documentation standards
- **⚙️ Enhanced Configuration**: New auto-download setting with user-friendly configuration dialog

## 🚀 Quick Start

### Installation

**Option 1: From GitHub Releases (Recommended)**
1. Go to [GitHub Releases](https://github.com/elcool0r/vscode_manage_instructions/releases)
2. Download the latest `copilot-instructions-manager-{version}.vsix` file
3. Install using command line:
   ```bash
   code --install-extension copilot-instructions-manager-{version}.vsix
   ```

**Option 2: From VS Code UI**
1. Open VS Code Extensions view (`Ctrl+Shift+X`)
2. Click the `...` menu → "Install from VSIX..."
3. Choose the downloaded `.vsix` file

### Initial Setup

1. **Create GitHub Personal Access Token**:
   - Go to [GitHub Token Settings](https://github.com/settings/tokens/new?scopes=gist&description=Copilot%20Instructions%20Manager)
   - Select scope: `gist` (required)
   - Copy the generated token

2. **Configure the extension**:
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run "Copilot Instructions: Configure GitHub Gist Settings"
   - Enter your GitHub token
   - Optionally enter an existing Gist ID

### Basic Usage
- **Sync**: Right-click on `copilot-instructions.md` or in explorer → "Sync Copilot Instructions"
- **Command Palette**: Use `Ctrl+Shift+P` → "Copilot Instructions: Sync Copilot Instructions"

## Usage

### Syncing Instructions

1. Right-click on your `copilot-instructions.md` file or any folder in the explorer
2. Select "Sync Copilot Instructions" from the "Copilot Instructions" submenu
3. The extension will intelligently determine the best action:
   - **Create template** if no files exist
   - **Download** if only remote exists
   - **Upload** if only local exists  
   - **Compare and resolve** if both exist with differences
4. Follow the prompts to complete the sync operation

### Configuration

Use the Command Palette to run:
- `Copilot Instructions: Configure GitHub Gist Settings` - Set up your GitHub token, Gist ID, and .gitignore preferences

#### Configuration Options

- **GitHub Token**: Personal Access Token with `gist` scope
- **Gist ID**: (Optional) ID of existing Gist to use for updates
- **Auto-manage .gitignore**: (Default: enabled) Automatically add `copilot-instructions.md` to `.gitignore` when downloading
- **Auto-download on startup**: (Default: enabled) Check for newer instructions when opening workspaces
- **Periodic sync**: (Default: enabled) Automatically check for changes at regular intervals
- **Real-time sync**: (Default: enabled) Enable immediate sync when files are changed
- **Sync interval**: (Default: 30 minutes) How often to check for changes (1-1440 minutes)

#### Sync Mechanisms

The extension provides two complementary sync mechanisms that can be independently controlled:

- **🔄 Periodic Sync**: Timer-based sync that runs at configurable intervals (default: 30 minutes)
  - Ideal for regular background synchronization
  - Works even when files aren't being actively modified
  - Can be set from 1 minute to 24 hours (1440 minutes)

- **⚡ Real-time Sync**: Immediate sync triggered by file changes (with 2-second debounce)
  - Instant response when you save copilot-instructions.md files
  - Prevents work loss by syncing changes immediately
  - Uses file system watchers for efficient monitoring

Both mechanisms can be enabled simultaneously for comprehensive coverage, or individually based on your workflow preferences.

## Requirements

- VS Code 1.74.0 or higher
- GitHub Personal Access Token with `gist` scope

## Security

Your GitHub token is stored securely in VS Code's configuration. The extension only accesses GitHub's Gist API and does not send data anywhere else.

## Troubleshooting

### Testing Periodic Sync

If you're unsure whether periodic sync is working:

1. **Check the Output Channel**: Open `View > Output` and select "Copilot Instructions Manager" from the dropdown
2. **Enable Notifications**: Set `copilotInstructions.showNotifications` to `true` temporarily
3. **Use a Short Interval**: Set `copilotInstructions.periodicSyncInterval` to `1` or `2` minutes for testing
4. **Manual Test**: Use the command "Copilot Instructions: Test Periodic Sync (Debug)" from the Command Palette
5. **Check Logs**: The output channel will show all sync activity with timestamps

### Common Issues

- **No sync activity**: Ensure you have configured both GitHub token and Gist ID
- **Permissions error**: Verify your GitHub token has the `gist` scope
- **Network issues**: Check your internet connection and GitHub status

## Development

For development setup, testing, and release processes, see:
- [Testing Guide](TESTING_GUIDE.md) - Comprehensive testing instructions
- [Release Process](RELEASE_PROCESS.md) - Automated release workflow
- [GitHub Actions](.github/GITHUB_ACTIONS.md) - CI/CD pipeline documentation

## Contributing

This extension was created to help manage Copilot instructions across projects. Feel free to suggest improvements or report issues.

## License

MIT License
