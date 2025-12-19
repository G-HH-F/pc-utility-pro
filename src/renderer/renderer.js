// PC Utility Pro - Renderer

// ============================================================
// UNIQUE ID GENERATOR (Browser-compatible)
// ============================================================
const uniqueIdState = { counter: 0, lastTimestamp: 0 };

function generateUniqueId(prefix = 'id') {
  const timestamp = Date.now();
  if (timestamp !== uniqueIdState.lastTimestamp) {
    uniqueIdState.counter = 0;
    uniqueIdState.lastTimestamp = timestamp;
  } else {
    uniqueIdState.counter++;
  }
  const random = Math.random().toString(36).substring(2, 6);
  return prefix + '-' + timestamp + '-' + uniqueIdState.counter + '-' + random;
}

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize consent modal FIRST so button is clickable immediately
  initConsentModal();

  // Check if first run - show consent modal
  await checkFirstRun();

  initWindowControls();
  initNavigation();
  initHome();
  initChat();
  initHelp();
  initLauncher();
  initNotes();
  initWifi();
  initSpecs();
  initDesktopOrganizer();
  initSettings();
  initBackgroundEffects();
  initScreenshot();
  initToastSystem();
  initTrayEventHandlers();

  // Only initialize behavior tracking if consent was given
  const consent = await window.pcUtility.getConsentStatus();
  if (consent.analyticsConsent) {
    microBehaviorTracker.init();
  }
  aiInsightManager.init();
});

// ============================================================
// FIRST RUN & CONSENT
// ============================================================
async function checkFirstRun() {
  try {
    const status = await window.pcUtility.getConsentStatus();
    if (!status.firstRunComplete) {
      showConsentModal();
    }
  } catch (e) {
    console.error('Error checking first run status:', e);
  }
}

function showConsentModal() {
  const modal = document.getElementById('consent-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function hideConsentModal() {
  const modal = document.getElementById('consent-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function initConsentModal() {
  const acceptBtn = document.getElementById('consent-accept');
  const consentCheckbox = document.getElementById('analytics-consent');

  console.log('[Consent] Init modal, button found:', !!acceptBtn);

  if (acceptBtn) {
    acceptBtn.addEventListener('click', async (e) => {
      console.log('[Consent] Button clicked');
      e.preventDefault();
      e.stopPropagation();

      const analyticsEnabled = consentCheckbox?.checked ?? true;

      try {
        // Save consent choice
        await window.pcUtility.setAnalyticsConsent(analyticsEnabled);
        await window.pcUtility.completeFirstRun();

        // Hide modal
        hideConsentModal();

        // Initialize analytics if consent was given
        if (analyticsEnabled && typeof microBehaviorTracker !== 'undefined') {
          microBehaviorTracker.init();
        }

        showToast('Welcome to PC Utility Pro!', 'success');
      } catch (e) {
        console.error('[Consent] Error saving consent:', e);
        // Hide modal anyway
        hideConsentModal();
      }
    });
  } else {
    console.error('[Consent] Button not found in DOM!');
  }
}

// ============================================================
// SYSTEM TRAY EVENT HANDLERS
// ============================================================
function initTrayEventHandlers() {
  // Handle tray actions (from system tray context menu)
  window.pcUtility.onTrayAction(async (action) => {
    console.log('Tray action received:', action);

    switch (action) {
      case 'check-health':
        // Navigate to home and refresh health
        navigateToPage('home');
        showToast('Checking PC health...', 'info');
        break;

      case 'cleanup-temp':
        showToast('Cleaning temp files...', 'info');
        try {
          const result = await window.pcUtility.cleanupTemp();
          if (result.success) {
            showToast(result.message || 'Temp files cleaned!', 'success');
          } else {
            showToast(result.error || 'Cleanup failed', 'error');
          }
        } catch (e) {
          showToast('Cleanup failed', 'error');
        }
        break;

      case 'cleanup-browser':
        showToast('Clearing browser cache...', 'info');
        try {
          const result = await window.pcUtility.cleanupBrowser();
          if (result.success) {
            showToast(result.message || 'Browser cache cleared!', 'success');
          } else {
            showToast(result.error || 'Cleanup failed', 'error');
          }
        } catch (e) {
          showToast('Cleanup failed', 'error');
        }
        break;

      case 'cleanup-recycle':
        showToast('Emptying Recycle Bin...', 'info');
        try {
          const result = await window.pcUtility.cleanupRecycleBin();
          if (result.success) {
            showToast(result.message || 'Recycle Bin emptied!', 'success');
          } else {
            showToast(result.error || 'Cleanup failed', 'error');
          }
        } catch (e) {
          showToast('Cleanup failed', 'error');
        }
        break;

      case 'cleanup-all':
        showToast('Running full cleanup...', 'info');
        try {
          await window.pcUtility.cleanupTemp();
          await window.pcUtility.cleanupBrowser();
          await window.pcUtility.cleanupRecycleBin();
          showToast('Full cleanup complete!', 'success');
        } catch (e) {
          showToast('Some cleanup tasks failed', 'error');
        }
        break;

      default:
        console.log('Unknown tray action:', action);
    }
  });

  // Handle navigation requests (from tray or main process)
  window.pcUtility.onNavigate((page) => {
    console.log('Navigate to:', page);
    navigateToPage(page);
  });
}

// Navigate to a specific page
function navigateToPage(pageName) {
  const pages = document.querySelectorAll('.page');
  const navItems = document.querySelectorAll('.nav-item');

  pages.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById(`page-${pageName}`);
  const targetNav = document.querySelector(`[data-page="${pageName}"]`);

  if (targetPage) {
    targetPage.classList.add('active');
  }
  if (targetNav) {
    targetNav.classList.add('active');
  }
}

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================
function initToastSystem() {
  // Create toast container if it doesn't exist
  if (!document.getElementById('toast-container')) {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  // Listen for toast events from main process
  window.pcUtility.onToast((data) => {
    showToast(data.message, data.type || 'success');
  });
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    background: ${type === 'success' ? 'rgba(16, 185, 129, 0.95)' : type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(102, 126, 234, 0.95)'};
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s ease;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  toast.innerHTML = `<span style="font-size: 16px;">${icon}</span> ${message}`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  // Animate out after 3 seconds
  setTimeout(() => {
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// MICRO-BEHAVIOR TRACKING (Mouse, Scroll, Focus)
// ============================================================
const microBehaviorTracker = {
  mouseHistory: [],
  scrollHistory: [],
  hoverStart: null,
  lastMouseMove: 0,
  clickTimestamps: [],

  init() {
    // Track mouse position (throttled to every 100ms)
    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - this.lastMouseMove < 100) return;
      this.lastMouseMove = now;

      this.mouseHistory.push({
        x: e.clientX,
        y: e.clientY,
        timestamp: now,
        element: e.target.tagName
      });

      // Keep last 5 minutes (3000 entries at 100ms intervals)
      if (this.mouseHistory.length > 3000) {
        this.mouseHistory.shift();
      }
    });

    // Track hovers on interactive elements
    document.addEventListener('mouseenter', (e) => {
      if (e.target.matches('button, .nav-item, .insight-card, a, .action-btn, .cleanup-action')) {
        this.hoverStart = { element: e.target, time: Date.now() };
      }
    }, true);

    document.addEventListener('mouseleave', (e) => {
      if (this.hoverStart && e.target === this.hoverStart.element) {
        const duration = Date.now() - this.hoverStart.time;
        window.pcUtility.trackMicroBehavior({
          type: 'hover_duration',
          element: e.target.className || e.target.tagName,
          duration: duration,
          clicked: false
        });
        this.hoverStart = null;
      }
    }, true);

    // Track clicks with timing
    document.addEventListener('click', (e) => {
      const now = Date.now();

      // If we were hovering, record the hover->click duration
      if (this.hoverStart && e.target === this.hoverStart.element) {
        const hoverDuration = now - this.hoverStart.time;
        window.pcUtility.trackMicroBehavior({
          type: 'hover_duration',
          element: e.target.className || e.target.tagName,
          duration: hoverDuration,
          clicked: true
        });
        this.hoverStart = null;
      }

      // Track click patterns (for stress detection)
      this.clickTimestamps.push(now);
      if (this.clickTimestamps.length > 20) {
        this.clickTimestamps.shift();
      }

      // Detect rapid clicking (possible frustration)
      if (this.clickTimestamps.length >= 5) {
        const recentClicks = this.clickTimestamps.slice(-5);
        const interval = (recentClicks[4] - recentClicks[0]) / 4;
        if (interval < 300) { // 5 clicks in less than 1.2 seconds
          window.pcUtility.trackMicroBehavior({
            type: 'rapid_clicks',
            interval: interval,
            element: e.target.className || e.target.tagName
          });
        }
      }
    }, true);

    // Track scroll behavior
    let scrollTimeout;
    let lastScrollY = window.scrollY;
    let scrollStartTime = null;

    window.addEventListener('scroll', () => {
      const now = Date.now();
      const currentY = window.scrollY;

      if (!scrollStartTime) {
        scrollStartTime = now;
      }

      this.scrollHistory.push({
        position: currentY,
        timestamp: now
      });

      // Keep last 500 scroll events
      if (this.scrollHistory.length > 500) {
        this.scrollHistory.shift();
      }

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        // Scroll ended - calculate speed
        const duration = now - scrollStartTime;
        const distance = Math.abs(currentY - lastScrollY);
        const speed = distance / (duration / 1000); // px/sec

        window.pcUtility.trackMicroBehavior({
          type: 'scroll_speed',
          speed: speed,
          distance: distance,
          duration: duration
        });

        lastScrollY = currentY;
        scrollStartTime = null;
      }, 150);
    }, { passive: true });

    // Calculate and report focus score periodically
    setInterval(() => {
      const score = this.calculateFocusScore();
      if (score !== null) {
        window.pcUtility.trackMicroBehavior({
          type: 'focus_score',
          score: score
        });
      }
    }, 30000); // Every 30 seconds
  },

  calculateFocusScore() {
    // Analyze last 30 seconds of mouse movement
    const now = Date.now();
    const recent = this.mouseHistory.filter(m => now - m.timestamp < 30000);

    if (recent.length < 10) return null;

    // Calculate path smoothness (focused = smooth, distracted = erratic)
    let totalDistance = 0;
    let directionChanges = 0;

    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i - 1].x;
      const dy = recent[i].y - recent[i - 1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);

      if (i > 1) {
        const prevDx = recent[i - 1].x - recent[i - 2].x;
        const prevDy = recent[i - 1].y - recent[i - 2].y;
        // Direction change detection
        if ((dx * prevDx < 0) || (dy * prevDy < 0)) {
          directionChanges++;
        }
      }
    }

    // Higher score = more focused (fewer direction changes per distance)
    if (totalDistance === 0) return 50;
    const rawScore = 100 - (directionChanges / totalDistance * 500);
    return Math.max(0, Math.min(100, rawScore));
  }
};

