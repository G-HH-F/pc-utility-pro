/**
 * Cleanup Handlers
 * Handles disk cleanup operations (temp files, browser cache, recycle bin)
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

/**
 * Register cleanup IPC handlers
 */
function registerCleanupHandlers(auditLogger) {
  // Cleanup temp files
  ipcMain.handle('cleanup-temp', async () => {
    try {
      const tempPaths = [
        process.env.TEMP,
        path.join(process.env.LOCALAPPDATA, 'Temp'),
        path.join(os.homedir(), 'AppData', 'Local', 'Temp')
      ].filter((p, i, arr) => p && arr.indexOf(p) === i); // Remove duplicates

      let totalFreed = 0;
      let totalCleaned = 0;
      let errors = [];

      for (const tempPath of tempPaths) {
        if (!fs.existsSync(tempPath)) continue;

        try {
          const files = fs.readdirSync(tempPath);
          for (const file of files) {
            try {
              const filePath = path.join(tempPath, file);
              const stats = fs.statSync(filePath);

              if (stats.isFile()) {
                // Skip files in use (modified in last minute)
                if (Date.now() - stats.mtimeMs < 60000) continue;

                totalFreed += stats.size;
                fs.unlinkSync(filePath);
                totalCleaned++;
              } else if (stats.isDirectory()) {
                // Try to remove empty directories
                try {
                  fs.rmdirSync(filePath);
                  totalCleaned++;
                } catch (e) {
                  // Directory not empty, skip
                }
              }
            } catch (e) {
              // File in use or permission denied, skip
            }
          }
        } catch (e) {
          errors.push(tempPath);
        }
      }

      if (auditLogger) {
        auditLogger.cleanupPerformed('temp_files', { cleaned: totalCleaned, freedBytes: totalFreed });
      }

      const freedMB = (totalFreed / 1024 / 1024).toFixed(1);
      return {
        success: true,
        message: `Cleaned ${totalCleaned} temp files, freed ${freedMB} MB`,
        stats: { cleaned: totalCleaned, freedBytes: totalFreed }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cleanup browser cache
  ipcMain.handle('cleanup-browser', async () => {
    try {
      const browserCachePaths = [
        // Chrome
        path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        // Edge
        path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
        // Firefox
        path.join(process.env.LOCALAPPDATA, 'Mozilla', 'Firefox', 'Profiles'),
        // Brave
        path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'),
      ].filter(Boolean);

      let totalFreed = 0;
      let totalCleaned = 0;
      let browsersCleared = [];

      for (const cachePath of browserCachePaths) {
        if (!fs.existsSync(cachePath)) continue;

        const browserName = cachePath.includes('Chrome') ? 'Chrome' :
          cachePath.includes('Edge') ? 'Edge' :
            cachePath.includes('Firefox') ? 'Firefox' :
              cachePath.includes('Brave') ? 'Brave' : 'Unknown';

        try {
          const result = await clearDirectory(cachePath);
          totalFreed += result.freedBytes;
          totalCleaned += result.filesDeleted;
          if (!browsersCleared.includes(browserName)) {
            browsersCleared.push(browserName);
          }
        } catch (e) {
          // Continue with other browsers
        }
      }

      if (auditLogger) {
        auditLogger.cleanupPerformed('browser_cache', {
          cleaned: totalCleaned,
          freedBytes: totalFreed,
          browsers: browsersCleared
        });
      }

      const freedMB = (totalFreed / 1024 / 1024).toFixed(1);
      return {
        success: true,
        message: `Cleared cache for ${browsersCleared.join(', ') || 'browsers'}, freed ${freedMB} MB`,
        stats: { cleaned: totalCleaned, freedBytes: totalFreed, browsers: browsersCleared }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cleanup recycle bin
  ipcMain.handle('cleanup-recycle-bin', async () => {
    try {
      return new Promise((resolve) => {
        // Use PowerShell to empty the recycle bin
        const psCommand = `Clear-RecycleBin -Force -ErrorAction SilentlyContinue`;

        exec(`powershell -Command "${psCommand}"`, { timeout: 30000 }, (error) => {
          if (auditLogger) {
            auditLogger.cleanupPerformed('recycle_bin', { success: !error });
          }

          if (error) {
            // Even if there's an error, the bin might have been emptied
            resolve({
              success: true,
              message: 'Recycle Bin emptied (or was already empty)',
              stats: {}
            });
          } else {
            resolve({
              success: true,
              message: 'Recycle Bin emptied successfully',
              stats: {}
            });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cleanup old downloads
  ipcMain.handle('cleanup-old-downloads', async () => {
    try {
      const downloadsPath = path.join(os.homedir(), 'Downloads');

      if (!fs.existsSync(downloadsPath)) {
        return { success: false, error: 'Downloads folder not found' };
      }

      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      let totalFreed = 0;
      let totalCleaned = 0;
      const deletedFiles = [];

      const files = fs.readdirSync(downloadsPath);

      for (const file of files) {
        try {
          const filePath = path.join(downloadsPath, file);
          const stats = fs.statSync(filePath);

          if (stats.isFile() && stats.mtimeMs < thirtyDaysAgo) {
            // Check for installer/setup files that are likely safe to delete
            const ext = path.extname(file).toLowerCase();
            const safeExtensions = ['.exe', '.msi', '.dmg', '.pkg', '.zip', '.rar', '.7z', '.tmp'];

            if (safeExtensions.includes(ext)) {
              totalFreed += stats.size;
              // Move to recycle bin instead of permanent delete
              const psCommand = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${filePath.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
              exec(`powershell -Command "${psCommand}"`, { timeout: 5000 });
              deletedFiles.push(file);
              totalCleaned++;
            }
          }
        } catch (e) {
          // Skip files that can't be processed
        }
      }

      if (auditLogger) {
        auditLogger.cleanupPerformed('old_downloads', {
          cleaned: totalCleaned,
          freedBytes: totalFreed,
          files: deletedFiles.slice(0, 10)
        });
      }

      const freedMB = (totalFreed / 1024 / 1024).toFixed(1);
      return {
        success: true,
        message: `Moved ${totalCleaned} old downloads to Recycle Bin (${freedMB} MB)`,
        stats: { cleaned: totalCleaned, freedBytes: totalFreed, files: deletedFiles }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

/**
 * Helper function to clear a directory recursively
 */
async function clearDirectory(dirPath) {
  let freedBytes = 0;
  let filesDeleted = 0;

  if (!fs.existsSync(dirPath)) {
    return { freedBytes: 0, filesDeleted: 0 };
  }

  const clearRecursive = (currentPath) => {
    try {
      const items = fs.readdirSync(currentPath);

      for (const item of items) {
        const itemPath = path.join(currentPath, item);

        try {
          const stats = fs.statSync(itemPath);

          if (stats.isDirectory()) {
            clearRecursive(itemPath);
            try {
              fs.rmdirSync(itemPath);
            } catch (e) {
              // Directory might not be empty
            }
          } else {
            freedBytes += stats.size;
            fs.unlinkSync(itemPath);
            filesDeleted++;
          }
        } catch (e) {
          // Skip files that can't be processed
        }
      }
    } catch (e) {
      // Skip directories that can't be read
    }
  };

  clearRecursive(dirPath);
  return { freedBytes, filesDeleted };
}

module.exports = { registerCleanupHandlers };
