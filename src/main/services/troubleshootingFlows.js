/**
 * Guided Troubleshooting Flows
 * Step-by-step wizards for common issues
 */

const si = require('systeminformation');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * All troubleshooting flows
 */
const FLOWS = {
  'slow-pc': {
    id: 'slow-pc',
    title: 'PC Running Slow',
    description: 'Let\'s figure out why your PC is slow and fix it',
    icon: '🐌',
    steps: [
      {
        id: 'check-resources',
        title: 'Checking System Resources',
        description: 'Looking at CPU and memory usage...',
        action: 'checkResources',
        automatic: true,
      },
      {
        id: 'check-memory-hogs',
        title: 'Finding Memory Hogs',
        description: 'Checking what\'s using the most memory...',
        action: 'findMemoryHogs',
        automatic: true,
      },
      {
        id: 'check-startup',
        title: 'Checking Startup Programs',
        description: 'Looking at programs that start with Windows...',
        action: 'checkStartupPrograms',
        automatic: true,
      },
      {
        id: 'check-uptime',
        title: 'Checking System Uptime',
        description: 'Seeing how long since last restart...',
        action: 'checkUptime',
        automatic: true,
      },
      {
        id: 'recommendations',
        title: 'Recommendations',
        description: 'Here\'s what I found and suggest...',
        action: 'generateRecommendations',
        automatic: true,
      },
    ],
  },

  'low-storage': {
    id: 'low-storage',
    title: 'Low Disk Space',
    description: 'Find and clean up what\'s using your storage',
    icon: '💾',
    steps: [
      {
        id: 'check-drives',
        title: 'Checking Disk Space',
        description: 'Scanning all drives...',
        action: 'checkDrives',
        automatic: true,
      },
      {
        id: 'check-recycle',
        title: 'Checking Recycle Bin',
        description: 'Seeing how much is in the Recycle Bin...',
        action: 'checkRecycleBin',
        automatic: true,
      },
      {
        id: 'check-temp',
        title: 'Checking Temp Files',
        description: 'Looking for temporary files to clean...',
        action: 'checkTempFiles',
        automatic: true,
      },
      {
        id: 'check-downloads',
        title: 'Checking Downloads',
        description: 'Scanning your Downloads folder...',
        action: 'checkDownloads',
        automatic: true,
      },
      {
        id: 'find-large-files',
        title: 'Finding Large Files',
        description: 'Looking for big files taking up space...',
        action: 'findLargeFiles',
        automatic: true,
      },
      {
        id: 'cleanup-options',
        title: 'Cleanup Options',
        description: 'Here\'s what you can clean up...',
        action: 'generateCleanupOptions',
        automatic: true,
      },
    ],
  },

  'overheating': {
    id: 'overheating',
    title: 'PC Overheating',
    description: 'Diagnose and fix overheating issues',
    icon: '🔥',
    steps: [
      {
        id: 'check-temp',
        title: 'Checking Temperature',
        description: 'Reading CPU temperature...',
        action: 'checkTemperature',
        automatic: true,
      },
      {
        id: 'check-cpu-usage',
        title: 'Checking CPU Usage',
        description: 'Seeing what\'s working the CPU hard...',
        action: 'checkCpuUsage',
        automatic: true,
      },
      {
        id: 'check-processes',
        title: 'Checking Heavy Processes',
        description: 'Finding processes using lots of CPU...',
        action: 'findCpuHogs',
        automatic: true,
      },
      {
        id: 'recommendations',
        title: 'Cooling Recommendations',
        description: 'Here\'s how to cool down your PC...',
        action: 'generateCoolingTips',
        automatic: true,
      },
    ],
  },

  'internet-issues': {
    id: 'internet-issues',
    title: 'Internet Problems',
    description: 'Diagnose and fix connection issues',
    icon: '📶',
    steps: [
      {
        id: 'check-connection',
        title: 'Checking Connection',
        description: 'Testing network connectivity...',
        action: 'checkConnection',
        automatic: true,
      },
      {
        id: 'check-dns',
        title: 'Checking DNS',
        description: 'Testing name resolution...',
        action: 'checkDns',
        automatic: true,
      },
      {
        id: 'check-speed',
        title: 'Checking Speed',
        description: 'Testing internet speed...',
        action: 'checkSpeed',
        automatic: true,
      },
      {
        id: 'recommendations',
        title: 'Network Recommendations',
        description: 'Here\'s what might help...',
        action: 'generateNetworkTips',
        automatic: true,
      },
    ],
  },
};