// ============================================================
// AI INSIGHT MANAGER - Event-Driven & Smart
// ============================================================
const aiInsightManager = {
  currentInsight: null,
  currentPage: 'home',
  lastInsightTime: 0,
  shownInsights: new Set(), // Track what we've shown to avoid repetition
  sessionInsightCount: 0,
  maxInsightsPerSession: 5, // Don't overwhelm

  // Minimum time between ANY insights (5 minutes)
  globalCooldown: 5 * 60 * 1000,

  init() {
    // Don't auto-trigger on load - wait for something interesting
    // Start monitoring for real events
    this.startEventMonitoring();
  },

  startEventMonitoring() {
    // Monitor for actual interesting events, not just page changes
    setInterval(() => this.checkSystemEvents(), 30000); // Every 30 seconds
  },

  async checkSystemEvents() {
    // Don't show if we've hit session limit or in cooldown
    if (this.sessionInsightCount >= this.maxInsightsPerSession) return;
    if (Date.now() - this.lastInsightTime < this.globalCooldown) return;

    try {
      // Get actual system state to see if anything is noteworthy
      const mood = await window.pcUtility.getPcMood();

      // Only trigger insights for REAL issues, not routine stuff
      const triggers = [];

      if (mood.cpuUsage > 85) triggers.push({ type: 'high_cpu', value: mood.cpuUsage });
      if (mood.memoryUsage > 90) triggers.push({ type: 'high_memory', value: mood.memoryUsage });
      if (mood.diskUsage > 90) triggers.push({ type: 'low_disk', value: mood.diskUsage });
      if (mood.browserTabs > 15) triggers.push({ type: 'many_tabs', value: mood.browserTabs });

      // If there's a real trigger, maybe show an insight (50% chance to feel less predictable)
      if (triggers.length > 0 && Math.random() > 0.5) {
        const trigger = triggers[0]; // Most important
        const insightKey = `${trigger.type}_${Math.floor(trigger.value / 10) * 10}`;

        // Don't repeat the same insight this session
        if (this.shownInsights.has(insightKey)) return;

        await this.fetchAndShowInsight(this.currentPage, trigger);
        this.shownInsights.add(insightKey);
      }
    } catch (e) {
      // Silent fail - not critical
    }
  },

  // Called when user navigates - but DON'T always show insight
  onPageChange(page) {
    this.currentPage = page;

    // Only occasionally check on page change (20% chance, and only if no recent insight)
    const timeSinceLastInsight = Date.now() - this.lastInsightTime;
    const shouldCheck = Math.random() < 0.2 && timeSinceLastInsight > this.globalCooldown;

    if (shouldCheck && this.sessionInsightCount < this.maxInsightsPerSession) {
      // Delay randomly between 3-10 seconds so it feels natural
      const delay = 3000 + Math.random() * 7000;
      setTimeout(() => this.fetchAndShowInsight(page, null), delay);
    }
  },

  async fetchAndShowInsight(page, trigger) {
    // Double-check cooldown
    if (Date.now() - this.lastInsightTime < this.globalCooldown) return;

    try {
      const insight = await window.pcUtility.getAIInsight({
        page: page,
        trigger: trigger,
        timestamp: Date.now()
      });

      // Only show if AI thinks it's genuinely worth showing
      if (insight && insight.show && insight.actionable) {
        this.showInsight(page, insight);
        this.lastInsightTime = Date.now();
        this.sessionInsightCount++;
      }
    } catch (e) {
      console.error('Error getting AI insight:', e);
    }
  },

  showInsight(page, insight) {
    const indicator = document.getElementById('ai-insight-indicator');
    if (!indicator) return;

    this.currentInsight = insight;
    this.currentPage = page;

    // Update indicator content
    const titleEl = indicator.querySelector('.ai-insight-title');
    const previewEl = indicator.querySelector('.ai-insight-preview-text');
    const messageEl = indicator.querySelector('.ai-message');

    if (titleEl) titleEl.textContent = insight.title || 'AI Insight';
    if (previewEl) previewEl.textContent = insight.preview || '';
    if (messageEl) messageEl.textContent = insight.fullMessage || '';

    // Show/hide action buttons based on suggestion type
    const actionsDiv = indicator.querySelector('.ai-suggestion-actions');
    if (actionsDiv) {
      actionsDiv.style.display = insight.actionable ? 'flex' : 'none';
    }

    // Show the indicator
    indicator.classList.add('visible');

    // Auto-hide after 30 seconds if not interacted
    setTimeout(() => {
      if (!indicator.classList.contains('expanded')) {
        indicator.classList.remove('visible');
      }
    }, 30000);
  },

  expandInsight() {
    const indicator = document.getElementById('ai-insight-indicator');
    if (indicator) {
      indicator.classList.add('expanded');
      const expanded = indicator.querySelector('.ai-insight-expanded');
      if (expanded) expanded.style.display = 'block';
    }
  },

  async confirmSuggestion() {
    if (this.currentInsight?.action) {
      try {
        const result = await window.pcUtility.executeSuggestion(this.currentInsight.action);

        // Show meaningful feedback based on action type
        const actionType = this.currentInsight.action.type;
        const title = this.currentInsight.title || 'Action';

        let feedbackMessage = '';
        if (result.success !== false) {
          switch (actionType) {
            case 'cleanup-temp':
              feedbackMessage = `Cleaned ${result.filesDeleted || 'temp'} files`;
              break;
            case 'cleanup-browser':
              feedbackMessage = 'Browser cache cleared';
              break;
            case 'cleanup-recycle':
              feedbackMessage = 'Recycle bin emptied';
              break;
            case 'navigate':
              feedbackMessage = `Navigated to ${this.currentInsight.action.page || 'page'}`;
              break;
            case 'open-app':
              feedbackMessage = `Opening ${this.currentInsight.action.app || 'application'}`;
              break;
            case 'speed-test':
              feedbackMessage = 'Starting speed test...';
              break;
            case 'organize-desktop':
              feedbackMessage = 'Desktop organized!';
              break;
            case 'open-storage':
              feedbackMessage = 'Opening storage page';
              break;
            case 'check-apps':
              feedbackMessage = 'Checking running apps';
              break;
            case 'close-heavy-apps':
              feedbackMessage = result.message || (result.closedCount > 0
                ? `Closed ${result.closedCount} apps, freed ~${result.freedMemory || 0}MB`
                : 'No apps available to close');
              break;
            default:
              feedbackMessage = result.navigated ? `Opened ${result.navigated}` : `${title} completed`;
          }
          showToast(feedbackMessage, 'success');
          showSuccessAnimation();
        } else {
          showToast(result.error || 'Action failed', 'error');
        }
      } catch (e) {
        console.error('Error executing suggestion:', e);
        showToast('Failed to execute action', 'error');
      }
    } else {
      showToast('No action available', 'info');
    }
    this.dismissInsight();
  },

  dismissInsight() {
    const indicator = document.getElementById('ai-insight-indicator');
    if (indicator) {
      indicator.classList.remove('visible', 'expanded');
      const expanded = indicator.querySelector('.ai-insight-expanded');
      if (expanded) expanded.style.display = 'none';
    }

    this.cooldowns[this.currentPage] = Date.now();

    if (this.currentInsight) {
      window.pcUtility.dismissInsight(this.currentInsight.id);
      this.currentInsight = null;
    }
  },

  onPageChange(page) {
    this.currentPage = page;
    // Check for insights after a short delay when page changes
    setTimeout(() => this.checkForInsight(page), 2000);
  }
};

// Track current page for analytics
let currentPageName = 'home';

// ============================================================
// BACKGROUND EFFECTS
// ============================================================
function initBackgroundEffects() {
  const container = document.getElementById('sparkles');
  const colors = ['#54a0ff', '#5f27cd', '#00d2d3', '#667eea'];

  // Create subtle background particles
  for (let i = 0; i < 15; i++) {
    createParticle(container, colors);
  }

  // Create new particles periodically
  setInterval(() => {
    createParticle(container, colors);
  }, 1000);
}

function createParticle(container, colors) {
  const particle = document.createElement('div');
  particle.className = 'sparkle';
  particle.style.left = Math.random() * 100 + '%';
  particle.style.top = Math.random() * 100 + '%';
  particle.style.background = colors[Math.floor(Math.random() * colors.length)];
  particle.style.animationDelay = Math.random() * 4 + 's';
  particle.style.animationDuration = (3 + Math.random() * 2) + 's';
  particle.style.opacity = '0.3';

  container.appendChild(particle);

  // Remove after animation
  setTimeout(() => particle.remove(), 6000);
}

// Success animation for completed actions
function showSuccessAnimation() {
  const colors = ['#10b981', '#00d2d3', '#54a0ff', '#667eea'];

  for (let i = 0; i < 15; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti';
    particle.style.left = (50 + (Math.random() - 0.5) * 30) + '%';
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDelay = (Math.random() * 0.5) + 's';
    particle.style.borderRadius = '50%';

    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 3500);
  }
}

// ============================================================
// WINDOW CONTROLS
// ============================================================
function initWindowControls() {
  document.getElementById('btn-min')?.addEventListener('click', () => window.pcUtility.minimize());
  document.getElementById('btn-max')?.addEventListener('click', () => window.pcUtility.maximize());
  document.getElementById('btn-close')?.addEventListener('click', () => window.pcUtility.close());
}

// ============================================================
// NAVIGATION
// ============================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageName = item.dataset.page;
      const previousPage = currentPageName;

      // Track page visit
      window.pcUtility.trackPageVisit(pageName, previousPage);
      currentPageName = pageName;

      // Notify AI insight manager of page change
      aiInsightManager.onPageChange(pageName);

      // Update nav
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Update pages
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById(`page-${pageName}`).classList.add('active');

      // Load page content
      if (pageName === 'storage') {
        loadStorage();
        loadDesktopItems();
      }
      if (pageName === 'specs') {
        loadSpecs();
        // Load first tab content by default
      }
      if (pageName === 'notes') loadNotes();
    });
  });

  // Quick action buttons
  document.getElementById('ask-ai-btn')?.addEventListener('click', () => {
    document.querySelector('[data-page="chat"]').click();
  });

  document.getElementById('contact-support-btn')?.addEventListener('click', () => {
    document.querySelector('[data-page="help"]').click();
  });
}

// ============================================================
// HOME PAGE - PC Mood & Status
// ============================================================
let refreshInterval;

function initHome() {
  refreshPcMood();
  loadSessionRecap();
  refreshHomeWidgets();
  // Refresh every 10 seconds
  refreshInterval = setInterval(() => {
    refreshPcMood();
    refreshHomeWidgets();
  }, 10000);
}

