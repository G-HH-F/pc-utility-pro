/**
 * Command Validation Security Module
 * Allowlist-based approach for safe command execution
 *
 * Two tiers:
 * - ALLOWED_COMMANDS: Basic diagnostics (free AI assistant)
 * - SUPPORT_ALLOWED_COMMANDS: Full fix capabilities (paid AI support)
 */

// Commands that are ALLOWED (allowlist approach)
const ALLOWED_COMMANDS = {
  // System information (read-only)
  'systeminfo': { shell: 'cmd', description: 'Get system information' },
  'hostname': { shell: 'cmd', description: 'Get computer name' },
  'whoami': { shell: 'cmd', description: 'Get current user' },
  'date /t': { shell: 'cmd', description: 'Get current date' },
  'time /t': { shell: 'cmd', description: 'Get current time' },

  // Process/task info (read-only)
  'tasklist': { shell: 'cmd', description: 'List running processes' },
  'tasklist /v': { shell: 'cmd', description: 'List processes with details' },

  // Network info (read-only)
  'ipconfig': { shell: 'cmd', description: 'Show network configuration' },
  'ipconfig /all': { shell: 'cmd', description: 'Show full network configuration' },
  'netstat -an': { shell: 'cmd', description: 'Show network connections' },
  'ping': { shell: 'cmd', description: 'Ping a host', allowArgs: true, argPattern: /^[\w.-]+$/ },

  // Disk info (read-only)
  'wmic logicaldisk get size,freespace,caption': { shell: 'cmd', description: 'Get disk space' },
  'dir': { shell: 'cmd', description: 'List directory', allowArgs: true, argPattern: /^"?[a-zA-Z]:\\[^<>:"|?*]*"?$/ },

  // Safe app launchers
  'start notepad': { shell: 'cmd', description: 'Open Notepad' },
  'start calc': { shell: 'cmd', description: 'Open Calculator' },
  'start mspaint': { shell: 'cmd', description: 'Open Paint' },
  'start explorer': { shell: 'cmd', description: 'Open File Explorer' },
  'start ms-settings:': { shell: 'cmd', description: 'Open Settings' },
  'start chrome': { shell: 'cmd', description: 'Open Chrome' },
  'start msedge': { shell: 'cmd', description: 'Open Edge' },
  'start firefox': { shell: 'cmd', description: 'Open Firefox' },
  'control': { shell: 'cmd', description: 'Open Control Panel' },
  'taskmgr': { shell: 'cmd', description: 'Open Task Manager' },

  // Clipboard (safe)
  'clip': { shell: 'cmd', description: 'Copy to clipboard', allowPipe: true },
};