/**
 * Execute a troubleshooting step
 */
async function executeStep(flowId, stepId) {
  const flow = FLOWS[flowId];
  if (!flow) throw new Error(`Unknown flow: ${flowId}`);

  const step = flow.steps.find(s => s.id === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);

  // Execute the action
  const actionFn = stepActions[step.action];
  if (!actionFn) throw new Error(`Unknown action: ${step.action}`);

  return await actionFn();
}

/**
 * Step action implementations
 */
const stepActions = {
  // === SLOW PC FLOW ===

  async checkResources() {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);

    const cpuUsage = Math.round(cpu.currentLoad);
    const memUsage = Math.round((mem.used / mem.total) * 100);
    const memUsedGB = (mem.used / 1024 / 1024 / 1024).toFixed(1);
    const memTotalGB = (mem.total / 1024 / 1024 / 1024).toFixed(0);

    let status = 'good';
    let message = '';

    if (cpuUsage > 80 || memUsage > 85) {
      status = 'critical';
      message = `Your system is under heavy load! CPU: ${cpuUsage}%, RAM: ${memUsage}%`;
    } else if (cpuUsage > 50 || memUsage > 70) {
      status = 'warning';
      message = `Resources are moderately high. CPU: ${cpuUsage}%, RAM: ${memUsage}%`;
    } else {
      message = `Resources look healthy. CPU: ${cpuUsage}%, RAM: ${memUsage}%`;
    }

    return {
      status,
      message,
      data: {
        cpu: cpuUsage,
        memory: memUsage,
        memoryUsed: memUsedGB,
        memoryTotal: memTotalGB,
      },
    };
  },

  async findMemoryHogs() {
    const procs = await si.processes();
    const mem = await si.mem();
    const totalGB = mem.total / 1024 / 1024 / 1024;

    const hogs = procs.list
      .sort((a, b) => b.mem - a.mem)
      .slice(0, 5)
      .map(p => ({
        name: p.name.replace('.exe', ''),
        memPercent: p.mem.toFixed(1),
        memMB: Math.round((p.mem / 100) * totalGB * 1024),
        pid: p.pid,
      }));

    const topHog = hogs[0];
    let status = 'info';
    let message = `Top memory users found. ${topHog.name} is using ${topHog.memMB}MB.`;

    if (topHog.memMB > 2000) {
      status = 'warning';
      message = `${topHog.name} is using a lot of memory (${topHog.memMB}MB). Consider closing it.`;
    }

    return {
      status,
      message,
      data: { hogs },
      actions: hogs.slice(0, 3).map(h => ({
        label: `Close ${h.name}`,
        action: 'close-process',
        pid: h.pid,
      })),
    };
  },

  async checkStartupPrograms() {
    return new Promise((resolve) => {
      exec('wmic startup get caption,command', { shell: 'cmd.exe' }, (error, stdout) => {
        const lines = stdout.trim().split('\n').slice(1).filter(l => l.trim());
        const programs = lines.map(line => {
          const parts = line.trim().split(/\s{2,}/);
          return { name: parts[0] || 'Unknown', command: parts[1] || '' };
        }).filter(p => p.name && p.name !== 'Caption');

        let status = 'info';
        let message = `You have ${programs.length} startup programs.`;

        if (programs.length > 10) {
          status = 'warning';
          message = `You have ${programs.length} startup programs. This may slow down boot time.`;
        }

        resolve({
          status,
          message,
          data: { programs, count: programs.length },
        });
      });
    });
  },

  async checkUptime() {
    const time = await si.time();
    const uptimeHours = time.uptime / 3600;
    const uptimeDays = uptimeHours / 24;

    let status = 'good';
    let message = '';

    if (uptimeDays > 7) {
      status = 'warning';
      message = `Your PC has been running for ${Math.floor(uptimeDays)} days. A restart would help clear memory and apply updates.`;
    } else if (uptimeDays > 3) {
      status = 'info';
      message = `Uptime: ${Math.floor(uptimeDays)} days. Consider restarting in the next few days.`;
    } else {
      message = `Uptime: ${Math.floor(uptimeHours)} hours. Recently restarted, that's good!`;
    }

    return {
      status,
      message,
      data: { uptimeHours, uptimeDays },
      actions: uptimeDays > 3 ? [{ label: 'Restart Now', action: 'restart' }] : [],
    };
  },

  async generateRecommendations() {
    // This would aggregate results from previous steps
    return {
      status: 'complete',
      message: 'Analysis complete! See recommendations above.',
      data: {},
    };
  },

  // === LOW STORAGE FLOW ===

  async checkDrives() {
    const drives = await si.fsSize();

    const driveInfo = drives.map(d => ({
      name: d.mount,
      sizeGB: Math.round(d.size / 1024 / 1024 / 1024),
      usedGB: Math.round(d.used / 1024 / 1024 / 1024),
      freeGB: Math.round((d.size - d.used) / 1024 / 1024 / 1024),
      usedPercent: Math.round(d.use),
    }));

    const critical = driveInfo.filter(d => d.usedPercent > 90);
    const warning = driveInfo.filter(d => d.usedPercent > 75 && d.usedPercent <= 90);

    let status = 'good';
    let message = 'Disk space looks healthy.';

    if (critical.length > 0) {
      status = 'critical';
      message = `${critical[0].name} is ${critical[0].usedPercent}% full! Only ${critical[0].freeGB}GB free.`;
    } else if (warning.length > 0) {
      status = 'warning';
      message = `${warning[0].name} is getting full (${warning[0].usedPercent}% used).`;
    }

    return { status, message, data: { drives: driveInfo } };
  },

  async checkRecycleBin() {
    return new Promise((resolve) => {
      exec('powershell -Command "(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum | Select-Object -ExpandProperty Sum"',
        { shell: 'powershell.exe' },
        (error, stdout) => {
          const bytes = parseInt(stdout.trim()) || 0;
          const mb = Math.round(bytes / 1024 / 1024);
          const gb = (bytes / 1024 / 1024 / 1024).toFixed(2);

          let status = 'info';
          let message = `Recycle Bin: ${mb}MB`;

          if (mb > 1000) {
            status = 'warning';
            message = `Recycle Bin has ${gb}GB! Emptying it would free up space.`;
          }

          resolve({
            status,
            message,
            data: { sizeMB: mb, sizeGB: gb },
            actions: mb > 100 ? [{ label: 'Empty Recycle Bin', action: 'empty-recycle' }] : [],
          });
        }
      );
    });
  },

  async checkTempFiles() {
    const tempDir = os.tmpdir();
    let totalSize = 0;
    let fileCount = 0;

    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          const stats = fs.statSync(path.join(tempDir, file));
          totalSize += stats.size;
          fileCount++;
        } catch (e) {}
      }
    } catch (e) {}

    const mb = Math.round(totalSize / 1024 / 1024);

    return {
      status: mb > 500 ? 'warning' : 'info',
      message: `Temp folder: ${mb}MB in ${fileCount} items`,
      data: { sizeMB: mb, fileCount },
      actions: mb > 100 ? [{ label: 'Clear Temp Files', action: 'clear-temp' }] : [],
    };
  },

  async checkDownloads() {
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    let totalSize = 0;
    let fileCount = 0;
    let oldFiles = [];

    try {
      const files = fs.readdirSync(downloadsPath);
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        try {
          const filePath = path.join(downloadsPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            totalSize += stats.size;
            fileCount++;
            if (stats.mtime.getTime() < thirtyDaysAgo) {
              oldFiles.push({ name: file, sizeMB: Math.round(stats.size / 1024 / 1024) });
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    const mb = Math.round(totalSize / 1024 / 1024);
    const gb = (totalSize / 1024 / 1024 / 1024).toFixed(1);

    let status = 'info';
    let message = `Downloads: ${mb < 1000 ? mb + 'MB' : gb + 'GB'} in ${fileCount} files`;

    if (oldFiles.length > 10) {
      status = 'warning';
      message += `. ${oldFiles.length} files are over 30 days old.`;
    }

    return {
      status,
      message,
      data: { sizeMB: mb, fileCount, oldFileCount: oldFiles.length },
      actions: oldFiles.length > 5 ? [{ label: 'Review Old Downloads', action: 'open-downloads' }] : [],
    };
  },

  async findLargeFiles() {
    const homedir = os.homedir();
    const largeFiles = [];

    const scanDir = (dir, depth = 0) => {
      if (depth > 3) return; // Limit depth

      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.')) continue;

          const fullPath = path.join(dir, item.name);
          try {
            if (item.isFile()) {
              const stats = fs.statSync(fullPath);
              if (stats.size > 100 * 1024 * 1024) { // > 100MB
                largeFiles.push({
                  path: fullPath,
                  name: item.name,
                  sizeMB: Math.round(stats.size / 1024 / 1024),
                });
              }
            } else if (item.isDirectory() && !['node_modules', 'AppData', '.git'].includes(item.name)) {
              scanDir(fullPath, depth + 1);
            }
          } catch (e) {}
        }
      } catch (e) {}
    };

    // Scan common locations
    scanDir(path.join(homedir, 'Downloads'));
    scanDir(path.join(homedir, 'Desktop'));
    scanDir(path.join(homedir, 'Documents'));
    scanDir(path.join(homedir, 'Videos'));

    largeFiles.sort((a, b) => b.sizeMB - a.sizeMB);
    const top10 = largeFiles.slice(0, 10);

    return {
      status: top10.length > 5 ? 'warning' : 'info',
      message: `Found ${largeFiles.length} files over 100MB`,
      data: { files: top10 },
    };
  },

  async generateCleanupOptions() {
    return {
      status: 'complete',
      message: 'Analysis complete! Use the cleanup options above.',
      data: {},
    };
  },

  // === OVERHEATING FLOW ===

  async checkTemperature() {
    const temp = await si.cpuTemperature();

    let status = 'good';
    let message = '';

    if (!temp.main) {
      status = 'info';
      message = 'Temperature sensors not available on this system.';
    } else if (temp.main > 85) {
      status = 'critical';
      message = `CPU is very hot: ${Math.round(temp.main)}°C! This could cause throttling or damage.`;
    } else if (temp.main > 70) {
      status = 'warning';
      message = `CPU is warm: ${Math.round(temp.main)}°C. Keep an eye on it.`;
    } else {
      message = `CPU temperature: ${Math.round(temp.main)}°C. Looking good!`;
    }

    return { status, message, data: { temperature: temp.main } };
  },

  async checkCpuUsage() {
    const cpu = await si.currentLoad();
    const usage = Math.round(cpu.currentLoad);

    let status = 'good';
    let message = `CPU usage: ${usage}%`;

    if (usage > 80) {
      status = 'warning';
      message = `CPU is working hard at ${usage}%. This generates heat.`;
    }

    return { status, message, data: { usage } };
  },

  async findCpuHogs() {
    const procs = await si.processes();

    const hogs = procs.list
      .filter(p => !['System Idle Process', 'Idle'].includes(p.name))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5)
      .map(p => ({
        name: p.name.replace('.exe', ''),
        cpu: p.cpu.toFixed(1),
        pid: p.pid,
      }));

    const topHog = hogs[0];
    let status = 'info';
    let message = `Top CPU user: ${topHog.name} (${topHog.cpu}%)`;

    if (parseFloat(topHog.cpu) > 50) {
      status = 'warning';
      message = `${topHog.name} is using ${topHog.cpu}% CPU. This is generating heat.`;
    }

    return {
      status,
      message,
      data: { hogs },
      actions: parseFloat(topHog.cpu) > 30 ? [{ label: `Close ${topHog.name}`, action: 'close-process', pid: topHog.pid }] : [],
    };
  },

  async generateCoolingTips() {
    return {
      status: 'complete',
      message: 'Tips: 1) Make sure vents aren\'t blocked, 2) Clean dust from fans, 3) Close CPU-heavy apps, 4) Consider a laptop cooling pad.',
      data: {},
    };
  },

  // === INTERNET FLOW ===

  async checkConnection() {
    const interfaces = await si.networkInterfaces();
    const active = interfaces.find(i => i.ip4 && !i.internal);

    if (!active) {
      return {
        status: 'critical',
        message: 'No active network connection found!',
        data: { connected: false },
      };
    }

    return {
      status: 'good',
      message: `Connected via ${active.iface} (${active.ip4})`,
      data: { connected: true, interface: active.iface, ip: active.ip4 },
    };
  },

  async checkDns() {
    return new Promise((resolve) => {
      exec('nslookup google.com', { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve({
            status: 'critical',
            message: 'DNS resolution failed! Try restarting your router.',
            data: { working: false },
          });
        } else {
          resolve({
            status: 'good',
            message: 'DNS is working correctly.',
            data: { working: true },
          });
        }
      });
    });
  },

  async checkSpeed() {
    // Quick ping test instead of full speed test
    return new Promise((resolve) => {
      exec('ping -n 3 8.8.8.8', { timeout: 10000 }, (error, stdout) => {
        if (error) {
          resolve({
            status: 'critical',
            message: 'Cannot reach internet. Check your connection.',
            data: { reachable: false },
          });
          return;
        }

        // Parse ping time
        const match = stdout.match(/Average = (\d+)ms/);
        const avgPing = match ? parseInt(match[1]) : null;

        let status = 'good';
        let message = `Internet is reachable. Ping: ${avgPing}ms`;

        if (avgPing > 200) {
          status = 'warning';
          message = `High latency detected: ${avgPing}ms. Connection may be slow.`;
        }

        resolve({ status, message, data: { reachable: true, ping: avgPing } });
      });
    });
  },

  async generateNetworkTips() {
    return {
      status: 'complete',
      message: 'Tips: 1) Restart your router, 2) Move closer to WiFi, 3) Check for interference, 4) Try a wired connection.',
      data: {},
    };
  },
};

