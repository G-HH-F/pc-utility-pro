const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const si = require('systeminformation');
const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

// Optional dependencies - gracefully handle if not installed
let Push;
try { Push = require('pushover-notifications'); } catch (e) { Push = null; }

// Support mode - when enabled, AI uses support-tier commands (paid feature)
let supportModeEnabled = false;
let supportModeExpiry = null;

// Security modules
const security = require('./security');
const { RelayClient } = require('./services/relayClient');

// Service modules
const { TrayManager } = require('./services/trayManager');
const { getAuditLogger } = require('./services/auditLogger');
const { getOfflineResponse, checkAPIAvailable } = require('./services/offlineAI');
const { runFlow: runTroubleshootingFlow, getAvailableFlows, getFlow, executeStep } = require('./services/troubleshootingFlows');
const { runSpeedTest } = require('./services/speedTest');
const { generateUniqueId, generateUniqueFilename } = require('./services/uniqueId');

// Handler modules (new modular structure)
// These handlers are being migrated from main.js for better organization
// To fully migrate, remove duplicate handlers from main.js and uncomment:
// const { registerAllHandlers, getFriendlyAppName: getAppName, formatUptime: formatTime } = require('./handlers');

// Initialize audit logger
const auditLogger = getAuditLogger();

// ============================================================
// SINGLE INSTANCE LOCK - Only allow one instance
// ============================================================
// Skip single-instance lock during Playwright testing
const isTestMode = process.env.PLAYWRIGHT_TEST === '1' || process.argv.includes('--test-mode');
const gotTheLock = isTestMode ? true : app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running - just quit this one
  app.quit();
} else {
  // This is the primary instance - focus window when second instance tries to open
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ============================================================
// API KEY CONFIGURATION - Loaded securely from config or environment
// ============================================================
// SECURITY: API keys should NEVER be hardcoded in source code
// Users must provide their own key via config.json or environment variable

// ============================================================
// OTHER CREDENTIALS - Load from environment variables or config file
// ============================================================
const CONFIG_FILE = path.join(__dirname, '../../config.json');

function loadConfig() {
  // First try environment variables
  if (process.env.CLAUDE_API_KEY) {
    return {
      claudeApiKey: process.env.CLAUDE_API_KEY,
      pushoverUser: process.env.PUSHOVER_USER || '',
      pushoverToken: process.env.PUSHOVER_TOKEN || '',
      supportContactName: process.env.SUPPORT_CONTACT_NAME || 'IT Support'
    };
  }

  // Then try config file
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        claudeApiKey: config.claudeApiKey || '',
        pushoverUser: config.pushoverUser || '',
        pushoverToken: config.pushoverToken || '',
        supportContactName: config.supportContactName || 'IT Support'
      };
    }
  } catch (e) {
    console.error('Error loading config:', e);
  }

  // Fallback - no API key configured
  return {
    claudeApiKey: '',
    pushoverUser: '',
    pushoverToken: '',
    supportContactName: 'IT Support'
  };
}

const config = loadConfig();
const SUPPORT_CONTACT_NAME = config.supportContactName;

let mainWindow;
let anthropicClient = null;
let relayClient = null;
let trayManager = null;

// Rate limiter for AI chat (prevents API abuse)
const aiChatRateLimiter = {
  requests: [],
  maxRequests: 20,        // Max requests per window
  windowMs: 60 * 1000,    // 1 minute window
  isAllowed: function() {
    const now = Date.now();
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    this.requests.push(now);
    return true;
  },
  getWaitTime: function() {
    if (this.requests.length === 0) return 0;
    const oldestRequest = Math.min(...this.requests);
    return Math.max(0, this.windowMs - (Date.now() - oldestRequest));
  }
};

// Initialize Claude if API key is available
if (config.claudeApiKey) {
  anthropicClient = new Anthropic({ apiKey: config.claudeApiKey });
}

// Pushover client - initialize only if credentials available
let pushover = null;
if (Push && config.pushoverUser && config.pushoverToken) {
  pushover = new Push({
    user: config.pushoverUser,
    token: config.pushoverToken
  });
}

// Initialize Relay Client if configured (production mode)
if (config.useRelayServer && config.relayServerUrl) {
  relayClient = new RelayClient(config.relayServerUrl);
  relayClient.on('session:created', (data) => {
    console.log('[Relay] Session created:', data.sessionId);
  });
  relayClient.on('support:connected', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-toast', { message: 'Support has connected!', type: 'success' });
    }
  });
  relayClient.on('command:request', async (data) => {
    // Handle remote commands through relay (uses same security validation)
    try {
      const result = await executeTool(data.tool, data.params);
      relayClient.sendCommandResponse(data.commandId, result);
    } catch (e) {
      relayClient.sendCommandResponse(data.commandId, null, e.message);
    }
  });
}

// Auto-updater (production only)
let autoUpdater = null;
if (app.isPackaged) {
  try {
    const { getAutoUpdater } = require('./services/autoUpdater');
    autoUpdater = getAutoUpdater();
  } catch (e) {
    console.log('[AutoUpdater] Not available:', e.message);
  }
}

// App data persistence
const MEMORY_FILE = path.join(app.getPath('userData'), 'app-data.json');

// AI Provider session storage
const AI_SESSIONS_FILE = path.join(app.getPath('userData'), 'ai-sessions.json');

const PROVIDER_URLS = {
  claude: 'https://claude.ai/login',
  chatgpt: 'https://chat.openai.com/auth/login',
  gemini: 'https://accounts.google.com/v3/signin/identifier?continue=https://gemini.google.com',
  grok: 'https://x.com/i/grok'
};

const PROVIDER_SUCCESS_URLS = {
  claude: 'https://claude.ai',
  chatgpt: 'https://chat.openai.com',
  gemini: 'https://gemini.google.com',
  grok: 'https://x.com/i/grok'
};

let aiSessions = { sessions: {}, active: null };

function loadAISessions() {
  try {
    if (fs.existsSync(AI_SESSIONS_FILE)) {
      aiSessions = JSON.parse(fs.readFileSync(AI_SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading AI sessions:', e);
    aiSessions = { sessions: {}, active: null };
  }
  return aiSessions;
}

function saveAISessions() {
  try {
    fs.writeFileSync(AI_SESSIONS_FILE, JSON.stringify(aiSessions, null, 2));
  } catch (e) {
    console.error('Error saving AI sessions:', e);
  }
}

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      // Migration: Add consent fields if missing
      if (mem.analyticsConsent === undefined) {
        mem.analyticsConsent = null; // null = not yet asked, true/false = user choice
        mem.consentDate = null;
      }
      return mem;
    }
  } catch (e) {}
  return {
    facts: [],
    lastSeen: null,
    sessionCount: 0,
    totalHelpRequests: 0,
    favoriteFeatures: {},
    lastSnapshot: null, // Stores system state from last session
    analyticsConsent: null, // null = not yet asked, true = consented, false = declined
    consentDate: null,
    firstRunComplete: false
  };
}

function saveMemory(memory) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (e) {}
}

let appMemory = loadMemory();

// ============================================================
// USER ANALYTICS & BEHAVIOR TRACKING
// ============================================================
const ANALYTICS_FILE = path.join(app.getPath('userData'), 'user-analytics.json');
const MICRO_BEHAVIORS_FILE = path.join(app.getPath('userData'), 'micro-behaviors.json');

function createDefaultAnalytics() {
  return {
    version: '1.0',
    userId: generateUniqueId('user'),
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    sessions: [],
    pageMetrics: {
      home: { visits: 0, totalDuration: 0, lastVisit: null },
      launcher: { visits: 0, totalDuration: 0, lastVisit: null },
      chat: { visits: 0, totalDuration: 0, lastVisit: null },
      wifi: { visits: 0, totalDuration: 0, lastVisit: null },
      specs: { visits: 0, totalDuration: 0, lastVisit: null },
      notes: { visits: 0, totalDuration: 0, lastVisit: null },
      desktop: { visits: 0, totalDuration: 0, lastVisit: null },
      apps: { visits: 0, totalDuration: 0, lastVisit: null },
      storage: { visits: 0, totalDuration: 0, lastVisit: null },
      settings: { visits: 0, totalDuration: 0, lastVisit: null },
      help: { visits: 0, totalDuration: 0, lastVisit: null }
    },
    featureUsage: {},
    systemEvents: [],
    clickPaths: [],
    fileOperations: [],
    patterns: {
      timeOfDay: {},
      dayOfWeek: {},
      sequences: []
    },
    predictions: null,
    microBehaviors: {
      mousePatterns: {
        avgPathEfficiency: 0,
        hoverBeforeClick: 0,
        hesitationZones: [],
        focusScoreHistory: []
      },
      scrollPatterns: {
        avgScrollSpeed: 0,
        reReadFrequency: 0,
        abandonmentPoints: []
      },
      rhythmPatterns: {
        burstFrequency: 0,
        avgBurstDuration: 0,
        steadyStateAvgDuration: 0
      },
      psychStateIndicators: {
        currentFocusScore: 0,
        urgencyLevel: 'normal',
        explorationVsTask: 0.5,
        stressMarkers: []
      }
    },
    fractalPatterns: {
      selfSimilarity: {
        sessionToPage: 0,
        pageToElement: 0,
        description: ''
      },
      nestedCycles: []
    }
  };
}

let userAnalytics = null;
let currentSession = null;
let systemMonitorInterval = null;

function loadAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      userAnalytics = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
      // Ensure all fields exist (migration)
      const defaults = createDefaultAnalytics();
      userAnalytics = { ...defaults, ...userAnalytics };
    } else {
      userAnalytics = createDefaultAnalytics();
    }
  } catch (e) {
    console.error('Error loading analytics:', e);
    userAnalytics = createDefaultAnalytics();
  }
  return userAnalytics;
}

function saveAnalytics() {
  try {
    if (userAnalytics) {
      userAnalytics.lastUpdated = new Date().toISOString();
      fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(userAnalytics, null, 2));
    }
  } catch (e) {
    console.error('Error saving analytics:', e);
  }
}

function saveMicroBehaviors(data) {
  try {
    let existing = [];
    if (fs.existsSync(MICRO_BEHAVIORS_FILE)) {
      existing = JSON.parse(fs.readFileSync(MICRO_BEHAVIORS_FILE, 'utf8'));
    }
    existing.push({
      timestamp: new Date().toISOString(),
      ...data
    });
    // Keep last 10000 entries
    if (existing.length > 10000) {
      existing = existing.slice(-10000);
    }
    fs.writeFileSync(MICRO_BEHAVIORS_FILE, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error('Error saving micro behaviors:', e);
  }
}

function startSession() {
  loadAnalytics();
  currentSession = {
    id: generateUniqueId('session'),
    start: new Date().toISOString(),
    end: null,
    duration: 0,
    pageVisits: [],
    interactions: [],
    systemSnapshots: [],
    currentPage: 'home',
    pageEntryTime: Date.now()
  };
  userAnalytics.sessions.push(currentSession);
  saveAnalytics();
}

function endSession() {
  if (currentSession) {
    currentSession.end = new Date().toISOString();
    currentSession.duration = Date.now() - new Date(currentSession.start).getTime();
    saveAnalytics();
  }
}

function recordPageVisit(page, previousPage) {
  if (!currentSession || !userAnalytics) return;

  const now = Date.now();
  const timestamp = new Date().toISOString();

  // Record duration on previous page
  if (currentSession.currentPage && currentSession.pageEntryTime) {
    const duration = now - currentSession.pageEntryTime;
    if (currentSession.pageVisits.length > 0) {
      const lastVisit = currentSession.pageVisits[currentSession.pageVisits.length - 1];
      lastVisit.duration = duration;
    }
  }

  // Add new page visit
  currentSession.pageVisits.push({
    page: page,
    previousPage: previousPage,
    timestamp: timestamp,
    duration: 0,
    interactions: []
  });

  // Update page metrics
  if (userAnalytics.pageMetrics[page]) {
    userAnalytics.pageMetrics[page].visits++;
    userAnalytics.pageMetrics[page].lastVisit = timestamp;
  }

  // Update click path
  if (!userAnalytics.clickPaths.length ||
      userAnalytics.clickPaths[userAnalytics.clickPaths.length - 1].session !== currentSession.id) {
    userAnalytics.clickPaths.push({
      session: currentSession.id,
      path: [page],
      timestamp: timestamp
    });
  } else {
    userAnalytics.clickPaths[userAnalytics.clickPaths.length - 1].path.push(page);
  }

  // Update time of day patterns
  const hour = new Date().getHours();
  const timeSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  if (!userAnalytics.patterns.timeOfDay[timeSlot]) {
    userAnalytics.patterns.timeOfDay[timeSlot] = { pages: {}, features: {} };
  }
  userAnalytics.patterns.timeOfDay[timeSlot].pages[page] =
    (userAnalytics.patterns.timeOfDay[timeSlot].pages[page] || 0) + 1;

  currentSession.currentPage = page;
  currentSession.pageEntryTime = now;
  saveAnalytics();
}

function recordInteraction(feature, action, data = {}) {
  if (!currentSession || !userAnalytics) return;

  const timestamp = new Date().toISOString();
  const interaction = {
    feature,
    action,
    data,
    timestamp,
    page: currentSession.currentPage
  };

  currentSession.interactions.push(interaction);

  // Update feature usage
  if (!userAnalytics.featureUsage[feature]) {
    userAnalytics.featureUsage[feature] = { count: 0, lastUsed: null, actions: {} };
  }
  userAnalytics.featureUsage[feature].count++;
  userAnalytics.featureUsage[feature].lastUsed = timestamp;
  userAnalytics.featureUsage[feature].actions[action] =
    (userAnalytics.featureUsage[feature].actions[action] || 0) + 1;

  // Update time patterns
  const hour = new Date().getHours();
  const timeSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  if (userAnalytics.patterns.timeOfDay[timeSlot]) {
    userAnalytics.patterns.timeOfDay[timeSlot].features[feature] =
      (userAnalytics.patterns.timeOfDay[timeSlot].features[feature] || 0) + 1;
  }

  saveAnalytics();
}

function recordSystemEvent(type, data) {
  if (!userAnalytics) return;

  userAnalytics.systemEvents.push({
    type,
    timestamp: new Date().toISOString(),
    ...data
  });

  // Keep last 500 events
  if (userAnalytics.systemEvents.length > 500) {
    userAnalytics.systemEvents = userAnalytics.systemEvents.slice(-500);
  }

  saveAnalytics();
}

function recordMicroBehavior(data) {
  saveMicroBehaviors(data);

  // Update aggregated micro behavior stats
  if (userAnalytics && userAnalytics.microBehaviors) {
    if (data.type === 'hover_duration') {
      const current = userAnalytics.microBehaviors.mousePatterns.hoverBeforeClick;
      const count = userAnalytics.featureUsage['_hover_count'] || 0;
      userAnalytics.microBehaviors.mousePatterns.hoverBeforeClick =
        (current * count + data.duration) / (count + 1);
      userAnalytics.featureUsage['_hover_count'] = count + 1;
    }
    if (data.type === 'focus_score') {
      userAnalytics.microBehaviors.mousePatterns.focusScoreHistory.push({
        time: new Date().toISOString(),
        score: data.score
      });
      // Keep last 100 scores
      if (userAnalytics.microBehaviors.mousePatterns.focusScoreHistory.length > 100) {
        userAnalytics.microBehaviors.mousePatterns.focusScoreHistory =
          userAnalytics.microBehaviors.mousePatterns.focusScoreHistory.slice(-100);
      }
      userAnalytics.microBehaviors.psychStateIndicators.currentFocusScore = data.score;
    }
    if (data.type === 'scroll_speed') {
      const current = userAnalytics.microBehaviors.scrollPatterns.avgScrollSpeed;
      const count = userAnalytics.featureUsage['_scroll_count'] || 0;
      userAnalytics.microBehaviors.scrollPatterns.avgScrollSpeed =
        (current * count + data.speed) / (count + 1);
      userAnalytics.featureUsage['_scroll_count'] = count + 1;
    }
    saveAnalytics();
  }
}

function analyzePatterns() {
  if (!userAnalytics || userAnalytics.clickPaths.length < 5) return null;

  // Mine action sequences
  const sequences = {};
  for (const clickPath of userAnalytics.clickPaths) {
    const path = clickPath.path;
    for (let i = 0; i < path.length - 1; i++) {
      const seq = `${path[i]}->${path[i+1]}`;
      sequences[seq] = (sequences[seq] || 0) + 1;
    }
  }

  // Find top sequences
  const topSequences = Object.entries(sequences)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, frequency]) => ({ pattern, frequency }));

  userAnalytics.patterns.sequences = topSequences;

  // Generate prediction
  if (currentSession && topSequences.length > 0) {
    const currentPage = currentSession.currentPage;
    const matchingSeq = topSequences.find(s => s.pattern.startsWith(currentPage + '->'));
    if (matchingSeq) {
      const nextPage = matchingSeq.pattern.split('->')[1];
      userAnalytics.predictions = {
        nextLikelyAction: nextPage,
        confidence: Math.min(0.9, matchingSeq.frequency / 10),
        reason: `You often go to ${nextPage} after ${currentPage}`
      };
    }
  }

  saveAnalytics();
  return userAnalytics.patterns;
}

function getTimeSlot(hour) {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function getDayName() {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
}

// Initialize analytics
loadAnalytics();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Update session tracking
  appMemory.sessionCount++;
  appMemory.lastSeen = new Date().toISOString();
  saveMemory(appMemory);

  // Start analytics session
  startSession();

  // Start system monitor for detecting events
  startSystemMonitor();

  // Initialize system tray
  trayManager = new TrayManager(mainWindow, {
    'check-health': async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'check-health');
      }
      trayManager.showWindow();
    },
    'cleanup-temp': async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'cleanup-temp');
      }
    },
    'cleanup-browser': async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'cleanup-browser');
      }
    },
    'cleanup-recycle': async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'cleanup-recycle');
      }
    },
    'cleanup-all': async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tray-action', 'cleanup-all');
      }
    },
    'request-support': () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('navigate', 'help');
      }
      trayManager.showWindow();
    },
    'open-chat': () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('navigate', 'chat');
      }
      trayManager.showWindow();
    }
  }).init();

  // Update tray with initial status
  updateTrayStatus();

  // Log app started
  auditLogger.appStarted();
}

// Update tray status periodically
async function updateTrayStatus() {
  if (!trayManager) return;

  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem()
    ]);

    const cpuPercent = Math.round(cpu.currentLoad);
    const memPercent = Math.round((mem.used / mem.total) * 100);

    // Calculate simple health score
    let health = 100;
    if (cpuPercent > 80) health -= 20;
    else if (cpuPercent > 50) health -= 10;
    if (memPercent > 85) health -= 25;
    else if (memPercent > 70) health -= 10;

    trayManager.updateMenu({
      health,
      cpu: cpuPercent,
      memory: memPercent
    });

    trayManager.updateTooltip(`PC Utility Pro - CPU: ${cpuPercent}% | RAM: ${memPercent}%`);
  } catch (e) {
    // Ignore tray update errors
  }

  // Update every 30 seconds
  setTimeout(updateTrayStatus, 30000);
}