// ============================================================
// HOME WIDGETS
// ============================================================
async function refreshHomeWidgets() {
  // Storage widget
  try {
    const storage = await window.pcUtility.getStorageInfo();
    if (storage && storage.drives && storage.drives.length > 0) {
      const mainDrive = storage.drives[0];
      const usedPercent = mainDrive.percent || 0;
      const freeGB = mainDrive.freeGB || '0';

      document.getElementById('home-storage-fill').style.width = `${usedPercent}%`;
      document.getElementById('home-storage-text').textContent = `${freeGB} GB free (${Math.round(usedPercent)}% used)`;
    }
  } catch (e) {
    console.error('Storage widget error:', e);
    document.getElementById('home-storage-text').textContent = 'Could not load';
  }

  // Network widget
  try {
    const network = await window.pcUtility.getNetworkInfo();
    const statusEl = document.getElementById('home-network-status');
    const iconEl = document.getElementById('home-network-icon');

    if (network && network.connected) {
      statusEl.textContent = network.ssid || 'Connected';
      iconEl.textContent = '📶';
    } else {
      statusEl.textContent = 'Not connected';
      iconEl.textContent = '📵';
    }
  } catch (e) {
    document.getElementById('home-network-status').textContent = 'Connected';
  }

  // Top apps widget
  try {
    const result = await window.pcUtility.getRunningApps();
    const container = document.getElementById('home-top-apps');

    // Result is { apps, summary }, not an array
    if (result && result.apps && result.apps.length > 0) {
      const topApps = result.apps.slice(0, 3);
      container.innerHTML = topApps.map(app => `
        <div class="top-app-item">
          <span class="app-name">${app.name}</span>
          <span class="app-usage">${app.cpu ? app.cpu + '% CPU' : ''}</span>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<span class="loading-mini">No apps running</span>';
    }
  } catch (e) {
    console.error('Apps widget error:', e);
    document.getElementById('home-top-apps').innerHTML = '<span class="loading-mini">Could not load</span>';
  }
}

// Home widget button handlers
document.getElementById('home-cleanup-btn')?.addEventListener('click', () => {
  document.querySelector('[data-page="storage"]').click();
});

document.getElementById('home-speedtest-btn')?.addEventListener('click', () => {
  document.querySelector('[data-page="specs"]').click();
  setTimeout(() => {
    document.querySelector('[data-tab="network"]')?.click();
    document.getElementById('speed-test-btn')?.click();
  }, 100);
});

document.getElementById('home-apps-btn')?.addEventListener('click', () => {
  document.querySelector('[data-page="specs"]').click();
  setTimeout(() => {
    document.querySelector('[data-tab="apps"]')?.click();
  }, 100);
});

async function loadSessionRecap() {
  try {
    const recap = await window.pcUtility.getSessionRecap();

    const section = document.getElementById('recap-section');
    const timeEl = document.getElementById('recap-time');
    const changesEl = document.getElementById('recap-changes');

    if (!section || !recap) return;

    // Don't show if first time or just opened
    if (recap.lastSeen === 'First time here!' || recap.lastSeen === 'Just now') {
      section.style.display = 'none';
      return;
    }

    timeEl.textContent = recap.lastSeen;

    changesEl.innerHTML = recap.changes.map(change => `
      <div class="recap-change ${change.type}">
        <span class="change-icon">${change.icon}</span>
        <span>${change.text}</span>
      </div>
    `).join('');

    section.style.display = 'block';

    // Auto-hide after 30 seconds
    setTimeout(() => {
      section.style.opacity = '0';
      section.style.transform = 'translateY(-10px)';
      setTimeout(() => section.style.display = 'none', 300);
    }, 30000);

  } catch (e) {
    console.error('Error loading recap:', e);
  }
}

async function refreshPcMood() {
  try {
    const mood = await window.pcUtility.getPcMood();

    // Update greeting and username
    document.getElementById('greeting').textContent = mood.greeting + ',';
    document.getElementById('username').textContent = mood.username || 'there';

    // Update avatar mood
    const avatar = document.getElementById('pc-avatar');
    avatar.className = 'pc-avatar ' + mood.mood;

    // Update mouth
    const mouth = avatar.querySelector('.avatar-mouth');
    mouth.className = 'avatar-mouth ' + mood.mood;

    // Update mood message
    document.getElementById('mood-message').textContent = mood.moodMessage;

    // Update health ring
    const healthScore = mood.healthScore;
    const healthRing = document.getElementById('health-ring-fill');
    const circumference = 326.73;
    const offset = circumference - (healthScore / 100) * circumference;
    healthRing.style.strokeDashoffset = offset;

    // Rainbow color based on score
    if (healthScore >= 80) healthRing.style.stroke = '#00d2d3';
    else if (healthScore >= 60) healthRing.style.stroke = '#ff9ff3';
    else if (healthScore >= 40) healthRing.style.stroke = '#feca57';
    else healthRing.style.stroke = '#ff6b6b';

    document.getElementById('health-score').textContent = healthScore;

    // Update stats
    document.getElementById('stat-cpu').textContent = mood.stats.cpu + '%';
    document.getElementById('stat-memory').textContent = mood.stats.memory + '%';
    document.getElementById('stat-uptime').textContent = mood.stats.uptime;

    // Update insights
    renderInsights(mood.insights);

  } catch (error) {
    console.error('Error refreshing PC mood:', error);
  }
}

function renderInsights(insights) {
  const container = document.getElementById('insights-list');
  container.innerHTML = '';

  insights.forEach(insight => {
    const card = document.createElement('div');
    card.className = `insight-card ${insight.type} glow-hover`;

    let html = `
      <span class="insight-icon">${insight.icon}</span>
      <div class="insight-text">
        <span class="insight-title">${insight.title}</span>
        <span class="insight-detail">${insight.detail}</span>
      </div>
    `;

    if (insight.action) {
      html += `<button class="insight-action" data-action="${insight.action}" data-data="${insight.actionData || ''}">${insight.actionLabel}</button>`;
    }

    card.innerHTML = html;

    // Add action handler
    const actionBtn = card.querySelector('.insight-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', async () => {
        const action = actionBtn.dataset.action;
        const data = actionBtn.dataset.data;

        actionBtn.textContent = 'Working...';
        actionBtn.disabled = true;

        const result = await window.pcUtility.quickFix({ action, data });

        if (result.success) {
          actionBtn.textContent = '✓ Done';
          setTimeout(refreshPcMood, 1000);
        } else {
          actionBtn.textContent = 'Failed';
        }
      });
    }

    container.appendChild(card);
  });
}

// ============================================================
// QUICK LAUNCHER - Customizable
// ============================================================

// All available apps that can be added to Quick Launch
const allAvailableApps = {
  chrome: { icon: '🌐', label: 'Chrome' },
  edge: { icon: '🌐', label: 'Edge' },
  firefox: { icon: '🦊', label: 'Firefox' },
  spotify: { icon: '🎵', label: 'Spotify' },
  netflix: { icon: '🎬', label: 'Netflix' },
  youtube: { icon: '📺', label: 'YouTube' },
  tiktok: { icon: '📱', label: 'TikTok' },
  instagram: { icon: '📸', label: 'Instagram' },
  twitter: { icon: '🐦', label: 'Twitter/X' },
  reddit: { icon: '🤖', label: 'Reddit' },
  notepad: { icon: '📝', label: 'Notepad' },
  calculator: { icon: '🔢', label: 'Calculator' },
  photos: { icon: '🖼️', label: 'Photos' },
  files: { icon: '📁', label: 'Files' },
  settings: { icon: '⚙️', label: 'Settings' },
  paint: { icon: '🎨', label: 'Paint' },
  wordpad: { icon: '📄', label: 'WordPad' },
  snip: { icon: '✂️', label: 'Snipping Tool' },
  terminal: { icon: '💻', label: 'Terminal' },
  vscode: { icon: '📘', label: 'VS Code' }
};

// Default apps (excluding Discord, Steam, Xbox)
const defaultLauncherApps = ['chrome', 'spotify', 'netflix', 'youtube', 'notepad', 'calculator', 'photos', 'files'];

let launcherApps = [];
let isEditMode = false;

function initLauncher() {
  // Load saved apps or use defaults
  const saved = localStorage.getItem('pc-utility-launcher-apps');
  if (saved) {
    try {
      launcherApps = JSON.parse(saved);
    } catch (e) {
      launcherApps = [...defaultLauncherApps];
    }
  } else {
    launcherApps = [...defaultLauncherApps];
  }

  renderLauncher();

  // Edit button
  document.getElementById('edit-launcher-btn')?.addEventListener('click', toggleEditMode);

  // Modal close
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('launcher-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'launcher-modal') closeModal();
  });
}

function saveLauncherApps() {
  localStorage.setItem('pc-utility-launcher-apps', JSON.stringify(launcherApps));
}

function renderLauncher() {
  const grid = document.getElementById('launcher-grid');
  grid.innerHTML = '';

  launcherApps.forEach(appKey => {
    const app = allAvailableApps[appKey];
    if (!app) return;

    const item = document.createElement('div');
    item.className = 'launcher-item glow-hover';
    item.dataset.app = appKey;
    item.innerHTML = `
      <span class="icon">${app.icon}</span>
      <span class="label">${app.label}</span>
      ${isEditMode ? '<button class="remove-app-btn">&times;</button>' : ''}
    `;

    if (isEditMode) {
      item.querySelector('.remove-app-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeApp(appKey);
      });
    } else {
      item.addEventListener('click', () => {
        launchApp(appKey);
        item.style.transform = 'scale(0.95)';
        setTimeout(() => { item.style.transform = ''; }, 150);
      });
    }

    grid.appendChild(item);
  });

  // Add "+" button in edit mode
  if (isEditMode) {
    const addBtn = document.createElement('div');
    addBtn.className = 'launcher-item add-app-btn glow-hover';
    addBtn.innerHTML = `
      <span class="icon">➕</span>
      <span class="label">Add App</span>
    `;
    addBtn.addEventListener('click', openAddAppModal);
    grid.appendChild(addBtn);
  }
}

function toggleEditMode() {
  isEditMode = !isEditMode;
  const btn = document.getElementById('edit-launcher-btn');
  btn.textContent = isEditMode ? 'Done' : 'Edit';
  btn.classList.toggle('active', isEditMode);
  renderLauncher();
}

function removeApp(appKey) {
  launcherApps = launcherApps.filter(a => a !== appKey);
  saveLauncherApps();
  renderLauncher();
}

function openAddAppModal() {
  const modal = document.getElementById('launcher-modal');
  const container = document.getElementById('available-apps');

  // Get apps not already in launcher
  const availableKeys = Object.keys(allAvailableApps).filter(k => !launcherApps.includes(k));

  if (availableKeys.length === 0) {
    container.innerHTML = '<p class="no-apps">All apps already added!</p>';
  } else {
    container.innerHTML = '';
    availableKeys.forEach(appKey => {
      const app = allAvailableApps[appKey];
      const item = document.createElement('div');
      item.className = 'available-app-item glow-hover';
      item.innerHTML = `
        <span class="icon">${app.icon}</span>
        <span class="label">${app.label}</span>
      `;
      item.addEventListener('click', () => {
        addApp(appKey);
        closeModal();
      });
      container.appendChild(item);
    });
  }

  modal.style.display = 'flex';
}

function closeModal() {
  document.getElementById('launcher-modal').style.display = 'none';
}

function addApp(appKey) {
  if (!launcherApps.includes(appKey)) {
    launcherApps.push(appKey);
    saveLauncherApps();
    renderLauncher();
  }
}

async function launchApp(appName) {
  try {
    await window.pcUtility.launchApp(appName);
    // Little sparkle burst when app launches
    for (let i = 0; i < 5; i++) {
      const container = document.getElementById('sparkles');
      const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff'];
      createSparkle(container, colors);
    }
  } catch (error) {
    console.error('Error launching app:', error);
  }
}

// ============================================================
// WIFI/INTERNET PAGE 📶
// ============================================================
function initWifi() {
  document.getElementById('speed-test-btn')?.addEventListener('click', runSpeedTest);
}

async function loadWifi() {
  try {
    const wifiInfo = await window.pcUtility.getWifiInfo();

    document.getElementById('wifi-name').textContent = wifiInfo.ssid || 'No WiFi connected';
    document.getElementById('wifi-detail').textContent = wifiInfo.connected ?
      `Signal: ${wifiInfo.signal}% | ${wifiInfo.type}` :
      'Not connected to any network';

    const statusEl = document.getElementById('wifi-status');
    statusEl.textContent = wifiInfo.connected ? 'Connected' : 'Disconnected';
    statusEl.className = `wifi-status ${wifiInfo.connected ? 'connected' : 'disconnected'}`;

    document.getElementById('wifi-icon').textContent = wifiInfo.connected ? '📶' : '📵';

  } catch (error) {
    console.error('Error loading WiFi info:', error);
  }
}

// Speed Test Progress Listener Setup
let speedTestProgressListener = null;

function setupSpeedTestProgressListener() {
  if (!speedTestProgressListener) {
    speedTestProgressListener = window.pcUtility.onSpeedTestProgress((data) => {
      const progressBar = document.getElementById('speed-progress-bar');
      const progressMessage = document.getElementById('speed-progress-message');

      // Use percent for overall progress (0-100 across all phases)
      const percent = data.percent !== undefined ? data.percent : data.progress;
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressMessage) progressMessage.textContent = data.message;

      // Update live speed display if available
      if (data.currentSpeed !== undefined) {
        const phase = data.phase;
        if (phase === 'download') {
          const el = document.getElementById('download-speed');
          if (el) el.textContent = data.currentSpeed.toFixed(1);
        } else if (phase === 'upload') {
          const el = document.getElementById('upload-speed');
          if (el) el.textContent = data.currentSpeed.toFixed(1);
        }
      }
    });
  }
}

function getGradeClass(grade) {
  if (!grade) return '';
  if (grade === 'A+' || grade === 'A') return 'grade-excellent';
  if (grade === 'B') return 'grade-good';
  if (grade === 'C') return 'grade-fair';
  return 'grade-poor';
}

function getSuitabilityClass(suitable) {
  if (suitable === true) return 'suitable';
  if (suitable === false) return 'unsuitable';
  return 'marginal';
}

function getSuitabilityText(suitable) {
  if (suitable === true) return '✓ Great';
  if (suitable === false) return '✗ Poor';
  return '~ OK';
}

async function runSpeedTest() {
  const btn = document.getElementById('speed-test-btn');
  const progressContainer = document.getElementById('speed-test-progress');
  const progressBar = document.getElementById('speed-progress-bar');
  const suitabilitySection = document.getElementById('speed-suitability');
  const analysisSection = document.getElementById('speed-analysis');
  const overallScore = document.getElementById('speed-overall-score');

  // Safety check - elements must exist
  if (!btn || !progressContainer) {
    console.error('Speed test UI elements not found');
    return;
  }

  // Setup progress listener
  setupSpeedTestProgressListener();

  // Reset UI
  btn.innerHTML = '<span>⏳</span> Testing...';
  btn.disabled = true;
  progressContainer.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (suitabilitySection) suitabilitySection.style.display = 'none';
  if (analysisSection) analysisSection.style.display = 'none';

  // Reset all metrics to show animation
  const metrics = ['download', 'upload', 'ping', 'jitter', 'bufferbloat', 'packet-loss'];
  metrics.forEach(m => {
    const el = document.getElementById(`${m}-speed`) || document.getElementById(m);
    if (el) el.textContent = '--';
    const gradeEl = document.getElementById(`${m.replace('-', '')}-grade`);
    if (gradeEl) {
      gradeEl.textContent = '--';
      gradeEl.className = 'metric-grade';
    }
  });

  if (overallScore) {
    const scoreValue = overallScore.querySelector('.score-value');
    if (scoreValue) scoreValue.textContent = '--';
    overallScore.className = 'overall-score';
  }

  try {
    const result = await window.pcUtility.runSpeedTest();

    // Hide progress, show results
    progressContainer.style.display = 'none';

    if (result.success) {
      // Update main metrics
      document.getElementById('download-speed').textContent = result.download?.toFixed(1) || '--';
      document.getElementById('upload-speed').textContent = result.upload?.toFixed(1) || '--';
      document.getElementById('ping-speed').textContent = result.ping?.toFixed(0) || '--';
      document.getElementById('jitter-speed').textContent = result.jitter?.toFixed(1) || '--';
      document.getElementById('bufferbloat-speed').textContent = result.bufferbloat?.toFixed(0) || '--';
      document.getElementById('packet-loss').textContent = result.packetLoss?.toFixed(1) || '0';

      // Update grades
      if (result.grades) {
        const gradeMap = {
          'download': 'download-grade',
          'upload': 'upload-grade',
          'ping': 'ping-grade',
          'jitter': 'jitter-grade',
          'bufferbloat': 'bufferbloat-grade',
          'packetLoss': 'packetloss-grade'
        };

        for (const [key, elementId] of Object.entries(gradeMap)) {
          const gradeEl = document.getElementById(elementId);
          if (gradeEl && result.grades[key]) {
            // Grade is an object with { grade, color, label }
            const gradeData = result.grades[key];
            const gradeStr = typeof gradeData === 'object' ? gradeData.grade : gradeData;
            gradeEl.textContent = gradeStr;
            gradeEl.className = `metric-grade ${getGradeClass(gradeStr)}`;
          }
        }
      }

      // Update overall score
      if (result.overallScore !== undefined && overallScore) {
        const scoreValue = overallScore.querySelector('.score-value');
        if (scoreValue) scoreValue.textContent = result.overallScore;
        if (result.overallScore >= 90) overallScore.className = 'overall-score excellent';
        else if (result.overallScore >= 70) overallScore.className = 'overall-score good';
        else if (result.overallScore >= 50) overallScore.className = 'overall-score fair';
        else overallScore.className = 'overall-score poor';
      }

      // Update suitability indicators
      if (result.suitability && suitabilitySection) {
        suitabilitySection.style.display = 'block';

        const suitMap = {
          'gaming': 'suit-gaming',
          'streaming4k': 'suit-streaming',
          'videoCalls': 'suit-videocalls',
          'workFromHome': 'suit-wfh'
        };

        for (const [key, elementId] of Object.entries(suitMap)) {
          const el = document.getElementById(elementId);
          if (el && result.suitability[key] !== undefined) {
            const statusEl = el.querySelector('.suit-status');
            if (statusEl) {
              statusEl.textContent = getSuitabilityText(result.suitability[key]);
              el.className = `suitability-item ${getSuitabilityClass(result.suitability[key])}`;
            }
          }
        }
      }

      // Update analysis (always show - issues, recommendations, or all-clear)
      if (analysisSection) {
        analysisSection.style.display = 'block';

        const issuesEl = document.getElementById('analysis-issues');
        const recsEl = document.getElementById('analysis-recommendations');

        if (issuesEl) {
          if (result.issues && result.issues.length > 0) {
            issuesEl.innerHTML = `
              <h4>⚠️ Issues Detected</h4>
              <ul>${result.issues.map(i => `<li>${i}</li>`).join('')}</ul>
            `;
            issuesEl.style.display = 'block';
          } else {
            issuesEl.innerHTML = `
              <h4>✅ Connection Health</h4>
              <p style="color: #00d2d3;">No issues detected! Your connection looks healthy.</p>
            `;
            issuesEl.style.display = 'block';
          }
        }

        if (recsEl) {
          if (result.recommendations && result.recommendations.length > 0) {
            recsEl.innerHTML = `
              <h4>💡 Recommendations</h4>
              <ul>${result.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
            `;
          } else {
            recsEl.innerHTML = '';
          }
          recsEl.style.display = 'block';
        }

        // Add AI analysis button
        showAiAnalysisOption(result);
      }

      // Save to history
      saveSpeedTestResult(result);

    } else {
      // Test failed - safely update elements
      const failMetrics = ['download-speed', 'upload-speed', 'ping-speed', 'jitter-speed', 'bufferbloat-speed', 'packet-loss'];
      failMetrics.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
      });

      if (analysisSection) {
        analysisSection.style.display = 'block';
        const issuesEl = document.getElementById('analysis-issues');
        const recsEl = document.getElementById('analysis-recommendations');
        if (issuesEl) {
          issuesEl.innerHTML = `
            <h4>⚠️ Test Failed</h4>
            <p>${result.error || 'Could not complete speed test. Please check your internet connection.'}</p>
          `;
          issuesEl.style.display = 'block';
        }
        if (recsEl) recsEl.style.display = 'none';
      }
    }

  } catch (error) {
    if (progressContainer) progressContainer.style.display = 'none';
    console.error('Speed test error:', error);

    const errorMetrics = ['download-speed', 'upload-speed', 'ping-speed', 'jitter-speed', 'bufferbloat-speed', 'packet-loss'];
    errorMetrics.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '--';
    });
  }

  btn.innerHTML = '<span>🚀</span> Run Speed Test';
  btn.disabled = false;
}

// Speed Test History Functions
const SPEED_HISTORY_KEY = 'pc-utility-speed-history';
const MAX_HISTORY_ITEMS = 10;

function saveSpeedTestResult(result) {
  if (!result || !result.success) return;

  const historyItem = {
    timestamp: result.timestamp || new Date().toISOString(),
    download: result.download,
    upload: result.upload,
    ping: result.ping,
    jitter: result.jitter,
    bufferbloat: result.bufferbloat,
    packetLoss: result.packetLoss,
    overallScore: result.overallScore,
    suitability: result.suitability
  };

  let history = [];
  try {
    const saved = localStorage.getItem(SPEED_HISTORY_KEY);
    if (saved) history = JSON.parse(saved);
  } catch (e) {
    console.error('Error loading speed test history:', e);
  }

  // Add new item at the beginning
  history.unshift(historyItem);

  // Keep only the last MAX_HISTORY_ITEMS
  if (history.length > MAX_HISTORY_ITEMS) {
    history = history.slice(0, MAX_HISTORY_ITEMS);
  }

  localStorage.setItem(SPEED_HISTORY_KEY, JSON.stringify(history));
  renderSpeedTestHistory();
}

function loadSpeedTestHistory() {
  renderSpeedTestHistory();

  // Setup clear history button
  const clearBtn = document.getElementById('clear-speed-history-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearSpeedTestHistory);
  }
}

function clearSpeedTestHistory() {
  localStorage.removeItem(SPEED_HISTORY_KEY);
  renderSpeedTestHistory();
}

// Store latest speed test result for AI analysis
let latestSpeedTestResult = null;

function showAiAnalysisOption(result) {
  latestSpeedTestResult = result;

  const analysisSection = document.getElementById('speed-analysis');
  if (!analysisSection) return;

  // Remove any existing AI button
  const existingBtn = analysisSection.querySelector('.ai-analyze-btn');
  if (existingBtn) existingBtn.remove();

  // Create AI analysis button
  const aiBtn = document.createElement('button');
  aiBtn.className = 'action-btn ai-analyze-btn';
  aiBtn.innerHTML = '<span>🤖</span> Ask AI for Detailed Analysis';
  aiBtn.onclick = triggerAiSpeedTestAnalysis;

  analysisSection.appendChild(aiBtn);
}

async function triggerAiSpeedTestAnalysis() {
  if (!latestSpeedTestResult) return;

  const result = latestSpeedTestResult;

  // Build a detailed prompt for the AI
  const suitabilityText = result.suitability ?
    `Gaming: ${result.suitability.gaming ? 'Good' : 'Poor'}, 4K Streaming: ${result.suitability.streaming4k ? 'Good' : 'Poor'}, Video Calls: ${result.suitability.videoCalls ? 'Good' : 'Poor'}, Work From Home: ${result.suitability.workFromHome ? 'Good' : 'Poor'}` :
    'Not available';

  const prompt = `I just ran a network speed test. Here are my results:

- Download: ${result.download?.toFixed(1) || '--'} Mbps (Grade: ${result.grades?.download?.grade || '--'})
- Upload: ${result.upload?.toFixed(1) || '--'} Mbps (Grade: ${result.grades?.upload?.grade || '--'})
- Ping: ${result.ping?.toFixed(0) || '--'} ms (Grade: ${result.grades?.ping?.grade || '--'})
- Jitter: ${result.jitter?.toFixed(1) || '--'} ms (Grade: ${result.grades?.jitter?.grade || '--'})
- Bufferbloat: ${result.bufferbloat?.toFixed(0) || '--'} ms (Grade: ${result.grades?.bufferbloat?.grade || '--'})
- Packet Loss: ${result.packetLoss?.toFixed(1) || '0'}% (Grade: ${result.grades?.packetLoss?.grade || '--'})
- Overall Score: ${result.overallScore || '--'}/100

Connection Suitability: ${suitabilityText}

${result.issues?.length > 0 ? 'Issues detected: ' + result.issues.join(', ') : 'No issues detected.'}

Please analyze these results and give me:
1. A summary of my connection quality in plain terms
2. What these numbers mean for my daily usage (gaming, streaming, video calls, etc.)
3. Any specific recommendations to improve my connection
4. If anything looks concerning, explain what might be causing it`;

  // Navigate to chat page and send the prompt
  const chatInput = document.getElementById('chat-input');
  const chatPage = document.getElementById('page-chat');

  // Switch to chat page
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelector('.nav-item[data-page="chat"]')?.classList.add('active');
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  if (chatPage) chatPage.classList.add('active');

  // Set the prompt and trigger send
  if (chatInput) {
    chatInput.value = prompt;
    // Trigger the send button click
    setTimeout(() => {
      document.getElementById('send-btn')?.click();
    }, 100);
  }
}

function renderSpeedTestHistory() {
  const historyList = document.getElementById('speed-history-list');
  if (!historyList) return;

  let history = [];
  try {
    const saved = localStorage.getItem(SPEED_HISTORY_KEY);
    if (saved) history = JSON.parse(saved);
  } catch (e) {
    console.error('Error loading speed test history:', e);
  }

  if (history.length === 0) {
    historyList.innerHTML = '<p class="history-empty">No previous tests. Run a speed test to start tracking.</p>';
    return;
  }

  historyList.innerHTML = history.map((item, index) => {
    const date = new Date(item.timestamp);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const scoreClass = item.overallScore >= 90 ? 'excellent' :
                       item.overallScore >= 70 ? 'good' :
                       item.overallScore >= 50 ? 'fair' : 'poor';

    return `
      <div class="history-item">
        <div class="history-date">${dateStr}<br><span style="opacity:0.7">${timeStr}</span></div>
        <div class="history-stat">
          <span class="history-stat-value">${item.download?.toFixed(0) || '--'}</span>
          <span class="history-stat-label">Down</span>
        </div>
        <div class="history-stat">
          <span class="history-stat-value">${item.upload?.toFixed(0) || '--'}</span>
          <span class="history-stat-label">Up</span>
        </div>
        <div class="history-stat">
          <span class="history-stat-value">${item.ping?.toFixed(0) || '--'}</span>
          <span class="history-stat-label">Ping</span>
        </div>
        <div class="history-score ${scoreClass}">${item.overallScore || '--'}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// PC SPECS PAGE 💻
// ============================================================
let currentSpecs = null;

function initSpecs() {
  // Will load when page is opened
}

async function loadSpecs() {
  try {
    const specs = await window.pcUtility.getSpecs();
    currentSpecs = specs; // Store for detail view

    // Fun summary based on specs
    let summary = "You've got a nice computer! ";
    if (specs.ram >= 16) summary += "Plenty of memory for multitasking. ";
    if (specs.gpu && specs.gpu.includes('RTX')) summary += "Great graphics for gaming! ";
    if (specs.storage >= 500) summary += "Lots of storage space. ";

    document.getElementById('specs-summary').textContent = summary;

    // CPU
    document.getElementById('spec-cpu').textContent = specs.cpuName || 'Unknown';
    document.getElementById('spec-cpu-detail').textContent = specs.cpuCores ? `${specs.cpuCores} cores, ${specs.cpuSpeed}` : '';

    // RAM
    const ramGB = specs.ram ? (specs.ram).toFixed(0) + ' GB' : 'Unknown';
    document.getElementById('spec-ram').textContent = ramGB;
    document.getElementById('spec-ram-detail').textContent = specs.ram >= 16 ? 'Great for multitasking!' : specs.ram >= 8 ? 'Good for everyday use' : 'Consider upgrading';

    // GPU
    document.getElementById('spec-gpu').textContent = specs.gpu || 'Unknown';
    document.getElementById('spec-gpu-detail').textContent = specs.gpu && specs.gpu.includes('RTX') ? 'Ready for gaming!' : '';

    // Storage
    const storageGB = specs.storage ? Math.round(specs.storage) + ' GB' : 'Unknown';
    document.getElementById('spec-storage').textContent = storageGB;
    document.getElementById('spec-storage-detail').textContent = specs.storageFree ? `${Math.round(specs.storageFree)} GB free` : '';

    // OS
    document.getElementById('spec-os').textContent = specs.os || 'Windows';
    document.getElementById('spec-os-detail').textContent = specs.osVersion || '';

    // Display
    document.getElementById('spec-display').textContent = specs.display || `${window.screen.width}x${window.screen.height}`;
    document.getElementById('spec-display-detail').textContent = specs.displayDetails || '';

  } catch (error) {
    console.error('Error loading specs:', error);
  }
}

function showSpecDetail(specType) {
  if (!currentSpecs) return;

  const panel = document.getElementById('spec-detail-panel');
  const icon = document.getElementById('detail-icon');
  const title = document.getElementById('detail-title');
  const content = document.getElementById('detail-content');

  // Generate smart CPU insights
  function getCpuInsights() {
    const cpu = currentSpecs.cpuName || '';
    const cores = currentSpecs.cpuCores || 0;
    const insights = [];

    // Detect CPU generation and type
    if (cpu.includes('i9') || cpu.includes('Ryzen 9')) {
      insights.push({ type: 'excellence', text: 'Flagship-tier processor. You have top-of-the-line computing power for any workload.' });
    } else if (cpu.includes('i7') || cpu.includes('Ryzen 7')) {
      insights.push({ type: 'good', text: 'High-performance processor. Excellent for gaming, streaming, video editing, and heavy multitasking.' });
    } else if (cpu.includes('i5') || cpu.includes('Ryzen 5')) {
      insights.push({ type: 'good', text: 'Mid-range workhorse. Handles gaming at high settings, productivity apps, and moderate content creation well.' });
    } else if (cpu.includes('i3') || cpu.includes('Ryzen 3')) {
      insights.push({ type: 'info', text: 'Entry-level processor. Great for everyday tasks, web browsing, office work, and light gaming.' });
    }

    // Intel generation detection
    const intelMatch = cpu.match(/i[3579]-(\d{2})(\d{2})/);
    if (intelMatch) {
      const gen = parseInt(intelMatch[1]);
      if (gen >= 12) insights.push({ type: 'info', text: `${gen}th Gen Intel with hybrid architecture (P-cores + E-cores) for optimized power efficiency.` });
      else if (gen >= 10) insights.push({ type: 'info', text: `${gen}th Gen Intel. Still capable but consider upgrading in 2-3 years for newer features.` });
      else if (gen < 10) insights.push({ type: 'warning', text: `${gen}th Gen Intel is aging. You may notice slowdowns with modern software and games.` });
    }

    // AMD generation detection
    if (cpu.includes('5000') || cpu.includes('5600') || cpu.includes('5800') || cpu.includes('5900')) {
      insights.push({ type: 'good', text: 'Ryzen 5000 series (Zen 3) - Excellent single-threaded performance, great for gaming.' });
    } else if (cpu.includes('7000') || cpu.includes('7600') || cpu.includes('7800') || cpu.includes('7900')) {
      insights.push({ type: 'excellence', text: 'Ryzen 7000 series (Zen 4) - Latest architecture with DDR5 support and top-tier efficiency.' });
    }

    // Core count context
    if (cores >= 16) insights.push({ type: 'info', text: `${cores} cores lets you run VMs, compile code, render video, and game simultaneously without breaking a sweat.` });
    else if (cores >= 8) insights.push({ type: 'info', text: `${cores} cores is the sweet spot for modern gaming and multitasking. Most games won't use more than 6-8.` });
    else if (cores >= 4) insights.push({ type: 'info', text: `${cores} cores handles most tasks but you may see stutters if gaming while running Discord, browser, and Spotify.` });

    return insights;
  }

  // Generate smart RAM insights
  function getRamInsights() {
    const ram = currentSpecs.ram || 0;
    const usage = currentSpecs.ramUsage || 0;
    const insights = [];

    // Capacity analysis
    if (ram >= 64) {
      insights.push({ type: 'excellence', text: '64GB+ is professional workstation territory. Perfect for 4K video editing, 3D rendering, large datasets, or running multiple VMs.' });
    } else if (ram >= 32) {
      insights.push({ type: 'good', text: '32GB is future-proof. You can keep dozens of browser tabs, run games, stream, and edit video without worrying about memory.' });
    } else if (ram >= 16) {
      insights.push({ type: 'good', text: '16GB is the current sweet spot. Comfortable for gaming and productivity, but heavy Chrome users may occasionally feel the pinch.' });
    } else if (ram >= 8) {
      insights.push({ type: 'warning', text: '8GB is the bare minimum in 2024. Windows itself uses 3-4GB. You\'ll hit the limit with a game + browser + Discord open.' });
    } else {
      insights.push({ type: 'critical', text: 'Under 8GB severely limits what you can do. Expect frequent slowdowns, freezes, and apps crashing. Upgrade strongly recommended.' });
    }

    // Current usage analysis
    if (usage > 90) {
      insights.push({ type: 'critical', text: `You're using ${usage.toFixed(0)}% of RAM right now. Your PC is likely swapping to disk, causing major slowdowns. Close some apps!` });
    } else if (usage > 75) {
      insights.push({ type: 'warning', text: `Currently at ${usage.toFixed(0)}% usage. You're getting close to the limit. Opening more apps may cause slowdowns.` });
    } else if (usage > 50) {
      insights.push({ type: 'info', text: `${usage.toFixed(0)}% usage is healthy. You have headroom for more applications or browser tabs.` });
    } else {
      insights.push({ type: 'good', text: `Only ${usage.toFixed(0)}% in use. Plenty of breathing room - your RAM is handling the current workload easily.` });
    }

    // Practical context
    const freeGb = currentSpecs.ramFree || 0;
    if (freeGb < 2) {
      insights.push({ type: 'warning', text: `Only ${freeGb.toFixed(1)}GB free. Close unused browser tabs (each can use 100-500MB) or restart memory-hungry apps.` });
    }

    return insights;
  }

  // Generate smart GPU insights
  function getGpuInsights() {
    const gpu = currentSpecs.gpu || '';
    const vram = currentSpecs.gpuVram || '';
    const insights = [];

    // NVIDIA RTX 40 series
    if (gpu.includes('4090')) {
      insights.push({ type: 'excellence', text: 'RTX 4090 is the fastest consumer GPU ever made. 4K gaming at max settings, AI workloads, professional 3D work - nothing will slow it down.' });
    } else if (gpu.includes('4080')) {
      insights.push({ type: 'excellence', text: 'RTX 4080 handles 4K gaming excellently. Ray tracing, DLSS 3 Frame Generation, and content creation are all smooth.' });
    } else if (gpu.includes('4070')) {
      insights.push({ type: 'good', text: 'RTX 4070 series is the 1440p sweet spot. Great ray tracing performance with DLSS 3 making demanding games playable.' });
    } else if (gpu.includes('4060')) {
      insights.push({ type: 'good', text: 'RTX 4060 is solid for 1080p gaming with ray tracing. DLSS 3 helps in demanding titles. Good value option.' });
    }
    // NVIDIA RTX 30 series
    else if (gpu.includes('3090') || gpu.includes('3080')) {
      insights.push({ type: 'good', text: 'RTX 30 series high-end. Still excellent for 4K gaming. DLSS 2 support keeps it competitive with newer games.' });
    } else if (gpu.includes('3070') || gpu.includes('3060')) {
      insights.push({ type: 'good', text: 'RTX 30 series mid-range. Great 1440p or 1080p performance. Ray tracing works but at lower settings than 40 series.' });
    }
    // NVIDIA GTX series
    else if (gpu.includes('GTX 16')) {
      insights.push({ type: 'info', text: 'GTX 16 series is capable but lacks ray tracing and DLSS. Good for 1080p esports titles and older games at high settings.' });
    } else if (gpu.includes('GTX 10')) {
      insights.push({ type: 'warning', text: 'GTX 10 series is showing its age. Modern games will need medium-low settings. Consider upgrading for newer titles.' });
    }
    // AMD Radeon
    else if (gpu.includes('7900')) {
      insights.push({ type: 'excellence', text: 'RX 7900 series competes with RTX 4080. Excellent rasterization, huge VRAM. FSR 3 helps in supported games.' });
    } else if (gpu.includes('7800') || gpu.includes('7700')) {
      insights.push({ type: 'good', text: 'RX 7000 mid-range offers great value. Strong 1440p performance with plenty of VRAM for modern games.' });
    } else if (gpu.includes('6800') || gpu.includes('6900')) {
      insights.push({ type: 'good', text: 'RX 6000 series high-end. Still powerful for 1440p/4K. Ray tracing exists but NVIDIA has the edge there.' });
    } else if (gpu.includes('6600') || gpu.includes('6700')) {
      insights.push({ type: 'info', text: 'RX 6000 mid-range. Solid 1080p-1440p gaming. Great price-to-performance but ray tracing is limited.' });
    }
    // Intel Arc
    else if (gpu.includes('Arc A7')) {
      insights.push({ type: 'info', text: 'Intel Arc A7 series. Competitive 1080p-1440p performance. Driver improvements have helped but some games still have issues.' });
    } else if (gpu.includes('Arc A3') || gpu.includes('Arc A5')) {
      insights.push({ type: 'info', text: 'Intel Arc entry-level. Budget option for 1080p gaming. XeSS upscaling helps in supported titles.' });
    }
    // Integrated graphics
    else if (gpu.includes('Intel') && (gpu.includes('UHD') || gpu.includes('Iris'))) {
      insights.push({ type: 'warning', text: 'Integrated Intel graphics. Fine for desktop work and video playback, but gaming is limited to light/older titles at low settings.' });
    } else if (gpu.includes('Vega') || gpu.includes('Radeon Graphics')) {
      insights.push({ type: 'info', text: 'AMD integrated graphics. Better than Intel for light gaming. Can handle esports titles at 720p-1080p low settings.' });
    }

    // VRAM context
    const vramNum = parseInt(vram);
    if (vramNum >= 16) {
      insights.push({ type: 'info', text: `${vramNum}GB VRAM is massive. 4K textures, heavy modding, AI/ML workloads - you won't run out anytime soon.` });
    } else if (vramNum >= 12) {
      insights.push({ type: 'info', text: `${vramNum}GB VRAM handles 4K textures in most games. Some heavily modded games might push it.` });
    } else if (vramNum >= 8) {
      insights.push({ type: 'info', text: `${vramNum}GB VRAM is comfortable for 1440p. 4K might require reducing texture quality in newer games.` });
    } else if (vramNum >= 4) {
      insights.push({ type: 'warning', text: `${vramNum}GB VRAM is tight for modern games. You may see texture pop-in or need to lower settings in recent titles.` });
    }

    return insights;
  }

  // Generate smart storage insights
  function getStorageInsights() {
    const total = currentSpecs.storage || 0;
    const free = currentSpecs.storageFree || 0;
    const type = currentSpecs.storageType || '';
    const usedPercent = total > 0 ? ((total - free) / total) * 100 : 0;
    const insights = [];

    // Drive type
    if (type === 'SSD') {
      insights.push({ type: 'good', text: 'SSD storage means fast boot times (15-30 sec), quick app launches, and snappy file operations. Much better than old HDDs.' });
    } else if (type === 'HDD') {
      insights.push({ type: 'warning', text: 'HDD storage is slow by modern standards. Consider adding an SSD for Windows and frequently-used apps - it\'s the single best upgrade for an old PC.' });
    }

    // Capacity context
    if (total >= 2000) {
      insights.push({ type: 'excellence', text: `${Math.round(total)}GB total storage is huge. Room for a large game library, video projects, and years of files.` });
    } else if (total >= 1000) {
      insights.push({ type: 'good', text: `${Math.round(total)}GB is comfortable. Fits 10-15 modern games plus your files. Just don't hoard too many AAA titles.` });
    } else if (total >= 500) {
      insights.push({ type: 'info', text: `${Math.round(total)}GB requires some management. Modern games are 50-150GB each. You'll need to uninstall games you're not playing.` });
    } else if (total >= 250) {
      insights.push({ type: 'warning', text: `${Math.round(total)}GB is tight. Windows needs 20-40GB, leaving room for only 2-3 large games. Consider adding more storage.` });
    } else {
      insights.push({ type: 'critical', text: `Under 250GB is very limiting. You'll constantly juggle space. An external drive or storage upgrade would help significantly.` });
    }

    // Current usage
    if (usedPercent > 95) {
      insights.push({ type: 'critical', text: `${usedPercent.toFixed(0)}% full is critical! Windows needs free space for updates, temp files, and virtual memory. Free up space immediately or risk system instability.` });
    } else if (usedPercent > 90) {
      insights.push({ type: 'warning', text: `${usedPercent.toFixed(0)}% full. Getting tight. Windows Update may fail, and performance can degrade. Time to clean up or expand storage.` });
    } else if (usedPercent > 75) {
      insights.push({ type: 'info', text: `${usedPercent.toFixed(0)}% used. Healthy but keep an eye on it. Run Disk Cleanup occasionally to remove temp files.` });
    } else {
      insights.push({ type: 'good', text: `Only ${usedPercent.toFixed(0)}% used. You have ${Math.round(free)}GB free - plenty of room for new games and projects.` });
    }

    // Practical tip
    if (free < 50) {
      insights.push({ type: 'warning', text: `With only ${Math.round(free)}GB free, check: Downloads folder (often full of forgotten files), Recycle Bin, and unused programs.` });
    }

    return insights;
  }

  // Generate smart OS insights
  function getOsInsights() {
    const os = currentSpecs.os || '';
    const version = currentSpecs.osVersion || '';
    const build = currentSpecs.osBuild || '';
    const insights = [];

    // Windows version analysis
    if (os.includes('Windows 11')) {
      insights.push({ type: 'good', text: 'Windows 11 is current and supported. You get the latest security patches, features, and DirectStorage for faster game loading.' });
      if (build && parseInt(build) >= 22631) {
        insights.push({ type: 'info', text: 'You\'re on Windows 11 23H2 or newer. This includes Copilot AI integration and the latest performance improvements.' });
      }
    } else if (os.includes('Windows 10')) {
      insights.push({ type: 'warning', text: 'Windows 10 support ends October 2025. After that, no security updates. Consider upgrading to Windows 11 if your hardware supports it.' });
      if (version.includes('19045') || version.includes('22H2')) {
        insights.push({ type: 'info', text: 'You\'re on Windows 10 22H2, the final feature update. You\'ll still get security updates until end of support.' });
      }
    } else if (os.includes('Windows 8') || os.includes('Windows 7')) {
      insights.push({ type: 'critical', text: 'This Windows version is no longer supported. You\'re missing critical security updates. Upgrade urgently recommended.' });
    }

    // Architecture
    if (currentSpecs.osArch === 'x64' || currentSpecs.osArch === '64-bit') {
      insights.push({ type: 'info', text: '64-bit Windows can address more than 4GB RAM and run both 32-bit and 64-bit applications. This is standard and correct.' });
    }

    // General tip
    insights.push({ type: 'info', text: 'Run Windows Update regularly. Besides security, updates often include driver improvements and performance optimizations.' });

    return insights;
  }

  // Build the spec details with smart insights
  const specDetails = {
    cpu: {
      icon: '🧠',
      title: 'Processor Details',
      rows: [
        { label: 'Model', value: currentSpecs.cpuName || 'Unknown' },
        { label: 'Manufacturer', value: currentSpecs.cpuManufacturer || 'Unknown' },
        { label: 'Cores', value: currentSpecs.cpuCores || 'Unknown' },
        { label: 'Base Speed', value: currentSpecs.cpuSpeed || 'Unknown' },
        { label: 'Max Boost', value: currentSpecs.cpuSpeedMax || 'Unknown' },
      ],
      insights: getCpuInsights()
    },
    ram: {
      icon: '💾',
      title: 'Memory (RAM) Details',
      rows: [
        { label: 'Total Installed', value: `${currentSpecs.ram?.toFixed(1) || 0} GB` },
        { label: 'Currently Used', value: currentSpecs.ramUsed ? `${currentSpecs.ramUsed.toFixed(1)} GB` : 'Unknown' },
        { label: 'Available', value: currentSpecs.ramFree ? `${currentSpecs.ramFree.toFixed(1)} GB` : 'Unknown' },
        { label: 'Usage', value: currentSpecs.ramUsage ? `${currentSpecs.ramUsage.toFixed(0)}%` : 'Unknown' },
      ],
      insights: getRamInsights()
    },
    gpu: {
      icon: '🎮',
      title: 'Graphics Card Details',
      rows: [
        { label: 'Model', value: currentSpecs.gpu || 'Unknown' },
        { label: 'Manufacturer', value: currentSpecs.gpuVendor || 'Unknown' },
        { label: 'Video Memory', value: currentSpecs.gpuVram || 'Unknown' },
        { label: 'Driver Version', value: currentSpecs.gpuDriver || 'Unknown' },
      ],
      insights: getGpuInsights()
    },
    storage: {
      icon: '💿',
      title: 'Storage Details',
      rows: [
        { label: 'Total Capacity', value: `${Math.round(currentSpecs.storage || 0)} GB` },
        { label: 'Used', value: `${Math.round((currentSpecs.storage || 0) - (currentSpecs.storageFree || 0))} GB` },
        { label: 'Free', value: `${Math.round(currentSpecs.storageFree || 0)} GB` },
        { label: 'Drive Type', value: currentSpecs.storageType || 'Unknown' },
      ],
      insights: getStorageInsights()
    },
    os: {
      icon: '🪟',
      title: 'Operating System Details',
      rows: [
        { label: 'Edition', value: currentSpecs.os || 'Windows' },
        { label: 'Version', value: currentSpecs.osVersion || 'Unknown' },
        { label: 'Build', value: currentSpecs.osBuild || 'Unknown' },
        { label: 'Architecture', value: currentSpecs.osArch || '64-bit' },
        { label: 'Computer Name', value: currentSpecs.hostname || 'Unknown' },
      ],
      insights: getOsInsights()
    }
  };

  const spec = specDetails[specType];
  if (!spec) return;

  icon.textContent = spec.icon;
  title.textContent = spec.title;

  // Build rows HTML
  let html = spec.rows.map(row => `
    <div class="spec-detail-row">
      <span class="spec-detail-label">${row.label}</span>
      <span class="spec-detail-value">${row.value}</span>
    </div>
  `).join('');

  // Build insights HTML with color-coded types
  if (spec.insights && spec.insights.length > 0) {
    const insightColors = {
      excellence: '#10b981', // green
      good: '#3b82f6',       // blue
      info: '#8b5cf6',       // purple
      warning: '#f59e0b',    // orange
      critical: '#ef4444'    // red
    };

    html += `<div class="spec-insights-section" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">`;
    html += `<h4 style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-muted);">Analysis</h4>`;

    spec.insights.forEach(insight => {
      const color = insightColors[insight.type] || insightColors.info;
      html += `
        <div style="display: flex; gap: 10px; margin-bottom: 10px; padding: 10px; background: ${color}15; border-left: 3px solid ${color}; border-radius: 4px;">
          <span style="color: ${color}; font-size: 14px; flex-shrink: 0;">
            ${insight.type === 'excellence' ? '⭐' : insight.type === 'good' ? '✓' : insight.type === 'warning' ? '⚠' : insight.type === 'critical' ? '🔴' : 'ℹ'}
          </span>
          <span style="color: var(--text-secondary); font-size: 13px; line-height: 1.4;">${insight.text}</span>
        </div>
      `;
    });

    html += `</div>`;
  }

  content.innerHTML = html;
  panel.style.display = 'block';

  // Scroll to panel
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSpecDetail() {
  const panel = document.getElementById('spec-detail-panel');
  panel.style.display = 'none';
}

// Expose spec detail functions globally for onclick handlers
window.showSpecDetail = showSpecDetail;
window.closeSpecDetail = closeSpecDetail;

// ============================================================
// NOTES PAGE 📝
// ============================================================
let notes = [];

function initNotes() {
  // Load notes from localStorage
  const saved = localStorage.getItem('pc-utility-notes');
  if (saved) {
    try {
      notes = JSON.parse(saved);
    } catch (e) {
      notes = [];
    }
  }

  document.getElementById('save-note-btn')?.addEventListener('click', saveNote);
  document.getElementById('note-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) saveNote();
  });

  // Note template buttons
  document.querySelectorAll('.note-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template;
      const input = document.getElementById('note-input');
      if (input && template) {
        input.value = template;
        input.focus();
        // Place cursor at end
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });
}

function saveNote() {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text) return;

  notes.unshift({
    id: generateUniqueId('note'),
    text: text,
    time: new Date().toLocaleString()
  });

  // Keep only last 50 notes
  notes = notes.slice(0, 50);

  localStorage.setItem('pc-utility-notes', JSON.stringify(notes));
  input.value = '';
  loadNotes();

  // Visual feedback
  showSuccessAnimation();
}

function loadNotes() {
  const container = document.getElementById('notes-list');
  container.innerHTML = '';

  // Update notes count
  const countEl = document.getElementById('notes-count');
  if (countEl) {
    countEl.textContent = `${notes.length} note${notes.length !== 1 ? 's' : ''}`;
  }

  if (notes.length === 0) {
    container.innerHTML = `
      <div class="notes-empty-state">
        <span class="empty-icon">📝</span>
        <p>No notes yet. Start typing above!</p>
      </div>
    `;
    return;
  }

  notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card glow-hover';
    card.innerHTML = `
      <p class="note-text">${escapeHtml(note.text)}</p>
      <span class="note-time">${note.time}</span>
      <button class="note-delete" data-id="${note.id}">×</button>
    `;

    card.querySelector('.note-delete').addEventListener('click', () => {
      notes = notes.filter(n => n.id !== note.id);
      localStorage.setItem('pc-utility-notes', JSON.stringify(notes));
      loadNotes();
    });

    container.appendChild(card);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// DESKTOP ORGANIZER
// ============================================================
let desktopItems = [];

function initDesktopOrganizer() {
  document.getElementById('refresh-desktop-btn')?.addEventListener('click', loadDesktopItems);
  document.getElementById('cleanup-desktop-btn')?.addEventListener('click', cleanupDesktopFiles);
}

async function loadDesktopItems() {
  const container = document.getElementById('desktop-preview');
  container.innerHTML = '<div class="loading-state">Scanning desktop...</div>';

  try {
    const items = await window.pcUtility.getDesktopItems();
    desktopItems = items;
    renderDesktopPreview(items);
  } catch (error) {
    console.error('Error loading desktop items:', error);
    container.innerHTML = '<div class="loading-state">Could not scan desktop</div>';
  }
}

function renderDesktopPreview(items) {
  const container = document.getElementById('desktop-preview');

  if (!items || items.categories.length === 0) {
    container.innerHTML = '<div class="loading-state">Desktop is empty or already organized!</div>';
    return;
  }

  container.innerHTML = '';

  // Create a section for each category
  items.categories.forEach(category => {
    if (category.items.length === 0) return;

    const section = document.createElement('div');
    section.className = 'desktop-category glow-hover';
    section.innerHTML = `
      <div class="category-header">
        <span class="category-icon">${category.icon}</span>
        <span class="category-name">${category.name}</span>
        <span class="category-count">${category.items.length} items</span>
      </div>
      <div class="category-items">
        ${category.items.slice(0, 5).map(item => `
          <div class="desktop-item">
            <span class="item-icon">${item.icon}</span>
            <span class="item-name">${item.name}</span>
          </div>
        `).join('')}
        ${category.items.length > 5 ? `<div class="desktop-item more">+${category.items.length - 5} more</div>` : ''}
      </div>
    `;
    container.appendChild(section);
  });

  // Summary
  const summary = document.createElement('div');
  summary.className = 'desktop-summary';
  summary.innerHTML = `
    <p><strong>${items.totalItems}</strong> items on desktop</p>
    <p class="summary-hint">Click "Organize Desktop" to sort icons by category</p>
  `;
  container.appendChild(summary);
}

async function cleanupDesktopFiles() {
  const btn = document.getElementById('cleanup-desktop-btn');
  const resultDiv = document.getElementById('desktop-result');

  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Cleaning...';

  try {
    const result = await window.pcUtility.cleanupDesktopFiles();

    resultDiv.textContent = result.message;
    resultDiv.className = 'cleanup-result' + (result.success ? '' : ' error');
    resultDiv.style.display = 'block';

    if (result.success) {
      showSuccessAnimation();
      setTimeout(loadDesktopItems, 1000);
    }

    setTimeout(() => {
      resultDiv.style.display = 'none';
    }, 4000);

  } catch (error) {
    resultDiv.textContent = 'Error cleaning desktop';
    resultDiv.className = 'cleanup-result error';
    resultDiv.style.display = 'block';
  }

  btn.innerHTML = '<span>🧹</span> Move Files to Folders';
  btn.disabled = false;
}

// ============================================================
// SETTINGS - AI Provider Management
// ============================================================
const providerUrls = {
  claude: 'https://claude.ai',
  chatgpt: 'https://chat.openai.com',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.x.ai'
};

// Settings storage key
const SETTINGS_KEY = 'pc-utility-settings';

// Default settings
const defaultSettings = {
  startup: false,
  minimized: false,
  updates: true,
  proactive: true,
  voice: false,
  responseStyle: 'balanced',
  monitoring: true,
  refresh: 10,
  cpuAlert: 90,
  diskAlert: 10,
  analytics: true,
  remember: true,
  notifications: true,
  sounds: false
};

// Load settings from localStorage
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch (e) {
    return defaultSettings;
  }
}

// Save settings to localStorage
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
}

// Get current settings
let appSettings = loadSettings();

function initSettings() {
  // Load saved settings into UI
  document.getElementById('setting-startup').checked = appSettings.startup;
  document.getElementById('setting-minimized').checked = appSettings.minimized;
  document.getElementById('setting-updates').checked = appSettings.updates;
  document.getElementById('setting-proactive').checked = appSettings.proactive;
  document.getElementById('setting-voice').checked = appSettings.voice;
  document.getElementById('setting-response-style').value = appSettings.responseStyle;
  document.getElementById('setting-monitoring').checked = appSettings.monitoring;
  document.getElementById('setting-refresh').value = appSettings.refresh;
  document.getElementById('setting-cpu-alert').value = appSettings.cpuAlert;
  document.getElementById('setting-disk-alert').value = appSettings.diskAlert;
  document.getElementById('setting-analytics').checked = appSettings.analytics;
  document.getElementById('setting-remember').checked = appSettings.remember;
  document.getElementById('setting-notifications').checked = appSettings.notifications;
  document.getElementById('setting-sounds').checked = appSettings.sounds;

  // Add change listeners to all toggle switches
  document.querySelectorAll('.toggle-switch input').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const settingName = e.target.id.replace('setting-', '');
      appSettings[settingName] = e.target.checked;
      saveSettings(appSettings);
      handleSettingChange(settingName, e.target.checked);
    });
  });

  // Add change listeners to select dropdowns
  document.querySelectorAll('.setting-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const settingName = e.target.id.replace('setting-', '').replace(/-([a-z])/g, (g) => g[1].toUpperCase());
      const value = isNaN(e.target.value) ? e.target.value : parseInt(e.target.value);
      appSettings[settingName] = value;
      saveSettings(appSettings);
      handleSettingChange(settingName, value);
    });
  });

  // Clear chat history button
  document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all chat history?')) {
      chatHistory = [];
      const chatMessages = document.getElementById('chat-messages');
      if (chatMessages) {
        chatMessages.innerHTML = `
          <div class="message assistant">
            <div class="message-content">
              Hey there! I'm Max, your PC assistant. Chat history cleared. How can I help you today?
            </div>
          </div>
        `;
      }
      showSuccessAnimation();
    }
  });

  // Export data button
  document.getElementById('export-data-btn')?.addEventListener('click', async () => {
    try {
      const analytics = await window.pcUtility.exportAnalytics();
      const data = {
        settings: appSettings,
        analytics: analytics,
        exportDate: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pc-utility-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccessAnimation();
    } catch (e) {
      alert('Failed to export data');
    }
  });

  // Clear all data button
  document.getElementById('clear-data-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete ALL your data? This cannot be undone.')) {
      if (confirm('This will clear all settings, chat history, notes, and analytics. Continue?')) {
        localStorage.clear();
        appSettings = { ...defaultSettings };
        chatHistory = [];
        location.reload();
      }
    }
  });

  // About links
  document.getElementById('btn-website')?.addEventListener('click', () => {
    window.pcUtility.openExternal('https://pcutilitypro.com');
  });
  document.getElementById('btn-support')?.addEventListener('click', () => {
    window.pcUtility.openExternal('https://pcutilitypro.com/support');
  });
  document.getElementById('btn-privacy')?.addEventListener('click', () => {
    window.pcUtility.openExternal('https://pcutilitypro.com/privacy');
  });
  document.getElementById('btn-terms')?.addEventListener('click', () => {
    window.pcUtility.openExternal('https://pcutilitypro.com/terms');
  });
}