/**
 * Get list of available flows
 */
function getAvailableFlows() {
  return Object.values(FLOWS).map(f => ({
    id: f.id,
    title: f.title,
    description: f.description,
    icon: f.icon,
    stepCount: f.steps.length,
  }));
}

/**
 * Get flow details
 */
function getFlow(flowId) {
  return FLOWS[flowId] || null;
}

/**
 * Run an entire flow and return results
 */
async function runFlow(flowId, onStepComplete = null) {
  const flow = FLOWS[flowId];
  if (!flow) throw new Error(`Unknown flow: ${flowId}`);

  const results = {
    flowId,
    title: flow.title,
    startTime: Date.now(),
    steps: [],
    overallStatus: 'good',
  };

  for (const step of flow.steps) {
    try {
      const result = await executeStep(flowId, step.id);
      results.steps.push({
        id: step.id,
        title: step.title,
        ...result,
      });

      // Update overall status
      if (result.status === 'critical') results.overallStatus = 'critical';
      else if (result.status === 'warning' && results.overallStatus !== 'critical') {
        results.overallStatus = 'warning';
      }

      if (onStepComplete) {
        onStepComplete(step.id, result);
      }
    } catch (e) {
      results.steps.push({
        id: step.id,
        title: step.title,
        status: 'error',
        message: e.message,
        data: {},
      });
    }
  }

  results.endTime = Date.now();
  results.duration = results.endTime - results.startTime;

  return results;
}

module.exports = {
  FLOWS,
  getAvailableFlows,
  getFlow,
  executeStep,
  runFlow,
};