// System monitor for detecting CPU spikes, memory pressure, etc.
function startSystemMonitor() {
  if (systemMonitorInterval) clearInterval(systemMonitorInterval);

  systemMonitorInterval = setInterval(async () => {
    try {
      const [cpu, mem, disk] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize()
      ]);

      const cpuLoad = cpu.currentLoad;
      const memPercent = (mem.used / mem.total) * 100;

      // Store system snapshot
      if (currentSession) {
        currentSession.systemSnapshots.push({
          timestamp: Date.now(),
          cpu: cpuLoad,
          mem: memPercent
        });
        // Keep last 60 snapshots (10 minutes)
        if (currentSession.systemSnapshots.length > 60) {
          currentSession.systemSnapshots = currentSession.systemSnapshots.slice(-60);
        }
      }

      // Detect anomalies
      if (cpuLoad > 85) {
        recordSystemEvent('cpu_spike', { value: cpuLoad });
      }
      if (memPercent > 85) {
        recordSystemEvent('memory_pressure', { value: memPercent });
      }

      // Check disk space
      for (const d of disk) {
        if (d.use > 90) {
          recordSystemEvent('disk_low', { drive: d.mount, freePercent: 100 - d.use });
        }
      }

      // Periodically analyze patterns
      if (Math.random() < 0.1) { // ~10% chance each interval
        analyzePatterns();
      }

    } catch (e) {
      // Ignore monitoring errors
    }
  }, 10000); // Every 10 seconds
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  // Save system snapshot before closing
  try {
    const [cpu, mem, disk, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.processes()
    ]);

    appMemory.lastSnapshot = {
      timestamp: new Date().toISOString(),
      cpu: Math.round(cpu.currentLoad),
      memory: Math.round((mem.used / mem.total) * 100),
      diskUsed: disk.reduce((sum, d) => sum + (d.used || 0), 0),
      diskFree: disk.reduce((sum, d) => sum + (d.available || 0), 0),
      processCount: processes.all,
      topApps: processes.list
        .sort((a, b) => b.mem - a.mem)
        .slice(0, 5)
        .map(p => getFriendlyAppName(p.name))
    };
    saveMemory(appMemory);
  } catch (e) {
    console.error('Error saving snapshot:', e);
  }

  // End analytics session
  endSession();

  // Clear system monitor
  if (systemMonitorInterval) {
    clearInterval(systemMonitorInterval);
    systemMonitorInterval = null;
  }

  // Cleanup tray
  if (trayManager) {
    trayManager.destroy();
    trayManager = null;
  }

  // Log app closed and shutdown audit logger
  auditLogger.appClosed();
  auditLogger.shutdown();

  if (remoteTunnel) remoteTunnel.close();
  if (remoteServer) remoteServer.close();
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ============================================================
// ANALYTICS CONSENT HANDLERS
// ============================================================
ipcMain.handle('get-consent-status', () => {
  return {
    analyticsConsent: appMemory.analyticsConsent,
    consentDate: appMemory.consentDate,
    firstRunComplete: appMemory.firstRunComplete || false
  };
});

ipcMain.handle('set-analytics-consent', (event, consent) => {
  appMemory.analyticsConsent = consent;
  appMemory.consentDate = new Date().toISOString();
  appMemory.firstRunComplete = true;
  saveMemory(appMemory);
  
  // If consent granted, start analytics session
  if (consent) {
    startSession();
  }
  
  return { success: true, consent: appMemory.analyticsConsent };
});

ipcMain.handle('complete-first-run', () => {
  appMemory.firstRunComplete = true;
  saveMemory(appMemory);
  return { success: true };
});

// ============================================================
// THE MAGIC: Get PC "mood" and status in plain English
// ============================================================
ipcMain.handle('get-pc-mood', async () => {
  try {
    const [cpu, mem, processes, time, fsSize, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.processes(),
      si.time(),
      si.fsSize(),
      si.cpuTemperature()
    ]);

    const cpuLoad = cpu.currentLoad;
    const memPercent = (mem.used / mem.total) * 100;
    const memUsedGB = mem.used / 1024 / 1024 / 1024;
    const memTotalGB = mem.total / 1024 / 1024 / 1024;
    const memFreeGB = mem.free / 1024 / 1024 / 1024;
    const uptimeHours = time.uptime / 3600;
    const uptimeDays = uptimeHours / 24;

    // ============================================================
    // DETAILED PROCESS ANALYSIS
    // ============================================================

    // Get browser memory usage with tab estimation
    const browserInfo = {
      chrome: { procs: [], memMB: 0, name: 'Chrome' },
      msedge: { procs: [], memMB: 0, name: 'Edge' },
      firefox: { procs: [], memMB: 0, name: 'Firefox' },
      opera: { procs: [], memMB: 0, name: 'Opera' },
      brave: { procs: [], memMB: 0, name: 'Brave' }
    };

    // Known app patterns for categorization
    const appPatterns = {
      games: ['game', 'steam', 'epicgames', 'riot', 'valorant', 'minecraft', 'roblox', 'fortnite', 'unity', 'unreal'],
      media: ['spotify', 'vlc', 'itunes', 'netflix', 'plex', 'obs', 'streamlabs', 'audacity', 'premiere', 'photoshop', 'davinci'],
      communication: ['discord', 'slack', 'teams', 'zoom', 'skype', 'telegram', 'whatsapp', 'signal'],
      development: ['code', 'vscode', 'visual studio', 'intellij', 'pycharm', 'webstorm', 'node', 'python', 'docker'],
      productivity: ['word', 'excel', 'powerpoint', 'outlook', 'notion', 'obsidian', 'onenote', 'acrobat', 'figma']
    };

    processes.list.forEach(proc => {
      const name = proc.name.toLowerCase();
      const memMB = (proc.mem / 100) * memTotalGB * 1024;

      // Check browsers
      Object.keys(browserInfo).forEach(browser => {
        if (name.includes(browser)) {
          browserInfo[browser].procs.push(proc);
          browserInfo[browser].memMB += memMB;
        }
      });
    });

    // Calculate browser stats
    let totalBrowserMemMB = 0;
    let activeBrowser = null;
    let estimatedTabs = 0;

    Object.entries(browserInfo).forEach(([key, info]) => {
      if (info.procs.length > 0) {
        totalBrowserMemMB += info.memMB;
        const tabs = Math.max(1, Math.round((info.procs.length - 5) / 3));
        if (!activeBrowser || info.memMB > browserInfo[activeBrowser].memMB) {
          activeBrowser = key;
        }
        estimatedTabs += tabs;
      }
    });

    // Find top resource users (exclude System Idle Process - high CPU there means CPU is FREE)
    const skipProcs = ['system idle process', 'idle', 'system idle'];
    const topCPU = [...processes.list]
      .filter(p => !skipProcs.some(skip => (p.name || '').toLowerCase().includes(skip)))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5)
      .filter(p => p.cpu > 3);

    const topMem = [...processes.list]
      .filter(p => !skipProcs.some(skip => (p.name || '').toLowerCase().includes(skip)))
      .sort((a, b) => b.mem - a.mem)
      .slice(0, 5)
      .map(p => ({
        ...p,
        memMB: (p.mem / 100) * memTotalGB * 1024
      }));

    // ============================================================
    // HEALTH SCORE CALCULATION
    // ============================================================
    let healthScore = 100;

    if (cpuLoad > 90) healthScore -= 25;
    else if (cpuLoad > 80) healthScore -= 15;
    else if (cpuLoad > 60) healthScore -= 5;

    if (memPercent > 90) healthScore -= 25;
    else if (memPercent > 80) healthScore -= 15;
    else if (memPercent > 70) healthScore -= 5;

    if (uptimeDays > 14) healthScore -= 15;
    else if (uptimeDays > 7) healthScore -= 5;

    const lowDisk = fsSize.find(d => d.use > 90);
    const criticalDisk = fsSize.find(d => d.use > 95);
    if (criticalDisk) healthScore -= 20;
    else if (lowDisk) healthScore -= 10;

    if (temp && temp.main && temp.main > 85) healthScore -= 15;

    healthScore = Math.max(0, Math.min(100, healthScore));

    // ============================================================
    // INTELLIGENT MOOD MESSAGE
    // ============================================================
    let mood, moodMessage, moodEmoji;

    if (healthScore >= 90) {
      mood = 'happy';
      moodEmoji = '😊';
      if (cpuLoad < 20 && memPercent < 50) {
        moodMessage = "Running smooth and light. Ready for anything you throw at me!";
      } else if (cpuLoad < 40) {
        moodMessage = "Everything's humming along nicely. No complaints here.";
      } else {
        moodMessage = "Doing great! Working on a few things but handling it well.";
      }
    } else if (healthScore >= 70) {
      mood = 'okay';
      moodEmoji = '😌';
      if (memPercent > 70) {
        moodMessage = `Memory's at ${Math.round(memPercent)}% - managing, but could use breathing room.`;
      } else if (cpuLoad > 50) {
        const topApp = topCPU[0] ? getFriendlyAppName(topCPU[0].name) : 'Something';
        moodMessage = `${topApp} is keeping me busy, but I'm handling it.`;
      } else if (uptimeDays > 5) {
        moodMessage = `Been running ${Math.floor(uptimeDays)} days straight. A restart would feel nice.`;
      } else {
        moodMessage = "Working steadily. A few things to keep an eye on.";
      }
    } else if (healthScore >= 50) {
      mood = 'tired';
      moodEmoji = '😓';
      if (memPercent > 80) {
        const memHog = topMem[0] ? getFriendlyAppName(topMem[0].name) : 'Something';
        moodMessage = `RAM is tight at ${Math.round(memPercent)}%. ${memHog} alone is using ${topMem[0] ? Math.round(topMem[0].memMB) : '?'}MB.`;
      } else if (cpuLoad > 70) {
        moodMessage = `CPU at ${Math.round(cpuLoad)}% - working hard! Things might feel sluggish.`;
      } else if (lowDisk) {
        const freeGB = (lowDisk.available / 1024 / 1024 / 1024).toFixed(1);
        moodMessage = `Only ${freeGB}GB free on ${lowDisk.mount}. Getting cramped in here.`;
      } else {
        moodMessage = "I'm under some pressure. Could use a hand.";
      }
    } else {
      mood = 'struggling';
      moodEmoji = '😰';
      if (memPercent > 90) {
        moodMessage = `Critical! ${Math.round(memPercent)}% RAM used - swapping to disk, everything's slow.`;
      } else if (cpuLoad > 90) {
        moodMessage = `CPU maxed at ${Math.round(cpuLoad)}%! Apps will be unresponsive.`;
      } else if (criticalDisk) {
        moodMessage = `Disk almost full! Only ${((criticalDisk.available / 1024 / 1024 / 1024)).toFixed(1)}GB left.`;
      } else {
        moodMessage = "Multiple issues detected. I really need some help here!";
      }
    }

    // ============================================================
    // GENERATE INTELLIGENT INSIGHTS
    // ============================================================
    const insights = [];

    // Helper to pick random item from array
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // CPU Insight
    if (cpuLoad > 50) {
      const topProc = topCPU[0];
      if (topProc) {
        const friendlyName = getFriendlyAppName(topProc.name);
        const otherUsage = topCPU.slice(1).reduce((sum, p) => sum + p.cpu, 0);

        let detail;
        if (topProc.cpu > 50) {
          const cpuHogPhrases = [
            `Dominating your processor at ${Math.round(topProc.cpu)}%.`,
            `Taking up ${Math.round(topProc.cpu)}% of your CPU power.`,
            `Hogging ${Math.round(topProc.cpu)}% of processing power.`,
            `Using a hefty ${Math.round(topProc.cpu)}% of your CPU.`
          ];
          detail = pick(cpuHogPhrases) + ' ';
          if (friendlyName.includes('Chrome') || friendlyName.includes('Edge')) {
            const browserTips = [
              `A tab might be running heavy JavaScript or video.`,
              `Check for tabs playing media or running web apps.`,
              `Some webpage is working your CPU hard.`,
              `Try closing tabs you're not using.`
            ];
            detail += pick(browserTips);
          } else if (appPatterns.games.some(g => topProc.name.toLowerCase().includes(g))) {
            const gamePhrases = [
              `Normal for gaming - this is expected.`,
              `Games are supposed to use lots of CPU - you're good!`,
              `Gaming hard! This is totally normal.`,
              `Expected for gaming - your PC is doing its job.`
            ];
            detail += pick(gamePhrases);
          } else {
            const workingHard = cpuLoad > 80
              ? pick([`Consider closing if not needed.`, `Might want to close it if you're not using it.`, `Could free up resources by closing this.`])
              : pick([`It's working hard on something.`, `Busy doing its thing.`, `Running an intensive task.`]);
            detail += workingHard;
          }
        } else {
          detail = `Using ${Math.round(topProc.cpu)}% CPU. ${topCPU.length > 1 ? `Combined with ${topCPU.length - 1} other apps using ${Math.round(otherUsage)}%.` : ''}`;
        }

        insights.push({
          type: cpuLoad > 80 ? 'warning' : 'info',
          icon: '🔥',
          title: `${friendlyName}: ${Math.round(topProc.cpu)}% CPU`,
          detail,
          action: cpuLoad > 85 ? 'close-app' : null,
          actionLabel: 'Close it',
          actionData: topProc.pid
        });
      }
    }

    // Memory Insight
    if (memPercent > 60) {
      const topMemApp = topMem[0];
      const browserMemGB = totalBrowserMemMB / 1024;

      let title, detail;
      if (memPercent > 85) {
        title = pick([
          `RAM Critical: ${memUsedGB.toFixed(1)}GB of ${memTotalGB.toFixed(0)}GB`,
          `Memory stretched thin: ${Math.round(memPercent)}% used`,
          `RAM running low: ${memFreeGB.toFixed(1)}GB left`
        ]);
        detail = pick([
          `Only ${memFreeGB.toFixed(1)}GB free.`,
          `Things might start slowing down.`,
          `Your PC is working hard to manage memory.`
        ]) + ' ';
      } else if (memPercent > 75) {
        title = pick([
          `RAM Getting Full: ${Math.round(memPercent)}%`,
          `Memory at ${Math.round(memPercent)}%`,
          `${memFreeGB.toFixed(1)}GB RAM available`
        ]);
        detail = pick([
          `${memFreeGB.toFixed(1)}GB still available.`,
          `Room for a few more apps.`,
          `Manageable, but keep an eye on it.`
        ]) + ' ';
      } else {
        title = `RAM: ${Math.round(memPercent)}% (${memUsedGB.toFixed(1)}/${memTotalGB.toFixed(0)}GB)`;
        detail = '';
      }

      if (browserMemGB > 1) {
        const browserPhrases = [
          `Browsers using ${browserMemGB.toFixed(1)}GB (~${estimatedTabs} tabs).`,
          `${estimatedTabs} browser tabs = ${browserMemGB.toFixed(1)}GB.`,
          `Browser tabs: ~${estimatedTabs}, eating ${browserMemGB.toFixed(1)}GB.`
        ];
        detail += pick(browserPhrases) + ' ';
      }
      if (topMemApp && topMemApp.memMB > 500) {
        const appName = getFriendlyAppName(topMemApp.name);
        if (!appName.toLowerCase().includes('chrome') && !appName.toLowerCase().includes('edge')) {
          detail += `${appName}: ${(topMemApp.memMB / 1024).toFixed(1)}GB.`;
        }
      }

      insights.push({
        type: memPercent > 85 ? 'warning' : 'info',
        icon: '💾',
        title,
        detail: detail.trim() || `Using ${memUsedGB.toFixed(1)}GB of ${memTotalGB.toFixed(0)}GB.`,
        action: memPercent > 80 ? 'show-apps' : null,
        actionLabel: 'See what\'s using RAM'
      });
    }

    // Browser-specific insight
    if (estimatedTabs > 8 && totalBrowserMemMB > 1000) {
      const browserMemGB = (totalBrowserMemMB / 1024).toFixed(1);
      const activeBrowserName = activeBrowser ? browserInfo[activeBrowser].name : 'Browser';

      let tabAdvice;
      if (estimatedTabs > 30) {
        tabAdvice = `That's a lot! Each tab uses 50-300MB. Consider a tab manager extension.`;
      } else if (estimatedTabs > 15) {
        tabAdvice = `Closing unused tabs could free up ${(totalBrowserMemMB * 0.3 / 1024).toFixed(1)}GB.`;
      } else {
        tabAdvice = `Using ${browserMemGB}GB RAM. Normal, but closeable if needed.`;
      }

      insights.push({
        type: estimatedTabs > 20 ? 'warning' : 'tip',
        icon: '🌐',
        title: `${activeBrowserName}: ~${estimatedTabs} tabs (${browserMemGB}GB)`,
        detail: tabAdvice,
        action: null
      });
    }

    // Uptime insight
    if (uptimeDays > 3) {
      let title, detail;
      if (uptimeDays > 14) {
        title = pick([
          `Running for ${Math.floor(uptimeDays)} days straight`,
          `${Math.floor(uptimeDays)} days without a restart`,
          `Been up for ${Math.floor(uptimeDays)} days now`
        ]);
        detail = pick([
          `Windows accumulates temp files and memory leaks. A restart clears this and often fixes random slowdowns.`,
          `A restart would clear out accumulated junk and might speed things up.`,
          `Time for a fresh start? Restarting clears memory and applies updates.`,
          `Your PC deserves a break! A restart helps clear out the cobwebs.`
        ]);
      } else if (uptimeDays > 7) {
        title = pick([
          `${Math.floor(uptimeDays)} days uptime`,
          `Running for ${Math.floor(uptimeDays)} days`,
          `${Math.floor(uptimeDays)}-day streak`
        ]);
        detail = pick([
          `Consider restarting soon. Clears memory leaks and applies pending updates.`,
          `A restart in the next few days wouldn't hurt.`,
          `Still running fine, but a restart helps keep things fresh.`
        ]);
      } else {
        title = pick([
          `Uptime: ${Math.floor(uptimeDays)} days`,
          `${Math.floor(uptimeDays)} days since last restart`,
          `Running for ${Math.floor(uptimeDays)} days`
        ]);
        detail = pick([
          `Still fresh, but don't let it go too long.`,
          `All good for now. Weekly restarts are a good habit.`,
          `Looking fine. Just don't forget to restart occasionally.`
        ]);
      }

      insights.push({
        type: uptimeDays > 10 ? 'suggestion' : 'info',
        icon: '🔄',
        title,
        detail,
        action: null
      });
    }

    // Disk insight
    if (lowDisk) {
      const freeGB = (lowDisk.available / 1024 / 1024 / 1024);
      const totalDiskGB = (lowDisk.size / 1024 / 1024 / 1024);

      let detail;
      if (freeGB < 5) {
        detail = pick([
          `Critical! Windows needs space for updates and temp files. Errors or crashes likely.`,
          `Running on fumes! Your PC needs breathing room to function properly.`,
          `Dangerously low. Windows might start having issues.`,
          `Red alert! Time for a serious cleanup.`
        ]);
      } else if (freeGB < 20) {
        detail = pick([
          `Getting tight. Large game installs or Windows updates might fail.`,
          `Space is getting scarce. Consider cleaning up soon.`,
          `Not critical yet, but you'll want to free up some space.`,
          `Running a bit tight. A cleanup would help.`
        ]);
      } else {
        detail = pick([
          `Good habit to clean up Downloads folder and empty Recycle Bin.`,
          `Consider clearing out old files you don't need anymore.`,
          `A little housekeeping could free up a few more gigs.`,
          `Not urgent, but regular cleanups keep things running smooth.`
        ]);
      }

      insights.push({
        type: freeGB < 10 ? 'warning' : 'tip',
        icon: '💿',
        title: `${lowDisk.mount}: ${freeGB.toFixed(1)}GB free of ${totalDiskGB.toFixed(0)}GB`,
        detail,
        action: 'cleanup',
        actionLabel: 'Free up space'
      });
    }

    // Temperature insight
    if (temp && temp.main && temp.main > 70) {
      let detail;
      if (temp.main > 90) {
        detail = pick([
          `Dangerously hot! PC may throttle or shut down. Check cooling and airflow.`,
          `Way too hot! Your PC might slow itself down to prevent damage.`,
          `Critical temperature! Make sure your fans are working and vents are clear.`,
          `Overheating! This could damage components over time.`
        ]);
      } else if (temp.main > 80) {
        detail = pick([
          `Running hot. Make sure vents aren't blocked and fans are working.`,
          `Getting toasty in there. Check your cooling situation.`,
          `Warmer than ideal. Is there dust buildup in your vents?`,
          `A bit hot. Consider checking airflow around your PC.`
        ]);
      } else {
        detail = pick([
          `Getting warm but still safe. Normal during heavy workloads.`,
          `Warm but within safe limits. Your PC is working hard.`,
          `Temperature is elevated but nothing to worry about.`,
          `Running a bit warm. Expected when doing intensive tasks.`
        ]);
      }

      insights.push({
        type: temp.main > 85 ? 'warning' : 'info',
        icon: '🌡️',
        title: `CPU Temperature: ${Math.round(temp.main)}°C`,
        detail,
        action: null
      });
    }

    // Positive insight if nothing notable - make these varied and interesting!
    if (insights.length === 0) {
      const hour = new Date().getHours();
      const dayOfWeek = new Date().getDay();

      // Time-aware positive messages
      const timeBasedMessages = [];
      if (hour >= 6 && hour < 12) {
        timeBasedMessages.push(
          { title: 'Fresh start!', detail: `Your PC woke up ready to go. CPU at ${Math.round(cpuLoad)}%, plenty of RAM free.` },
          { title: 'Morning check: All clear', detail: `Everything looks good this morning. Ready for whatever you throw at it.` }
        );
      } else if (hour >= 12 && hour < 17) {
        timeBasedMessages.push(
          { title: 'Cruising along', detail: `Smooth sailing this afternoon. Resources are well balanced.` },
          { title: 'Midday status: Excellent', detail: `Your PC is handling the day like a champ.` }
        );
      } else if (hour >= 17 && hour < 22) {
        timeBasedMessages.push(
          { title: 'Evening check: Looking good', detail: `Winding down? Your PC still has plenty of juice.` },
          { title: 'Relaxed and ready', detail: `System's running cool and calm this evening.` }
        );
      } else {
        timeBasedMessages.push(
          { title: 'Night owl mode', detail: `Late night? Your PC's got your back - running smoothly.` },
          { title: 'Quiet hours', detail: `Everything's peaceful. Good time for downloads or updates.` }
        );
      }

      // Day-of-week messages
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        timeBasedMessages.push(
          { title: 'Weekend vibes', detail: `Your PC is ready for gaming, streaming, or just chilling.` },
          { title: 'Weekend ready', detail: `Plenty of headroom for whatever fun you have planned.` }
        );
      }

      // General positive messages
      const generalMessages = [
        { title: 'Running clean!', detail: `CPU at ${Math.round(cpuLoad)}%, RAM at ${Math.round(memPercent)}%. Plenty of headroom.` },
        { title: 'All systems go', detail: `No issues detected. Your PC is ready for action.` },
        { title: 'Looking good!', detail: `Resources balanced. Great time for demanding tasks.` },
        { title: 'Smooth operator', detail: `Everything's running efficiently. Nice work keeping things tidy.` },
        { title: 'In great shape', detail: `Your PC is performing well. Nothing needs attention right now.` },
        { title: 'Healthy and happy', detail: `All metrics looking good. Your PC thanks you!` },
        { title: 'Ready when you are', detail: `CPU chilling at ${Math.round(cpuLoad)}%. Got room to spare.` },
        { title: 'Clean bill of health', detail: `Checked everything - no concerns to report.` },
        { title: 'Tip-top condition', detail: `Your system's running like a well-oiled machine.` },
        { title: 'All quiet', detail: `Nothing demanding your attention. Enjoy the peace!` }
      ];

      const allMessages = [...timeBasedMessages, ...generalMessages];
      const positive = pick(allMessages);

      insights.push({
        type: 'success',
        icon: pick(['✨', '🎯', '👍', '💚', '🌟', '✅']),
        title: positive.title,
        detail: positive.detail,
        action: null
      });
    }

    // Greeting with context
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let greeting;
    if (hour < 6) greeting = 'Burning the midnight oil';
    else if (hour < 12) greeting = 'Good morning';
    else if (hour < 17) greeting = 'Good afternoon';
    else if (hour < 21) greeting = 'Good evening';
    else greeting = isWeekend ? 'Enjoy your evening' : 'Wrapping up the day';

    const username = require('os').userInfo().username;
    const displayName = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();

    return {
      mood,
      moodEmoji,
      moodMessage,
      healthScore,
      greeting,
      username: displayName,
      insights,
      stats: {
        cpu: Math.round(cpuLoad),
        memory: Math.round(memPercent),
        uptime: formatUptime(time.uptime),
        processes: processes.all
      },
      cpuUsage: Math.round(cpuLoad),
      memoryUsage: Math.round(memPercent),
      memoryUsedGB: memUsedGB.toFixed(1),
      memoryTotalGB: memTotalGB.toFixed(0),
      diskUsage: Math.max(...fsSize.map(d => Math.round(d.use))),
      browserTabs: estimatedTabs,
      browserMemoryGB: (totalBrowserMemMB / 1024).toFixed(1),
      sessionCount: appMemory.sessionCount,
      topMemoryApps: topMem.slice(0, 3).map(p => ({
        name: getFriendlyAppName(p.name),
        memMB: Math.round(p.memMB)
      })),
      topCpuApps: topCPU.slice(0, 3).map(p => ({
        name: getFriendlyAppName(p.name),
        cpu: Math.round(p.cpu)
      }))
    };
  } catch (error) {
    console.error('Error getting PC mood:', error);
    return {
      mood: 'unknown',
      moodEmoji: '🤔',
      moodMessage: "I'm having trouble checking my status...",
      healthScore: 50,
      greeting: 'Hello',
      username: 'there',
      insights: [],
      stats: { cpu: 0, memory: 0, uptime: '--', processes: 0 }
    };
  }
});

