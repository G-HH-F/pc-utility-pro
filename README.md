# PC Utility Pro

<div align="center">

**The all-in-one Windows PC utility with AI-powered assistance**

[![Version](https://img.shields.io/badge/version-2.4.0-blue.svg)](https://github.com/G-HH-F/pc-utility-pro/releases)
[![CI](https://github.com/G-HH-F/pc-utility-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/G-HH-F/pc-utility-pro/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey.svg)]()
[![Tests](https://img.shields.io/badge/tests-12%20passing-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)]()

[Features](#features) • [Installation](#installation) • [Configuration](#configuration) • [Documentation](#documentation) • [Support](#support)

</div>

---

## Overview

PC Utility Pro is a modern Windows desktop application that combines system monitoring, AI-powered assistance, and powerful cleanup tools in a sleek, intuitive interface. Built with Electron for optimal performance and a beautiful dark theme for comfortable extended use.

## Features

### 🖥️ System Monitor
- **Real-time Metrics** - CPU, RAM, and disk usage at a glance
- **Process Manager** - View and terminate resource-hungry processes
- **Health Score** - Intelligent system health assessment with actionable insights
- **Network Speed Test** - Professional-grade testing with jitter, bufferbloat, packet loss detection, and use-case suitability analysis

### 🤖 AI Assistant (Max)
Powered by Claude AI, your personal PC assistant can:
- Answer questions about your computer and software
- Perform file operations (read, write, move, copy, delete)
- Search and organize files intelligently
- Execute safe system commands
- Find duplicate files and clean up clutter
- Organize folders by file type

### 🛠️ Cleanup Tools
- **Temp Files** - Remove Windows temporary files
- **Browser Cache** - Clear Chrome, Firefox, and Edge caches
- **Recycle Bin** - Empty recycle bin to free space
- **Space Analysis** - See exactly how much space you've recovered

### 🎮 Game Launcher
Automatically detects and launches games from:
- Steam
- Xbox/Microsoft Store
- Epic Games
- Riot Games (League of Legends, Valorant)

### 📝 Additional Features
- **Quick Notes** - Jot down thoughts with auto-save
- **Desktop Organizer** - Clean up your desktop intelligently
- **Remote IT Support** - Get help from support agents
- **Usage Insights** - Understand your productivity patterns

## Installation

### From Release (Recommended)
1. Download the latest release from the [Releases page](https://github.com/pcutilitypro/pc-utility-pro/releases)
2. Choose between:
   - **Installer** (`PC Utility Pro-x.x.x-Setup.exe`) - Full installation with shortcuts
   - **Portable** (`PC Utility Pro-x.x.x-Portable.exe`) - No installation required
3. Run and enjoy!

### From Source
```bash
# Clone the repository
git clone https://github.com/pcutilitypro/pc-utility-pro.git
cd pc-utility-pro

# Install dependencies
npm install

# Run the application
npm start

# Build distributable
npm run build:win
```

## Configuration

### Claude API Key (Required for AI Features)

The AI assistant requires an API key from [Anthropic](https://www.anthropic.com/).

**Option 1: Config File (Recommended)**
```bash
# Copy the example configuration
copy config.json.example config.json

# Edit config.json and add your key
{
  "claudeApiKey": "your-api-key-here"
}
```

**Option 2: Environment Variable**
```bash
set CLAUDE_API_KEY=your-api-key-here
```

**Option 3: In-App Settings**
Navigate to Settings → Enter your API key in the Claude API Key field

### Remote Support Configuration (Optional)

For IT support features, configure Pushover notifications:
```json
{
  "pushoverUser": "your-pushover-user-key",
  "pushoverToken": "your-pushover-app-token",
  "supportContactName": "IT Support"
}
```

## System Requirements

| Component | Requirement |
|-----------|-------------|
| OS | Windows 10 or later |
| RAM | 4 GB minimum |
| Disk | 200 MB available space |
| Display | 1280x720 minimum |
| Node.js | 18+ (for development) |

## Project Structure

```
pc-utility-pro/
├── src/
│   ├── main/main.js          # Electron main process
│   ├── preload/preload.js    # Context bridge
│   └── renderer/
│       ├── index.html        # Application UI
│       ├── renderer.js       # Frontend logic
│       └── styles.css        # Dark theme styling
├── assets/                   # Application icons and images
├── build/                    # Build configuration
├── config.json.example       # Configuration template
├── package.json              # Dependencies and scripts
├── LICENSE                   # MIT License
├── PRIVACY_POLICY.md         # Privacy Policy
├── EULA.md                   # End User License Agreement
└── CHANGELOG.md              # Version history
```

## Documentation

- [Privacy Policy](PRIVACY_POLICY.md) - How we handle your data
- [EULA](EULA.md) - End User License Agreement
- [Changelog](CHANGELOG.md) - Version history and updates
- [Icon Guide](build/ICON_GUIDE.md) - Creating application icons

## Security

- **Local Data Only** - All analytics and user data stored locally
- **No Hardcoded Keys** - API keys loaded from config or environment
- **Safe Commands** - AI assistant has a blocklist for dangerous operations
- **Optional Features** - Remote support requires explicit user action

## Support

- **Issues:** [GitHub Issues](https://github.com/pcutilitypro/pc-utility-pro/issues)
- **Email:** support@pcutilitypro.com
- **Documentation:** [Wiki](https://github.com/pcutilitypro/pc-utility-pro/wiki)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Made with ❤️ by PC Utility Pro Team

© 2025 PC Utility Pro. All rights reserved.
</div>