// Handle setting changes that need immediate action
function handleSettingChange(setting, value) {
  switch (setting) {
    case 'proactive':
      // Enable/disable AI insights
      if (!value) {
        document.getElementById('ai-insight-indicator')?.classList.remove('visible');
      }
      break;
    case 'monitoring':
      // Could start/stop system monitoring
      break;
    case 'refresh':
      // Update refresh interval (would need IPC to main process)
      break;
  }
}

// ============================================================
// SCREENSHOT FEATURE 📸 (Reserved for future use)
// ============================================================
function initScreenshot() {
  // Screenshot button removed from UI
  // Keep function stub for potential future reintegration
}

// ============================================================
// CHAT PAGE - AI Assistant
// ============================================================
let chatHistory = [];

function initChat() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) {
        input.value = prompt;
        sendMessage();
      }
    });
  });

  // Clear chat button
  document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
    chatHistory = [];
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
      <div class="message assistant">
        <div class="assistant-avatar-small">🤖</div>
        <div class="message-content">
          <p>Hey there! 👋 I'm Max, your PC assistant.</p>
          <p>I can actually <strong>do things</strong> for you - not just answer questions. Try asking me to:</p>
        </div>
      </div>
    `;
    // Show suggestions again
    document.getElementById('chat-suggestions').style.display = 'flex';
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  // Hide suggestions after first message
  document.getElementById('chat-suggestions').style.display = 'none';

  input.value = '';
  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  // Add user message
  addChatMessage('user', message);
  chatHistory.push({ role: 'user', content: message });

  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message assistant';
  typingDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  document.getElementById('chat-messages').appendChild(typingDiv);
  scrollChat();

  try {
    const result = await window.pcUtility.chat({
      message,
      history: chatHistory.slice(-10) // Keep last 10 messages for context
    });

    // Remove typing indicator
    typingDiv.remove();

    if (result.success) {
      addChatMessage('assistant', result.response);
      chatHistory.push({ role: 'assistant', content: result.response });
    } else {
      addChatMessage('assistant', result.error || "I'm having trouble right now. Try again in a moment!");
    }
  } catch (error) {
    typingDiv.remove();
    addChatMessage('assistant', "Something went wrong. Please try again.");
  }

  input.disabled = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

function addChatMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  // Simple markdown-like formatting
  let html = content
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  if (role === 'assistant') {
    div.innerHTML = `
      <div class="assistant-avatar-small">🤖</div>
      <div class="message-content"><p>${html}</p></div>
    `;
  } else {
    div.innerHTML = `<div class="message-content"><p>${html}</p></div>`;
  }

  container.appendChild(div);
  scrollChat();
}

function scrollChat() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

// ============================================================
// APPS PAGE
// ============================================================
async function loadApps() {
  const container = document.getElementById('apps-list');
  container.innerHTML = '<div class="loading-state">Loading apps...</div>';

  try {
    const result = await window.pcUtility.getRunningApps();
    const { apps, summary } = result;

    if (!apps || apps.length === 0) {
      container.innerHTML = '<div class="loading-state">No apps found</div>';
      return;
    }

    // Build the container HTML with summary
    let html = '';

    // Summary section
    if (summary) {
      const summaryColor = summary.systemMemoryPercent > 80 ? '#f59e0b' :
                          summary.potentialSavings > 500 ? '#3b82f6' : '#10b981';
      html += `
        <div class="apps-summary" style="background: linear-gradient(135deg, ${summaryColor}15, ${summaryColor}05); border: 1px solid ${summaryColor}40; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600; color: var(--text-primary);">
              ${summary.totalApps} Active Applications
            </span>
            <span style="color: ${summaryColor}; font-weight: 500;">
              ${summary.totalMemoryGB}GB RAM
            </span>
          </div>
          <div style="color: var(--text-secondary); font-size: 13px; line-height: 1.4;">
            ${summary.insight}
          </div>
          ${summary.potentialSavings > 200 ? `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid ${summaryColor}30; font-size: 12px; color: var(--text-muted);">
              💡 Potential savings: ~${Math.round(summary.potentialSavings)}MB if idle apps closed
            </div>
          ` : ''}
        </div>
      `;
    }

    // Apps list
    apps.forEach(app => {
      const icon = getAppIcon(app.name, app.category);
      const categoryColor = getCategoryColor(app.category);

      // Determine status indicators
      const cpuClass = app.cpu > 50 ? 'critical' : app.cpu > 20 ? 'high' : '';
      const memClass = app.memoryStatus === 'high' ? 'critical' : app.memoryStatus === 'moderate' ? 'high' : '';

      // Status badge
      let statusBadge = '';
      if (app.cpu > 50) {
        statusBadge = '<span class="app-status-badge critical">High CPU</span>';
      } else if (app.memoryStatus === 'high' && app.cpu < 5) {
        statusBadge = '<span class="app-status-badge warning">Idle + High RAM</span>';
      } else if (app.canSave > 500) {
        statusBadge = '<span class="app-status-badge info">Could save ' + Math.round(app.canSave) + 'MB</span>';
      }

      html += `
        <div class="app-item glow-hover clickable-app ${app.memoryStatus === 'high' ? 'app-high-usage' : ''}"
             data-app-name="${app.name}"
             data-app-cpu="${app.cpu}"
             data-app-memory="${app.memory}"
             style="cursor: pointer; position: relative;">
          <div class="app-icon">${icon}</div>
          <div class="app-info">
            <div class="app-name-row">
              <span class="app-name">${app.name}</span>
              <span class="app-category" style="background: ${categoryColor}">${app.category}</span>
              ${statusBadge}
            </div>
            <div class="app-description">${app.description}</div>
            <div class="app-insight" style="margin-top: 6px; padding: 8px; background: var(--bg-secondary); border-radius: 6px; font-size: 12px;">
              <div style="color: var(--text-secondary); margin-bottom: 4px;">
                <strong style="color: var(--text-primary);">Memory:</strong> ${app.memoryInsight}
              </div>
              <div style="color: var(--text-secondary); margin-bottom: 4px;">
                <strong style="color: var(--text-primary);">CPU:</strong> ${app.cpuInsight}
              </div>
              <div style="color: ${app.canSave > 0 ? '#f59e0b' : 'var(--text-muted)'}; font-style: ${app.canSave > 0 ? 'normal' : 'italic'};">
                ${app.canSave > 0 ? '💡 ' : ''}${app.recommendation}
              </div>
            </div>
            <div class="app-detail" style="margin-top: 6px;">
              ${app.count > 1 ? app.count + ' processes' : '1 process'}
              ${!app.canClose ? ' • <span style="color: #6b7280;">System required</span>' : ''}
              ${app.typical ? ` • <span style="color: var(--text-muted);">Typical: ${app.typical}</span>` : ''}
            </div>
          </div>
          <div class="app-usage">
            <div class="app-cpu ${cpuClass}">${app.cpu}% CPU</div>
            <div class="app-memory ${memClass}">${app.memory} MB</div>
          </div>
          <div class="ask-ai-hint" style="position: absolute; right: 12px; top: 12px; font-size: 10px; color: var(--text-muted); opacity: 0.7;">🤖 Click to ask AI</div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Add click handlers for AI queries
    container.querySelectorAll('.clickable-app').forEach(appEl => {
      appEl.addEventListener('click', () => {
        const appName = appEl.dataset.appName;
        const appCpu = appEl.dataset.appCpu;
        const appMemory = appEl.dataset.appMemory;

        // Navigate to chat and ask about the app
        document.querySelector('[data-page="chat"]').click();

        // Pre-fill the chat with a question about this app
        setTimeout(() => {
          const chatInput = document.getElementById('chat-input');
          if (chatInput) {
            chatInput.value = `What is ${appName}? It's using ${appCpu}% CPU and ${appMemory}MB RAM. Is this normal? Should I close it?`;
            chatInput.focus();
            // Optionally auto-send
            document.getElementById('send-btn')?.click();
          }
        }, 100);
      });
    });
  } catch (error) {
    console.error('Error loading apps:', error);
    container.innerHTML = '<div class="loading-state">Could not load apps</div>';
  }
}