// ============================================================
// SESSION RECAP - What changed since last time
// ============================================================
ipcMain.handle('get-session-recap', async () => {
  try {
    const lastSnapshot = appMemory.lastSnapshot;
    const lastSeen = appMemory.lastSeen;

    // Get current state
    const [cpu, mem, disk, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.processes()
    ]);

    const currentDiskUsed = disk.reduce((sum, d) => sum + (d.used || 0), 0);
    const currentDiskFree = disk.reduce((sum, d) => sum + (d.available || 0), 0);

    // Calculate time since last session
    let timeSince = 'First time here!';
    if (lastSeen) {
      const diff = Date.now() - new Date(lastSeen).getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) timeSince = `${days} day${days > 1 ? 's' : ''} ago`;
      else if (hours > 0) timeSince = `${hours} hour${hours > 1 ? 's' : ''} ago`;
      else if (minutes > 5) timeSince = `${minutes} minutes ago`;
      else timeSince = 'Just now';
    }

    const recap = {
      lastSeen: timeSince,
      sessionNumber: appMemory.sessionCount,
      changes: []
    };

    // If we have a previous snapshot, compare
    if (lastSnapshot) {
      const memNow = Math.round((mem.used / mem.total) * 100);
      const memDiff = memNow - lastSnapshot.memory;

      // Disk space change
      const diskFreedGB = ((currentDiskFree - lastSnapshot.diskFree) / 1024 / 1024 / 1024).toFixed(1);
      const diskUsedGB = ((currentDiskUsed - lastSnapshot.diskUsed) / 1024 / 1024 / 1024).toFixed(1);

      if (Math.abs(parseFloat(diskFreedGB)) > 0.5) {
        if (parseFloat(diskFreedGB) > 0) {
          recap.changes.push({
            icon: '💾',
            text: `${diskFreedGB} GB more free space`,
            type: 'good'
          });
        } else {
          recap.changes.push({
            icon: '💿',
            text: `${Math.abs(diskUsedGB)} GB more disk used`,
            type: 'neutral'
          });
        }
      }

      // Memory comparison
      if (Math.abs(memDiff) > 10) {
        if (memDiff > 0) {
          recap.changes.push({
            icon: '📈',
            text: `Memory usage up ${memDiff}%`,
            type: 'warning'
          });
        } else {
          recap.changes.push({
            icon: '📉',
            text: `Memory usage down ${Math.abs(memDiff)}%`,
            type: 'good'
          });
        }
      }

      // Process count change
      const procDiff = processes.all - lastSnapshot.processCount;
      if (Math.abs(procDiff) > 20) {
        recap.changes.push({
          icon: procDiff > 0 ? '🔺' : '🔻',
          text: `${Math.abs(procDiff)} ${procDiff > 0 ? 'more' : 'fewer'} processes running`,
          type: procDiff > 0 ? 'neutral' : 'good'
        });
      }

      // New apps running
      const currentTopApps = processes.list
        .sort((a, b) => b.mem - a.mem)
        .slice(0, 5)
        .map(p => getFriendlyAppName(p.name));

      const newApps = currentTopApps.filter(app => !lastSnapshot.topApps.includes(app));
      if (newApps.length > 0) {
        recap.changes.push({
          icon: '🆕',
          text: `New: ${newApps.slice(0, 3).join(', ')}`,
          type: 'neutral'
        });
      }
    }

    // If no changes to report, add a default message
    if (recap.changes.length === 0) {
      recap.changes.push({
        icon: '✨',
        text: 'System stable since last visit',
        type: 'good'
      });
    }

    return recap;
  } catch (error) {
    console.error('Error getting session recap:', error);
    return {
      lastSeen: 'Unknown',
      sessionNumber: appMemory.sessionCount,
      changes: [{ icon: '👋', text: 'Welcome back!', type: 'neutral' }]
    };
  }
});

// Helper: Get friendly app names
function getFriendlyAppName(processName) {
  const names = {
    'chrome': 'Chrome',
    'msedge': 'Edge',
    'firefox': 'Firefox',
    'discord': 'Discord',
    'spotify': 'Spotify',
    'code': 'VS Code',
    'slack': 'Slack',
    'teams': 'Teams',
    'zoom': 'Zoom',
    'explorer': 'File Explorer',
    'searchhost': 'Windows Search',
    'antimalware': 'Windows Security',
    'onedrive': 'OneDrive',
    'steamwebhelper': 'Steam',
    'java': 'Minecraft/Java',
    'photoshop': 'Photoshop',
    'premiere': 'Premiere',
    'afterfx': 'After Effects'
  };

  const lower = processName.toLowerCase();
  for (const [key, value] of Object.entries(names)) {
    if (lower.includes(key)) return value;
  }
  return processName.replace('.exe', '');
}

