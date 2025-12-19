# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PC Utility Pro - A Windows PC utility application built with Electron. Features real-time system monitoring, AI assistant (Claude-powered) with two-tier command capabilities, and disk cleanup tools.

## Commands

```bash
npm install    # Install dependencies
npm start      # Run the application
npm run dev    # Run in development mode
npm run build:win  # Build Windows installers
```

## Setup

Copy `config.json.example` to `config.json` and configure:
- `claudeApiKey` - Anthropic Claude API key (for AI assistant)
- `autoCheckUpdates` - Enable/disable auto-update checks

Environment variable `CLAUDE_API_KEY` overrides config.json.

## Architecture

```
src/
  main/main.js          # Electron main process - all IPC handlers, system APIs
  main/security/        # Command and path validation modules
  main/services/        # Audit logger, tray manager, offline AI, speed test
    speedTest.js        # Advanced network testing (jitter, bufferbloat, packet loss)
  main/handlers/        # IPC handler modules (systemInfo, cleanup, etc.)
  preload/preload.js    # Context bridge - exposes pcUtility API to renderer
  renderer/
    index.html          # UI with frameless window, sidebar navigation
    renderer.js         # Frontend logic, page navigation, event handlers
    styles.css          # Dark theme with CSS custom properties
```

### IPC Communication Pattern

Main process exposes handlers via `ipcMain.handle('channel-name', ...)`. Preload bridges them to renderer via `contextBridge.exposeInMainWorld('pcUtility', {...})`. Renderer calls `window.pcUtility.methodName()`.

Key IPC channels:
- `get-pc-mood` - Returns health score, CPU/RAM stats, and actionable insights
- `chat-with-ai` - AI assistant with tool use (file operations, commands)
- `run-speed-test` - Advanced network test (returns ping, jitter, download, upload, bufferbloat, grades, suitability)
- `enable-support-mode` / `disable-support-mode` / `get-support-mode-status` - Support mode management
- `cleanup-*` - Disk cleanup operations (temp, browser cache, recycle bin)
- `get-games` - Scans Steam/Xbox/Epic game directories

### AI Assistant Tools

The AI assistant uses Claude tool calling with these capabilities:
- File operations: `read_file`, `write_file`, `move_file`, `copy_file`, `delete_file`
- Directory operations: `list_directory`, `create_folder`, `search_files`
- System: `run_command` (with allowlist-based validation)
- Cleanup: `find_duplicates`, `find_large_files`, `organize_by_type`

### Two-Tier Command System

Commands are validated via allowlists in `src/main/security/commandValidator.js`:

**Basic Tier (Free AI Assistant):**
- Read-only diagnostics: `systeminfo`, `tasklist`, `ipconfig`, `dir`
- Safe app launchers

**Support Tier (Paid - when support mode enabled):**
- All basic tier commands plus:
- Process management: `taskkill`
- Disk cleanup: `cleanmgr`, temp file deletion
- Windows repair: `sfc /scannow`, `DISM`, `chkdsk`
- Network repair: `ipconfig /flushdns`, `netsh winsock reset`
- Service control: `net start/stop`

### App Data

Persistent data stored in `app.getPath('userData')/app-data.json`:
- Session count, last seen timestamp
- User facts (for AI context)
- Support request count

Notes stored in localStorage (`pc-utility-notes`).

## Key Implementation Details

- Frameless window with custom title bar (draggable via CSS `-webkit-app-region: drag`)
- System info via `systeminformation` package
- Process termination uses `taskkill /PID {pid} /F`
- Delete operations use PowerShell to send to Recycle Bin
- Advanced speed test via `src/main/services/speedTest.js`:
  - Uses Cloudflare endpoints for download/upload/ping
  - Measures jitter (15 samples), packet loss, bufferbloat
  - Extended duration (10-20s) for accurate results
  - Quality grading (A+ to D) and use-case suitability analysis
  - History saved in localStorage (`pc-utility-speed-history`)
- Games detection scans standard install paths for Steam, Xbox, Epic, Riot
- Single instance lock prevents multiple app instances

## Windows-Specific

Commands use `cmd.exe` or `powershell.exe` shells. Path separators are backslashes. The app is designed for Windows only.
