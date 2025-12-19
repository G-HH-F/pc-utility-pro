/**
 * System Info Handlers
 * Handles system information retrieval (specs, running apps, network)
 */

const { ipcMain, shell } = require('electron');
const si = require('systeminformation');
const path = require('path');
const os = require('os');

// Map process names to friendly names
const FRIENDLY_APP_NAMES = {
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
  'afterfx': 'After Effects',
  'obs': 'OBS Studio',
  'vlc': 'VLC',
  'notepad++': 'Notepad++',
  'winword': 'Word',
  'excel': 'Excel',
  'powerpnt': 'PowerPoint',
  'outlook': 'Outlook'
};

/**
 * Get friendly app name from process name
 */
function getFriendlyAppName(processName) {
  const lower = processName.toLowerCase();
  for (const [key, value] of Object.entries(FRIENDLY_APP_NAMES)) {
    if (lower.includes(key)) return value;
  }
  return processName.replace('.exe', '');
}

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} minutes`;
}

/**
 * Register system info IPC handlers
 */
function registerSystemInfoHandlers() {
  // Get running apps
  ipcMain.handle('get-running-apps', async () => {
    try {
      const processes = await si.processes();

      // Group by name and sum resources
      const appMap = new Map();

      for (const proc of processes.list) {
        // Skip system processes
        if (proc.name.toLowerCase().includes('system') ||
          proc.name.toLowerCase().includes('svchost') ||
          proc.name.toLowerCase().includes('runtime') ||
          proc.name.toLowerCase().includes('service')) {
          continue;
        }

        const name = getFriendlyAppName(proc.name);
        const existing = appMap.get(name);

        if (existing) {
          existing.cpu += proc.cpu;
          existing.mem += proc.mem_rss || 0;
          existing.pids.push(proc.pid);
        } else {
          appMap.set(name, {
            name,
            cpu: proc.cpu,
            mem: proc.mem_rss || 0,
            pids: [proc.pid]
          });
        }
      }

      // Convert to array and sort by memory usage
      const apps = Array.from(appMap.values())
        .filter(app => app.mem > 10 * 1024 * 1024) // Min 10MB
        .sort((a, b) => b.mem - a.mem)
        .slice(0, 20)
        .map(app => ({
          name: app.name,
          cpu: Math.round(app.cpu * 10) / 10,
          memoryMB: Math.round(app.mem / 1024 / 1024),
          pids: app.pids
        }));

      const totalMemory = await si.mem();
      const totalUsedMB = Math.round(totalMemory.used / 1024 / 1024);
      const totalMB = Math.round(totalMemory.total / 1024 / 1024);

      return {
        apps,
        summary: {
          totalApps: apps.length,
          totalMemoryUsedMB: totalUsedMB,
          totalMemoryMB: totalMB,
          memoryPercent: Math.round((totalMemory.used / totalMemory.total) * 100)
        }
      };
    } catch (error) {
      console.error('Error getting running apps:', error);
      return { apps: [], summary: {} };
    }
  });

  // Get PC specs
  ipcMain.handle('get-specs', async () => {
    try {
      const [cpu, mem, os, graphics, disk, network, time, battery, system] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.osInfo(),
        si.graphics(),
        si.diskLayout(),
        si.networkInterfaces(),
        si.time(),
        si.battery(),
        si.system()
      ]);

      return {
        cpu: {
          manufacturer: cpu.manufacturer,
          brand: cpu.brand,
          speed: `${cpu.speed} GHz`,
          cores: cpu.cores,
          physicalCores: cpu.physicalCores,
          vendor: cpu.vendor
        },
        memory: {
          total: `${Math.round(mem.total / 1024 / 1024 / 1024)} GB`,
          used: `${Math.round(mem.used / 1024 / 1024 / 1024)} GB`,
          free: `${Math.round(mem.free / 1024 / 1024 / 1024)} GB`,
          usedPercent: Math.round((mem.used / mem.total) * 100)
        },
        os: {
          platform: os.platform,
          distro: os.distro,
          release: os.release,
          arch: os.arch,
          hostname: os.hostname
        },
        graphics: graphics.controllers.map(g => ({
          vendor: g.vendor,
          model: g.model,
          vram: g.vram ? `${g.vram} MB` : 'Integrated'
        })),
        storage: disk.map(d => ({
          name: d.name || d.model,
          type: d.type,
          size: `${Math.round(d.size / 1024 / 1024 / 1024)} GB`,
          interfaceType: d.interfaceType
        })),
        network: network.filter(n => !n.internal && n.ip4).map(n => ({
          name: n.iface,
          ip4: n.ip4,
          mac: n.mac,
          speed: n.speed ? `${n.speed} Mbps` : 'Unknown'
        })),
        system: {
          manufacturer: system.manufacturer,
          model: system.model,
          serial: system.serial?.substring(0, 8) + '...'
        },
        uptime: formatUptime(time.uptime),
        battery: battery.hasBattery ? {
          percent: battery.percent,
          isCharging: battery.isCharging,
          timeRemaining: battery.timeRemaining
        } : null
      };
    } catch (error) {
      console.error('Error getting specs:', error);
      return null;
    }
  });

  // Get WiFi/Network info
  ipcMain.handle('get-wifi-info', async () => {
    try {
      const [networkInterfaces, networkConnections, networkStats] = await Promise.all([
        si.networkInterfaces(),
        si.networkConnections(),
        si.networkStats()
      ]);

      // Find active WiFi interface
      const wifiInterface = networkInterfaces.find(n =>
        n.type === 'wireless' || n.ifaceName?.toLowerCase().includes('wi-fi') || n.ifaceName?.toLowerCase().includes('wlan')
      );

      const activeInterface = networkInterfaces.find(n => !n.internal && n.ip4 && n.operstate === 'up');

      return {
        wifi: wifiInterface ? {
          name: wifiInterface.ifaceName,
          ip: wifiInterface.ip4,
          mac: wifiInterface.mac,
          speed: wifiInterface.speed ? `${wifiInterface.speed} Mbps` : 'Unknown',
          signal: wifiInterface.signalLevel || 'Unknown'
        } : null,
        connection: activeInterface ? {
          name: activeInterface.ifaceName,
          type: activeInterface.type,
          ip: activeInterface.ip4,
          gateway: activeInterface.gateway,
          dns: activeInterface.dns
        } : null,
        stats: networkStats[0] ? {
          rxBytes: networkStats[0].rx_bytes,
          txBytes: networkStats[0].tx_bytes,
          rxPerSec: networkStats[0].rx_sec,
          txPerSec: networkStats[0].tx_sec
        } : null,
        openConnections: networkConnections.length
      };
    } catch (error) {
      console.error('Error getting wifi info:', error);
      return { wifi: null, connection: null, stats: null };
    }
  });

  // Run speed test
  ipcMain.handle('run-speed-test', async () => {
    try {
      const https = require('https');

      // Download test - use Cloudflare test file
      const downloadStart = Date.now();
      const downloadSize = await new Promise((resolve) => {
        let size = 0;
        const req = https.get('https://speed.cloudflare.com/__down?bytes=10000000', (res) => {
          res.on('data', chunk => size += chunk.length);
          res.on('end', () => resolve(size));
        });
        req.on('error', () => resolve(0));
        req.setTimeout(10000, () => {
          req.destroy();
          resolve(size);
        });
      });
      const downloadTime = (Date.now() - downloadStart) / 1000;
      const downloadSpeed = downloadSize > 0 ? (downloadSize * 8 / downloadTime / 1000000) : 0;

      return {
        success: true,
        download: Math.round(downloadSpeed * 10) / 10,
        upload: null, // Upload test requires POST endpoint
        ping: null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Open external links
  ipcMain.handle('open-external', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Launch application
  ipcMain.handle('launch-app', async (event, appName) => {
    try {
      const { exec } = require('child_process');

      // Common app mappings
      const appCommands = {
        'chrome': 'start chrome',
        'edge': 'start msedge',
        'firefox': 'start firefox',
        'notepad': 'notepad',
        'calculator': 'calc',
        'explorer': 'explorer',
        'settings': 'start ms-settings:',
        'task-manager': 'taskmgr',
        'cmd': 'cmd',
        'powershell': 'powershell',
        'vscode': 'code'
      };

      const command = appCommands[appName.toLowerCase()] || `start ${appName}`;

      return new Promise((resolve) => {
        exec(command, { shell: 'cmd.exe' }, (error) => {
          if (error) {
            resolve({ success: false, error: `Could not launch ${appName}` });
          } else {
            resolve({ success: true, message: `Launched ${appName}` });
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerSystemInfoHandlers,
  getFriendlyAppName,
  formatUptime,
  FRIENDLY_APP_NAMES
};
