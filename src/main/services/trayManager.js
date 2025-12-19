/**
 * System Tray Manager
 * Provides quick access to common actions from the system tray
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(mainWindow, handlers = {}) {
    this.mainWindow = mainWindow;
    this.tray = null;
    this.handlers = handlers;
    this.isQuitting = false;
  }

  /**
   * Initialize the system tray
   */
  init() {
    // Create tray icon
    const iconPath = path.join(__dirname, '../../../assets/icon.png');
    let trayIcon;

    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      // Resize for tray (16x16 on Windows)
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch (e) {
      // Fallback to empty icon if asset not found
      trayIcon = nativeImage.createEmpty();
    }

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('PC Utility Pro');

    // Build context menu
    this.updateMenu();

    // Click behavior
    this.tray.on('click', () => {
      this.showWindow();
    });

    // Double-click opens window
    this.tray.on('double-click', () => {
      this.showWindow();
    });

    return this;
  }

  /**
   * Update the tray context menu
   */
  updateMenu(status = {}) {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'PC Utility Pro',
        enabled: false,
        icon: this.getStatusIcon(status.health),
      },
      { type: 'separator' },
      {
        label: `Health: ${status.health || '--'}%`,
        enabled: false,
      },
      {
        label: `CPU: ${status.cpu || '--'}% | RAM: ${status.memory || '--'}%`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: '🔍 Check PC Health',
        click: () => this.handleAction('check-health'),
      },
      {
        label: '🧹 Quick Cleanup',
        submenu: [
          {
            label: 'Clear Temp Files',
            click: () => this.handleAction('cleanup-temp'),
          },
          {
            label: 'Clear Browser Cache',
            click: () => this.handleAction('cleanup-browser'),
          },
          {
            label: 'Empty Recycle Bin',
            click: () => this.handleAction('cleanup-recycle'),
          },
          { type: 'separator' },
          {
            label: 'Run All Cleanup',
            click: () => this.handleAction('cleanup-all'),
          },
        ],
      },
      {
        label: '🆘 Request Support',
        click: () => this.handleAction('request-support'),
      },
      {
        label: '💬 Ask AI Assistant',
        click: () => this.handleAction('open-chat'),
      },
      { type: 'separator' },
      {
        label: '⚙️ Open PC Utility Pro',
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.quitApp(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Get status icon based on health score
   */
  getStatusIcon(health) {
    // Could return different icons based on health
    // For now, return null (no icon)
    return null;
  }

  /**
   * Handle tray action
   */
  handleAction(action) {
    if (this.handlers[action]) {
      this.handlers[action]();
    } else {
      // Default: show window and navigate
      this.showWindow();
      if (this.mainWindow) {
        this.mainWindow.webContents.send('tray-action', action);
      }
    }
  }

  /**
   * Show/focus main window
   */
  showWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      this.mainWindow.focus();
    }
  }

  /**
   * Update tray tooltip with current status
   */
  updateTooltip(text) {
    if (this.tray) {
      this.tray.setToolTip(text);
    }
  }

  /**
   * Show balloon notification (Windows)
   */
  showNotification(title, content) {
    if (this.tray && process.platform === 'win32') {
      this.tray.displayBalloon({
        title,
        content,
        iconType: 'info',
      });
    }
  }

  /**
   * Quit the application
   */
  quitApp() {
    this.isQuitting = true;
    app.quit();
  }

  /**
   * Check if app is quitting (used to prevent minimize to tray on quit)
   */
  isAppQuitting() {
    return this.isQuitting;
  }

  /**
   * Destroy the tray
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = { TrayManager };
