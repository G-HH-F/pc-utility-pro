/**
 * Auto-Updater Service
 * Handles checking for and installing updates
 */

const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');

class AutoUpdaterService {
  constructor() {
    this.mainWindow = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;

    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupEventHandlers();
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates...');
      this.sendToRenderer('update:checking');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] Update available:', info.version);
      this.updateAvailable = true;
      this.sendToRenderer('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[AutoUpdater] No updates available');
      this.sendToRenderer('update:not-available', {
        currentVersion: app.getVersion(),
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`[AutoUpdater] Download progress: ${Math.round(progress.percent)}%`);
      this.sendToRenderer('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded');
      this.updateDownloaded = true;
      this.sendToRenderer('update:downloaded', {
        version: info.version,
      });

      // Show dialog to restart
      this.showRestartDialog(info.version);
    });

    autoUpdater.on('error', (error) => {
      console.error('[AutoUpdater] Error:', error);
      this.sendToRenderer('update:error', {
        message: error.message,
      });
    });
  }

  /**
   * Send message to renderer process
   */
  sendToRenderer(channel, data = {}) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates
   */
  async checkForUpdates() {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (error) {
      console.error('[AutoUpdater] Check failed:', error);
      return null;
    }
  }

  /**
   * Download update
   */
  async downloadUpdate() {
    if (!this.updateAvailable) {
      return false;
    }

    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      console.error('[AutoUpdater] Download failed:', error);
      return false;
    }
  }

  /**
   * Install update and restart
   */
  quitAndInstall() {
    if (this.updateDownloaded) {
      autoUpdater.quitAndInstall(false, true);
    }
  }

  /**
   * Show restart dialog
   */
  showRestartDialog(version) {
    const options = {
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: `PC Utility Pro ${version} has been downloaded`,
      detail: 'The update will be installed when you restart the app.',
    };

    dialog.showMessageBox(this.mainWindow, options).then((result) => {
      if (result.response === 0) {
        this.quitAndInstall();
      }
    });
  }

  /**
   * Get current version
   */
  getCurrentVersion() {
    return app.getVersion();
  }

  /**
   * Get update status
   */
  getStatus() {
    return {
      currentVersion: this.getCurrentVersion(),
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
    };
  }
}

// Singleton instance
let instance = null;

function getAutoUpdater() {
  if (!instance) {
    instance = new AutoUpdaterService();
  }
  return instance;
}

module.exports = { getAutoUpdater, AutoUpdaterService };
