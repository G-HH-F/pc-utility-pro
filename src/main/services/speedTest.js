/**
 * Advanced Speed Test Module
 * Comprehensive network testing with bufferbloat detection
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Test server endpoints
const TEST_SERVERS = [
  { name: 'Cloudflare', ping: 'https://speed.cloudflare.com/__down?bytes=1000', download: 'https://speed.cloudflare.com/__down?bytes=104857600', upload: 'https://speed.cloudflare.com/__up' },
  { name: 'Google', ping: 'https://www.google.com/generate_204', download: null, upload: null },
  { name: 'Cloudflare-backup', ping: 'https://1.1.1.1', download: 'https://speed.cloudflare.com/__down?bytes=26214400', upload: null },
];

// Quality thresholds
const QUALITY_THRESHOLDS = {
  ping: { excellent: 20, good: 50, fair: 100, poor: 200 },
  jitter: { excellent: 5, good: 15, fair: 30, poor: 50 },
  download: { excellent: 100, good: 50, fair: 25, poor: 10 },
  upload: { excellent: 50, good: 25, fair: 10, poor: 5 },
  bufferbloat: { excellent: 10, good: 30, fair: 100, poor: 200 },
  packetLoss: { excellent: 0, good: 1, fair: 3, poor: 5 },
};

/**
 * Calculate jitter from ping samples
 */
function calculateJitter(samples) {
  if (samples.length < 2) return 0;
  let totalVariation = 0;
  for (let i = 1; i < samples.length; i++) {
    totalVariation += Math.abs(samples[i] - samples[i - 1]);
  }
  return totalVariation / (samples.length - 1);
}

/**
 * Get quality grade based on value and metric type
 */
function getGrade(value, metric) {
  const thresholds = QUALITY_THRESHOLDS[metric];
  if (!thresholds) return { grade: 'N/A', color: '#888' };

  // For metrics where lower is better (ping, jitter, bufferbloat, packetLoss)
  const lowerIsBetter = ['ping', 'jitter', 'bufferbloat', 'packetLoss'].includes(metric);

  if (lowerIsBetter) {
    if (value <= thresholds.excellent) return { grade: 'A+', color: '#00ff88', label: 'Excellent' };
    if (value <= thresholds.good) return { grade: 'A', color: '#88ff00', label: 'Good' };
    if (value <= thresholds.fair) return { grade: 'B', color: '#ffcc00', label: 'Fair' };
    if (value <= thresholds.poor) return { grade: 'C', color: '#ff8800', label: 'Poor' };
    return { grade: 'D', color: '#ff4444', label: 'Bad' };
  } else {
    // For metrics where higher is better (download, upload)
    if (value >= thresholds.excellent) return { grade: 'A+', color: '#00ff88', label: 'Excellent' };
    if (value >= thresholds.good) return { grade: 'A', color: '#88ff00', label: 'Good' };
    if (value >= thresholds.fair) return { grade: 'B', color: '#ffcc00', label: 'Fair' };
    if (value >= thresholds.poor) return { grade: 'C', color: '#ff8800', label: 'Poor' };
    return { grade: 'D', color: '#ff4444', label: 'Bad' };
  }
}

/**
 * Calculate overall connection score (0-100)
 */
