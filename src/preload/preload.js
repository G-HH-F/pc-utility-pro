const { contextBridge, ipcRenderer } = require('electron');

// PC Utility Pro - Preload API
contextBridge.exposeInMainWorld('pcUtility', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // PC mood and status
  getPcMood: () => ipcRenderer.invoke('get-pc-mood'),
  getSessionRecap: () => ipcRenderer.invoke('get-session-recap'),

  // Support Mode - enables enhanced AI capabilities (paid feature)
  enableSupportMode: (options) => ipcRenderer.invoke('enable-support-mode', options || {}),
  disableSupportMode: () => ipcRenderer.invoke('disable-support-mode'),
  getSupportModeStatus: () => ipcRenderer.invoke('get-support-mode-status'),

  // AI Assistant
  chat: (options) => ipcRenderer.invoke('chat-with-ai', options),
  chatWithSupport: (options) => ipcRenderer.invoke('chat-with-support', options),

  // Quick fixes - One-click solutions
  quickFix: (options) => ipcRenderer.invoke('quick-fix', options),

  // Info panels
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),

  // NEW: WiFi/Internet info
  getWifiInfo: () => ipcRenderer.invoke('get-wifi-info'),
  runSpeedTest: () => ipcRenderer.invoke('run-speed-test'),

  // NEW: PC Specs
  getSpecs: () => ipcRenderer.invoke('get-specs'),

  // NEW: Screenshot features
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  screenshotToSupport: () => ipcRenderer.invoke('screenshot-to-support'),

  // NEW: Launch apps
  launchApp: (appName) => ipcRenderer.invoke('launch-app', appName),

  // Desktop organizer
  getDesktopItems: () => ipcRenderer.invoke('get-desktop-items'),
  cleanupDesktopFiles: () => ipcRenderer.invoke('cleanup-desktop-files'),

  // AI Provider settings
  loginToAI: (provider) => ipcRenderer.invoke('login-to-ai', provider),
  getAIProviderStatus: () => ipcRenderer.invoke('get-ai-provider-status'),
  setActiveAIProvider: (provider) => ipcRenderer.invoke('set-active-ai-provider', provider),
  disconnectAIProvider: () => ipcRenderer.invoke('disconnect-ai-provider'),

  // NEW: Cleanup functions
  cleanupTemp: () => ipcRenderer.invoke('cleanup-temp'),
  cleanupBrowser: () => ipcRenderer.invoke('cleanup-browser'),
  cleanupRecycleBin: () => ipcRenderer.invoke('cleanup-recycle-bin'),
  cleanupOldDownloads: () => ipcRenderer.invoke('cleanup-old-downloads'),

  // NEW: Organize folders
  organizeFolder: (folder) => ipcRenderer.invoke('organize-folder', folder),

  // Utils
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ============================================================
  // ANALYTICS & BEHAVIOR TRACKING
  // ============================================================

  // Track page navigation
  trackPageVisit: (page, previousPage) => ipcRenderer.invoke('track-page-visit', { page, previousPage }),

  // Track feature interactions
  trackInteraction: (feature, action, data) => ipcRenderer.invoke('track-interaction', { feature, action, data }),

  // Track micro-behaviors (mouse, scroll, hover, etc.)
  trackMicroBehavior: (data) => ipcRenderer.invoke('track-micro-behavior', data),

  // Get analytics summary
  getAnalyticsSummary: () => ipcRenderer.invoke('get-analytics-summary'),

  // Get AI-powered predictions
  getPredictions: () => ipcRenderer.invoke('get-predictions'),

  // Export all analytics data
  exportAnalytics: () => ipcRenderer.invoke('export-analytics'),

  // ============================================================
  // AI INSIGHTS
  // ============================================================

  // Get proactive AI insight for current context
  getAIInsight: (context) => ipcRenderer.invoke('get-ai-insight', context),

  // Dismiss an insight
  dismissInsight: (insightId) => ipcRenderer.invoke('dismiss-insight', insightId),

  // Execute a suggested action
  executeSuggestion: (action) => ipcRenderer.invoke('execute-suggestion', action),

  // ============================================================
  // CONSENT & FIRST RUN
  // ============================================================

  // Get current consent status
  getConsentStatus: () => ipcRenderer.invoke('get-consent-status'),

  // Set analytics consent (true/false)
  setAnalyticsConsent: (consent) => ipcRenderer.invoke('set-analytics-consent', consent),

  // Mark first run as complete
  completeFirstRun: () => ipcRenderer.invoke('complete-first-run'),

  // ============================================================
  // TROUBLESHOOTING FLOWS
  // ============================================================

  // Get list of available troubleshooting flows
  getTroubleshootingFlows: () => ipcRenderer.invoke('get-troubleshooting-flows'),

  // Run a specific troubleshooting flow
  runTroubleshootingFlow: (flowId) => ipcRenderer.invoke('run-troubleshooting-flow', flowId),

  // Get result of a specific step in a flow
  getTroubleshootingResult: (flowId, stepId) => ipcRenderer.invoke('get-troubleshooting-result', { flowId, stepId }),

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  // Listen for toast notifications
  onToast: (callback) => ipcRenderer.on('show-toast', (event, data) => callback(data)),

  // Listen for tray actions (quick actions from system tray)
  onTrayAction: (callback) => ipcRenderer.on('tray-action', (event, action) => callback(action)),

  // Listen for navigation requests (e.g., from tray)
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, page) => callback(page)),

  // Listen for speed test progress updates
  onSpeedTestProgress: (callback) => ipcRenderer.on('speed-test-progress', (event, data) => callback(data))
});
