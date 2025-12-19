# Changelog

All notable changes to PC Utility Pro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2025-12-19

### Security
- **Command Injection Prevention** - Added PID validation in quick-fix handler to prevent command injection
- **Path Traversal Protection** - Added path validation for `get_file_info`, `find_duplicates`, and `find_large_files` operations
- **XSS Prevention** - Implemented allowlist for page navigation to prevent script injection
- **URL Validation** - Added protocol validation in `open-external` handler (only allows http/https)
- **UNC Path Blocking** - Blocked network share paths to prevent SSRF attacks
- **Command Chaining Prevention** - Added validation to block command chaining operators (&&, ||, |, ;, etc.)
- **Session Lifetime Limits** - Added 4-hour absolute max session lifetime to prevent indefinite session extension
- **Null-safe Event Handlers** - Fixed potential crashes from missing UI elements

### Added
- **Automated Test Suite** - Added Playwright tests for Electron app (12 tests covering core functionality)
- **Advanced Speed Test Module** - Complete rewrite of network testing:
  - Jitter measurement with 15 ping samples for accuracy
  - Packet loss detection and percentage reporting
  - Bufferbloat detection (measures latency increase under load)
  - Extended test duration (10-20 sec download, 8-15 sec upload) matching professional speed tests
  - Quality grading system (A+ to D) for each metric
  - Overall connection score (0-100)
  - Use-case suitability analysis (gaming, 4K streaming, video calls, work from home, cloud gaming)
  - Smart recommendations based on detected issues
- **Speed Test History** - Results saved locally with trend tracking
- **AI Speed Test Analysis** - Ask Max to analyze your speed test results and get personalized recommendations
- **Live Progress Display** - Real-time speed updates during testing

### Changed
- Speed test now runs for minimum duration to ensure accurate results
- Improved outlier removal in speed calculations for more consistent results
- Quality thresholds aligned with industry standards

## [2.3.0] - 2025-12-17

### Changed
- **Architecture:** Removed LocalTunnel dependency - support mode now works entirely locally
- Support mode is now a local toggle that enables enhanced AI capabilities
- No external network connections required for support features
- AI assistant automatically uses support-tier commands when support mode is active

### Removed
- LocalTunnel dependency (eliminated 6 npm vulnerabilities)
- Remote HTTP server for support sessions
- Access code system for remote connections

### Fixed
- Simplified support flow - no more tunnels, servers, or access codes
- Reduced attack surface by removing network-exposed endpoints

## [2.2.0] - 2025-12-17

### Security
- **CRITICAL:** Fixed remote command execution vulnerability in support endpoint
- Implemented two-tier command validation system:
  - Basic tier (free AI): Read-only diagnostics only
  - Support tier (paid AI): Extended commands for applying fixes
- Added comprehensive blocklist for dangerous operations (format, registry, credential theft, etc.)
- All remote commands now logged to audit trail

### Added
- Application icon (gear/cog design with AI indicator)
- System tray integration with quick actions menu
- Support tier command allowlist for IT fix operations:
  - Process management (taskkill)
  - Disk cleanup and temp file clearing
  - Windows repair tools (sfc, DISM, chkdsk)
  - Network repair (flush DNS, reset Winsock)
  - Service management (start/stop)
  - Browser cache clearing
  - Event log viewing

### Changed
- Remote support AI can now apply fixes (paid feature differentiation)
- Improved security module with tiered validation

## [2.1.0] - 2025-12-11

### Security
- **CRITICAL:** Removed hardcoded API key from source code
- API keys now loaded securely from config file or environment variables only

### Added
- LICENSE file (MIT License)
- Privacy Policy (PRIVACY_POLICY.md)
- End User License Agreement (EULA.md)
- Changelog (this file)
- Commercial Readiness Report

### Changed
- Updated config loading to be more secure
- Improved documentation for API key setup

### Fixed
- Security vulnerability with exposed credentials

## [2.0.0] - 2025-12-10

### Added
- AI Assistant (Max) powered by Claude
  - Natural language conversation
  - File operations (read, write, move, copy, delete)
  - Directory management
  - System command execution
  - Duplicate file finder
  - Folder organization
- User behavior analytics (local storage only)
  - Micro-behavior tracking
  - Pattern analysis
  - Usage insights
- Remote IT Support
  - LocalTunnel integration
  - Pushover notifications
  - Secure access codes
- Desktop Organizer tool
- Screenshot capture feature
- Toast notification system
- AI provider session management

### Changed
- Complete UI redesign with modern dark theme
- Improved system monitoring accuracy
- Enhanced cleanup tools
- Better error handling throughout

### Fixed
- Multiple UI/UX improvements
- Performance optimizations

## [1.0.0] - 2025-11-01

### Added
- Initial release
- System Monitor
  - CPU, RAM, Disk monitoring
  - Process viewer
  - Health score
- Cleanup Tools
  - Temp file cleaner
  - Browser cache cleaner
  - Recycle bin manager
- Game Launcher
  - Steam games detection
  - Xbox games detection
  - Epic Games detection
  - Riot Games detection
- Quick Notes
- Speed Test
- Settings page
- Dark theme interface
- Frameless window design

---

## Version Numbering

- **Major (X.0.0):** Breaking changes or major feature additions
- **Minor (0.X.0):** New features, backward compatible
- **Patch (0.0.X):** Bug fixes, security patches