function calculateOverallScore(results) {
  let score = 100;
  const weights = { ping: 15, jitter: 10, download: 30, upload: 20, bufferbloat: 15, packetLoss: 10 };

  // Ping scoring (0-20ms = 100%, 200ms+ = 0%)
  if (results.ping !== '--') {
    const pingScore = Math.max(0, 100 - (results.ping / 2));
    score -= weights.ping * (1 - pingScore / 100);
  }

  // Jitter scoring (0-5ms = 100%, 50ms+ = 0%)
  if (results.jitter !== '--') {
    const jitterScore = Math.max(0, 100 - (results.jitter * 2));
    score -= weights.jitter * (1 - jitterScore / 100);
  }

  // Download scoring (100+ Mbps = 100%, <10 = proportional)
  if (results.download !== '--') {
    const dlScore = Math.min(100, results.download);
    score -= weights.download * (1 - dlScore / 100);
  }

  // Upload scoring (50+ Mbps = 100%)
  if (results.upload !== '--') {
    const ulScore = Math.min(100, results.upload * 2);
    score -= weights.upload * (1 - ulScore / 100);
  }

  // Bufferbloat scoring (0-10ms = 100%, 200ms+ = 0%)
  if (results.bufferbloat !== '--') {
    const bbScore = Math.max(0, 100 - (results.bufferbloat / 2));
    score -= weights.bufferbloat * (1 - bbScore / 100);
  }

  // Packet loss scoring (0% = 100%, 5%+ = 0%)
  if (results.packetLoss !== '--') {
    const plScore = Math.max(0, 100 - (results.packetLoss * 20));
    score -= weights.packetLoss * (1 - plScore / 100);
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Get connection type recommendation based on results
 */
function getConnectionAnalysis(results) {
  const issues = [];
  const recommendations = [];

  if (results.ping > 100) {
    issues.push('High latency detected');
    recommendations.push('Consider using a wired connection instead of WiFi');
  }

  if (results.jitter > 30) {
    issues.push('Unstable connection (high jitter)');
    recommendations.push('Check for network congestion or interference');
  }

  if (results.bufferbloat > 100) {
    issues.push('Bufferbloat detected - network queuing causing lag');
    recommendations.push('Enable SQM/QoS on your router if available');
    recommendations.push('Consider upgrading router firmware');
  }

  if (results.packetLoss > 2) {
    issues.push('Packet loss detected');
    recommendations.push('Check cable connections');
    recommendations.push('Contact ISP if problem persists');
  }

  if (results.download < 25) {
    issues.push('Slow download speed');
    if (results.download < 10) {
      recommendations.push('Speed may be insufficient for 4K streaming');
    }
  }

  if (results.upload < 5) {
    issues.push('Low upload speed');
    recommendations.push('Video calls and uploads may be affected');
  }

  // Determine use case suitability (use <= for thresholds to be inclusive)
  const suitability = {
    gaming: results.ping <= 50 && results.jitter <= 15 && results.bufferbloat <= 50,
    streaming4k: results.download >= 25,
    streaming1080p: results.download >= 10,
    videoCalls: results.upload >= 3 && results.ping <= 100 && results.jitter <= 30,
    workFromHome: results.download >= 25 && results.upload >= 5 && results.ping <= 100,
    cloudGaming: results.ping <= 40 && results.jitter <= 10 && results.download >= 35,
  };

  return { issues, recommendations, suitability };
}

/**
 * Perform latency test with multiple samples for accuracy
 */
async function testLatency(progressCallback) {
  const samples = [];
  const sampleCount = 15; // More samples for accurate jitter measurement
  let failed = 0;

  progressCallback?.({ phase: 'ping', progress: 0, percent: 0, message: 'Testing latency...' });

  for (let i = 0; i < sampleCount; i++) {
    try {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const req = https.get('https://speed.cloudflare.com/__down?bytes=1', { timeout: 5000 }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      const latency = Date.now() - start;
      samples.push(latency);
    } catch (e) {
      failed++;
    }

    const progress = ((i + 1) / sampleCount) * 100;
    const currentPing = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : '--';
    progressCallback?.({
      phase: 'ping',
      progress,
      percent: progress * 0.25, // 0-25% of total test
      message: `Ping: ${currentPing} ms (${i + 1}/${sampleCount})`
    });

    // Small delay between samples
    await new Promise(r => setTimeout(r, 150));
  }

  if (samples.length === 0) {
    return { ping: '--', jitter: '--', packetLoss: '--', samples: [] };
  }

  const avgPing = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const jitter = Math.round(calculateJitter(samples) * 10) / 10;
  const packetLoss = Math.round((failed / sampleCount) * 100 * 10) / 10;

  progressCallback?.({
    phase: 'ping',
    progress: 100,
    percent: 25,
    message: `Latency: ${avgPing} ms, Jitter: ${jitter} ms`
  });

  return { ping: avgPing, jitter, packetLoss, samples };
}

/**
 * Perform download speed test with extended duration for accuracy
 * Runs for minimum 10 seconds to get stable results like professional speed tests
 */
async function testDownload(progressCallback) {
  progressCallback?.({ phase: 'download', progress: 0, message: 'Testing download speed...', percent: 25 });

  const MIN_TEST_DURATION = 10000; // 10 seconds minimum
  const MAX_TEST_DURATION = 20000; // 20 seconds maximum
  const testStartTime = Date.now();

  let totalBytes = 0;
  const speedSamples = [];
  let iteration = 0;

  // Keep downloading until we have enough data for accurate measurement
  while (Date.now() - testStartTime < MAX_TEST_DURATION) {
    iteration++;
    // Use larger chunks for faster connections
    const chunkSize = iteration === 1 ? 5242880 : 26214400; // 5MB warm-up, then 25MB chunks

    try {
      const url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}`;
      const chunkStartTime = Date.now();
      let bytesReceived = 0;

      await new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 30000 }, (res) => {
          res.on('data', (chunk) => {
            bytesReceived += chunk.length;
            totalBytes += chunk.length;

            const totalElapsed = (Date.now() - testStartTime) / 1000;
            const currentSpeed = (totalBytes * 8 / totalElapsed / 1000000).toFixed(1);
            const progress = Math.min(95, (totalElapsed / (MIN_TEST_DURATION / 1000)) * 100);

            progressCallback?.({
              phase: 'download',
              progress,
              percent: 25 + (progress * 0.25), // 25-50% of total test
              message: `Download: ${currentSpeed} Mbps`,
              currentSpeed: parseFloat(currentSpeed)
            });
          });
          res.on('end', resolve);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });

      const chunkElapsed = (Date.now() - chunkStartTime) / 1000;
      if (bytesReceived > 0 && chunkElapsed > 0) {
        speedSamples.push((bytesReceived * 8 / chunkElapsed / 1000000));
      }

      // Check if we've run long enough
      if (Date.now() - testStartTime >= MIN_TEST_DURATION && speedSamples.length >= 2) {
        break;
      }
    } catch (e) {
      console.log(`Download chunk ${iteration} failed:`, e.message);
      // Continue testing even if one chunk fails
      if (Date.now() - testStartTime >= MIN_TEST_DURATION) break;
    }
  }

  if (speedSamples.length === 0) {
    return { download: '--', downloadSamples: [] };
  }

  // Calculate average, excluding outliers (use median-like approach)
  speedSamples.sort((a, b) => a - b);
  const trimmed = speedSamples.length > 2
    ? speedSamples.slice(1, -1)  // Remove highest and lowest
    : speedSamples;

  const avgSpeed = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length * 10) / 10;
  const testDuration = Math.round((Date.now() - testStartTime) / 1000);

  progressCallback?.({
    phase: 'download',
    progress: 100,
    percent: 50,
    message: `Download complete: ${avgSpeed} Mbps (${testDuration}s)`
  });

  return { download: avgSpeed, downloadSamples: speedSamples, downloadDuration: testDuration };
}

/**
 * Perform upload speed test with extended duration for accuracy
 * Runs for minimum 8 seconds to get stable results
 */
async function testUpload(progressCallback) {
  progressCallback?.({ phase: 'upload', progress: 0, message: 'Testing upload speed...', percent: 50 });

  const MIN_TEST_DURATION = 8000; // 8 seconds minimum
  const MAX_TEST_DURATION = 15000; // 15 seconds maximum
  const testStartTime = Date.now();

  let totalBytes = 0;
  const speedSamples = [];
  let iteration = 0;

  // Pre-generate upload data (reuse to save memory)
  const uploadData = Buffer.alloc(2097152, 'x'); // 2MB buffer

  while (Date.now() - testStartTime < MAX_TEST_DURATION) {
    iteration++;
    // Start with smaller uploads, scale up
    const size = iteration === 1 ? 1048576 : 2097152; // 1MB warm-up, then 2MB
    const data = uploadData.slice(0, size);

    try {
      const chunkStartTime = Date.now();

      await new Promise((resolve, reject) => {
        const url = new URL('https://speed.cloudflare.com/__up');
        const options = {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': data.length,
          },
          timeout: 30000,
        };

        const req = https.request(options, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

        // Send data in chunks for progress tracking
        const chunkSize = 65536;
        let sent = 0;
        const sendChunk = () => {
          while (sent < data.length) {
            const chunk = data.slice(sent, Math.min(sent + chunkSize, data.length));
            const canContinue = req.write(chunk);
            sent += chunk.length;
            totalBytes += chunk.length;

            const totalElapsed = (Date.now() - testStartTime) / 1000;
            const currentSpeed = totalElapsed > 0 ? (totalBytes * 8 / totalElapsed / 1000000).toFixed(1) : '0';
            const progress = Math.min(95, (totalElapsed / (MIN_TEST_DURATION / 1000)) * 100);

            progressCallback?.({
              phase: 'upload',
              progress,
              percent: 50 + (progress * 0.25), // 50-75% of total test
              message: `Upload: ${currentSpeed} Mbps`,
              currentSpeed: parseFloat(currentSpeed)
            });

            if (!canContinue) {
              req.once('drain', sendChunk);
              return;
            }
          }
          req.end();
        };
        sendChunk();
      });

      const chunkElapsed = (Date.now() - chunkStartTime) / 1000;
      if (chunkElapsed > 0 && size > 0) {
        speedSamples.push((size * 8 / chunkElapsed / 1000000));
      }

      // Check if we've run long enough
      if (Date.now() - testStartTime >= MIN_TEST_DURATION && speedSamples.length >= 2) {
        break;
      }
    } catch (e) {
      console.log(`Upload chunk ${iteration} failed:`, e.message);
      if (Date.now() - testStartTime >= MIN_TEST_DURATION) break;
    }
  }

  if (speedSamples.length === 0) {
    return { upload: '--', uploadSamples: [] };
  }

  // Calculate average, excluding outliers
  speedSamples.sort((a, b) => a - b);
  const trimmed = speedSamples.length > 2
    ? speedSamples.slice(1, -1)
    : speedSamples;

  const avgSpeed = Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length * 10) / 10;
  const testDuration = Math.round((Date.now() - testStartTime) / 1000);

  progressCallback?.({
    phase: 'upload',
    progress: 100,
    percent: 75,
    message: `Upload complete: ${avgSpeed} Mbps (${testDuration}s)`
  });

  return { upload: avgSpeed, uploadSamples: speedSamples, uploadDuration: testDuration };
}

/**
 * Perform bufferbloat test (ping during load)
 * Measures latency increase when network is under heavy load
 */
async function testBufferbloat(baselinePing, progressCallback) {
  progressCallback?.({ phase: 'bufferbloat', progress: 0, percent: 75, message: 'Testing bufferbloat...' });

  if (baselinePing === '--') {
    return { bufferbloat: '--', loadedPing: '--' };
  }

  // Start a download in background and measure ping during load
  const pingSamples = [];
  let downloadActive = true;

  // Start background download (larger file for sustained load)
  const downloadPromise = new Promise((resolve) => {
    const req = https.get('https://speed.cloudflare.com/__down?bytes=104857600', { timeout: 20000 }, (res) => {
      res.on('data', () => {});
      res.on('end', () => { downloadActive = false; resolve(); });
      res.on('error', () => { downloadActive = false; resolve(); });
    });
    req.on('error', () => { downloadActive = false; resolve(); });
    req.on('timeout', () => { req.destroy(); downloadActive = false; resolve(); });

    // Timeout after 12 seconds
    setTimeout(() => {
      if (downloadActive) {
        req.destroy();
        downloadActive = false;
        resolve();
      }
    }, 12000);
  });

  // Measure ping during download
  const pingInterval = 250;
  const maxSamples = 40;
  let samplesTaken = 0;

  while (downloadActive && samplesTaken < maxSamples) {
    try {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const req = https.get('https://1.1.1.1', { timeout: 2000 }, (res) => {
          res.destroy();
          resolve();
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      pingSamples.push(Date.now() - start);
    } catch (e) {
      // Ignore failed pings during load test
    }
    samplesTaken++;

    const progress = (samplesTaken / maxSamples) * 100;
    const currentLoadedPing = pingSamples.length > 0 ? Math.round(pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length) : '--';
    progressCallback?.({
      phase: 'bufferbloat',
      progress,
      percent: 75 + (progress * 0.25), // 75-100% of total test
      message: `Bufferbloat: ${currentLoadedPing}ms under load`
    });
    await new Promise(r => setTimeout(r, pingInterval));
  }

  await downloadPromise;

  if (pingSamples.length === 0) {
    return { bufferbloat: '--', loadedPing: '--' };
  }

  const loadedPing = Math.round(pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length);
  const bufferbloat = Math.max(0, loadedPing - baselinePing);

  return { bufferbloat, loadedPing };
}

/**
 * Run complete speed test
 */
async function runSpeedTest(progressCallback) {
  const startTime = Date.now();
  const results = {};

  try {
    // Phase 1: Latency test
    const latencyResults = await testLatency(progressCallback);
    results.ping = latencyResults.ping;
    results.jitter = latencyResults.jitter;
    results.packetLoss = latencyResults.packetLoss;
    results.pingSamples = latencyResults.samples;

    // Phase 2: Download test
    const downloadResults = await testDownload(progressCallback);
    results.download = downloadResults.download;
    results.downloadSamples = downloadResults.downloadSamples;

    // Phase 3: Upload test
    const uploadResults = await testUpload(progressCallback);
    results.upload = uploadResults.upload;
    results.uploadSamples = uploadResults.uploadSamples;

    // Phase 4: Bufferbloat test
    const bufferbloatResults = await testBufferbloat(results.ping, progressCallback);
    results.bufferbloat = bufferbloatResults.bufferbloat;
    results.loadedPing = bufferbloatResults.loadedPing;

    // Calculate grades
    results.grades = {
      ping: getGrade(results.ping, 'ping'),
      jitter: getGrade(results.jitter, 'jitter'),
      download: getGrade(results.download, 'download'),
      upload: getGrade(results.upload, 'upload'),
      bufferbloat: getGrade(results.bufferbloat, 'bufferbloat'),
      packetLoss: getGrade(results.packetLoss, 'packetLoss'),
    };

    // Calculate overall score
    results.overallScore = calculateOverallScore(results);
    results.overallGrade = results.overallScore >= 90 ? 'A+' :
                          results.overallScore >= 80 ? 'A' :
                          results.overallScore >= 70 ? 'B' :
                          results.overallScore >= 60 ? 'C' :
                          results.overallScore >= 50 ? 'D' : 'F';

    // Get analysis
    const analysis = getConnectionAnalysis(results);
    results.issues = analysis.issues;
    results.recommendations = analysis.recommendations;
    results.suitability = analysis.suitability;

    results.testDuration = Math.round((Date.now() - startTime) / 1000);
    results.timestamp = new Date().toISOString();
    results.success = true;

    progressCallback?.({ phase: 'complete', progress: 100, message: 'Test complete!' });

  } catch (error) {
    console.error('Speed test error:', error);
    results.success = false;
    results.error = error.message;
  }

  return results;
}

module.exports = {
  runSpeedTest,
  testLatency,
  testDownload,
  testUpload,
  testBufferbloat,
  getGrade,
  calculateOverallScore,
  QUALITY_THRESHOLDS,
};