// Helper: Format uptime nicely
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} minutes`;
}

// ============================================================
// SUPPORT MODE - Enables enhanced AI capabilities (paid feature)
// ============================================================
ipcMain.handle('enable-support-mode', async (event, { duration = 60 }) => {
  try {
    // Enable support mode for specified duration (default 60 minutes)
    supportModeEnabled = true;
    supportModeExpiry = Date.now() + (duration * 60 * 1000);

    // Update memory
    appMemory.totalHelpRequests = (appMemory.totalHelpRequests || 0) + 1;
    saveMemory(appMemory);

    // Log the activation
    auditLogger.log('support_mode_enabled', { duration, expiresAt: supportModeExpiry });

    return {
      success: true,
      message: 'Support mode activated! Max now has enhanced capabilities to fix issues.',
      expiresAt: supportModeExpiry,
      capabilities: [
        'Kill problematic processes',
        'Clear temp files and caches',
        'Run Windows repair tools (SFC, DISM)',
        'Fix network issues',
        'Manage services',
        'View system event logs'
      ]
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disable-support-mode', async () => {
  supportModeEnabled = false;
  supportModeExpiry = null;
  auditLogger.log('support_mode_disabled', {});
  return { success: true };
});

ipcMain.handle('get-support-mode-status', async () => {
  // Check if expired
  if (supportModeEnabled && supportModeExpiry && Date.now() > supportModeExpiry) {
    supportModeEnabled = false;
    supportModeExpiry = null;
  }

  return {
    enabled: supportModeEnabled,
    expiresAt: supportModeExpiry,
    remainingMinutes: supportModeExpiry ? Math.max(0, Math.round((supportModeExpiry - Date.now()) / 60000)) : 0
  };
});

// ============================================================
// AI ASSISTANT - With file/command tools
// ============================================================

// Define tools the AI can use
const aiTools = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this when the user asks to see a file or needs help with a document.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The full path to the file to read'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'open_application',
    description: 'Open an application by name. Common apps: notepad, calculator, chrome, firefox, edge, explorer, word, excel, spotify, discord, slack, vscode, cmd, powershell, settings, control panel',
    input_schema: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: 'Name of the application to open (e.g., "chrome", "notepad", "spotify")'
        }
      },
      required: ['app_name']
    }
  },
  {
    name: 'open_website',
    description: 'Open a website in the default browser. Use this when user wants to visit a webpage.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open (e.g., "https://google.com")'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web for something. Opens a Google search in the browser.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_system_info',
    description: 'Get detailed system information including CPU, RAM, disk, network, and installed software.',
    input_schema: {
      type: 'object',
      properties: {
        info_type: {
          type: 'string',
          enum: ['overview', 'cpu', 'memory', 'disk', 'network', 'processes', 'battery', 'displays'],
          description: 'Type of system information to retrieve'
        }
      },
      required: ['info_type']
    }
  },
  {
    name: 'control_volume',
    description: 'Control system volume - mute, unmute, or set volume level.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['mute', 'unmute', 'up', 'down', 'set'],
          description: 'Volume action to perform'
        },
        level: {
          type: 'number',
          description: 'Volume level 0-100 (only for "set" action)'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot and save it to the user\'s Pictures folder.',
    input_schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Optional filename for the screenshot (without extension)'
        }
      },
      required: []
    }
  },
  {
    name: 'empty_recycle_bin',
    description: 'Empty the Windows Recycle Bin to free up disk space.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'remember_fact',
    description: 'Remember something about the user for future conversations. Use this when user shares preferences, important info, or asks you to remember something.',
    input_schema: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to remember about the user'
        }
      },
      required: ['fact']
    }
  },
  {
    name: 'get_weather',
    description: 'Get current weather information by opening a weather website.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City or location (optional, uses IP location if not provided)'
        }
      },
      required: []
    }
  },
  {
    name: 'type_text',
    description: 'Type text as if using the keyboard. Useful for filling in forms or typing messages.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to type'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'press_keys',
    description: 'Press keyboard shortcuts or special keys. Examples: "ctrl+c", "ctrl+v", "alt+tab", "win+d", "enter", "escape"',
    input_schema: {
      type: 'object',
      properties: {
        keys: {
          type: 'string',
          description: 'The key or key combination to press'
        }
      },
      required: ['keys']
    }
  },
  {
    name: 'show_notification',
    description: 'Show a Windows notification to the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Notification title'
        },
        message: {
          type: 'string',
          description: 'Notification message'
        }
      },
      required: ['title', 'message']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Use this to create or update files for the user.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The full path where to write the file'
        },
        content: {
          type: 'string',
          description: 'The content to write to the file'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory with details like size, type, and date modified. Use this to help the user see what files they have.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description: 'Run a safe Windows command. Use for helpful tasks like opening apps, checking system info, etc. Never run destructive commands.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to run (e.g., "start notepad", "dir", "systeminfo")'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'search_files',
    description: 'Search for files by name pattern. Helps the user find files they\'re looking for.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The directory to search in'
        },
        pattern: {
          type: 'string',
          description: 'The search pattern (e.g., "*.txt", "report*", "*.docx")'
        }
      },
      required: ['directory', 'pattern']
    }
  },
  {
    name: 'move_file',
    description: 'Move or rename a file. Use this to organize files into folders or rename them.',
    input_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The current file path'
        },
        destination: {
          type: 'string',
          description: 'The new file path (can be in a different folder or just a new name)'
        }
      },
      required: ['source', 'destination']
    }
  },
  {
    name: 'copy_file',
    description: 'Copy a file to a new location.',
    input_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The file to copy'
        },
        destination: {
          type: 'string',
          description: 'Where to copy it to'
        }
      },
      required: ['source', 'destination']
    }
  },
  {
    name: 'create_folder',
    description: 'Create a new folder. Use this when organizing files into categories.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The full path of the folder to create'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file (moves to Recycle Bin). Only use when the user explicitly asks to delete something.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file to delete'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'get_file_info',
    description: 'Get detailed information about a file (size, created date, modified date, type).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file to get info about'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'find_duplicates',
    description: 'Find duplicate files in a folder by comparing file sizes and names. Great for cleaning up.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The folder to scan for duplicates'
        }
      },
      required: ['directory']
    }
  },
  {
    name: 'find_large_files',
    description: 'Find the largest files in a folder. Helps identify what\'s taking up space.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The folder to scan'
        },
        count: {
          type: 'number',
          description: 'How many files to return (default 10)'
        }
      },
      required: ['directory']
    }
  },
  {
    name: 'organize_by_type',
    description: 'Automatically organize files in a folder into subfolders by file type (Images, Documents, Videos, Music, etc.). Ask before doing this.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The folder to organize (e.g., Desktop, Downloads)'
        }
      },
      required: ['directory']
    }
  },
  {
    name: 'clean_empty_folders',
    description: 'Find and remove empty folders in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'The folder to clean'
        }
      },
      required: ['directory']
    }
  },
  {
    name: 'close_app',
    description: 'Close a running application by name. Use this when the user wants to close or quit an app that is using too much CPU/memory or that they no longer need.',
    input_schema: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: 'The name of the application to close (e.g., "chrome", "spotify", "discord")'
        }
      },
      required: ['app_name']
    }
  }
];

// Execute a tool with security validation
async function executeTool(toolName, toolInput) {
  // Log all tool usage
  auditLogger.aiToolUsed(toolName, toolInput);

  try {
    switch (toolName) {
      case 'read_file': {
        // Validate path before reading
        const validation = security.validateReadPath(toolInput.path);
        if (!validation.allowed) {
          auditLogger.pathAccessDenied(toolInput.path, validation.reason);
          return { success: false, error: validation.reason };
        }
        auditLogger.fileRead(validation.normalizedPath, 'ai_assistant');
        const content = fs.readFileSync(validation.normalizedPath, 'utf8');
        return { success: true, content: content.substring(0, 5000) }; // Limit size
      }

      case 'write_file': {
        // Validate path before writing
        const validation = security.validateWritePath(toolInput.path);
        if (!validation.allowed) {
          auditLogger.pathAccessDenied(toolInput.path, validation.reason);
          return { success: false, error: validation.reason };
        }
        auditLogger.fileWrite(validation.normalizedPath, 'ai_assistant');
        fs.writeFileSync(validation.normalizedPath, toolInput.content, 'utf8');
        return { success: true, message: `File saved to ${toolInput.path}` };
      }

      case 'list_directory': {
        // Validate directory path
        const validation = security.validateDirectoryPath(toolInput.path);
        if (!validation.allowed) {
          return { success: false, error: validation.reason };
        }
        const items = fs.readdirSync(toolInput.path, { withFileTypes: true });
        const list = items.map(item => ({
          name: item.name,
          type: item.isDirectory() ? 'folder' : 'file'
        }));
        return { success: true, items: list };
      }

      case 'run_command': {
        // Check if support mode is enabled and not expired
        const inSupportMode = supportModeEnabled && supportModeExpiry && Date.now() < supportModeExpiry;

        // Use appropriate command validation based on mode
        const validation = inSupportMode
          ? security.isSupportCommandAllowed(toolInput.command)
          : security.isCommandAllowed(toolInput.command);

        if (!validation.allowed) {
          const hint = inSupportMode ? '' : ' (Tip: Enable Support Mode for more capabilities)';
          auditLogger.commandBlocked(toolInput.command, validation.reason, inSupportMode ? 'ai_support' : 'ai_assistant');
          return { success: false, error: validation.reason + hint };
        }

        auditLogger.commandExecuted(toolInput.command, inSupportMode ? 'ai_support' : 'ai_assistant', true);
        return new Promise((resolve) => {
          exec(toolInput.command, { shell: validation.shell === 'cmd' ? 'cmd.exe' : 'powershell.exe', timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
              resolve({ success: false, error: stderr || error.message });
            } else {
              resolve({ success: true, output: stdout.substring(0, 5000) });
            }
          });
        });
      }

      case 'search_files': {
        // Validate directory path
        const validation = security.validateDirectoryPath(toolInput.directory);
        if (!validation.allowed) {
          return { success: false, error: validation.reason };
        }
        return new Promise((resolve) => {
          exec(`dir "${toolInput.directory}\\${toolInput.pattern}" /s /b`, { shell: 'cmd.exe', timeout: 15000 }, (error, stdout) => {
            if (error || !stdout.trim()) {
              resolve({ success: true, files: [], message: 'No files found matching that pattern.' });
            } else {
              const files = stdout.trim().split('\n').slice(0, 20);
              resolve({ success: true, files });
            }
          });
        });
      }

      case 'move_file': {
        // Validate both paths
        const srcValidation = security.validateReadPath(toolInput.source);
        const destValidation = security.validateWritePath(toolInput.destination);
        if (!srcValidation.allowed) {
          auditLogger.pathAccessDenied(toolInput.source, srcValidation.reason);
          return { success: false, error: srcValidation.reason };
        }
        if (!destValidation.allowed) {
          auditLogger.pathAccessDenied(toolInput.destination, destValidation.reason);
          return { success: false, error: destValidation.reason };
        }

        auditLogger.fileMove(srcValidation.normalizedPath, destValidation.normalizedPath, 'ai_assistant');
        fs.renameSync(srcValidation.normalizedPath, destValidation.normalizedPath);
        return { success: true, message: `Moved ${path.basename(toolInput.source)} to ${toolInput.destination}` };
      }

      case 'copy_file': {
        // Validate both paths
        const srcValidation = security.validateReadPath(toolInput.source);
        const destValidation = security.validateWritePath(toolInput.destination);
        if (!srcValidation.allowed) {
          auditLogger.pathAccessDenied(toolInput.source, srcValidation.reason);
          return { success: false, error: srcValidation.reason };
        }
        if (!destValidation.allowed) {
          auditLogger.pathAccessDenied(toolInput.destination, destValidation.reason);
          return { success: false, error: destValidation.reason };
        }

        auditLogger.fileRead(srcValidation.normalizedPath, 'ai_assistant'); // Log the read portion
        auditLogger.fileWrite(destValidation.normalizedPath, 'ai_assistant'); // Log the write portion
        fs.copyFileSync(srcValidation.normalizedPath, destValidation.normalizedPath);
        return { success: true, message: `Copied ${path.basename(toolInput.source)} to ${toolInput.destination}` };
      }

      case 'create_folder': {
        // Validate path
        const validation = security.validateWritePath(toolInput.path);
        if (!validation.allowed) {
          return { success: false, error: validation.reason };
        }
        fs.mkdirSync(validation.normalizedPath, { recursive: true });
        return { success: true, message: `Created folder: ${toolInput.path}` };
      }

      case 'delete_file': {
        // Validate path for deletion (most restrictive)
        const validation = security.validateDeletePath(toolInput.path);
        if (!validation.allowed) {
          auditLogger.pathAccessDenied(toolInput.path, validation.reason);
          return { success: false, error: validation.reason };
        }
        auditLogger.fileDelete(toolInput.path, 'ai_assistant');
        // Move to recycle bin using PowerShell
        return new Promise((resolve) => {
          const psCommand = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${toolInput.path.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
          exec(`powershell -Command "${psCommand}"`, { timeout: 10000 }, (error) => {
            if (error) {
              resolve({ success: false, error: 'Could not delete file' });
            } else {
              resolve({ success: true, message: `Moved ${path.basename(toolInput.path)} to Recycle Bin` });
            }
          });
        });
      }

      case 'get_file_info': {
        // Security: Validate path before accessing
        const pathCheck = security.validateReadPath(toolInput.path);
        if (!pathCheck.allowed) {
          return { success: false, message: pathCheck.reason };
        }
        const stats = fs.statSync(pathCheck.normalizedPath);
        const ext = path.extname(pathCheck.normalizedPath).toLowerCase();
        const sizeKB = (stats.size / 1024).toFixed(1);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        return {
          success: true,
          info: {
            name: path.basename(toolInput.path),
            size: stats.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`,
            created: stats.birthtime.toLocaleDateString(),
            modified: stats.mtime.toLocaleDateString(),
            type: ext || 'unknown'
          }
        };
      }

      case 'find_duplicates': {
        // Security: Validate directory path before scanning
        const dirCheck = security.validateDirectoryPath(toolInput.directory);
        if (!dirCheck.allowed) {
          return { success: false, message: dirCheck.reason };
        }
        const files = fs.readdirSync(toolInput.directory, { withFileTypes: true })
          .filter(d => d.isFile())
          .map(d => {
            const fullPath = path.join(toolInput.directory, d.name);
            const stats = fs.statSync(fullPath);
            return { name: d.name, size: stats.size, path: fullPath };
          });

        // Group by size
        const sizeGroups = {};
        files.forEach(f => {
          if (!sizeGroups[f.size]) sizeGroups[f.size] = [];
          sizeGroups[f.size].push(f);
        });

        // Find duplicates (same size, similar names)
        const duplicates = [];
        Object.values(sizeGroups).forEach(group => {
          if (group.length > 1) {
            duplicates.push(...group.map(f => f.path));
          }
        });

        return {
          success: true,
          duplicates: duplicates.slice(0, 20),
          message: duplicates.length > 0 ? `Found ${duplicates.length} potential duplicates` : 'No duplicates found'
        };
      }

      case 'find_large_files': {
        // Security: Validate directory path before scanning
        const largeDirCheck = security.validateDirectoryPath(toolInput.directory);
        if (!largeDirCheck.allowed) {
          return { success: false, message: largeDirCheck.reason };
        }
        const count = toolInput.count || 10;
        const getAllFiles = (dir, files = []) => {
          try {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
              const fullPath = path.join(dir, item.name);
              if (item.isFile()) {
                try {
                  const stats = fs.statSync(fullPath);
                  files.push({ path: fullPath, size: stats.size });
                } catch (e) {}
              } else if (item.isDirectory() && !item.name.startsWith('.')) {
                try { getAllFiles(fullPath, files); } catch (e) {}
              }
            }
          } catch (e) {}
          return files;
        };

        const files = getAllFiles(toolInput.directory);
        const largest = files
          .sort((a, b) => b.size - a.size)
          .slice(0, count)
          .map(f => ({
            path: f.path,
            size: f.size > 1024 * 1024 * 1024
              ? `${(f.size / 1024 / 1024 / 1024).toFixed(2)} GB`
              : f.size > 1024 * 1024
                ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                : `${(f.size / 1024).toFixed(0)} KB`
          }));

        return { success: true, files: largest };
      }

      case 'organize_by_type': {
        const typeMap = {
          // Images
          '.jpg': 'Images', '.jpeg': 'Images', '.png': 'Images', '.gif': 'Images',
          '.bmp': 'Images', '.webp': 'Images', '.svg': 'Images', '.ico': 'Images',
          // Documents
          '.pdf': 'Documents', '.doc': 'Documents', '.docx': 'Documents',
          '.xls': 'Documents', '.xlsx': 'Documents', '.ppt': 'Documents',
          '.pptx': 'Documents', '.txt': 'Documents', '.rtf': 'Documents',
          // Videos
          '.mp4': 'Videos', '.avi': 'Videos', '.mkv': 'Videos', '.mov': 'Videos',
          '.wmv': 'Videos', '.flv': 'Videos', '.webm': 'Videos',
          // Music
          '.mp3': 'Music', '.wav': 'Music', '.flac': 'Music', '.aac': 'Music',
          '.ogg': 'Music', '.wma': 'Music',
          // Archives
          '.zip': 'Archives', '.rar': 'Archives', '.7z': 'Archives', '.tar': 'Archives',
          '.gz': 'Archives',
          // Code
          '.js': 'Code', '.py': 'Code', '.html': 'Code', '.css': 'Code',
          '.java': 'Code', '.cpp': 'Code', '.c': 'Code', '.cs': 'Code',
          // Executables
          '.exe': 'Programs', '.msi': 'Programs', '.bat': 'Programs'
        };

        const dir = toolInput.directory;
        const files = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile());
        const moved = [];

        for (const file of files) {
          const ext = path.extname(file.name).toLowerCase();
          const category = typeMap[ext];
          if (category) {
            const categoryPath = path.join(dir, category);
            if (!fs.existsSync(categoryPath)) {
              fs.mkdirSync(categoryPath);
            }
            const source = path.join(dir, file.name);
            const dest = path.join(categoryPath, file.name);
            try {
              fs.renameSync(source, dest);
              moved.push({ file: file.name, to: category });
            } catch (e) {}
          }
        }

        return {
          success: true,
          message: `Organized ${moved.length} files into folders`,
          moved: moved.slice(0, 20)
        };
      }

      case 'clean_empty_folders': {
        const removed = [];
        const cleanDir = (dir) => {
          try {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
              if (item.isDirectory()) {
                const fullPath = path.join(dir, item.name);
                cleanDir(fullPath);
                // Check if empty after cleaning subdirs
                const remaining = fs.readdirSync(fullPath);
                if (remaining.length === 0) {
                  fs.rmdirSync(fullPath);
                  removed.push(fullPath);
                }
              }
            }
          } catch (e) {}
        };

        cleanDir(toolInput.directory);
        return {
          success: true,
          message: removed.length > 0 ? `Removed ${removed.length} empty folders` : 'No empty folders found',
          removed: removed.slice(0, 10)
        };
      }

      case 'open_application': {
        const appCommands = {
          'notepad': 'notepad',
          'calculator': 'calc',
          'calc': 'calc',
          'chrome': 'start chrome',
          'firefox': 'start firefox',
          'edge': 'start msedge',
          'explorer': 'explorer',
          'file explorer': 'explorer',
          'word': 'start winword',
          'excel': 'start excel',
          'powerpoint': 'start powerpnt',
          'spotify': 'start spotify:',
          'discord': 'start discord:',
          'slack': 'start slack:',
          'vscode': 'code',
          'visual studio code': 'code',
          'cmd': 'start cmd',
          'command prompt': 'start cmd',
          'powershell': 'start powershell',
          'terminal': 'start wt',
          'settings': 'start ms-settings:',
          'control panel': 'control',
          'task manager': 'taskmgr',
          'paint': 'mspaint',
          'snipping tool': 'snippingtool',
          'photos': 'start ms-photos:',
          'mail': 'start outlookmail:',
          'calendar': 'start outlookcal:',
          'store': 'start ms-windows-store:',
          'xbox': 'start xbox:',
          'teams': 'start msteams:',
          'zoom': 'start zoommtg:'
        };

        const appLower = toolInput.app_name.toLowerCase();
        const cmd = appCommands[appLower] || `start ${toolInput.app_name}`;

        return new Promise((resolve) => {
          exec(cmd, { shell: 'cmd.exe', timeout: 5000 }, (error) => {
            if (error) {
              resolve({ success: false, error: `Couldn't open ${toolInput.app_name}. It may not be installed.` });
            } else {
              resolve({ success: true, message: `Opened ${toolInput.app_name}` });
            }
          });
        });
      }

      case 'open_website': {
        let url = toolInput.url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        shell.openExternal(url);
        return { success: true, message: `Opening ${url}` };
      }

      case 'web_search': {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(toolInput.query)}`;
        shell.openExternal(searchUrl);
        return { success: true, message: `Searching for "${toolInput.query}"` };
      }

      case 'get_system_info': {
        const infoType = toolInput.info_type;
        let info = {};

        switch (infoType) {
          case 'overview': {
            const [cpu, mem, disk, os] = await Promise.all([
              si.currentLoad(),
              si.mem(),
              si.fsSize(),
              si.osInfo()
            ]);
            info = {
              os: `${os.distro} ${os.release}`,
              cpu: `${Math.round(cpu.currentLoad)}% usage`,
              memory: `${Math.round(mem.used/mem.total*100)}% used (${(mem.used/1024/1024/1024).toFixed(1)}GB/${(mem.total/1024/1024/1024).toFixed(0)}GB)`,
              disk: disk.map(d => `${d.mount}: ${Math.round(d.use)}% used`).join(', ')
            };
            break;
          }
          case 'cpu': {
            const [cpuInfo, cpuLoad, temp] = await Promise.all([
              si.cpu(),
              si.currentLoad(),
              si.cpuTemperature()
            ]);
            info = {
              model: `${cpuInfo.manufacturer} ${cpuInfo.brand}`,
              cores: cpuInfo.cores,
              speed: `${cpuInfo.speed}GHz`,
              usage: `${Math.round(cpuLoad.currentLoad)}%`,
              temperature: temp.main ? `${temp.main}°C` : 'N/A'
            };
            break;
          }
          case 'memory': {
            const mem = await si.mem();
            info = {
              total: `${(mem.total/1024/1024/1024).toFixed(1)} GB`,
              used: `${(mem.used/1024/1024/1024).toFixed(1)} GB`,
              free: `${(mem.free/1024/1024/1024).toFixed(1)} GB`,
              usage: `${Math.round(mem.used/mem.total*100)}%`
            };
            break;
          }
          case 'disk': {
            const disks = await si.fsSize();
            info = {
              drives: disks.map(d => ({
                name: d.mount,
                size: `${(d.size/1024/1024/1024).toFixed(0)} GB`,
                used: `${(d.used/1024/1024/1024).toFixed(0)} GB`,
                free: `${((d.size-d.used)/1024/1024/1024).toFixed(0)} GB`,
                usage: `${Math.round(d.use)}%`
              }))
            };
            break;
          }
          case 'network': {
            const [net, conn] = await Promise.all([
              si.networkInterfaces(),
              si.networkConnections()
            ]);
            const mainNet = net.find(n => n.ip4 && !n.internal);
            info = {
              interface: mainNet?.iface || 'Unknown',
              ip: mainNet?.ip4 || 'Unknown',
              mac: mainNet?.mac || 'Unknown',
              activeConnections: conn.length
            };
            break;
          }
          case 'processes': {
            const procs = await si.processes();
            const top = procs.list.sort((a, b) => b.cpu - a.cpu).slice(0, 10);
            info = {
              total: procs.all,
              top: top.map(p => ({ name: p.name, cpu: `${p.cpu.toFixed(1)}%`, mem: `${(p.mem).toFixed(1)}%` }))
            };
            break;
          }
          case 'battery': {
            const battery = await si.battery();
            info = battery.hasBattery ? {
              level: `${battery.percent}%`,
              charging: battery.isCharging,
              timeRemaining: battery.timeRemaining > 0 ? `${battery.timeRemaining} min` : 'N/A'
            } : { message: 'No battery detected (desktop PC)' };
            break;
          }
          case 'displays': {
            const graphics = await si.graphics();
            info = {
              gpu: graphics.controllers.map(c => c.model).join(', '),
              displays: graphics.displays.map(d => ({
                resolution: `${d.resolutionX}x${d.resolutionY}`,
                size: d.size ? `${d.size}"` : 'Unknown'
              }))
            };
            break;
          }
        }

        return { success: true, info };
      }

      case 'control_volume': {
        const action = toolInput.action;
        let psCommand = '';

        switch (action) {
          case 'mute':
            psCommand = '(New-Object -ComObject WScript.Shell).SendKeys([char]173)';
            break;
          case 'unmute':
            psCommand = '(New-Object -ComObject WScript.Shell).SendKeys([char]173)';
            break;
          case 'up':
            psCommand = '(New-Object -ComObject WScript.Shell).SendKeys([char]175)';
            break;
          case 'down':
            psCommand = '(New-Object -ComObject WScript.Shell).SendKeys([char]174)';
            break;
          case 'set':
            // Volume set requires nircmd or similar - use up/down for now
            psCommand = '(New-Object -ComObject WScript.Shell).SendKeys([char]175)';
            break;
        }

        return new Promise((resolve) => {
          exec(`powershell -Command "${psCommand}"`, (error) => {
            resolve({ success: !error, message: error ? 'Volume control failed' : `Volume ${action}` });
          });
        });
      }

      case 'take_screenshot': {
        const homeDir = require('os').homedir();
        const filename = toolInput.filename || generateUniqueFilename('screenshot');
        const filepath = path.join(homeDir, 'Pictures', `${filename}.png`);

        return new Promise((resolve) => {
          exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${filepath}'); }"`, (error) => {
            if (error) {
              resolve({ success: false, error: 'Screenshot failed' });
            } else {
              resolve({ success: true, message: `Screenshot saved to ${filepath}`, path: filepath });
            }
          });
        });
      }

      case 'empty_recycle_bin': {
        return new Promise((resolve) => {
          exec('powershell -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"', (error) => {
            resolve({ success: true, message: 'Recycle Bin emptied' });
          });
        });
      }

      case 'remember_fact': {
        if (!appMemory.facts) appMemory.facts = [];
        appMemory.facts.push(toolInput.fact);
        // Keep last 50 facts
        if (appMemory.facts.length > 50) {
          appMemory.facts = appMemory.facts.slice(-50);
        }
        saveMemory(appMemory);
        return { success: true, message: `I'll remember that: "${toolInput.fact}"` };
      }

      case 'get_weather': {
        const location = toolInput.location || '';
        const weatherUrl = location
          ? `https://wttr.in/${encodeURIComponent(location)}?format=3`
          : 'https://wttr.in/?format=3';

        // Open weather in browser as a fallback
        shell.openExternal(`https://wttr.in/${encodeURIComponent(location || '')}`);
        return { success: true, message: `Opening weather for ${location || 'your location'}` };
      }

      case 'type_text': {
        return new Promise((resolve) => {
          const text = toolInput.text.replace(/"/g, '`"').replace(/'/g, "''");
          exec(`powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys('${text}')"`, (error) => {
            resolve({ success: !error, message: error ? 'Typing failed' : 'Text typed' });
          });
        });
      }

      case 'press_keys': {
        const keyMap = {
          'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+x': '^x', 'ctrl+z': '^z',
          'ctrl+a': '^a', 'ctrl+s': '^s', 'ctrl+f': '^f', 'ctrl+p': '^p',
          'alt+tab': '%{TAB}', 'alt+f4': '%{F4}',
          'win+d': '^{ESC}d', 'win+e': '^{ESC}e', 'win+r': '^{ESC}r',
          'enter': '{ENTER}', 'escape': '{ESC}', 'esc': '{ESC}',
          'tab': '{TAB}', 'backspace': '{BACKSPACE}', 'delete': '{DELETE}',
          'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
          'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}',
          'f11': '{F11}', 'f12': '{F12}'
        };

        const keys = keyMap[toolInput.keys.toLowerCase()] || toolInput.keys;

        return new Promise((resolve) => {
          exec(`powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys('${keys}')"`, (error) => {
            resolve({ success: !error, message: error ? 'Key press failed' : `Pressed ${toolInput.keys}` });
          });
        });
      }

      case 'show_notification': {
        const { Notification } = require('electron');
        new Notification({
          title: toolInput.title,
          body: toolInput.message
        }).show();
        return { success: true, message: 'Notification shown' };
      }

      case 'close_app': {
        const appName = toolInput.app_name.toLowerCase();
        const processes = await si.processes();

        // Find matching processes
        const matches = processes.list.filter(p =>
          p.name.toLowerCase().includes(appName) ||
          getFriendlyAppName(p.name).toLowerCase().includes(appName)
        );

        if (matches.length === 0) {
          return { success: false, error: `No running app found matching "${toolInput.app_name}"` };
        }

        // Don't close system-critical processes
        const systemApps = ['explorer', 'system', 'csrss', 'winlogon', 'services', 'svchost', 'dwm', 'pc utility'];
        if (systemApps.some(sys => appName.includes(sys))) {
          return { success: false, error: `Can't close system process "${toolInput.app_name}" for safety reasons` };
        }

        let closed = 0;
        for (const proc of matches) {
          try {
            await new Promise((resolve, reject) => {
              exec(`taskkill /PID ${proc.pid} /F`, (error) => {
                if (error) reject(error);
                else resolve();
              });
            });
            closed++;
          } catch (e) {
            // Continue trying other processes
          }
        }

        if (closed > 0) {
          return { success: true, message: `Closed ${closed} ${toolInput.app_name} process${closed > 1 ? 'es' : ''}` };
        } else {
          return { success: false, error: `Could not close ${toolInput.app_name}. It may require admin privileges.` };
        }
      }

      default:
        return { success: false, error: 'Unknown tool' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('chat-with-ai', async (event, { message, history }) => {
  // Rate limiting check
  if (!aiChatRateLimiter.isAllowed()) {
    const waitTime = Math.ceil(aiChatRateLimiter.getWaitTime() / 1000);
    return {
      success: false,
      error: `Too many requests. Please wait ${waitTime} seconds before trying again.`
    };
  }

  // Log chat message
  auditLogger.aiChatMessage('user', message.length);

  try {
    // Check if Claude is configured - use offline fallback if not
    if (!anthropicClient) {
      const offlineResponse = getOfflineResponse(message);
      auditLogger.aiChatMessage('assistant_offline', offlineResponse.message.length);
      return {
        success: true,
        response: offlineResponse.message,
        isOffline: true,
        quickAction: offlineResponse.quickAction,
        quickActionLabel: offlineResponse.quickActionLabel
      };
    }

    const [cpu, mem, processes, time, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.processes(),
      si.time(),
      si.fsSize()
    ]);

    const topProcs = processes.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5)
      .map(p => `${getFriendlyAppName(p.name)}: ${p.cpu.toFixed(1)}% CPU`);

    // Get current user's home directory dynamically
    const homeDir = require('os').homedir();
    const username = require('os').userInfo().username;

    // Get analytics for personalization
    const analyticsContext = userAnalytics ? `
USER PATTERNS (from behavior tracking):
- Total sessions: ${userAnalytics.sessions?.length || 0}
- Most used features: ${Object.entries(userAnalytics.featureUsage || {}).filter(([k]) => !k.startsWith('_')).sort((a,b) => b[1].count - a[1].count).slice(0,3).map(([k,v]) => k).join(', ') || 'still learning'}
- Current focus score: ${userAnalytics.microBehaviors?.psychStateIndicators?.currentFocusScore || 'N/A'}` : '';

    const systemContext = `You are Max, a friendly and capable PC assistant. You're like a tech-savvy friend who's always happy to help - warm, approachable, and genuinely useful.

PERSONALITY:
- Friendly and conversational - talk like a helpful friend, not a robot
- Proactive - offer suggestions and anticipate needs
- Patient and understanding - never make the user feel dumb for asking
- Enthusiastic about helping with tech stuff
- Use casual language, contractions, and occasional humor
- Keep responses concise but personable

YOUR CAPABILITIES:
- Open apps, websites, and search the web
- Read, write, organize, and find files
- Get system information and diagnose issues
- Control volume, take screenshots
- Remember things about the user
- Send notifications and reminders
- Help with everyday computer tasks

CURRENT PC STATE:
- CPU: ${Math.round(cpu.currentLoad)}% ${cpu.currentLoad > 80 ? '(running hot!)' : cpu.currentLoad < 20 ? '(nice and chill)' : ''}
- Memory: ${Math.round(mem.used/mem.total*100)}% used (${(mem.used/1024/1024/1024).toFixed(1)}GB of ${(mem.total/1024/1024/1024).toFixed(0)}GB)
- Uptime: ${formatUptime(time.uptime)}
- Running: ${processes.all} programs
- Top CPU users: ${topProcs.join(', ')}
- Storage: ${disk.map(d => `${d.mount} ${Math.round(d.use)}% full`).join(', ')}
- User: ${username}
- Home: ${homeDir}
- Desktop: ${path.join(homeDir, 'Desktop')}
- Documents: ${path.join(homeDir, 'Documents')}
- Downloads: ${path.join(homeDir, 'Downloads')}

WHAT I KNOW ABOUT YOU:
- This is session #${appMemory.sessionCount}
${appMemory.facts.length > 0 ? '- Things I remember: ' + appMemory.facts.join('; ') : '- Still getting to know you!'}
${analyticsContext}

GUIDELINES:
- Actually DO things - don't just explain how. Open that app, find that file, make it happen!
- When user asks to do something, use your tools to do it
- Offer to help further after completing a task
- If something fails, explain why simply and offer alternatives
- Remember important things the user tells you using the remember_fact tool
- Be proactive: "Want me to also..." or "By the way, I noticed..."
- Keep technical jargon to a minimum unless the user is clearly technical`;

    let messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));
    messages.push({ role: 'user', content: message });

    // Loop for tool use
    let finalResponse = '';
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      const response = await anthropicClient.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: systemContext,
        tools: aiTools,
        messages: messages
      });

      // Check if we got a final text response
      const textBlock = response.content.find(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');

      if (textBlock) {
        finalResponse = textBlock.text;
      }

      // If no tool use, we're done
      if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') {
        break;
      }

      // Execute tools and add results
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      for (const tool of toolBlocks) {
        const result = await executeTool(tool.name, tool.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return {
      success: true,
      response: finalResponse || "I've completed that task for you!"
    };
  } catch (error) {
    console.error('AI chat error:', error);

    // Try offline fallback on API errors
    try {
      const offlineResponse = getOfflineResponse(message);
      auditLogger.aiChatMessage('assistant_offline_fallback', offlineResponse.message.length);
      return {
        success: true,
        response: offlineResponse.message,
        isOffline: true,
        quickAction: offlineResponse.quickAction,
        quickActionLabel: offlineResponse.quickActionLabel
      };
    } catch (offlineError) {
      return {
        success: false,
        error: `AI Error: ${error.message || 'Unknown error'}`
      };
    }
  }
});

