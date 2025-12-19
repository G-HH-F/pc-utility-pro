/**
 * Offline AI Fallback
 * Provides helpful responses when Claude API is unavailable
 */

// Keywords to match user queries
const KEYWORD_PATTERNS = {
  slow: ['slow', 'sluggish', 'lag', 'lagging', 'frozen', 'freeze', 'hang', 'stuck', 'unresponsive', 'takes forever'],
  memory: ['memory', 'ram', 'out of memory', 'memory full', 'using too much memory'],
  storage: ['storage', 'disk', 'space', 'full', 'no space', 'disk full', 'hard drive', 'ssd', 'c drive'],
  hot: ['hot', 'heat', 'overheating', 'temperature', 'fan', 'loud fan', 'thermal', 'burning'],
  startup: ['startup', 'boot', 'start up', 'takes long to start', 'slow boot', 'slow startup'],
  crash: ['crash', 'crashing', 'blue screen', 'bsod', 'restart', 'keeps restarting', 'shuts down'],
  virus: ['virus', 'malware', 'infected', 'hacked', 'suspicious', 'popup', 'pop-up', 'adware'],
  internet: ['internet', 'wifi', 'network', 'connection', 'offline', 'no internet', 'cant connect', 'disconnected'],
  battery: ['battery', 'charge', 'power', 'draining', 'dies fast', 'not charging'],
  update: ['update', 'windows update', 'updating', 'stuck updating', 'update failed'],
  app: ['app', 'application', 'program', 'software', 'not working', 'wont open', 'keeps closing'],
  audio: ['audio', 'sound', 'speaker', 'no sound', 'volume', 'mic', 'microphone'],
  display: ['display', 'screen', 'monitor', 'resolution', 'blurry', 'flickering', 'black screen'],
  cleanup: ['cleanup', 'clean', 'delete', 'remove', 'junk', 'temp files', 'free up space'],
  help: ['help', 'support', 'contact', 'talk to someone', 'human', 'real person'],
};