// ============================================================
// SPECS PAGE TAB SWITCHING
// ============================================================
document.querySelectorAll('.specs-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Update active tab button
    document.querySelectorAll('.specs-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update active tab content
    document.querySelectorAll('.specs-tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`)?.classList.add('active');

    // Load content if needed
    if (tabName === 'apps') {
      loadApps();
    } else if (tabName === 'network') {
      loadWifi();
      loadSpeedTestHistory();
    }
  });
});

function getCategoryColor(category) {
  const colors = {
    'Browser': 'rgba(99, 102, 241, 0.8)',
    'Communication': 'rgba(236, 72, 153, 0.8)',
    'Media': 'rgba(16, 185, 129, 0.8)',
    'Gaming': 'rgba(245, 158, 11, 0.8)',
    'Productivity': 'rgba(59, 130, 246, 0.8)',
    'Creative': 'rgba(168, 85, 247, 0.8)',
    'Development': 'rgba(34, 197, 94, 0.8)',
    'Cloud': 'rgba(6, 182, 212, 0.8)',
    'System': 'rgba(107, 114, 128, 0.8)',
    'Security': 'rgba(239, 68, 68, 0.8)',
    'Utility': 'rgba(156, 163, 175, 0.8)',
    'Hardware': 'rgba(251, 146, 60, 0.8)',
    'Other': 'rgba(75, 85, 99, 0.8)'
  };
  return colors[category] || colors['Other'];
}