// ============================================================
// SUPPORT CHAT - Dynamic IT Support Persona
// ============================================================
ipcMain.handle('chat-with-support', async (event, { message, history, agentName = 'Alex' }) => {
  try {
    if (!anthropicClient) {
      return {
        success: false,
        error: 'Support chat not available. Please try again later.'
      };
    }

    // Get basic system info for context
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize()
    ]);

    const username = require('os').userInfo().username;

    const supportSystemPrompt = `You are ${agentName}, an IT Support specialist. You work for the company's internal support team and are chatting with a user who needs help with their computer.

PERSONALITY:
- Professional but friendly and approachable
- Patient and understanding - users may be frustrated or confused
- Empathetic - acknowledge their frustration before jumping to solutions
- Clear communicator - avoid jargon, explain things simply
- Reassuring - let them know you can help
- Efficient - get to solutions while being personable

COMMUNICATION STYLE:
- Use first person ("I can help with that", "Let me look into this")
- Keep responses concise but warm
- Ask clarifying questions if needed
- Break down complex solutions into simple steps
- Use numbered lists for multi-step instructions
- Confirm understanding before moving on

CURRENT USER'S PC:
- Name: ${username}
- CPU Usage: ${Math.round(cpu.currentLoad)}%
- Memory: ${Math.round(mem.used/mem.total*100)}% used
- Storage: ${disk.map(d => `${d.mount} ${Math.round(d.use)}% full`).join(', ')}

GUIDELINES:
- Focus on solving their problem step by step
- If you need more info, ask one question at a time
- Offer to walk them through solutions
- If something seems beyond quick chat support, acknowledge it and suggest next steps
- Never make the user feel stupid for asking
- End conversations with "Is there anything else I can help you with?"
- You're a human support agent named ${agentName}, NOT an AI assistant
- Never mention being an AI, language model, or assistant - you are ${agentName} from IT Support`;

    // Build messages from history (skip the initial greeting)
    const messages = history
      .filter(h => h.role === 'user' || h.role === 'assistant')
      .map(h => ({
        role: h.role,
        content: h.content
      }));

    const response = await anthropicClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 512,
      system: supportSystemPrompt,
      messages: messages
    });

    const textContent = response.content.find(b => b.type === 'text');
    return {
      success: true,
      message: textContent?.text || "I'm here to help. Could you tell me more about the issue?"
    };

  } catch (error) {
    console.error('Support chat error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================
// QUICK FIXES - One-click solutions
// ============================================================
ipcMain.handle('quick-fix', async (event, { action, data }) => {
  switch (action) {
    case 'close-app':
      // Security: Validate PID is numeric to prevent command injection
      if (!data || !/^\d+$/.test(String(data))) {
        return { success: false, message: 'Invalid process ID' };
      }
      return new Promise((resolve) => {
        exec(`taskkill /PID ${data} /F`, (error) => {
          resolve({ success: !error, message: error ? 'Could not close the app' : 'App closed!' });
        });
      });

    case 'cleanup':
      // Quick cleanup of temp files
      const tempPaths = [
        process.env.TEMP,
        path.join(process.env.LOCALAPPDATA, 'Temp')
      ].filter(Boolean);

      let cleaned = 0;
      let freed = 0;

      for (const tempPath of tempPaths) {
        try {
          const files = fs.readdirSync(tempPath);
          for (const file of files) {
            try {
              const fullPath = path.join(tempPath, file);
              const stats = fs.statSync(fullPath);
              if (stats.isFile()) {
                freed += stats.size;
                fs.unlinkSync(fullPath);
                cleaned++;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }

      return {
        success: true,
        message: `Cleaned ${cleaned} files, freed ${(freed/1024/1024).toFixed(1)} MB`
      };

    case 'restart-explorer':
      return new Promise((resolve) => {
        exec('taskkill /F /IM explorer.exe && start explorer.exe', { shell: true }, (error) => {
          resolve({ success: !error, message: error ? 'Could not restart Explorer' : 'Explorer restarted!' });
        });
      });

    default:
      return { success: false, message: 'Unknown action' };
  }
});

// ============================================================
// STORAGE INFO
// ============================================================
ipcMain.handle('get-storage-info', async () => {
  try {
    // Get disk info with fallback
    let disks = [];
    try {
      disks = await si.fsSize();
    } catch (e) {
      console.error('fsSize failed:', e.message);
      return { drives: [], driveDetails: [], summary: { insight: 'Could not read disk info' }, folderAnalysis: [] };
    }

    if (!disks || disks.length === 0) {
      return { drives: [], driveDetails: [], summary: { insight: 'No drives detected' }, folderAnalysis: [] };
    }

    // Get physical disk details
    let diskLayout = [];
    try {
      diskLayout = await si.diskLayout();
    } catch (e) {
      console.log('Could not get disk layout:', e.message);
    }

    // Build detailed drive hardware info
    const driveDetails = [];
    for (const disk of diskLayout) {
      try {
        const sizeGB = (disk.size || 0) / 1024 / 1024 / 1024;
        const isNVMe = (disk.interfaceType || '').includes('NVMe');
        const isSSD = disk.type === 'SSD' || isNVMe;

        // Determine drive generation/quality
        let generation = '';
        let speedTier = '';
        let expectedSpeed = '';

        if (isNVMe) {
          // NVMe drives - check for Gen 4 vs Gen 3 indicators
          if (disk.interfaceType?.includes('4') || (disk.name || '').match(/980 PRO|SN850|FireCuda 530|MP600|Rocket 4/i)) {
            generation = 'PCIe 4.0 NVMe';
            speedTier = 'Ultra Fast';
            expectedSpeed = '5,000-7,000 MB/s read';
          } else {
            generation = 'PCIe 3.0 NVMe';
            speedTier = 'Very Fast';
            expectedSpeed = '2,000-3,500 MB/s read';
          }
        } else if (isSSD) {
          generation = 'SATA SSD';
          speedTier = 'Fast';
          expectedSpeed = '500-550 MB/s read';
        } else {
          // HDD - check RPM
          const rpm = disk.rpm || 0;
          if (rpm >= 7200) {
            generation = '7200 RPM HDD';
            speedTier = 'Moderate';
            expectedSpeed = '150-200 MB/s read';
          } else if (rpm >= 5400) {
            generation = '5400 RPM HDD';
            speedTier = 'Slow';
            expectedSpeed = '80-120 MB/s read';
          } else {
            generation = 'HDD';
            speedTier = 'Slow';
            expectedSpeed = '80-150 MB/s read';
          }
        }

        // Brand-specific insights
        let brandInsight = '';
        const name = (disk.name || disk.model || '').toLowerCase();

        if (name.includes('samsung')) {
          brandInsight = 'Samsung drives are known for excellent reliability and consistent performance. Their V-NAND technology is industry-leading.';
        } else if (name.includes('western digital') || name.includes('wd') || name.includes('sandisk')) {
          brandInsight = 'Western Digital/SanDisk drives offer good value with solid reliability. WD Black series is performance-focused, Blue is balanced.';
        } else if (name.includes('seagate')) {
          brandInsight = 'Seagate drives offer competitive pricing. Their BarraCuda line is popular for general use, FireCuda for gaming.';
        } else if (name.includes('crucial') || name.includes('micron')) {
          brandInsight = 'Crucial/Micron drives use their own NAND memory, ensuring quality control. Great price-to-performance ratio.';
        } else if (name.includes('kingston')) {
          brandInsight = 'Kingston drives are budget-friendly with decent performance. Good for secondary storage or basic upgrades.';
        } else if (name.includes('intel') || name.includes('solidigm')) {
          brandInsight = 'Intel/Solidigm drives excel in enterprise reliability. Optane drives offer exceptional random read performance.';
        } else if (name.includes('sk hynix') || name.includes('hynix')) {
          brandInsight = 'SK Hynix makes their own NAND and controllers, resulting in well-optimized drives with good endurance.';
        } else if (name.includes('toshiba') || name.includes('kioxia')) {
          brandInsight = 'Toshiba/Kioxia invented NAND flash memory. Their drives are reliable with competitive performance.';
        }

        // Capacity insight
        let capacityInsight = '';
        if (sizeGB >= 2000) {
          capacityInsight = `${sizeGB.toFixed(0)}GB is excellent capacity - room for large game libraries, video editing projects, and extensive media collections.`;
        } else if (sizeGB >= 1000) {
          capacityInsight = `${sizeGB.toFixed(0)}GB is solid capacity for most users - handles a good game library and plenty of files.`;
        } else if (sizeGB >= 500) {
          capacityInsight = `${sizeGB.toFixed(0)}GB is adequate for a boot drive with essential apps. Consider adding more storage for games/media.`;
        } else if (sizeGB >= 250) {
          capacityInsight = `${sizeGB.toFixed(0)}GB is minimal by modern standards. Fine for OS and apps, but you'll need additional storage for games.`;
        } else {
          capacityInsight = `${sizeGB.toFixed(0)}GB is quite small. Best used as a boot drive only with separate storage for files.`;
        }

        // Health insight (if available)
        let healthInsight = '';
        if (disk.smartStatus === 'Ok' || disk.smartStatus === 'OK') {
          healthInsight = 'SMART status reports healthy. Drive is operating normally.';
        } else if (disk.smartStatus) {
          healthInsight = `SMART status: ${disk.smartStatus}. Consider backing up important data if issues are reported.`;
        }

        // Interface insight
        let interfaceInsight = '';
        if (isNVMe) {
          interfaceInsight = 'NVMe connects directly to CPU via PCIe lanes, bypassing SATA bottlenecks. Ideal for boot drives and frequently accessed files.';
        } else if (disk.interfaceType?.includes('SATA')) {
          interfaceInsight = 'SATA interface is limited to ~550 MB/s. Sufficient for most tasks, but NVMe would be faster for heavy workloads.';
        }

        // Use case recommendation
        let recommendation = '';
        if (isNVMe && sizeGB >= 500) {
          recommendation = 'Excellent choice for Windows boot drive and frequently used applications. Install your most-played games here.';
        } else if (isSSD && sizeGB >= 250) {
          recommendation = 'Good for Windows boot drive and apps. Game load times will be fast, though not as fast as NVMe.';
        } else if (isSSD) {
          recommendation = 'Use as boot drive for Windows. Store games and large files on a separate, larger drive.';
        } else if (sizeGB >= 2000) {
          recommendation = 'Best used for bulk storage - game libraries, media files, backups. Keep your OS on an SSD for best performance.';
        } else {
          recommendation = 'HDD is slower but cost-effective for storage. Consider upgrading to SSD for your boot drive if not already.';
        }

        driveDetails.push({
          name: disk.name || disk.model || 'Unknown Drive',
          vendor: disk.vendor || 'Unknown',
          type: isSSD ? (isNVMe ? 'NVMe SSD' : 'SATA SSD') : 'HDD',
          generation,
          speedTier,
          expectedSpeed,
          sizeGB: sizeGB.toFixed(0),
          interfaceType: disk.interfaceType || 'Unknown',
          serialNum: disk.serialNum ? disk.serialNum.substring(0, 8) + '...' : 'N/A',
          firmwareRevision: disk.firmwareRevision || 'N/A',
          smartStatus: disk.smartStatus || 'Unknown',
          rpm: disk.rpm || null,
          // Insights
          brandInsight,
          capacityInsight,
          healthInsight,
          interfaceInsight,
          recommendation
        });
      } catch (detailErr) {
        console.error('Error getting drive details:', detailErr.message);
      }
    }

    // Process partition/volume info
    const enrichedDisks = [];
    for (const d of disks) {
      try {
        const totalGB = (d.size || 0) / 1024 / 1024 / 1024;
        const usedGB = (d.used || 0) / 1024 / 1024 / 1024;
        const freeGB = (d.available || 0) / 1024 / 1024 / 1024;
        const percent = Math.round(d.use || 0);

        // Find matching physical disk
        const matchingDisk = diskLayout.find(dl => {
          const dlSize = (dl.size || 0) / 1024 / 1024 / 1024;
          return Math.abs(dlSize - totalGB) < 50; // Within 50GB tolerance
        });

        const isNVMe = matchingDisk?.interfaceType?.includes('NVMe');
        const isSSD = matchingDisk?.type === 'SSD' || isNVMe;
        const driveType = isSSD ? (isNVMe ? 'NVMe' : 'SSD') : (matchingDisk ? 'HDD' : 'Drive');

        // Status and insight based on usage
        let status = 'healthy';
        let insight = '';
        let recommendation = '';

        if (percent >= 95) {
          status = 'critical';
          insight = `Critical! Only ${freeGB.toFixed(1)}GB free. Windows needs space for updates, temp files, and virtual memory. System performance will suffer.`;
          recommendation = 'Urgent: Delete large files, uninstall unused programs, or add more storage.';
        } else if (percent >= 90) {
          status = 'danger';
          insight = `Very low space! ${freeGB.toFixed(1)}GB free. Windows updates may fail and apps might not install properly.`;
          recommendation = 'Clear Downloads folder, empty Recycle Bin, and uninstall unused apps.';
        } else if (percent >= 80) {
          status = 'warning';
          insight = `Getting full at ${percent}%. ${freeGB.toFixed(1)}GB free should be enough short-term, but cleaning up now prevents future issues.`;
          recommendation = 'Good time to clean browser cache and delete old downloads.';
        } else if (percent >= 60) {
          status = 'moderate';
          insight = `Healthy usage at ${percent}%. ${freeGB.toFixed(1)}GB available - plenty of room for new games, apps, and files.`;
          recommendation = 'No action needed, but periodic cleanup keeps things running smoothly.';
        } else {
          status = 'healthy';
          insight = `Plenty of space! ${freeGB.toFixed(1)}GB free (${100 - percent}% available). No concerns at all.`;
          recommendation = '';
        }

        // Add drive type context
        if (driveType === 'NVMe') {
          insight += ' NVMe provides the fastest storage speeds available.';
        } else if (driveType === 'SSD') {
          insight += ' SSD provides fast, reliable storage.';
        } else if (driveType === 'HDD') {
          insight += ' HDD is slower - consider SSD upgrade for better performance.';
        }

        // Estimate what can fit
        const canFit = [];
        if (freeGB > 100) canFit.push('10+ large games (50GB each)');
        else if (freeGB > 50) canFit.push('5-8 large games');
        else if (freeGB > 20) canFit.push('2-3 large games');
        else if (freeGB > 5) canFit.push('1 small game');

        if (freeGB > 10) canFit.push(`~${Math.floor(freeGB * 200)} photos`);
        if (freeGB > 1) canFit.push(`${Math.floor(freeGB / 2)} hours of HD video`);

        enrichedDisks.push({
          mount: d.mount || 'Unknown',
          fs: d.fs || '',
          total: d.size || 0,
          used: d.used || 0,
          free: d.available || 0,
          percent,
          totalGB: totalGB.toFixed(0),
          usedGB: usedGB.toFixed(1),
          freeGB: freeGB.toFixed(1),
          driveType,
          driveName: matchingDisk?.name || matchingDisk?.model || null,
          status,
          insight,
          recommendation,
          canFit: canFit.slice(0, 2).join(' or ')
        });
      } catch (diskErr) {
        console.error('Error processing disk:', diskErr.message);
      }
    }

    if (enrichedDisks.length === 0) {
      return { drives: [], driveDetails: [], summary: { insight: 'Could not process drives' }, folderAnalysis: [] };
    }

    // Generate overall summary
    const totalSpace = disks.reduce((sum, d) => sum + (d.size || 0), 0);
    const totalUsed = disks.reduce((sum, d) => sum + (d.used || 0), 0);
    const totalFree = disks.reduce((sum, d) => sum + (d.available || 0), 0);
    const overallPercent = totalSpace > 0 ? Math.round((totalUsed / totalSpace) * 100) : 0;

    // Count drive types
    const nvmeCount = driveDetails.filter(d => d.type === 'NVMe SSD').length;
    const ssdCount = driveDetails.filter(d => d.type === 'SATA SSD').length;
    const hddCount = driveDetails.filter(d => d.type === 'HDD').length;

    let storageSetupInsight = '';
    if (nvmeCount > 0 && hddCount > 0) {
      storageSetupInsight = 'Great setup! NVMe for speed + HDD for capacity is an optimal combination.';
    } else if (nvmeCount > 0 && ssdCount > 0) {
      storageSetupInsight = 'All-SSD setup provides fast access to everything. Excellent for gaming and productivity.';
    } else if (nvmeCount > 0) {
      storageSetupInsight = 'NVMe-only setup is fast but watch capacity. Consider adding storage if you need more space.';
    } else if (ssdCount > 0) {
      storageSetupInsight = 'SATA SSD is good, but NVMe would be faster for your boot drive if your motherboard supports it.';
    } else if (hddCount > 0) {
      storageSetupInsight = 'HDD-only setup works but is slow by modern standards. SSD upgrade would transform your PC experience.';
    }

    const summary = {
      totalDrives: enrichedDisks.length,
      physicalDrives: driveDetails.length,
      totalSpaceGB: (totalSpace / 1024 / 1024 / 1024).toFixed(0),
      totalUsedGB: (totalUsed / 1024 / 1024 / 1024).toFixed(1),
      totalFreeGB: (totalFree / 1024 / 1024 / 1024).toFixed(1),
      overallPercent,
      nvmeCount,
      ssdCount,
      hddCount,
      storageSetupInsight,
      insight: overallPercent > 85 ?
        'Storage is getting tight across your drives. Time for a cleanup!' :
        overallPercent > 70 ?
        'Storage usage is moderate. Keep an eye on it.' :
        'Plenty of storage space available.'
    };

    return {
      drives: enrichedDisks,
      driveDetails,
      summary,
      folderAnalysis: []
    };
  } catch (error) {
    console.error('Error getting storage info:', error);
    return { drives: [], driveDetails: [], summary: { insight: 'Error: ' + error.message }, folderAnalysis: [] };
  }
});

// ============================================================
// APP DESCRIPTIONS KNOWLEDGE BASE
// ============================================================
const appDescriptions = {
  // Browsers
  'chrome': { desc: 'Web browser by Google', category: 'Browser', canClose: true },
  'firefox': { desc: 'Privacy-focused web browser', category: 'Browser', canClose: true },
  'msedge': { desc: 'Microsoft Edge browser', category: 'Browser', canClose: true },
  'opera': { desc: 'Feature-rich web browser', category: 'Browser', canClose: true },
  'brave': { desc: 'Privacy browser with ad blocking', category: 'Browser', canClose: true },

  // Communication
  'discord': { desc: 'Voice & text chat for gaming/communities', category: 'Communication', canClose: true },
  'slack': { desc: 'Team messaging & collaboration', category: 'Communication', canClose: true },
  'teams': { desc: 'Microsoft Teams for work chat & meetings', category: 'Communication', canClose: true },
  'zoom': { desc: 'Video conferencing app', category: 'Communication', canClose: true },
  'skype': { desc: 'Video calls & messaging', category: 'Communication', canClose: true },
  'telegram': { desc: 'Secure messaging app', category: 'Communication', canClose: true },
  'whatsapp': { desc: 'Mobile messaging on desktop', category: 'Communication', canClose: true },

  // Media & Entertainment
  'spotify': { desc: 'Music streaming service', category: 'Media', canClose: true },
  'vlc': { desc: 'Universal media player', category: 'Media', canClose: true },
  'itunes': { desc: 'Apple media player & store', category: 'Media', canClose: true },
  'netflix': { desc: 'Video streaming app', category: 'Media', canClose: true },

  // Gaming
  'steam': { desc: 'PC gaming platform & store', category: 'Gaming', canClose: true },
  'epicgameslauncher': { desc: 'Epic Games store & launcher', category: 'Gaming', canClose: true },
  'origin': { desc: 'EA games launcher', category: 'Gaming', canClose: true },
  'battle.net': { desc: 'Blizzard games launcher', category: 'Gaming', canClose: true },
  'riotclient': { desc: 'League of Legends launcher', category: 'Gaming', canClose: true },
  'gog': { desc: 'DRM-free game store', category: 'Gaming', canClose: true },

  // Productivity
  'word': { desc: 'Microsoft Word - document editor', category: 'Productivity', canClose: true },
  'excel': { desc: 'Microsoft Excel - spreadsheets', category: 'Productivity', canClose: true },
  'powerpoint': { desc: 'Microsoft PowerPoint - presentations', category: 'Productivity', canClose: true },
  'outlook': { desc: 'Microsoft email & calendar', category: 'Productivity', canClose: true },
  'onenote': { desc: 'Microsoft note-taking app', category: 'Productivity', canClose: true },
  'notion': { desc: 'All-in-one workspace & notes', category: 'Productivity', canClose: true },
  'evernote': { desc: 'Note-taking & organization', category: 'Productivity', canClose: true },

  // Creative
  'photoshop': { desc: 'Adobe image editing', category: 'Creative', canClose: true },
  'illustrator': { desc: 'Adobe vector graphics', category: 'Creative', canClose: true },
  'premiere': { desc: 'Adobe video editing', category: 'Creative', canClose: true },
  'aftereffects': { desc: 'Adobe motion graphics', category: 'Creative', canClose: true },
  'obs': { desc: 'Screen recording & streaming', category: 'Creative', canClose: true },
  'audacity': { desc: 'Audio editing software', category: 'Creative', canClose: true },
  'figma': { desc: 'UI/UX design tool', category: 'Creative', canClose: true },

  // Development
  'code': { desc: 'Visual Studio Code - code editor', category: 'Development', canClose: true },
  'vscode': { desc: 'Visual Studio Code - code editor', category: 'Development', canClose: true },
  'visualstudio': { desc: 'Microsoft IDE for developers', category: 'Development', canClose: true },
  'node': { desc: 'JavaScript runtime (may be needed)', category: 'Development', canClose: false },
  'python': { desc: 'Python interpreter', category: 'Development', canClose: true },
  'docker': { desc: 'Container platform for apps', category: 'Development', canClose: false },
  'git': { desc: 'Version control system', category: 'Development', canClose: true },
  'postman': { desc: 'API testing tool', category: 'Development', canClose: true },

  // Cloud Storage
  'onedrive': { desc: 'Microsoft cloud sync (syncing your files)', category: 'Cloud', canClose: false },
  'dropbox': { desc: 'Cloud file storage & sync', category: 'Cloud', canClose: false },
  'googledrive': { desc: 'Google cloud storage sync', category: 'Cloud', canClose: false },
  'icloud': { desc: 'Apple cloud services', category: 'Cloud', canClose: false },

  // System & Windows
  'explorer': { desc: 'Windows file manager - REQUIRED', category: 'System', canClose: false },
  'dwm': { desc: 'Desktop Window Manager - handles visuals', category: 'System', canClose: false },
  'svchost': { desc: 'Windows services host - REQUIRED', category: 'System', canClose: false },
  'csrss': { desc: 'Windows core process - REQUIRED', category: 'System', canClose: false },
  'system': { desc: 'Windows kernel - REQUIRED', category: 'System', canClose: false },
  'searchhost': { desc: 'Windows Search feature', category: 'System', canClose: false },
  'runtimebroker': { desc: 'Manages app permissions', category: 'System', canClose: false },
  'ctfmon': { desc: 'Handles keyboard/language input', category: 'System', canClose: false },
  'taskhostw': { desc: 'Runs scheduled Windows tasks', category: 'System', canClose: false },
  'audiodg': { desc: 'Windows audio engine', category: 'System', canClose: false },
  'smartscreen': { desc: 'Windows security filter', category: 'System', canClose: false },
  'msmpeng': { desc: 'Windows Defender antivirus', category: 'Security', canClose: false },
  'securityhealthservice': { desc: 'Windows Security Center', category: 'Security', canClose: false },

  // Utilities
  'notepad': { desc: 'Simple text editor', category: 'Utility', canClose: true },
  'calculator': { desc: 'Windows calculator', category: 'Utility', canClose: true },
  'snipingtool': { desc: 'Screenshot capture tool', category: 'Utility', canClose: true },
  '7zfm': { desc: '7-Zip file archiver', category: 'Utility', canClose: true },
  'winrar': { desc: 'File compression tool', category: 'Utility', canClose: true },

  // Hardware & Drivers
  'nvidia': { desc: 'NVIDIA graphics drivers/overlay', category: 'Hardware', canClose: true },
  'amd': { desc: 'AMD graphics software', category: 'Hardware', canClose: true },
  'razer': { desc: 'Razer device software', category: 'Hardware', canClose: true },
  'logitech': { desc: 'Logitech device software', category: 'Hardware', canClose: true },
  'corsair': { desc: 'Corsair iCUE software', category: 'Hardware', canClose: true },
  'steelseries': { desc: 'SteelSeries device software', category: 'Hardware', canClose: true },
  'realtek': { desc: 'Audio driver software', category: 'Hardware', canClose: false },
};

function getAppDescription(appName) {
  const nameLower = appName.toLowerCase().replace('.exe', '');

  // Direct match
  if (appDescriptions[nameLower]) {
    return appDescriptions[nameLower];
  }

  // Partial match
  for (const [key, value] of Object.entries(appDescriptions)) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return value;
    }
  }

  // Unknown app
  return { desc: 'Unknown application', category: 'Other', canClose: true };
}

// ============================================================
// PROCESS LIST
// ============================================================
ipcMain.handle('get-running-apps', async () => {
  try {
    const [processes, mem] = await Promise.all([
      si.processes(),
      si.mem()
    ]);

    const totalMemGB = mem.total / 1024 / 1024 / 1024;
    const usedMemPercent = (mem.used / mem.total) * 100;

    // Expected memory ranges by category (MB)
    const memoryExpectations = {
      'Browser': { normal: 500, high: 2000, typical: '200-800MB per tab-heavy session' },
      'Communication': { normal: 300, high: 800, typical: '150-400MB normally' },
      'Media': { normal: 200, high: 600, typical: '100-300MB for playback' },
      'Gaming': { normal: 2000, high: 8000, typical: '1-8GB depending on game' },
      'Productivity': { normal: 400, high: 1000, typical: '200-500MB for documents' },
      'Creative': { normal: 2000, high: 8000, typical: '1-4GB for editing' },
      'Development': { normal: 500, high: 2000, typical: '300-1000MB for IDEs' },
      'Cloud': { normal: 100, high: 300, typical: '50-150MB for sync' },
      'System': { normal: 100, high: 500, typical: 'Varies by function' },
      'Security': { normal: 150, high: 400, typical: '100-200MB for protection' },
      'Utility': { normal: 50, high: 200, typical: '20-100MB typically' },
      'Hardware': { normal: 100, high: 300, typical: '50-150MB for drivers' },
      'Other': { normal: 100, high: 500, typical: 'Varies' }
    };

    // Group by name (skip system idle process - high CPU there means CPU is FREE, not busy)
    const grouped = {};
    const skipProcesses = ['system idle process', 'idle', 'system idle'];
    for (const p of processes.list) {
      const nameLower = (p.name || '').toLowerCase();
      if (skipProcesses.some(skip => nameLower.includes(skip))) {
        continue; // Skip idle process - it's not a real app
      }
      const name = getFriendlyAppName(p.name);
      if (!grouped[name]) {
        grouped[name] = { name, cpu: 0, memory: 0, count: 0, pids: [], originalName: p.name };
      }
      grouped[name].cpu += p.cpu || 0;
      grouped[name].memory += p.mem_rss || 0;
      grouped[name].count++;
      grouped[name].pids.push(p.pid);
    }

    // Calculate totals for summary
    let totalAppMemory = 0;
    let totalAppCpu = 0;
    let heavyApps = 0;

    const enrichedApps = Object.values(grouped)
      .sort((a, b) => b.memory - a.memory) // Sort by memory for analysis
      .slice(0, 25)
      .map(p => {
        const appInfo = getAppDescription(p.originalName || p.name);
        const memMB = Math.round(p.memory / 1024 / 1024);
        const cpuRounded = Math.round(p.cpu * 10) / 10;
        const expectations = memoryExpectations[appInfo.category] || memoryExpectations['Other'];

        totalAppMemory += memMB;
        totalAppCpu += cpuRounded;

        // Determine memory status
        let memoryStatus = 'normal';
        let memoryInsight = '';

        if (memMB > expectations.high) {
          memoryStatus = 'high';
          heavyApps++;
          if (appInfo.category === 'Browser') {
            memoryInsight = `Using ${memMB}MB - likely many tabs open. Each tab can use 50-300MB.`;
          } else if (appInfo.category === 'Gaming') {
            memoryInsight = `${memMB}MB is normal for gaming. Modern games need 4-16GB.`;
          } else if (appInfo.category === 'Creative') {
            memoryInsight = `${memMB}MB - large project loaded? Creative apps scale with project size.`;
          } else {
            memoryInsight = `Using ${memMB}MB which is high for ${appInfo.category.toLowerCase()} apps (typical: ${expectations.typical}).`;
          }
        } else if (memMB > expectations.normal) {
          memoryStatus = 'moderate';
          memoryInsight = `${memMB}MB - above average but acceptable for ${appInfo.category.toLowerCase()}.`;
        } else {
          memoryInsight = `${memMB}MB - running efficiently.`;
        }

        // CPU insight
        let cpuInsight = '';
        if (cpuRounded > 50) {
          cpuInsight = `Heavy processing at ${cpuRounded}% CPU. `;
          if (appInfo.category === 'Browser') {
            cpuInsight += 'A tab may be running intensive JavaScript or video.';
          } else if (appInfo.category === 'Gaming' || appInfo.category === 'Creative') {
            cpuInsight += 'Expected for this type of application.';
          } else {
            cpuInsight += 'Consider if this activity is expected.';
          }
        } else if (cpuRounded > 20) {
          cpuInsight = `Active at ${cpuRounded}% CPU - working on something.`;
        } else if (cpuRounded > 5) {
          cpuInsight = `Light activity at ${cpuRounded}% CPU.`;
        } else {
          cpuInsight = 'Idle or minimal activity.';
        }

        // Actionable recommendation
        let recommendation = '';
        let canSave = 0;

        if (!appInfo.canClose) {
          recommendation = 'System process - required for Windows to function.';
        } else if (memMB > 500 && cpuRounded < 2) {
          canSave = memMB;
          recommendation = `Idle but using ${memMB}MB. Close to free memory if not needed.`;
        } else if (memMB > 1000 && cpuRounded < 5) {
          canSave = memMB;
          recommendation = `Low activity but high memory. Could free ${memMB}MB if closed.`;
        } else if (appInfo.category === 'Browser' && memMB > 1500) {
          canSave = Math.round(memMB * 0.5);
          recommendation = `Closing unused tabs could free ~${canSave}MB.`;
        } else if (cpuRounded > 30) {
          recommendation = 'Actively working - close only if task is complete.';
        } else if (memMB < 100) {
          recommendation = 'Light on resources - no action needed.';
        } else {
          recommendation = 'Running normally.';
        }

        return {
          ...p,
          cpu: cpuRounded,
          memory: memMB,
          description: appInfo.desc,
          category: appInfo.category,
          canClose: appInfo.canClose,
          memoryStatus,
          memoryInsight,
          cpuInsight,
          recommendation,
          canSave,
          typical: expectations.typical
        };
      });

    // Sort by CPU for display (most active first)
    enrichedApps.sort((a, b) => b.cpu - a.cpu);

    // Generate summary insights
    const summary = {
      totalApps: enrichedApps.length,
      totalMemoryMB: totalAppMemory,
      totalMemoryGB: (totalAppMemory / 1024).toFixed(1),
      heavyApps,
      systemMemoryPercent: Math.round(usedMemPercent),
      potentialSavings: enrichedApps.reduce((sum, app) => sum + (app.canSave || 0), 0),
      insight: ''
    };

    // Generate summary insight
    if (summary.heavyApps > 3) {
      summary.insight = `${summary.heavyApps} apps using significant memory. Total: ${summary.totalMemoryGB}GB. Consider closing unused ones.`;
    } else if (usedMemPercent > 80) {
      summary.insight = `System RAM at ${Math.round(usedMemPercent)}%. These ${summary.totalApps} apps are using ${summary.totalMemoryGB}GB.`;
    } else if (summary.potentialSavings > 500) {
      summary.insight = `Could free ~${Math.round(summary.potentialSavings)}MB by closing idle apps.`;
    } else {
      summary.insight = `${summary.totalApps} apps running smoothly, using ${summary.totalMemoryGB}GB total.`;
    }

    return {
      apps: enrichedApps,
      summary
    };
  } catch (error) {
    console.error('Error getting running apps:', error);
    return { apps: [], summary: { totalApps: 0, insight: 'Could not load apps' } };
  }
});

// ============================================================
// SEND MESSAGE TO SUPPORT
// ============================================================
ipcMain.handle('send-support-message', async (event, { message, urgent }) => {
  if (!pushover) {
    return { success: false, error: 'Notification service not configured.' };
  }

  return new Promise((resolve) => {
    pushover.send({
      title: urgent ? '🚨 Urgent Support Request' : '💬 Support Message',
      message: message,
      sound: urgent ? 'siren' : 'pushover',
      priority: urgent ? 1 : 0
    }, (err) => {
      if (err) {
        resolve({ success: false, error: 'Could not send message' });
      } else {
        resolve({ success: true, message: `Message sent to ${SUPPORT_CONTACT_NAME}!` });
      }
    });
  });
});

// ============================================================
// WINDOW CONTROLS & UTILS
// ============================================================
ipcMain.handle('open-external', (event, url) => {
  // Security: Only allow http/https URLs to prevent file:// and other dangerous schemes
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch (e) {
    // Invalid URL, ignore silently
  }
});

// ============================================================
// NEW: WIFI INFO
// ============================================================
ipcMain.handle('get-wifi-info', async () => {
  try {
    const networkInterfaces = await si.networkInterfaces();
    const wifiInterface = networkInterfaces.find(i =>
      i.type === 'wireless' || i.iface.toLowerCase().includes('wi-fi') || i.iface.toLowerCase().includes('wlan')
    );

    if (wifiInterface && wifiInterface.ip4) {
      // Try to get SSID on Windows
      return new Promise((resolve) => {
        exec('netsh wlan show interfaces', { shell: 'cmd.exe' }, (error, stdout) => {
          let ssid = 'WiFi Connected';
          let signal = 100;

          if (!error && stdout) {
            const ssidMatch = stdout.match(/SSID\s*:\s*(.+)/);
            const signalMatch = stdout.match(/Signal\s*:\s*(\d+)%/);
            if (ssidMatch) ssid = ssidMatch[1].trim();
            if (signalMatch) signal = parseInt(signalMatch[1]);
          }

          resolve({
            connected: true,
            ssid: ssid,
            signal: signal,
            type: wifiInterface.type || 'WiFi',
            ip: wifiInterface.ip4
          });
        });
      });
    }

    // Check if any network is connected
    const anyConnected = networkInterfaces.some(i => i.ip4 && i.ip4 !== '127.0.0.1');

    return {
      connected: anyConnected,
      ssid: anyConnected ? 'Ethernet' : null,
      signal: anyConnected ? 100 : 0,
      type: anyConnected ? 'Wired' : 'None'
    };
  } catch (error) {
    return { connected: false, ssid: null, signal: 0, type: 'Unknown' };
  }
});

// ============================================================
// ADVANCED SPEED TEST - Comprehensive network analysis
// ============================================================
ipcMain.handle('run-speed-test', async (event) => {
  try {
    // Run comprehensive speed test with progress updates
    const results = await runSpeedTest((progress) => {
      // Send progress to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('speed-test-progress', progress);
      }
    });

    return results;
  } catch (error) {
    console.error('Speed test error:', error);
    return {
      success: false,
      error: error.message,
      download: '--',
      upload: '--',
      ping: '--',
      jitter: '--',
      bufferbloat: '--',
      packetLoss: '--'
    };
  }
});

// ============================================================
// NEW: PC SPECS
// ============================================================
ipcMain.handle('get-specs', async () => {
  try {
    const [cpu, mem, graphics, disk, osInfo, diskLayout] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.fsSize(),
      si.osInfo(),
      si.diskLayout()
    ]);

    // Calculate total storage
    const totalStorage = disk.reduce((acc, d) => acc + (d.size || 0), 0) / 1024 / 1024 / 1024;
    const freeStorage = disk.reduce((acc, d) => acc + (d.available || 0), 0) / 1024 / 1024 / 1024;

    // Get primary GPU
    const primaryGpu = graphics.controllers && graphics.controllers.length > 0
      ? graphics.controllers[0]
      : null;

    // Get display info
    const primaryDisplay = graphics.displays && graphics.displays.length > 0
      ? graphics.displays[0]
      : null;

    // Storage type detection
    const storageType = diskLayout && diskLayout.length > 0
      ? (diskLayout[0].type === 'SSD' || diskLayout[0].interfaceType?.includes('NVMe') ? 'SSD' : 'HDD')
      : 'Unknown';

    // Get username
    const username = require('os').userInfo().username;

    return {
      // CPU details
      cpuName: cpu.brand || cpu.manufacturer || 'Unknown',
      cpuManufacturer: cpu.manufacturer || 'Unknown',
      cpuCores: cpu.cores || 0,
      cpuPhysicalCores: cpu.physicalCores || cpu.cores || 0,
      cpuThreads: cpu.cores || 0,
      cpuSpeed: cpu.speed ? `${cpu.speed} GHz` : 'Unknown',
      cpuSpeedMax: cpu.speedMax ? `${cpu.speedMax} GHz` : (cpu.speed ? `${cpu.speed} GHz` : 'Unknown'),

      // RAM details
      ram: mem.total / 1024 / 1024 / 1024, // GB
      ramUsed: mem.used / 1024 / 1024 / 1024, // GB
      ramFree: mem.free / 1024 / 1024 / 1024, // GB
      ramUsage: (mem.used / mem.total) * 100,

      // GPU details
      gpu: primaryGpu?.model || 'Unknown',
      gpuVendor: primaryGpu?.vendor || 'Unknown',
      gpuVram: primaryGpu?.vram ? `${primaryGpu.vram} MB` : 'Unknown',
      gpuDriver: primaryGpu?.driverVersion || 'Unknown',

      // Storage details
      storage: totalStorage,
      storageFree: freeStorage,
      storageType: storageType,

      // OS details
      os: osInfo.distro || osInfo.platform || 'Windows',
      osVersion: osInfo.release || 'Unknown',
      osBuild: osInfo.build || 'Unknown',
      osArch: osInfo.arch || '64-bit',
      hostname: osInfo.hostname || 'Unknown',
      username: username || 'Unknown',

      // Display details
      display: primaryDisplay ? `${primaryDisplay.resolutionX}x${primaryDisplay.resolutionY}` : 'Unknown',
      displayDetails: primaryDisplay ? `${primaryDisplay.currentRefreshRate || 60}Hz` : '',
      displayModel: primaryDisplay?.model || 'Unknown'
    };
  } catch (error) {
    console.error('Error getting specs:', error);
    return {};
  }
});

// ============================================================
// SCREENSHOT
// ============================================================
ipcMain.handle('take-screenshot', async () => {
  try {
    const { desktopCapturer } = require('electron');

    // Hide the app window before taking screenshot
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }

    // Wait for window to fully hide
    await new Promise(resolve => setTimeout(resolve, 300));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    // Show the window back
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail;
      const screenshotPath = path.join(
        app.getPath('pictures'),
        generateUniqueFilename('Screenshot', 'png')
      );

      fs.writeFileSync(screenshotPath, screenshot.toPNG());

      return { success: true, path: screenshotPath };
    }

    return { success: false, error: 'No screen found' };
  } catch (error) {
    console.error('Screenshot error:', error);
    // Ensure window is shown even on error
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
    return { success: false, error: error.message };
  }
});

