# Icon Generation Guide for PC Utility Pro

## Required Icon Files

For commercial distribution, you need the following icon files:

### Windows (Required)
- `assets/icon.ico` - Multi-resolution ICO file (16x16, 32x32, 48x48, 64x64, 128x128, 256x256)

### Recommended Additional Assets
- `assets/icon.png` - 512x512 PNG for high-DPI displays
- `assets/icon-256.png` - 256x256 PNG
- `build/installerIcon.ico` - Installer icon (256x256 minimum)
- `build/installerHeader.bmp` - 150x57 BMP for NSIS installer header
- `build/installerSidebar.bmp` - 164x314 BMP for NSIS installer sidebar

## Creating Your Icon

### Option 1: Online Tools (Quick)
1. Visit [Favicon.io](https://favicon.io/favicon-generator/) or [RealFaviconGenerator](https://realfavicongenerator.net/)
2. Design or upload your icon
3. Download the ICO package
4. Place `favicon.ico` as `assets/icon.ico`

### Option 2: Professional Design
1. Create a 1024x1024 PNG master icon
2. Use a tool like [png2ico](https://github.com/niclaslindstedt/png2ico) or GIMP to convert to ICO
3. Include all required sizes in the ICO file

### Option 3: PowerShell Script (Placeholder)
Run this to create a placeholder icon from system resources:

```powershell
# This creates a placeholder - replace with your actual branding
$iconPath = "$PSScriptRoot\..\assets\icon.ico"
$shell = New-Object -ComObject Shell.Application
# Note: For production, use a professionally designed icon
```

## Icon Design Guidelines

For a PC Utility application, consider:
- **Primary Color:** Blue/Purple gradient (matches current theme)
- **Shape:** Circuit board, gear, or shield motif
- **Style:** Modern, flat design with subtle gradients
- **Contrast:** Should be visible at 16x16 size

## Suggested Icon Concepts

1. **Shield with Gear** - Security + Optimization
2. **Dashboard Gauge** - System monitoring
3. **CPU Chip** - Technical/hardware focus
4. **Magic Wand** - AI/Automation capabilities
5. **Toolbox** - Utility suite concept

## After Creating Icons

1. Place `icon.ico` in the `assets/` folder
2. Verify the build with: `npm run pack`
3. Test the installer appearance
4. Check taskbar icon visibility at small sizes