function getAppIcon(name, category) {
  const icons = {
    'Chrome': '🌐',
    'Edge': '🌐',
    'Firefox': '🦊',
    'Discord': '💬',
    'Spotify': '🎵',
    'VS Code': '💻',
    'Steam': '🎮',
    'Teams': '👥',
    'Zoom': '📹',
    'Slack': '💼',
    'File Explorer': '📁',
    'Windows Security': '🛡️',
    'OneDrive': '☁️',
    'Photoshop': '🎨',
    'Premiere': '🎬',
    'Word': '📝',
    'Excel': '📊',
    'PowerPoint': '📽️',
    'Outlook': '📧',
    'Notion': '📓',
    'OBS': '🎥',
    'VLC': '🎞️',
    'Telegram': '✈️',
    'WhatsApp': '💬'
  };

  if (icons[name]) return icons[name];

  // Fallback by category
  const categoryIcons = {
    'Browser': '🌐',
    'Communication': '💬',
    'Media': '🎵',
    'Gaming': '🎮',
    'Productivity': '📄',
    'Creative': '🎨',
    'Development': '💻',
    'Cloud': '☁️',
    'System': '⚙️',
    'Security': '🛡️',
    'Utility': '🔧',
    'Hardware': '🖥️',
    'Other': '📱'
  };

  return categoryIcons[category] || '📱';
}