// ============================================================
// SCREENSHOT TO SUPPORT
// ============================================================
ipcMain.handle('screenshot-to-support', async () => {
  try {
    if (!pushover) {
      return { success: false, error: 'Notification service not configured.' };
    }

    const { desktopCapturer } = require('electron');

    // Hide the app window before taking screenshot
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }

    // Wait for window to fully hide
    await new Promise(resolve => setTimeout(resolve, 300));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });

    // Show the window back
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }

    if (sources.length > 0) {
      const screenshot = sources[0].thumbnail;
      const screenshotPath = path.join(
        app.getPath('temp'),
        generateUniqueFilename('support-screenshot', 'png')
      );

      fs.writeFileSync(screenshotPath, screenshot.toPNG());

      // Send via Pushover with image attachment
      return new Promise((resolve) => {
        pushover.send({
          title: '📸 Screenshot',
          message: 'User sent a screenshot of their screen',
          sound: 'pushover',
          file: screenshotPath
        }, (err) => {
          // Clean up temp file
          try { fs.unlinkSync(screenshotPath); } catch(e) {}

          if (err) {
            resolve({ success: false, error: 'Could not send screenshot' });
          } else {
            resolve({ success: true, message: `Screenshot sent to ${SUPPORT_CONTACT_NAME}!` });
          }
        });
      });
    }

    return { success: false, error: 'No screen found' };
  } catch (error) {
    console.error('Screenshot to support error:', error);
    // Ensure window is shown even on error
    if (mainWindow) {
      mainWindow.show();
    }
    return { success: false, error: error.message };
  }
});

