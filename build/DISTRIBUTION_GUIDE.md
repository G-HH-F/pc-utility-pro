# PC Utility Pro - Build and Distribution Guide

## Pre-Build Checklist

### Required Files
- [ ] `assets/icon.ico` - Application icon (256x256 multi-resolution)
- [ ] `config.json` removed from repository (use config.json.example)
- [ ] All API keys removed from source code
- [ ] Version number updated in package.json

### Code Signing (Recommended for Distribution)

#### Windows Code Signing Certificate
1. Purchase from a CA (DigiCert, Sectigo, GlobalSign)
   - Standard: ~$200-400/year
   - EV (Extended Validation): ~$300-600/year (removes SmartScreen warnings faster)

2. Configure in `package.json`:
```json
"win": {
  "certificateFile": "path/to/certificate.pfx",
  "certificatePassword": "your-password"
}
```

Or use environment variables:
```bash
set CSC_LINK=path/to/certificate.pfx
set CSC_KEY_PASSWORD=your-password
```

## Build Commands

```bash
# Install dependencies (first time only)
npm install

# Development run
npm start

# Build for Windows (unsigned)
npm run build:win

# Build for Windows (signed)
npm run build:win:signed

# Create unpacked directory (for testing)
npm run pack
```

## Output Files

After building, find your installers in `dist/`:

```
dist/
├── PC Utility Pro-2.4.0-win-x64.exe       # 64-bit installer
├── PC Utility Pro-2.4.0-win-ia32.exe      # 32-bit installer
├── PC Utility Pro-2.4.0-Portable.exe       # Portable version
├── latest.yml                              # Auto-update manifest
└── win-unpacked/                           # Unpacked app directory
```

## Distribution Channels

### 1. Direct Download (Website)
- Host installer on your website
- Provide checksums (SHA256) for verification
- Include system requirements and installation instructions

### 2. GitHub Releases
```bash
# Create a release on GitHub
gh release create v2.1.0 dist/*.exe --title "v2.1.0" --notes "Release notes here"
```

### 3. Microsoft Store
Requirements:
- Windows App Certification Kit (WACK) passed
- Privacy policy URL
- Age rating completed
- Store listing assets (screenshots, description)

### 4. Package Managers
- **Winget:** Submit manifest to microsoft/winget-pkgs
- **Chocolatey:** Create .nuspec package
- **Scoop:** Add to scoop bucket

## Auto-Update Setup

1. Configure GitHub releases as update source (already in package.json)
2. Add electron-updater dependency:
```bash
npm install electron-updater
```

3. Add update check in main.js:
```javascript
const { autoUpdater } = require('electron-updater');
app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
```

## Testing Checklist

### Functionality Tests
- [ ] App launches without errors
- [ ] System monitoring displays correct values
- [ ] AI Assistant responds (with valid API key)
- [ ] Cleanup tools work correctly
- [ ] All navigation works
- [ ] Settings are saved and restored
- [ ] Remote support initiates correctly

### Installation Tests
- [ ] Installer runs without errors
- [ ] Desktop shortcut created
- [ ] Start menu shortcut created
- [ ] App appears in Add/Remove Programs
- [ ] Uninstaller removes all files
- [ ] Portable version runs from any location

### Compatibility Tests
- [ ] Windows 10 (various builds)
- [ ] Windows 11
- [ ] Different screen resolutions
- [ ] Different DPI settings
- [ ] Fresh Windows installation

## Release Checklist

1. [ ] Update version in package.json
2. [ ] Update CHANGELOG.md
3. [ ] Run all tests
4. [ ] Build signed installers
5. [ ] Verify checksums
6. [ ] Create GitHub release
7. [ ] Update website download links
8. [ ] Announce release

## Troubleshooting

### Build Errors
- **Missing icon:** Create `assets/icon.ico` with multi-resolution support
- **Node-gyp errors:** Install Windows Build Tools: `npm install -g windows-build-tools`
- **Signing errors:** Verify certificate password and file path

### Runtime Errors
- **DLL not found:** Ensure all dependencies are bundled
- **API errors:** Check API key configuration
- **Permission errors:** App may need admin rights for some operations

## Support

- Documentation: https://pcutilitypro.com/docs
- Issues: https://github.com/pcutilitypro/pc-utility-pro/issues
- Email: support@pcutilitypro.com