// ============================================================
// STORAGE PAGE
// ============================================================
async function loadStorage() {
  const container = document.getElementById('storage-cards');
  container.innerHTML = '<div class="loading-state">Analyzing storage...</div>';

  try {
    const result = await window.pcUtility.getStorageInfo();
    const { drives, summary, folderAnalysis } = result;

    if (!drives || drives.length === 0) {
      container.innerHTML = '<div class="loading-state">No drives found</div>';
      return;
    }

    let html = '';

    // Summary section
    if (summary) {
      const summaryColor = summary.overallPercent > 85 ? '#ef4444' :
                          summary.overallPercent > 70 ? '#f59e0b' : '#10b981';
      html += `
        <div class="storage-summary" style="background: linear-gradient(135deg, ${summaryColor}15, ${summaryColor}05); border: 1px solid ${summaryColor}40; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600; color: var(--text-primary);">
              Total Storage: ${summary.totalSpaceGB}GB
            </span>
            <span style="color: ${summaryColor}; font-weight: 500;">
              ${summary.totalFreeGB}GB Free
            </span>
          </div>
          <div style="color: var(--text-secondary); font-size: 13px;">
            ${summary.insight}
          </div>
        </div>
      `;
    }

    // Drives
    drives.forEach(drive => {
      const statusColors = {
        critical: '#ef4444',
        danger: '#f97316',
        warning: '#f59e0b',
        moderate: '#3b82f6',
        healthy: '#10b981'
      };
      const statusColor = statusColors[drive.status] || statusColors.healthy;

      html += `
        <div class="storage-card glow-hover" style="border-left: 4px solid ${statusColor};">
          <div class="storage-header">
            <div>
              <span class="storage-name">${drive.mount} Drive</span>
              <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">${drive.driveType}</span>
            </div>
            <span class="storage-percent" style="color: ${statusColor};">${drive.percent}%</span>
          </div>
          <div class="storage-bar">
            <div class="storage-bar-fill" style="width: ${drive.percent}%; background: ${statusColor};"></div>
          </div>
          <div class="storage-details">
            <span>${drive.usedGB} GB used of ${drive.totalGB} GB</span>
            <span>${drive.freeGB} GB free</span>
          </div>

          <div class="storage-insight" style="margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 8px; font-size: 13px;">
            <div style="color: var(--text-secondary); line-height: 1.5; margin-bottom: 8px;">
              ${drive.insight}
            </div>
            ${drive.recommendation ? `
              <div style="color: ${statusColor}; font-size: 12px;">
                💡 ${drive.recommendation}
              </div>
            ` : ''}
            ${drive.canFit ? `
              <div style="color: var(--text-muted); font-size: 12px; margin-top: 6px;">
                📦 Space for: ${drive.canFit}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    // Folder analysis section
    if (folderAnalysis && folderAnalysis.length > 0) {
      html += `
        <div class="folder-analysis" style="margin-top: 24px;">
          <h3 style="font-size: 16px; margin-bottom: 16px; color: var(--text-primary);">
            📂 Where Your Space Goes
          </h3>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      folderAnalysis.forEach(folder => {
        const sizeColor = folder.sizeMB > 5000 ? '#ef4444' :
                         folder.sizeMB > 1000 ? '#f59e0b' : '#3b82f6';
        html += `
          <div class="folder-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px;">
            <span style="font-size: 24px;">${folder.icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: 500; color: var(--text-primary);">${folder.name}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${folder.tip}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 600; color: ${sizeColor};">
                ${folder.sizeMB > 1000 ? folder.sizeGB + 'GB' : folder.sizeMB + 'MB'}
              </div>
              <div style="font-size: 11px; color: var(--text-muted);">
                ${folder.fileCount} files
              </div>
            </div>
          </div>
        `;
      });

      html += `
          </div>
          <div style="margin-top: 12px; padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: 8px; font-size: 12px; color: var(--text-secondary);">
            💡 Tip: Old installers in Downloads and files in Recycle Bin are usually safe to delete.
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

  } catch (error) {
    console.error('Error loading storage:', error);
    container.innerHTML = '<div class="loading-state">Could not load storage info</div>';
  }
}

// Helper to show cleanup result
function showCleanupResult(message, isError = false) {
  const resultDiv = document.getElementById('cleanup-result');
  resultDiv.textContent = message;
  resultDiv.className = 'cleanup-result' + (isError ? ' error' : '');
  resultDiv.style.display = 'block';

  if (!isError) showSuccessAnimation();

  setTimeout(() => {
    resultDiv.style.display = 'none';
    loadStorage();
  }, 4000);
}

// Generic cleanup button handler
async function handleCleanupBtn(btn, cleanupFn, originalHtml) {
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Working...';

  try {
    const result = await cleanupFn();
    btn.innerHTML = originalHtml;
    btn.disabled = false;
    showCleanupResult(result.message, !result.success);
  } catch (error) {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
    showCleanupResult('An error occurred', true);
  }
}

// Cleanup temp files button
document.getElementById('cleanup-btn')?.addEventListener('click', async function() {
  await handleCleanupBtn(this, () => window.pcUtility.cleanupTemp(), '<span>🗑️</span> Clear Temp Files');
});

// Cleanup browser cache button
document.getElementById('cleanup-browser-btn')?.addEventListener('click', async function() {
  await handleCleanupBtn(this, () => window.pcUtility.cleanupBrowser(), '<span>🌐</span> Clear Browser Cache');
});

// Empty recycle bin button
document.getElementById('cleanup-recycle-btn')?.addEventListener('click', async function() {
  await handleCleanupBtn(this, () => window.pcUtility.cleanupRecycleBin(), '<span>♻️</span> Empty Recycle Bin');
});

// Clean old downloads button
document.getElementById('cleanup-downloads-btn')?.addEventListener('click', async function() {
  await handleCleanupBtn(this, () => window.pcUtility.cleanupOldDownloads(), '<span>📥</span> Clear Old Downloads');
});

// Organize folder buttons
document.querySelectorAll('.organize-btn').forEach(btn => {
  btn.addEventListener('click', async function() {
    const folder = this.dataset.folder;
    const originalHtml = this.innerHTML;

    this.disabled = true;
    this.innerHTML = '<span>⏳</span> Organizing...';

    try {
      const result = await window.pcUtility.organizeFolder(folder);
      this.innerHTML = originalHtml;
      this.disabled = false;
      showCleanupResult(result.message, !result.success);
    } catch (error) {
      this.innerHTML = originalHtml;
      this.disabled = false;
      showCleanupResult('Error organizing folder', true);
    }
  });
});

// ============================================================
// HELP PAGE - Contact Support (AI-Powered)
// ============================================================
let supportChatHistory = [];
let currentSupportAgent = null;

// Pool of support agent names (regular agents)
const supportAgents = [
  { name: 'Alex', emoji: '👨‍💻', title: 'Support Agent' },
  { name: 'Jordan', emoji: '🧑‍💻', title: 'Support Agent' },
  { name: 'Sam', emoji: '👩‍💻', title: 'Support Agent' },
  { name: 'Casey', emoji: '🧑‍💼', title: 'Support Agent' },
  { name: 'Riley', emoji: '👨‍🔧', title: 'IT Support' },
  { name: 'Morgan', emoji: '👩‍🔧', title: 'IT Support' },
  { name: 'Taylor', emoji: '🧑‍💻', title: 'Support Agent' },
  { name: 'Jamie', emoji: '👨‍💻', title: 'Support Agent' }
];

// Senior agents for urgent cases
const seniorAgents = [
  { name: 'Michael', emoji: '👨‍💼', title: 'Senior Technician' },
  { name: 'Sarah', emoji: '👩‍💼', title: 'Senior Technician' },
  { name: 'David', emoji: '🧑‍💼', title: 'Lead Support Engineer' },
  { name: 'Emily', emoji: '👩‍🔬', title: 'Senior IT Specialist' }
];

function getRandomAgent(isUrgent = false) {
  const pool = isUrgent ? seniorAgents : supportAgents;
  return pool[Math.floor(Math.random() * pool.length)];
}

function initHelp() {
  const chatSupportBtn = document.getElementById('chat-support-btn');
  const urgentHelpBtn = document.getElementById('urgent-help-btn');
  const askAiBtn = document.getElementById('help-ask-ai-btn');
  const helpOptionsView = document.getElementById('help-options-view');
  const supportChatView = document.getElementById('support-chat-view');
  const supportBackBtn = document.getElementById('support-back-btn');
  const endChatBtn = document.getElementById('end-support-chat-btn');
  const supportInput = document.getElementById('support-chat-input');
  const supportSendBtn = document.getElementById('support-send-btn');

  // Open support chat
  chatSupportBtn?.addEventListener('click', () => {
    openSupportChat();
  });

  // Urgent help - also opens support chat with urgent context
  urgentHelpBtn?.addEventListener('click', () => {
    openSupportChat(true);
  });

  // Ask Max - navigate to AI chat
  askAiBtn?.addEventListener('click', () => {
    document.querySelector('[data-page="chat"]').click();
  });

  // Back button
  supportBackBtn?.addEventListener('click', () => {
    closeSupportChat();
  });

  // End chat button
  endChatBtn?.addEventListener('click', () => {
    if (supportChatHistory.length > 0) {
      if (confirm('End this support conversation?')) {
        closeSupportChat(true);
      }
    } else {
      closeSupportChat();
    }
  });

  // Send message
  supportSendBtn?.addEventListener('click', () => {
    sendSupportMessage();
  });

  // Enter key to send
  supportInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendSupportMessage();
    }
  });
}

function openSupportChat(isUrgent = false) {
  const helpOptionsView = document.getElementById('help-options-view');
  const supportChatView = document.getElementById('support-chat-view');
  const connectingScreen = document.getElementById('support-connecting-screen');
  const messagesContainer = document.getElementById('support-chat-messages');
  const inputArea = document.getElementById('support-chat-input-area');
  const agentName = document.getElementById('support-agent-name');
  const agentStatus = document.getElementById('support-agent-status');
  const queueInfo = document.getElementById('queue-info');
  const connectingTitle = document.getElementById('connecting-title');
  const connectingSubtitle = document.getElementById('connecting-subtitle');

  helpOptionsView.style.display = 'none';
  supportChatView.style.display = 'block';

  // Reset to connecting state
  connectingScreen.style.display = 'flex';
  messagesContainer.style.display = 'none';
  inputArea.style.display = 'none';
  agentName.textContent = 'Connecting...';
  agentStatus.textContent = 'Finding available agent';
  supportChatHistory = [];
  messagesContainer.innerHTML = '';

  // Simulate realistic connection flow
  simulateConnection(isUrgent);
}

async function simulateConnection(isUrgent) {
  const connectingScreen = document.getElementById('support-connecting-screen');
  const messagesContainer = document.getElementById('support-chat-messages');
  const inputArea = document.getElementById('support-chat-input-area');
  const agentNameEl = document.getElementById('support-agent-name');
  const agentStatus = document.getElementById('support-agent-status');
  const queueInfo = document.getElementById('queue-info');
  const queuePosition = document.getElementById('queue-position');
  const queueWait = document.getElementById('queue-wait');
  const connectingTitle = document.getElementById('connecting-title');
  const connectingSubtitle = document.getElementById('connecting-subtitle');
  const phoneIcon = document.getElementById('connecting-phone-icon');
  const avatarEmoji = document.querySelector('#support-avatar span:first-child');
  const diagnosticScan = document.getElementById('diagnostic-scan');

  // Pick a random agent for this session (senior for urgent)
  currentSupportAgent = getRandomAgent(isUrgent);

  // Phase 1: Calling (2s)
  connectingTitle.textContent = 'Calling Support...';
  connectingSubtitle.textContent = 'Please wait while we connect you';
  phoneIcon.textContent = '📞';
  phoneIcon.style.animation = '';

  await sleep(2000);

  if (!isUrgent) {
    // === REGULAR FLOW ===

    // Phase 2: Connecting
    connectingTitle.textContent = 'Connecting...';
    connectingSubtitle.textContent = 'Finding an available agent';

    await sleep(2500);

    // Phase 3: Queue
    queueInfo.style.display = 'flex';
    connectingTitle.textContent = 'You\'re in the queue';
    connectingSubtitle.textContent = 'An agent will be with you shortly';

    // Start at position 3, 4, or 5 randomly
    const startPos = 3 + Math.floor(Math.random() * 3);
    queuePosition.textContent = startPos.toString();
    queueWait.textContent = `~${startPos} min`;

    await sleep(2500);

    // Move down queue slowly
    for (let pos = startPos - 1; pos >= 1; pos--) {
      queuePosition.textContent = pos.toString();
      queueWait.textContent = pos === 1 ? '~30 sec' : `~${pos} min`;
      await sleep(2000);
    }

    await sleep(1500);

  } else {
    // === URGENT FLOW with Diagnostic Scan ===

    // Phase 2: Priority routing
    connectingTitle.textContent = 'Priority Connection';
    connectingSubtitle.textContent = 'Routing to senior technician...';

    await sleep(2000);

    // Phase 3: Diagnostic scan
    connectingTitle.textContent = 'Preparing Your Case';
    connectingSubtitle.textContent = 'Running quick system diagnostic...';
    diagnosticScan.style.display = 'block';

    // Get real system info
    let pcMood = null;
    try {
      pcMood = await window.pcUtility.getPcMood();
    } catch (e) {
      console.log('Could not get PC mood for diagnostic');
    }

    // Scan CPU
    await sleep(800);
    const cpuEl = document.getElementById('scan-cpu');
    cpuEl.querySelector('.scan-status').textContent = '◉';
    cpuEl.querySelector('.scan-status').className = 'scan-status checking';
    await sleep(1200);
    cpuEl.querySelector('.scan-status').textContent = '✓';
    cpuEl.querySelector('.scan-status').className = 'scan-status done';
    document.getElementById('scan-cpu-value').textContent = pcMood ? `${pcMood.cpu}%` : 'OK';

    // Scan Memory
    const memEl = document.getElementById('scan-memory');
    memEl.querySelector('.scan-status').textContent = '◉';
    memEl.querySelector('.scan-status').className = 'scan-status checking';
    await sleep(1200);
    memEl.querySelector('.scan-status').textContent = '✓';
    memEl.querySelector('.scan-status').className = 'scan-status done';
    document.getElementById('scan-memory-value').textContent = pcMood ? `${pcMood.memory}%` : 'OK';

    // Scan Disk
    const diskEl = document.getElementById('scan-disk');
    diskEl.querySelector('.scan-status').textContent = '◉';
    diskEl.querySelector('.scan-status').className = 'scan-status checking';
    await sleep(1200);
    diskEl.querySelector('.scan-status').textContent = '✓';
    diskEl.querySelector('.scan-status').className = 'scan-status done';
    document.getElementById('scan-disk-value').textContent = pcMood?.insights?.find(i => i.title?.includes('Storage'))?.detail || 'OK';

    // Scan Processes
    const procEl = document.getElementById('scan-processes');
    procEl.querySelector('.scan-status').textContent = '◉';
    procEl.querySelector('.scan-status').className = 'scan-status checking';
    await sleep(1200);
    procEl.querySelector('.scan-status').textContent = '✓';
    procEl.querySelector('.scan-status').className = 'scan-status done';
    document.getElementById('scan-processes-value').textContent = 'Scanned';

    await sleep(1500);

    connectingTitle.textContent = 'Diagnostic Complete';
    connectingSubtitle.textContent = 'Connecting to senior technician...';

    await sleep(2000);
    diagnosticScan.style.display = 'none';
  }

  // Phase 4: Agent found
  queueInfo.style.display = 'none';
  phoneIcon.textContent = '✓';
  phoneIcon.style.animation = 'none';
  connectingTitle.textContent = isUrgent ? 'Senior Technician Found!' : 'Agent Found!';
  connectingSubtitle.textContent = `${currentSupportAgent.name} is joining the chat...`;
  agentNameEl.textContent = currentSupportAgent.name;
  avatarEmoji.textContent = currentSupportAgent.emoji;
  agentStatus.textContent = 'Joining...';

  await sleep(2000);

  // Phase 5: Show chat
  connectingScreen.style.display = 'none';
  messagesContainer.style.display = 'flex';
  inputArea.style.display = 'flex';
  agentStatus.textContent = `${currentSupportAgent.title} • Online`;

  // Reset for next time
  phoneIcon.textContent = '📞';
  phoneIcon.style.animation = '';
  resetDiagnosticScan();

  // Add system message
  addSupportSystemMessage(`${currentSupportAgent.name} has joined the conversation`);

  // Small delay then greeting
  await sleep(1200);

  // Add typing indicator
  addSupportTypingIndicator();

  await sleep(2000);

  removeSupportTypingIndicator();

  // Add greeting
  const greeting = isUrgent
    ? `Hi! I'm ${currentSupportAgent.name}, a ${currentSupportAgent.title}. I've reviewed the diagnostic scan from your system and I'm ready to help. What seems to be the problem?`
    : `Hi there! I'm ${currentSupportAgent.name}. How can I help you today?`;

  addSupportMessage('agent', greeting);

  // Focus input
  document.getElementById('support-chat-input')?.focus();
}

function resetDiagnosticScan() {
  const items = ['scan-cpu', 'scan-memory', 'scan-disk', 'scan-processes'];
  items.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.querySelector('.scan-status').textContent = '○';
      el.querySelector('.scan-status').className = 'scan-status pending';
    }
  });
  document.getElementById('scan-cpu-value').textContent = '...';
  document.getElementById('scan-memory-value').textContent = '...';
  document.getElementById('scan-disk-value').textContent = '...';
  document.getElementById('scan-processes-value').textContent = '...';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addSupportSystemMessage(text) {
  const messagesContainer = document.getElementById('support-chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'support-system-message joined';
  msgDiv.textContent = text;
  messagesContainer.appendChild(msgDiv);
}

function closeSupportChat(clearHistory = false) {
  const helpOptionsView = document.getElementById('help-options-view');
  const supportChatView = document.getElementById('support-chat-view');

  supportChatView.style.display = 'none';
  helpOptionsView.style.display = 'block';

  if (clearHistory) {
    supportChatHistory = [];
  }
}

function addSupportMessage(role, content) {
  const messagesContainer = document.getElementById('support-chat-messages');
  const isAgent = role === 'agent';
  const agentEmoji = currentSupportAgent?.emoji || '👨‍💻';

  const messageDiv = document.createElement('div');
  messageDiv.className = `support-message ${isAgent ? 'agent' : 'user'}`;

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isAgent) {
    messageDiv.innerHTML = `
      <div class="agent-avatar-small">${agentEmoji}</div>
      <div class="message-content">
        <p>${escapeHtml(content)}</p>
        <span class="message-time">${timeStr}</span>
      </div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="message-content">
        <p>${escapeHtml(content)}</p>
        <span class="message-time">${timeStr}</span>
      </div>
    `;
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSupportTypingIndicator() {
  const messagesContainer = document.getElementById('support-chat-messages');
  const agentEmoji = currentSupportAgent?.emoji || '👨‍💻';

  const typingDiv = document.createElement('div');
  typingDiv.className = 'support-typing';
  typingDiv.id = 'support-typing-indicator';
  typingDiv.innerHTML = `
    <div class="agent-avatar-small">${agentEmoji}</div>
    <div class="message-content">
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;

  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeSupportTypingIndicator() {
  document.getElementById('support-typing-indicator')?.remove();
}

async function sendSupportMessage() {
  const input = document.getElementById('support-chat-input');
  const sendBtn = document.getElementById('support-send-btn');
  const message = input.value.trim();

  if (!message) return;

  // Add user message
  addSupportMessage('user', message);
  supportChatHistory.push({ role: 'user', content: message });

  // Clear input
  input.value = '';
  sendBtn.disabled = true;

  // Show typing indicator
  addSupportTypingIndicator();

  try {
    // Call AI with support persona
    const response = await window.pcUtility.chatWithSupport({
      message,
      history: supportChatHistory,
      agentName: currentSupportAgent?.name || 'Alex'
    });

    removeSupportTypingIndicator();

    if (response.success) {
      addSupportMessage('agent', response.message);
      supportChatHistory.push({ role: 'assistant', content: response.message });
    } else {
      addSupportMessage('agent', "I'm having trouble connecting right now. Please try again in a moment.");
    }
  } catch (error) {
    removeSupportTypingIndicator();
    addSupportMessage('agent', "Sorry, I encountered an error. Let me try again - what was your question?");
    console.error('Support chat error:', error);
  }

  sendBtn.disabled = false;
  input.focus();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// CLEANUP ON PAGE HIDE
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(refreshInterval);
  } else {
    refreshPcMood();
    refreshInterval = setInterval(refreshPcMood, 10000);
  }
});