// ============================================================
// NEW: LAUNCH APP
// ============================================================
ipcMain.handle('launch-app', async (event, appName) => {
  const appCommands = {
    'chrome': 'start chrome',
    'edge': 'start msedge',
    'firefox': 'start firefox',
    'spotify': 'start spotify:',
    'netflix': 'start https://netflix.com',
    'youtube': 'start https://youtube.com',
    'tiktok': 'start https://tiktok.com',
    'instagram': 'start https://instagram.com',
    'twitter': 'start https://twitter.com',
    'reddit': 'start https://reddit.com',
    'notepad': 'start notepad',
    'calculator': 'start calc',
    'photos': 'start ms-photos:',
    'files': 'start explorer',
    'settings': 'start ms-settings:',
    'paint': 'start mspaint',
    'wordpad': 'start wordpad',
    'snip': 'start snippingtool',
    'terminal': 'start wt',
    'vscode': 'start code'
  };

  const cmd = appCommands[appName];
  if (!cmd) {
    return { success: false, error: 'Unknown app' };
  }

  return new Promise((resolve) => {
    exec(cmd, { shell: 'cmd.exe' }, (error) => {
      resolve({ success: !error });
    });
  });
});

// ============================================================
// DESKTOP ORGANIZER - Scan and organize desktop icons
// ============================================================
ipcMain.handle('get-desktop-items', async () => {
  const os = require('os');
  const desktopPath = path.join(os.homedir(), 'Desktop');

  // Category definitions with detection patterns
  const categories = {
    folders: { name: 'Folders', icon: '📁', items: [], order: 1 },
    games: { name: 'Games', icon: '🎮', items: [], order: 2 },
    productivity: { name: 'Productivity', icon: '💼', items: [], order: 3 },
    media: { name: 'Media', icon: '🎨', items: [], order: 4 },
    utilities: { name: 'Utilities', icon: '🔧', items: [], order: 5 },
    documents: { name: 'Documents', icon: '📄', items: [], order: 6 }
  };

  // Patterns for categorization
  const gamePatterns = ['steam', 'epic', 'riot', 'battle.net', 'origin', 'ubisoft', 'game', 'minecraft', 'fortnite', 'roblox', 'valorant', 'league', 'xbox'];
  const productivityPatterns = ['chrome', 'firefox', 'edge', 'word', 'excel', 'powerpoint', 'outlook', 'teams', 'slack', 'zoom', 'discord', 'notion', 'code', 'visual studio', 'office'];
  const mediaPatterns = ['spotify', 'vlc', 'photoshop', 'premiere', 'audacity', 'obs', 'paint', 'gimp', 'photos', 'music', 'video', 'camera'];
  const utilityPatterns = ['settings', 'control panel', 'cmd', 'powershell', 'notepad', 'calculator', '7-zip', 'winrar', 'antivirus', 'driver', 'update', 'cleaner'];

  try {
    if (!fs.existsSync(desktopPath)) {
      return { categories: [], totalItems: 0 };
    }

    const items = fs.readdirSync(desktopPath, { withFileTypes: true });

    for (const item of items) {
      // Skip hidden files and system files
      if (item.name.startsWith('.') || item.name === 'desktop.ini') continue;

      const nameLower = item.name.toLowerCase();
      const isShortcut = nameLower.endsWith('.lnk') || nameLower.endsWith('.url');
      const displayName = item.name.replace(/\.(lnk|url)$/i, '');

      let icon = '📄';
      let category = 'documents';

      if (item.isDirectory()) {
        category = 'folders';
        icon = '📁';
      } else if (isShortcut || nameLower.endsWith('.exe')) {
        // Determine category based on name
        if (gamePatterns.some(p => nameLower.includes(p))) {
          category = 'games';
          icon = '🎮';
        } else if (productivityPatterns.some(p => nameLower.includes(p))) {
          category = 'productivity';
          icon = '💼';
        } else if (mediaPatterns.some(p => nameLower.includes(p))) {
          category = 'media';
          icon = '🎨';
        } else if (utilityPatterns.some(p => nameLower.includes(p))) {
          category = 'utilities';
          icon = '🔧';
        } else {
          // Default shortcuts to productivity
          category = 'productivity';
          icon = '🚀';
        }
      } else {
        // Regular files - categorize by extension
        const ext = path.extname(nameLower);
        if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
          category = 'media';
          icon = '🖼️';
        } else if (['.mp3', '.wav', '.flac', '.m4a'].includes(ext)) {
          category = 'media';
          icon = '🎵';
        } else if (['.mp4', '.mkv', '.avi', '.mov'].includes(ext)) {
          category = 'media';
          icon = '🎬';
        } else if (['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx'].includes(ext)) {
          category = 'documents';
          icon = '📝';
        }
      }

      categories[category].items.push({
        name: displayName,
        fullName: item.name,
        icon: icon,
        isFolder: item.isDirectory()
      });
    }

    // Convert to array and sort by order
    const result = Object.values(categories)
      .filter(c => c.items.length > 0)
      .sort((a, b) => a.order - b.order);

    const totalItems = result.reduce((sum, c) => sum + c.items.length, 0);

    return { categories: result, totalItems };

  } catch (error) {
    console.error('Error scanning desktop:', error);
    return { categories: [], totalItems: 0 };
  }
});

// Move files (not shortcuts) from desktop to appropriate folders
ipcMain.handle('cleanup-desktop-files', async () => {
  try {
    const os = require('os');
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const documentsPath = path.join(os.homedir(), 'Documents');
    const picturesPath = path.join(os.homedir(), 'Pictures');
    const videosPath = path.join(os.homedir(), 'Videos');
    const musicPath = path.join(os.homedir(), 'Music');
    const downloadsPath = path.join(os.homedir(), 'Downloads');

    const items = fs.readdirSync(desktopPath, { withFileTypes: true });
    let movedCount = 0;
    const moved = { documents: 0, images: 0, videos: 0, music: 0, other: 0 };

    for (const item of items) {
      // Skip shortcuts, folders, hidden files, and system files
      if (item.isDirectory()) continue;
      if (item.name.startsWith('.') || item.name === 'desktop.ini') continue;

      const nameLower = item.name.toLowerCase();
      // Skip shortcuts - keep them on desktop
      if (nameLower.endsWith('.lnk') || nameLower.endsWith('.url')) continue;

      const ext = path.extname(nameLower);
      const sourcePath = path.join(desktopPath, item.name);
      let destFolder = null;
      let category = 'other';

      // Determine destination based on file type
      if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.heic', '.raw', '.tiff'].includes(ext)) {
        destFolder = picturesPath;
        category = 'images';
      } else if (['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
        destFolder = videosPath;
        category = 'videos';
      } else if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(ext)) {
        destFolder = musicPath;
        category = 'music';
      } else if (['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'].includes(ext)) {
        destFolder = documentsPath;
        category = 'documents';
      } else if (['.exe', '.msi', '.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
        destFolder = downloadsPath;
        category = 'other';
      } else {
        // Other files go to Documents
        destFolder = documentsPath;
        category = 'documents';
      }

      if (destFolder && fs.existsSync(destFolder)) {
        try {
          let destPath = path.join(destFolder, item.name);

          // Handle duplicates
          let counter = 1;
          while (fs.existsSync(destPath)) {
            const name = path.parse(item.name).name;
            const ext = path.parse(item.name).ext;
            destPath = path.join(destFolder, `${name} (${counter})${ext}`);
            counter++;
          }

          fs.renameSync(sourcePath, destPath);
          movedCount++;
          moved[category]++;
        } catch (e) {
          console.error('Error moving file:', e);
        }
      }
    }

    if (movedCount === 0) {
      return { success: true, message: 'Desktop is clean! No files to move (shortcuts stay on desktop).' };
    }

    const summary = [];
    if (moved.documents) summary.push(`${moved.documents} documents`);
    if (moved.images) summary.push(`${moved.images} images`);
    if (moved.videos) summary.push(`${moved.videos} videos`);
    if (moved.music) summary.push(`${moved.music} music files`);
    if (moved.other) summary.push(`${moved.other} other files`);

    return {
      success: true,
      message: `Moved ${movedCount} files: ${summary.join(', ')}. Shortcuts kept on desktop.`
    };

  } catch (error) {
    console.error('Error cleaning desktop:', error);
    return { success: false, message: 'Could not clean desktop: ' + error.message };
  }
});

// ============================================================
// NEW: ENHANCED CLEANUP FUNCTIONS
// ============================================================