// Detailed responses for each category
const RESPONSES = {
  slow: {
    title: "PC Running Slow",
    steps: [
      "**Close unused browser tabs** - Each tab uses 50-300MB of memory. Close ones you're not using.",
      "**Check Task Manager** - Press Ctrl+Shift+Esc to see what's using CPU/RAM. Close resource-heavy apps.",
      "**Restart your PC** - If it's been running for days, a restart clears memory and fixes many issues.",
      "**Disable startup programs** - Open Task Manager > Startup tab. Disable programs you don't need at startup.",
      "**Run Disk Cleanup** - Search 'Disk Cleanup' in Start menu, select your drive, and clean temp files."
    ],
    quickAction: { type: 'navigate', page: 'specs', tab: 'apps' },
    quickActionLabel: "Show Running Apps"
  },

  memory: {
    title: "High Memory Usage",
    steps: [
      "**Check what's using memory** - Go to the Specs page and look at the Apps tab to see memory usage.",
      "**Close browser tabs** - Browsers are the #1 memory hog. Close tabs you're not actively using.",
      "**Close background apps** - Discord, Spotify, Teams etc. use memory even when minimized.",
      "**Restart the app** - If one app is using too much, close and reopen it to clear its memory.",
      "**Consider adding RAM** - If you frequently hit 90%+ usage, your PC may need more RAM (8GB minimum recommended, 16GB ideal)."
    ],
    quickAction: { type: 'navigate', page: 'specs', tab: 'apps' },
    quickActionLabel: "Check Memory Usage"
  },

  storage: {
    title: "Low Disk Space",
    steps: [
      "**Empty Recycle Bin** - Right-click Recycle Bin on desktop > Empty. This is often the quickest win.",
      "**Clear temp files** - Use the Cleanup page to remove temporary files safely.",
      "**Check Downloads folder** - Old installers and downloads pile up. Delete what you don't need.",
      "**Uninstall unused programs** - Settings > Apps > look for large programs you no longer use.",
      "**Move files to external drive** - Videos, photos, and games take the most space. Consider external storage."
    ],
    quickAction: { type: 'navigate', page: 'storage' },
    quickActionLabel: "Go to Storage"
  },

  hot: {
    title: "PC Overheating",
    steps: [
      "**Check for blocked vents** - Make sure nothing is covering your PC's air vents.",
      "**Clean dust** - Dust buildup is the #1 cause of overheating. Use compressed air to clean vents.",
      "**Check room temperature** - PCs struggle in hot rooms. Try improving airflow or AC.",
      "**Check CPU usage** - If something is maxing out your CPU, it generates heat. Close it.",
      "**Elevate laptop** - If using a laptop, elevate the back to improve airflow underneath."
    ],
    quickAction: { type: 'navigate', page: 'home' },
    quickActionLabel: "Check Temperature"
  },

  startup: {
    title: "Slow Startup",
    steps: [
      "**Disable startup programs** - Press Ctrl+Shift+Esc > Startup tab. Disable non-essential programs.",
      "**Check for malware** - Run Windows Security scan. Malware can slow startup significantly.",
      "**Enable Fast Startup** - Settings > Power > Choose what the power buttons do > Enable fast startup.",
      "**Upgrade to SSD** - If you have a traditional hard drive, an SSD makes startup 5-10x faster.",
      "**Check for Windows Updates** - Sometimes pending updates slow things down."
    ],
    quickAction: null
  },

  crash: {
    title: "Crashes & Blue Screens",
    steps: [
      "**Note the error code** - Blue screens show an error code (like MEMORY_MANAGEMENT). Write it down.",
      "**Update drivers** - Outdated graphics or network drivers cause most crashes. Check for updates.",
      "**Check for overheating** - Crashes during games/heavy use often mean overheating.",
      "**Run memory test** - Search 'Windows Memory Diagnostic' and run it to check for bad RAM.",
      "**Check disk health** - Search 'cmd', run as admin, type: chkdsk C: /f"
    ],
    quickAction: { type: 'navigate', page: 'specs' },
    quickActionLabel: "Check System Health"
  },

  virus: {
    title: "Virus/Malware Concerns",
    steps: [
      "**Run Windows Security** - Search 'Windows Security' > Virus & threat protection > Quick scan.",
      "**Run full scan** - If quick scan finds nothing but you're suspicious, run a Full scan (takes longer).",
      "**Check browser extensions** - Remove any extensions you don't recognize.",
      "**Check installed programs** - Settings > Apps. Look for programs you didn't install.",
      "**Don't click popups** - If you see popups saying 'You have a virus! Call this number!' - that's a scam."
    ],
    quickAction: null
  },

  internet: {
    title: "Internet/WiFi Issues",
    steps: [
      "**Restart your router** - Unplug it for 30 seconds, plug back in. Fixes most issues.",
      "**Restart your PC** - Sometimes the network adapter needs a reset.",
      "**Check other devices** - If other devices work, the problem is your PC, not the internet.",
      "**Run network troubleshooter** - Settings > Network > Network troubleshooter.",
      "**Forget and reconnect WiFi** - Settings > Network > WiFi > Manage known networks. Forget your network and reconnect."
    ],
    quickAction: { type: 'navigate', page: 'specs', tab: 'network' },
    quickActionLabel: "Check Network"
  },

  battery: {
    title: "Battery Issues",
    steps: [
      "**Check battery health** - Search 'cmd', run as admin, type: powercfg /batteryreport",
      "**Lower screen brightness** - Biggest battery drain. Use the lowest comfortable brightness.",
      "**Check battery saver** - Settings > System > Battery. Enable battery saver mode.",
      "**Check what's draining** - Settings > System > Battery > See which apps are using battery.",
      "**Consider replacement** - Batteries degrade over time. After 2-3 years, capacity drops significantly."
    ],
    quickAction: { type: 'navigate', page: 'specs' },
    quickActionLabel: "Check Battery"
  },

  update: {
    title: "Windows Update Issues",
    steps: [
      "**Give it time** - Updates can take 30+ minutes. Don't force shutdown during updates.",
      "**Restart and retry** - If stuck, restart PC and go to Settings > Update to try again.",
      "**Run troubleshooter** - Settings > Update > Troubleshoot > Windows Update.",
      "**Free up space** - Updates need free space. Make sure you have at least 10GB free.",
      "**Check internet** - Updates need stable internet. Try a wired connection if possible."
    ],
    quickAction: null
  },

  app: {
    title: "App Not Working",
    steps: [
      "**Restart the app** - Close it completely (check Task Manager) and reopen.",
      "**Restart your PC** - Fixes most app issues by clearing stuck processes.",
      "**Run as administrator** - Right-click the app > Run as administrator.",
      "**Reinstall the app** - Uninstall via Settings > Apps, then reinstall fresh.",
      "**Check for updates** - The app might need an update to work with your Windows version."
    ],
    quickAction: null
  },

  audio: {
    title: "Sound/Audio Issues",
    steps: [
      "**Check volume mixer** - Right-click speaker icon > Open Volume Mixer. Make sure the app isn't muted.",
      "**Check output device** - Click speaker icon > make sure correct device (speakers/headphones) is selected.",
      "**Restart Windows Audio** - Search 'services.msc' > find 'Windows Audio' > Restart.",
      "**Update audio drivers** - Device Manager > Sound > Right-click your device > Update driver.",
      "**Check physical connections** - Make sure speakers/headphones are plugged in properly."
    ],
    quickAction: null
  },

  display: {
    title: "Display Issues",
    steps: [
      "**Check cable connections** - Make sure monitor cable is firmly connected at both ends.",
      "**Try different cable/port** - Cables and ports can fail. Try another if available.",
      "**Update graphics drivers** - Device Manager > Display adapters > Right-click > Update driver.",
      "**Check resolution** - Right-click desktop > Display settings. Make sure resolution is correct.",
      "**Try external monitor** - If laptop screen is black, try connecting external monitor to diagnose."
    ],
    quickAction: null
  },

  cleanup: {
    title: "Cleaning Up Your PC",
    steps: [
      "**Use the Cleanup page** - I have built-in cleanup tools. Go to the Storage page for easy cleanup.",
      "**Empty Recycle Bin** - Often the quickest way to free space.",
      "**Clear browser data** - Browsers store lots of cache. Clear it in browser settings.",
      "**Uninstall old programs** - Settings > Apps. Remove programs you no longer use.",
      "**Use Storage Sense** - Settings > Storage > Turn on Storage Sense for automatic cleanup."
    ],
    quickAction: { type: 'navigate', page: 'storage' },
    quickActionLabel: "Go to Cleanup"
  },

  help: {
    title: "Getting Help",
    steps: [
      "**Use the Help page** - Click 'Get Help' in the sidebar to request support from a real person.",
      "**Describe your issue** - The more details you provide, the better I can help.",
      "**Try the troubleshooting steps** - I'll suggest steps you can try while waiting for support.",
      "**Take a screenshot** - If you see an error, take a screenshot to share with support."
    ],
    quickAction: { type: 'navigate', page: 'help' },
    quickActionLabel: "Request Support"
  },

  default: {
    title: "I'm Here to Help",
    steps: [
      "I'm currently in offline mode, but I can still help with common issues!",
      "",
      "**Try asking about:**",
      "- 'My PC is slow'",
      "- 'Running out of storage'",
      "- 'PC is overheating'",
      "- 'Internet not working'",
      "- 'App keeps crashing'",
      "",
      "Or go to the **Help** page to contact support directly."
    ],
    quickAction: { type: 'navigate', page: 'help' },
    quickActionLabel: "Get Human Help"
  }
};

