/**
 * Path Validation Security Module
 * Ensures file operations are restricted to safe directories
 */

const path = require('path');
const os = require('os');

// Directories users can access
const ALLOWED_ROOTS = [
  os.homedir(),                                    // C:\Users\Username
  os.tmpdir(),                                     // Temp directory
  process.env.APPDATA,                             // AppData\Roaming
  process.env.LOCALAPPDATA,                        // AppData\Local
];

// Specific paths that are ALWAYS blocked (even within allowed roots)
const BLOCKED_PATHS = [
  'AppData\\Local\\Google\\Chrome\\User Data',     // Browser credentials
  'AppData\\Local\\Microsoft\\Edge\\User Data',
  'AppData\\Roaming\\Mozilla\\Firefox\\Profiles',
  'AppData\\Local\\Microsoft\\Credentials',        // Windows credentials
  'AppData\\Roaming\\Microsoft\\Credentials',
  'AppData\\Local\\Microsoft\\Vault',
  'AppData\\Roaming\\Microsoft\\Vault',
  'AppData\\Roaming\\Microsoft\\Protect',
  '.ssh',                                          // SSH keys
  '.gnupg',                                        // GPG keys
  '.aws',                                          // AWS credentials
  'ntuser.dat',                                    // Registry hive
  'AppData\\Local\\Packages',                      // UWP app data
];

// File extensions that cannot be read/written
const BLOCKED_EXTENSIONS_READ = [
  '.exe', '.dll', '.sys', '.drv',                  // Executables
  '.msi', '.msp',                                  // Installers
  '.dat', '.hiv',                                  // Registry/system
];

const BLOCKED_EXTENSIONS_WRITE = [
  '.exe', '.dll', '.sys', '.drv', '.com',          // Executables
  '.msi', '.msp', '.msu',                          // Installers
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1',        // Scripts
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',   // Script files
  '.scr', '.cpl',                                  // Control panel/screensavers
  '.inf', '.reg',                                  // System config
  '.lnk', '.url',                                  // Shortcuts (can be malicious)
];

/**
 * Check if a path is a UNC path (network share)
 */
function isUNCPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return false;
  // UNC paths start with \\ or //
  return inputPath.startsWith('\\\\') || inputPath.startsWith('//');
}

/**
 * Normalize and resolve a path safely
 */
function normalizePath(inputPath) {
  try {
    // Security: Block UNC paths to prevent SSRF attacks
    if (isUNCPath(inputPath)) {
      return null;
    }
    // Resolve to absolute path
    const resolved = path.resolve(inputPath);
    // Double-check resolved path isn't UNC (in case of symlinks/tricks)
    if (isUNCPath(resolved)) {
      return null;
    }
    // Normalize separators
    return path.normalize(resolved);
  } catch (e) {
    return null;
  }
}

/**
 * Check if a path is within allowed directories
 */
function isPathAllowed(inputPath) {
  const normalized = normalizePath(inputPath);
  if (!normalized) {
    return { allowed: false, reason: 'Invalid path' };
  }

  // Check if within any allowed root
  const isInAllowedRoot = ALLOWED_ROOTS.some(root => {
    if (!root) return false;
    const normalizedRoot = path.normalize(root);
    return normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase());
  });

  if (!isInAllowedRoot) {
    return {
      allowed: false,
      reason: 'Path is outside allowed directories. Access is limited to your user folders.'
    };
  }

  // Check against blocked paths
  const normalizedLower = normalized.toLowerCase();
  for (const blocked of BLOCKED_PATHS) {
    if (normalizedLower.includes(blocked.toLowerCase())) {
      return {
        allowed: false,
        reason: 'This location contains sensitive data and cannot be accessed.'
      };
    }
  }

  return { allowed: true };
}

/**
 * Validate a path for reading
 */
function validateReadPath(inputPath) {
  const pathCheck = isPathAllowed(inputPath);
  if (!pathCheck.allowed) {
    return pathCheck;
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (BLOCKED_EXTENSIONS_READ.includes(ext)) {
    return {
      allowed: false,
      reason: `Cannot read ${ext} files for security reasons.`
    };
  }

  return { allowed: true, normalizedPath: normalizePath(inputPath) };
}

/**
 * Validate a path for writing
 */
function validateWritePath(inputPath) {
  const pathCheck = isPathAllowed(inputPath);
  if (!pathCheck.allowed) {
    return pathCheck;
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (BLOCKED_EXTENSIONS_WRITE.includes(ext)) {
    return {
      allowed: false,
      reason: `Cannot write ${ext} files for security reasons.`
    };
  }

  return { allowed: true, normalizedPath: normalizePath(inputPath) };
}

/**
 * Validate a path for deletion (more restrictive)
 */
function validateDeletePath(inputPath) {
  const pathCheck = isPathAllowed(inputPath);
  if (!pathCheck.allowed) {
    return pathCheck;
  }

  const normalized = normalizePath(inputPath);

  // Extra protection: cannot delete from root of user profile
  const homedir = os.homedir();
  const relativePath = path.relative(homedir, normalized);

  // Block if it's directly in home folder (not in a subfolder)
  if (!relativePath.includes(path.sep)) {
    return {
      allowed: false,
      reason: 'Cannot delete files directly in your user folder. Move to a subfolder first.'
    };
  }

  // Block deletion of known important folders
  const importantFolders = ['Desktop', 'Documents', 'Pictures', 'Music', 'Videos', 'Downloads'];
  if (importantFolders.some(f => normalized.toLowerCase() === path.join(homedir, f).toLowerCase())) {
    return {
      allowed: false,
      reason: 'Cannot delete system folders like Desktop, Documents, etc.'
    };
  }

  return { allowed: true, normalizedPath: normalized };
}

/**
 * Validate a directory path for listing/scanning
 */
function validateDirectoryPath(inputPath) {
  return isPathAllowed(inputPath);
}

module.exports = {
  validateReadPath,
  validateWritePath,
  validateDeletePath,
  validateDirectoryPath,
  normalizePath,
  ALLOWED_ROOTS,
  BLOCKED_PATHS,
};