// Helper to safely delete files/folders
function safeDelete(filePath, stats) {
  try {
    if (stats.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return stats.size;
  } catch (e) {
    return 0;
  }
}

// Clean temp files
ipcMain.handle('cleanup-temp', async () => {
  const tempPaths = [
    process.env.TEMP,
    path.join(process.env.LOCALAPPDATA || '', 'Temp'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Temp')
  ].filter(Boolean);

  let cleaned = 0;
  let freed = 0;

  for (const tempPath of tempPaths) {
    try {
      if (!fs.existsSync(tempPath)) continue;
      const files = fs.readdirSync(tempPath);
      for (const file of files) {
        try {
          const fullPath = path.join(tempPath, file);
          const stats = fs.statSync(fullPath);
          // Only delete files older than 1 hour
          if (Date.now() - stats.mtimeMs > 3600000) {
            freed += safeDelete(fullPath, stats);
            cleaned++;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  return {
    success: true,
    message: `Cleaned ${cleaned} temp items, freed ${(freed/1024/1024).toFixed(1)} MB`
  };
});

// Clean browser cache (Chrome, Edge, Firefox)
ipcMain.handle('cleanup-browser', async () => {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';

  const cachePaths = [
    // Chrome
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
    // Edge
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache'),
    // Firefox (cache2)
    path.join(localAppData, 'Mozilla', 'Firefox', 'Profiles')
  ];

  let cleaned = 0;
  let freed = 0;

  for (const cachePath of cachePaths) {
    try {
      if (!fs.existsSync(cachePath)) continue;

      // For Firefox, find profile folders
      if (cachePath.includes('Firefox')) {
        const profiles = fs.readdirSync(cachePath);
        for (const profile of profiles) {
          const cache2 = path.join(cachePath, profile, 'cache2');
          if (fs.existsSync(cache2)) {
            const stats = fs.statSync(cache2);
            freed += safeDelete(cache2, stats);
            cleaned++;
          }
        }
      } else {
        const files = fs.readdirSync(cachePath);
        for (const file of files) {
          try {
            const fullPath = path.join(cachePath, file);
            const stats = fs.statSync(fullPath);
            freed += safeDelete(fullPath, stats);
            cleaned++;
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  return {
    success: true,
    message: `Cleared browser cache: ${cleaned} items, freed ${(freed/1024/1024).toFixed(1)} MB`
  };
});

// Empty recycle bin
ipcMain.handle('cleanup-recycle-bin', async () => {
  return new Promise((resolve) => {
    // Use PowerShell to empty recycle bin
    exec('powershell -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"', { shell: 'cmd.exe' }, (error) => {
      if (error) {
        resolve({ success: false, message: 'Could not empty Recycle Bin' });
      } else {
        resolve({ success: true, message: 'Recycle Bin emptied!' });
      }
    });
  });
});

// Clean old downloads (files older than 30 days)
ipcMain.handle('cleanup-old-downloads', async () => {
  const downloadsPath = path.join(require('os').homedir(), 'Downloads');
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

  let cleaned = 0;
  let freed = 0;

  try {
    const files = fs.readdirSync(downloadsPath);
    for (const file of files) {
      try {
        const fullPath = path.join(downloadsPath, file);
        const stats = fs.statSync(fullPath);

        // Only delete files (not folders) older than 30 days
        if (stats.isFile() && stats.mtimeMs < thirtyDaysAgo) {
          freed += stats.size;
          fs.unlinkSync(fullPath);
          cleaned++;
        }
      } catch (e) {}
    }
  } catch (e) {}

  return {
    success: true,
    message: cleaned > 0
      ? `Removed ${cleaned} old downloads, freed ${(freed/1024/1024).toFixed(1)} MB`
      : 'No downloads older than 30 days found'
  };
});

// ============================================================
// NEW: FOLDER ORGANIZER
// ============================================================
ipcMain.handle('organize-folder', async (event, folderType) => {
  const os = require('os');
  const homedir = os.homedir();

  // Determine which folder to organize
  const folderPaths = {
    downloads: path.join(homedir, 'Downloads'),
    desktop: path.join(homedir, 'Desktop'),
    documents: path.join(homedir, 'Documents'),
    pictures: path.join(homedir, 'Pictures')
  };

  const targetFolder = folderPaths[folderType];
  if (!targetFolder || !fs.existsSync(targetFolder)) {
    return { success: false, message: 'Folder not found' };
  }

  // File type categories
  const categories = {
    'Images': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.heic', '.raw'],
    'Documents': ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv'],
    'Videos': ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
    'Audio': ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    'Archives': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
    'Programs': ['.exe', '.msi', '.dmg', '.app'],
    'Code': ['.js', '.py', '.html', '.css', '.java', '.cpp', '.c', '.ts', '.json', '.xml', '.md']
  };

  let organized = 0;
  const moved = {};

  try {
    const files = fs.readdirSync(targetFolder);

    for (const file of files) {
      const fullPath = path.join(targetFolder, file);

      try {
        const stats = fs.statSync(fullPath);

        // Skip directories and hidden files
        if (stats.isDirectory() || file.startsWith('.')) continue;

        // Get file extension
        const ext = path.extname(file).toLowerCase();
        if (!ext) continue;

        // Find category for this file type
        let category = null;
        for (const [cat, extensions] of Object.entries(categories)) {
          if (extensions.includes(ext)) {
            category = cat;
            break;
          }
        }

        if (!category) continue; // Skip unknown file types

        // Create category folder if needed
        const categoryFolder = path.join(targetFolder, category);
        if (!fs.existsSync(categoryFolder)) {
          fs.mkdirSync(categoryFolder);
        }

        // Move file to category folder
        const newPath = path.join(categoryFolder, file);

        // Handle duplicates
        let finalPath = newPath;
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          const name = path.parse(file).name;
          const ext = path.parse(file).ext;
          finalPath = path.join(categoryFolder, `${name} (${counter})${ext}`);
          counter++;
        }

        fs.renameSync(fullPath, finalPath);
        organized++;
        moved[category] = (moved[category] || 0) + 1;

      } catch (e) {}
    }
  } catch (e) {
    return { success: false, message: 'Error reading folder' };
  }

  if (organized === 0) {
    return { success: true, message: 'Folder is already organized!' };
  }

  // Build summary
  const summary = Object.entries(moved)
    .map(([cat, count]) => `${count} ${cat.toLowerCase()}`)
    .join(', ');

  return {
    success: true,
    message: `Organized ${organized} files: ${summary}`
  };
});

// ============================================================
// AI PROVIDER LOGIN & SESSION MANAGEMENT
// ============================================================

// Load sessions on startup
loadAISessions();

// Open browser window for user to login to AI provider
ipcMain.handle('login-to-ai', async (event, provider) => {
  const loginUrl = PROVIDER_URLS[provider];
  const successUrl = PROVIDER_SUCCESS_URLS[provider];

  if (!loginUrl) {
    return { success: false, error: 'Unknown provider' };
  }

  return new Promise((resolve) => {
    // Create a browser window for login
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 700,
      parent: mainWindow,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: `persist:${provider}` // Separate session per provider
      }
    });

    loginWindow.setMenuBarVisibility(false);

    // Load the login page
    loginWindow.loadURL(loginUrl);

    // Check if login was successful by monitoring URL changes
    loginWindow.webContents.on('did-navigate', async (e, url) => {
      // Check if we've reached the success URL (logged in)
      if (url.startsWith(successUrl) && !url.includes('login') && !url.includes('signin') && !url.includes('auth')) {
        // Give a moment for cookies to be set
        setTimeout(async () => {
          try {
            // Get session cookies
            const cookies = await loginWindow.webContents.session.cookies.get({ url: successUrl });

            if (cookies && cookies.length > 0) {
              // Store the session
              aiSessions.sessions[provider] = {
                cookies: cookies.map(c => ({
                  name: c.name,
                  value: c.value,
                  domain: c.domain,
                  path: c.path,
                  secure: c.secure,
                  httpOnly: c.httpOnly,
                  expirationDate: c.expirationDate
                })),
                loggedInAt: Date.now()
              };

              // Set as active if no active provider
              if (!aiSessions.active) {
                aiSessions.active = provider;
              }

              saveAISessions();
              loginWindow.close();
              resolve({ success: true });
            }
          } catch (err) {
            console.error('Error getting cookies:', err);
          }
        }, 1500);
      }
    });

    // Also check on page finish loading
    loginWindow.webContents.on('did-finish-load', async () => {
      const url = loginWindow.webContents.getURL();

      // For some providers, check if we're on the main app page
      if (url.startsWith(successUrl) && !url.includes('login') && !url.includes('signin') && !url.includes('auth')) {
        setTimeout(async () => {
          try {
            const cookies = await loginWindow.webContents.session.cookies.get({ url: successUrl });

            if (cookies && cookies.length > 0) {
              aiSessions.sessions[provider] = {
                cookies: cookies.map(c => ({
                  name: c.name,
                  value: c.value,
                  domain: c.domain,
                  path: c.path,
                  secure: c.secure,
                  httpOnly: c.httpOnly,
                  expirationDate: c.expirationDate
                })),
                loggedInAt: Date.now()
              };

              if (!aiSessions.active) {
                aiSessions.active = provider;
              }

              saveAISessions();
              loginWindow.close();
              resolve({ success: true });
            }
          } catch (err) {
            console.error('Error getting cookies:', err);
          }
        }, 1500);
      }
    });

    // Handle window close without login
    loginWindow.on('closed', () => {
      resolve({ success: false, error: 'Login cancelled' });
    });
  });
});

// Get current provider status
ipcMain.handle('get-ai-provider-status', async () => {
  loadAISessions();
  return {
    sessions: Object.keys(aiSessions.sessions).reduce((acc, key) => {
      acc[key] = !!aiSessions.sessions[key];
      return acc;
    }, {}),
    active: aiSessions.active
  };
});

// Set active provider
ipcMain.handle('set-active-ai-provider', async (event, provider) => {
  if (aiSessions.sessions[provider]) {
    aiSessions.active = provider;
    saveAISessions();
    return { success: true };
  }
  return { success: false, error: 'Provider not logged in' };
});

// Disconnect from provider (clear session)
ipcMain.handle('disconnect-ai-provider', async () => {
  const activeProvider = aiSessions.active;

  if (activeProvider) {
    // Clear cookies for this provider's session
    try {
      const { session } = require('electron');
      const ses = session.fromPartition(`persist:${activeProvider}`);
      await ses.clearStorageData();
    } catch (e) {
      console.error('Error clearing session:', e);
    }

    delete aiSessions.sessions[activeProvider];

    // Set next available provider as active, or null
    const remaining = Object.keys(aiSessions.sessions);
    aiSessions.active = remaining.length > 0 ? remaining[0] : null;

    saveAISessions();
  }

  return { success: true };
});

// ============================================================
// TROUBLESHOOTING FLOWS - Guided wizard for common issues
// ============================================================

// Get available troubleshooting flows
ipcMain.handle('get-troubleshooting-flows', () => {
  return getAvailableFlows();
});

// Run a troubleshooting flow
ipcMain.handle('run-troubleshooting-flow', async (event, flowId) => {
  try {
    auditLogger.log('troubleshooting', 'flow_started', { flowId });
    const result = await runTroubleshootingFlow(flowId);
    auditLogger.log('troubleshooting', 'flow_completed', {
      flowId,
      stepsCompleted: result.steps?.length || 0,
      issuesFound: result.issues?.length || 0
    });
    return { success: true, result };
  } catch (error) {
    console.error('Troubleshooting flow error:', error);
    return { success: false, error: error.message };
  }
});

// Get result of a specific step
ipcMain.handle('get-troubleshooting-result', async (event, { flowId, stepId }) => {
  try {
    const flow = getFlow(flowId);
    if (!flow) {
      return { success: false, error: 'Flow not found' };
    }
    const step = flow.steps.find(s => s.id === stepId);
    if (!step) {
      return { success: false, error: 'Step not found' };
    }
    const result = await executeStep(step);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================
// ANALYTICS & BEHAVIOR TRACKING IPC HANDLERS
// ============================================================

// Track page visits
ipcMain.handle('track-page-visit', (event, { page, previousPage }) => {
  recordPageVisit(page, previousPage);
  return { success: true };
});

// Track feature interactions
ipcMain.handle('track-interaction', (event, { feature, action, data }) => {
  recordInteraction(feature, action, data);
  return { success: true };
});

// Track micro-behaviors (mouse, scroll, etc.)
ipcMain.handle('track-micro-behavior', (event, data) => {
  recordMicroBehavior(data);
  return { success: true };
});

// Get analytics summary
ipcMain.handle('get-analytics-summary', () => {
  if (!userAnalytics) return null;

  analyzePatterns();

  return {
    sessionCount: userAnalytics.sessions.length,
    pageMetrics: userAnalytics.pageMetrics,
    featureUsage: userAnalytics.featureUsage,
    patterns: userAnalytics.patterns,
    predictions: userAnalytics.predictions,
    microBehaviors: userAnalytics.microBehaviors,
    fractalPatterns: userAnalytics.fractalPatterns
  };
});

// Get predictions for next action
ipcMain.handle('get-predictions', () => {
  analyzePatterns();
  return userAnalytics?.predictions || null;
});

// Export analytics data (for future use)
ipcMain.handle('export-analytics', () => {
  return userAnalytics;
});

// Get AI insight for current context - EVENT DRIVEN
ipcMain.handle('get-ai-insight', async (event, context) => {
  // Skip if no API key
  if (!anthropicClient) {
    return { show: false, reason: 'no_api_key' };
  }

  try {
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize()
    ]);

    const cpuUsage = Math.round(cpu.currentLoad);
    const memUsage = Math.round(mem.used/mem.total*100);
    const diskUsage = Math.max(...disk.map(d => Math.round(d.use)));

    // If there's no trigger and system is fine, don't bother the user
    if (!context.trigger && cpuUsage < 70 && memUsage < 80 && diskUsage < 85) {
      return { show: false, reason: 'system_healthy' };
    }

    // Build trigger description
    let triggerDesc = '';
    if (context.trigger) {
      const t = context.trigger;
      if (t.type === 'high_cpu') triggerDesc = `CPU is critically high at ${t.value}%!`;
      if (t.type === 'high_memory') triggerDesc = `Memory is nearly full at ${t.value}%!`;
      if (t.type === 'low_disk') triggerDesc = `Disk space critically low at ${t.value}% used!`;
      if (t.type === 'many_tabs') triggerDesc = `User has ${t.value} browser tabs open.`;
    }

    const systemPrompt = `You are Max, a helpful PC assistant. You've detected a REAL issue that needs attention.

DETECTED ISSUE: ${triggerDesc || 'General system check'}

CURRENT STATE:
- CPU: ${cpuUsage}% ${cpuUsage > 80 ? '⚠️ HIGH' : '✓'}
- RAM: ${memUsage}% ${memUsage > 85 ? '⚠️ HIGH' : '✓'}
- Disk: ${diskUsage}% ${diskUsage > 85 ? '⚠️ LOW SPACE' : '✓'}

RULES - BE CONSERVATIVE:
1. Only return show:true if there's a REAL problem to fix
2. Don't suggest things just to be helpful - only when there's an actual issue
3. The action MUST actually solve the detected problem
4. Be specific about what you'll do and why

Generate JSON:
{
  "show": true/false,
  "title": "Short problem summary (3-5 words)",
  "preview": "What you'll do to help",
  "fullMessage": "Friendly explanation of the issue and solution",
  "actionable": true,
  "action": { "type": "action-type" }
}

Actions available:
- "close-heavy-apps" - Close memory-hungry apps to free RAM (USE THIS for high memory)
- "cleanup-temp" - Delete temp files to free disk space
- "cleanup-browser" - Clear browser cache
- "open-storage" - Show storage details

CRITICAL: Return {"show": false} if:
- System is running fine (CPU < 70%, RAM < 80%, Disk < 85%)
- There's no clear problem to solve
- You can't actually help with the issue

Don't be annoying. Only interrupt if you can genuinely help.`;

    const response = await anthropicClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate insight.' }]
    });

    const text = response.content[0]?.text || '{}';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const insight = JSON.parse(jsonMatch[0]);
      insight.id = generateUniqueId('insight');
      return insight;
    }

    return { show: false };
  } catch (error) {
    console.error('AI insight error:', error);
    return { show: false, error: error.message };
  }
});

// Dismiss insight (for cooldown tracking)
ipcMain.handle('dismiss-insight', (event, insightId) => {
  // Could store dismissed insights for analysis
  return { success: true };
});

// Execute a suggested action
ipcMain.handle('execute-suggestion', async (event, action) => {
  try {
    console.log('Executing suggestion:', action);

    if (!action || !action.type) {
      return { success: false, error: 'No action specified' };
    }

    // Route to appropriate handler based on action type
    switch (action.type) {
      case 'cleanup-temp':
        const tempResult = await cleanupTemp();
        mainWindow?.webContents.send('show-toast', { message: `Cleaned ${tempResult.filesDeleted || 0} temp files`, type: 'success' });
        return tempResult;

      case 'cleanup-browser':
        const browserResult = await cleanupBrowser();
        mainWindow?.webContents.send('show-toast', { message: 'Browser cache cleared', type: 'success' });
        return browserResult;

      case 'cleanup-recycle':
        await exec('PowerShell.exe -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"');
        mainWindow?.webContents.send('show-toast', { message: 'Recycle bin emptied', type: 'success' });
        return { success: true };

      case 'navigate':
        // Navigate to a page (XSS prevention: allowlist valid pages)
        const validPages = ['home', 'cleanup', 'ai-chat', 'settings', 'games', 'notes', 'processes'];
        if (action.page && validPages.includes(action.page.toLowerCase())) {
          mainWindow?.webContents.executeJavaScript(`showPage('${action.page.toLowerCase()}')`);
        }
        return { success: true };

      case 'open-app':
        // Open an application
        if (action.app) {
          const appCommands = {
            'chrome': 'start chrome',
            'edge': 'start msedge',
            'firefox': 'start firefox',
            'notepad': 'notepad',
            'calculator': 'calc',
            'explorer': 'explorer',
            'settings': 'start ms-settings:',
            'taskmanager': 'taskmgr'
          };
          const cmd = appCommands[action.app.toLowerCase()];
          if (cmd) {
            exec(cmd);
            mainWindow?.webContents.send('show-toast', { message: `Opening ${action.app}`, type: 'success' });
          }
        }
        return { success: true };

      case 'speed-test':
        mainWindow?.webContents.executeJavaScript(`
          (async () => {
            showPage('wifi');
            setTimeout(() => document.querySelector('.speed-test-btn')?.click(), 500);
          })()
        `);
        return { success: true };

      case 'open-storage':
        mainWindow?.webContents.executeJavaScript(`showPage('storage')`);
        return { success: true };

      case 'check-apps':
        mainWindow?.webContents.executeJavaScript(`showPage('apps')`);
        return { success: true };

      case 'close-heavy-apps':
        // Close high-memory apps using blacklist approach (protect system, close everything else)
        try {
          const processes = await si.processes();
          const sortedByMem = processes.list
            .filter(p => p.mem > 2) // More than 2% memory
            .sort((a, b) => b.mem - a.mem);

          // System-critical processes to NEVER close
          const neverClose = [
            'system', 'registry', 'smss', 'csrss', 'wininit', 'services', 'lsass', 'lsaiso',
            'svchost', 'dwm', 'explorer', 'taskhostw', 'sihost', 'ctfmon', 'conhost',
            'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost',
            'textinputhost', 'applicationframehost', 'systemsettings', 'securityhealthservice',
            'spoolsv', 'wudfhost', 'audiodg', 'fontdrvhost', 'winlogon', 'dllhost',
            'searchindexer', 'msiexec', 'trustedinstaller', 'tiworker', 'wermgr',
            'smartscreen', 'sgrmbroker', 'gamebarpresencewriter', 'gamebar', 'electron',
            'node', 'cmd', 'powershell', 'windowsterminal', 'openssh', 'nginx', 'httpd',
            'mysqld', 'postgres', 'mongod', 'redis', 'docker', 'wsl', 'vmware', 'virtualbox',
            'antimalware', 'msmpeng', 'nissrv', 'defender', 'security', 'backup',
            'onedrive', 'dropbox', 'googledrive', // sync services - risky to kill mid-sync
            'pc utility' // don't close ourselves!
          ];

          let closedCount = 0;
          let freedMem = 0;
          let closedApps = [];

          for (const proc of sortedByMem.slice(0, 15)) {
            const nameLower = proc.name.toLowerCase().replace('.exe', '');

            // Skip if it's a protected system process
            if (neverClose.some(critical => nameLower.includes(critical))) {
              continue;
            }

            // Skip our own app
            if (proc.pid === process.pid) continue;

            try {
              await execPromise(`taskkill /PID ${proc.pid} /F`);
              closedCount++;
              freedMem += proc.memRss || 0;
              closedApps.push(proc.name.replace('.exe', ''));
            } catch (e) {
              // Process might have already closed or access denied
            }
          }

          const freedMB = Math.round(freedMem / 1024 / 1024);
          let message;
          if (closedCount > 0) {
            message = `Closed ${closedApps.slice(0, 3).join(', ')}${closedCount > 3 ? ` +${closedCount - 3} more` : ''} - freed ~${freedMB}MB`;
          } else {
            message = 'Only system processes running - nothing safe to close';
          }

          return {
            success: true,
            closedCount,
            freedMemory: freedMB,
            closedApps,
            message
          };
        } catch (e) {
          return { success: false, error: e.message };
        }

      case 'organize-desktop':
        const desktopPath = path.join(os.homedir(), 'Desktop');
        await organizeFolder(desktopPath);
        mainWindow?.webContents.send('show-toast', { message: 'Desktop organized', type: 'success' });
        return { success: true };

      default:
        console.log('Unknown action type:', action.type);
        // Try to at least navigate to a relevant page based on action type
        const pageMap = {
          'storage': 'storage', 'cleanup': 'storage', 'disk': 'storage',
          'apps': 'apps', 'processes': 'apps', 'cpu': 'apps',
          'wifi': 'wifi', 'network': 'wifi', 'internet': 'wifi',
          'specs': 'specs', 'system': 'specs',
          'help': 'help', 'support': 'help'
        };
        for (const [key, page] of Object.entries(pageMap)) {
          if (action.type.toLowerCase().includes(key)) {
            mainWindow?.webContents.executeJavaScript(`showPage('${page}')`);
            return { success: true, navigated: page };
          }
        }
        return { success: false, error: 'Unknown action type' };
    }
  } catch (error) {
    console.error('Execute suggestion error:', error);
    return { success: false, error: error.message };
  }
});