// Greetings to handle
const GREETINGS = ['hi', 'hello', 'hey', 'hola', 'sup', 'yo', 'good morning', 'good afternoon', 'good evening'];

/**
 * Detect the category of a user's question
 */
function detectCategory(message) {
  const lower = message.toLowerCase();

  // Check for greetings
  if (GREETINGS.some(g => lower.includes(g)) && lower.length < 20) {
    return 'greeting';
  }

  // Score each category by keyword matches
  const scores = {};
  for (const [category, keywords] of Object.entries(KEYWORD_PATTERNS)) {
    scores[category] = keywords.filter(kw => lower.includes(kw)).length;
  }

  // Find highest scoring category
  const best = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])[0];

  return best ? best[0] : 'default';
}

/**
 * Generate an offline response
 */
function getOfflineResponse(message) {
  const category = detectCategory(message);

  // Handle greeting
  if (category === 'greeting') {
    return {
      message: "Hi! I'm Max, your PC assistant. I'm currently in offline mode, but I can still help with common issues. What's going on with your PC?",
      isOffline: true,
    };
  }

  const response = RESPONSES[category] || RESPONSES.default;

  // Format the response
  let formattedMessage = `## ${response.title}\n\n`;
  formattedMessage += response.steps.map((step, i) => {
    if (step.startsWith('**')) {
      return `${i + 1}. ${step}`;
    }
    return step;
  }).join('\n\n');

  formattedMessage += '\n\n---\n*I\'m currently offline. For more help, use the "Get Help" page to contact support.*';

  return {
    message: formattedMessage,
    quickAction: response.quickAction,
    quickActionLabel: response.quickActionLabel,
    isOffline: true,
    category,
  };
}

/**
 * Check if API is available
 */
async function checkAPIAvailable(anthropicClient) {
  if (!anthropicClient) return false;

  try {
    // Try a minimal API call
    await anthropicClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  getOfflineResponse,
  detectCategory,
  checkAPIAvailable,
  RESPONSES,
  KEYWORD_PATTERNS,
};