// Command chaining/injection patterns - ALWAYS blocked
const COMMAND_CHAINING_PATTERNS = [
  /&&/,                    // AND chaining
  /\|\|/,                  // OR chaining
  /;/,                     // Command separator
  /\|(?!\|)/,              // Pipe (but not ||)
  /`/,                     // Backtick execution
  /\$\(/,                  // Command substitution
  /\$\{/,                  // Variable expansion
  />\s*>/,                 // Output redirection append
  /<\s*</,                 // Input redirection
  /\n/,                    // Newline injection
  /\r/,                    // Carriage return injection
];

// Patterns that are ALWAYS blocked regardless of allowlist
const BLOCKED_PATTERNS = [
  // Command chaining (inherit from above)
  ...COMMAND_CHAINING_PATTERNS,
  // Dangerous commands
  /\bdel\b/i,
  /\brd\b/i,
  /\brmdir\b/i,
  /\berase\b/i,
  /\bformat\b/i,
  /\bfdisk\b/i,
  /\bdiskpart\b/i,

  // Registry manipulation
  /\breg\b/i,
  /\bregedit\b/i,

  // System modification
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\blogoff\b/i,
  /\bbcdedit\b/i,
  /\bbootrec\b/i,

  // Network attacks
  /\bnetsh\b/i,
  /\bnet\s+(user|localgroup|group)/i,
  /\barp\b/i,
  /\broute\b/i,

  // Download/execution vectors
  /\bcertutil\b.*-urlcache/i,
  /\bbitsadmin\b/i,
  /\bcurl\b.*-o/i,
  /\bwget\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bInvoke-Expression\b/i,
  /\biex\b/i,
  /\bDownloadString\b/i,
  /\bDownloadFile\b/i,

  // PowerShell bypass techniques
  /\b-enc\b/i,
  /\b-encoded\b/i,
  /\b-encodedcommand\b/i,
  /\bbypass\b/i,
  /\b-nop\b/i,
  /\b-noprofile\b/i,
  /\b-w\s*hidden\b/i,
  /\b-windowstyle\s*hidden\b/i,

  // Scheduled tasks
  /\bschtasks\b/i,
  /\bat\b\s+\d/i,

  // Service manipulation
  /\bsc\b\s+(create|config|delete|stop)/i,
  /\bnet\s+(start|stop)\b/i,

  // WMI abuse
  /\bwmic\b.*process\s+call/i,
  /\bwmic\b.*create/i,
  /\bwmic\b.*delete/i,

  // Credential access
  /\bmimikatz\b/i,
  /\bprocdump\b/i,
  /\blsass\b/i,
  /\bsam\b.*dump/i,

  // Dangerous PowerShell
  /\bpowershell\b/i,  // Block direct PowerShell invocation from cmd
  /\bpwsh\b/i,

  // File system attacks
  /\bmklink\b/i,
  /\bicacls\b/i,
  /\btakeown\b/i,
  /\bfsutil\b/i,

  // Code execution
  /\bcscript\b/i,
  /\bwscript\b/i,
  /\bmshta\b/i,
  /\brundll32\b/i,
  /\bregsvr32\b/i,
  /\binstallutil\b/i,

  // Encoding/obfuscation attempts
  /[\x00-\x1f]/,  // Control characters
  /\^./,          // Caret escaping (used for obfuscation)
  /%[0-9a-f]{2}/i, // URL encoding
];

// ============================================================
// SUPPORT TIER - More permissive for paid AI support
// ============================================================

// Commands allowed for paid AI support (can apply fixes)
const SUPPORT_ALLOWED_COMMANDS = {
  // Everything from basic tier
  ...ALLOWED_COMMANDS,

  // Process management
  'taskkill': { shell: 'cmd', description: 'Kill a process', allowArgs: true, argPattern: /^\/pid\s+\d+(\s+\/f)?$/i },
  'taskkill /im': { shell: 'cmd', description: 'Kill process by name', allowArgs: true, argPattern: /^[\w.-]+\.exe(\s+\/f)?$/i },

  // Disk cleanup
  'cleanmgr': { shell: 'cmd', description: 'Open Disk Cleanup' },
  'cleanmgr /sagerun:1': { shell: 'cmd', description: 'Run Disk Cleanup preset' },

  // Clear temp files (safe paths only)
  'del /q /f "%temp%\\*"': { shell: 'cmd', description: 'Clear user temp files' },
  'del /q /s "%temp%\\*"': { shell: 'cmd', description: 'Clear user temp files recursively' },
  'rd /s /q "%temp%"': { shell: 'cmd', description: 'Remove temp folder contents' },

  // Windows repair tools
  'sfc /scannow': { shell: 'cmd', description: 'System File Checker', requiresAdmin: true },
  'sfc /verifyonly': { shell: 'cmd', description: 'Verify system files' },
  'DISM /Online /Cleanup-Image /CheckHealth': { shell: 'cmd', description: 'DISM health check' },
  'DISM /Online /Cleanup-Image /ScanHealth': { shell: 'cmd', description: 'DISM scan health' },
  'DISM /Online /Cleanup-Image /RestoreHealth': { shell: 'cmd', description: 'DISM restore health', requiresAdmin: true },
  'chkdsk': { shell: 'cmd', description: 'Check disk', allowArgs: true, argPattern: /^[a-zA-Z]:(\s+\/[rfx])*$/i },

  // Network repair
  'ipconfig /release': { shell: 'cmd', description: 'Release IP address' },
  'ipconfig /renew': { shell: 'cmd', description: 'Renew IP address' },
  'ipconfig /flushdns': { shell: 'cmd', description: 'Flush DNS cache' },
  'netsh winsock reset': { shell: 'cmd', description: 'Reset Winsock catalog', requiresAdmin: true },
  'netsh int ip reset': { shell: 'cmd', description: 'Reset TCP/IP stack', requiresAdmin: true },

  // Windows Update
  'wuauclt /detectnow': { shell: 'cmd', description: 'Check for Windows updates' },
  'wuauclt /updatenow': { shell: 'cmd', description: 'Install Windows updates' },

  // Event logs (read-only)
  'wevtutil qe System /c:50 /f:text /rd:true': { shell: 'cmd', description: 'View recent system events' },
  'wevtutil qe Application /c:50 /f:text /rd:true': { shell: 'cmd', description: 'View recent app events' },

  // Service management (limited)
  'sc query': { shell: 'cmd', description: 'List services', allowArgs: true, argPattern: /^[\w]+$/ },
  'sc qc': { shell: 'cmd', description: 'Query service config', allowArgs: true, argPattern: /^[\w]+$/ },
  'net start': { shell: 'cmd', description: 'Start a service', allowArgs: true, argPattern: /^"?[\w\s]+"?$/ },
  'net stop': { shell: 'cmd', description: 'Stop a service', allowArgs: true, argPattern: /^"?[\w\s]+"?$/ },

  // Browser cache clearing
  'del /q /s /f "%LocalAppData%\\Google\\Chrome\\User Data\\Default\\Cache\\*"': { shell: 'cmd', description: 'Clear Chrome cache' },
  'del /q /s /f "%LocalAppData%\\Microsoft\\Edge\\User Data\\Default\\Cache\\*"': { shell: 'cmd', description: 'Clear Edge cache' },

  // Recycle bin
  'rd /s /q C:\\$Recycle.Bin': { shell: 'cmd', description: 'Empty Recycle Bin', requiresAdmin: true },

  // Power management
  'powercfg /batteryreport': { shell: 'cmd', description: 'Generate battery report' },
  'powercfg /energy': { shell: 'cmd', description: 'Generate energy report' },
  'shutdown /r /t 60': { shell: 'cmd', description: 'Schedule restart in 60 seconds' },
  'shutdown /a': { shell: 'cmd', description: 'Abort scheduled shutdown' },

  // Startup management
  'wmic startup list brief': { shell: 'cmd', description: 'List startup programs' },

  // GPU/Display
  'dxdiag': { shell: 'cmd', description: 'DirectX Diagnostics' },

  // Memory diagnostics
  'mdsched': { shell: 'cmd', description: 'Memory Diagnostic Tool' },
};

// Blocked patterns for support tier (still block truly dangerous stuff)
const SUPPORT_BLOCKED_PATTERNS = [
  // Disk destruction
  /\bformat\b/i,
  /\bfdisk\b/i,
  /\bdiskpart\b/i,

  // Registry manipulation (can brick system)
  /\breg\s+(add|delete|import|export)\b/i,
  /\bregedit\b/i,

  // Boot destruction
  /\bbcdedit\b/i,
  /\bbootrec\b/i,

  // Credential theft
  /\bmimikatz\b/i,
  /\bprocdump\b.*lsass/i,
  /\blsass\b.*dump/i,
  /\bsam\b.*dump/i,
  /sekurlsa/i,

  // Malware-style execution
  /\bInvoke-Expression\b/i,
  /\biex\b\s*\(/i,
  /\bDownloadString\b/i,
  /\bDownloadFile\b/i,
  /\b-enc\b/i,
  /\b-encodedcommand\b/i,
  /\bbypass\b.*execution/i,
  /\b-w\s*hidden\b/i,
  /\b-windowstyle\s*hidden\b/i,

  // Remote execution vectors
  /\bpsexec\b/i,
  /\bwmiexec\b/i,
  /\bsmbexec\b/i,

  // User/group manipulation
  /\bnet\s+(user|localgroup)\s+\w+\s+(\/add|\/delete)/i,

  // Dangerous scheduled tasks
  /\bschtasks\b.*\/create/i,

  // Code execution via LOLBins
  /\bmshta\b.*http/i,
  /\brundll32\b.*javascript/i,
  /\bregsvr32\b.*\/s.*\/u.*\/i/i,

  // Control characters / obfuscation
  /[\x00-\x1f]/,
];

/**
 * Check if a command matches any blocked patterns
 */
function containsBlockedPattern(command) {
  const normalized = command.trim();

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return { blocked: true, reason: 'This command contains potentially dangerous operations.' };
    }
  }

  return { blocked: false };
}

/**
 * Check if command is in the allowlist
 */
function isCommandAllowed(command) {
  const normalized = command.trim().toLowerCase();

  // First check blocked patterns
  const blockedCheck = containsBlockedPattern(command);
  if (blockedCheck.blocked) {
    return { allowed: false, reason: blockedCheck.reason };
  }

  // Check exact matches first
  for (const [allowed, config] of Object.entries(ALLOWED_COMMANDS)) {
    if (normalized === allowed.toLowerCase()) {
      return { allowed: true, shell: config.shell, description: config.description };
    }

    // Check commands that allow arguments
    if (config.allowArgs && normalized.startsWith(allowed.toLowerCase())) {
      const args = command.substring(allowed.length).trim();
      if (config.argPattern && !config.argPattern.test(args)) {
        return { allowed: false, reason: `Invalid arguments for ${allowed}` };
      }
      return { allowed: true, shell: config.shell, description: config.description };
    }
  }

  return {
    allowed: false,
    reason: 'This command is not in the allowed list. For security, only pre-approved commands can be run.'
  };
}

/**
 * Get list of allowed commands for display
 */
function getAllowedCommandsList() {
  return Object.entries(ALLOWED_COMMANDS).map(([cmd, config]) => ({
    command: cmd,
    description: config.description,
    allowsArguments: config.allowArgs || false,
  }));
}

/**
 * Check if a command matches support tier blocked patterns
 */
function containsSupportBlockedPattern(command) {
  const normalized = command.trim();

  for (const pattern of SUPPORT_BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return { blocked: true, reason: 'This command is blocked for security reasons.' };
    }
  }

  return { blocked: false };
}

/**
 * Check if command is allowed for support tier (more permissive)
 */
function isSupportCommandAllowed(command) {
  const normalized = command.trim().toLowerCase();

  // First check support-tier blocked patterns
  const blockedCheck = containsSupportBlockedPattern(command);
  if (blockedCheck.blocked) {
    return { allowed: false, reason: blockedCheck.reason };
  }

  // Check exact matches first
  for (const [allowed, config] of Object.entries(SUPPORT_ALLOWED_COMMANDS)) {
    if (normalized === allowed.toLowerCase()) {
      return {
        allowed: true,
        shell: config.shell,
        description: config.description,
        requiresAdmin: config.requiresAdmin || false
      };
    }

    // Check commands that allow arguments
    if (config.allowArgs && normalized.startsWith(allowed.toLowerCase())) {
      const args = command.substring(allowed.length).trim();
      if (config.argPattern && !config.argPattern.test(args)) {
        return { allowed: false, reason: `Invalid arguments for ${allowed}` };
      }
      return {
        allowed: true,
        shell: config.shell,
        description: config.description,
        requiresAdmin: config.requiresAdmin || false
      };
    }
  }

  return {
    allowed: false,
    reason: 'This command is not in the support allowed list.'
  };
}

/**
 * Get list of support-tier allowed commands for display
 */
function getSupportAllowedCommandsList() {
  return Object.entries(SUPPORT_ALLOWED_COMMANDS).map(([cmd, config]) => ({
    command: cmd,
    description: config.description,
    allowsArguments: config.allowArgs || false,
    requiresAdmin: config.requiresAdmin || false,
  }));
}

module.exports = {
  // Basic tier (free AI assistant)
  isCommandAllowed,
  containsBlockedPattern,
  getAllowedCommandsList,
  BLOCKED_PATTERNS,

  // Support tier (paid AI support)
  isSupportCommandAllowed,
  containsSupportBlockedPattern,
  getSupportAllowedCommandsList,
  SUPPORT_BLOCKED_PATTERNS,
};
