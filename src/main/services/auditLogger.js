/**
 * Audit Logger
 * Logs all sensitive operations for security and accountability
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class AuditLogger {
  constructor() {
    this.logDir = null;
    this.currentLogFile = null;
    this.buffer = [];
    this.flushInterval = null;
    this.maxLogAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    this.maxLogSize = 10 * 1024 * 1024; // 10MB per file
    this.initialized = false;
  }

  /**
   * Initialize the audit logger (called after app is ready)
   */
  init() {
    if (this.initialized) return;

    try {
      this.logDir = path.join(app.getPath('userData'), 'audit-logs');

      // Create log directory if it doesn't exist
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }

      // Set current log file
      this.rotateLogFile();

      // Flush buffer every 5 seconds
      this.flushInterval = setInterval(() => this.flush(), 5000);

      // Clean old logs on startup
      this.cleanOldLogs();

      this.initialized = true;
    } catch (e) {
      console.error('[AuditLogger] Init error:', e.message);
    }
  }

  /**
   * Rotate to a new log file
   */
  rotateLogFile() {
    const date = new Date().toISOString().split('T')[0];
    this.currentLogFile = path.join(this.logDir, `audit-${date}.jsonl`);
  }

  /**
   * Log an action
   */
  log(category, action, details = {}) {
    // Ensure we're initialized (lazy init after app is ready)
    if (!this.initialized) {
      this.init();
    }

    const entry = {
      timestamp: new Date().toISOString(),
      category,
      action,
      details,
      pid: process.pid,
    };

    this.buffer.push(JSON.stringify(entry));

    // Immediate flush for critical actions
    if (category === 'security' || category === 'remote') {
      this.flush();
    }
  }

  /**
   * Log categories with convenience methods
   */

  // File operations
  fileRead(filePath, source = 'unknown') {
    this.log('file', 'read', { path: filePath, source });
  }

  fileWrite(filePath, source = 'unknown') {
    this.log('file', 'write', { path: filePath, source });
  }

  fileDelete(filePath, source = 'unknown') {
    this.log('file', 'delete', { path: filePath, source });
  }

  fileMove(from, to, source = 'unknown') {
    this.log('file', 'move', { from, to, source });
  }

  // Command execution
  commandExecuted(command, source = 'unknown', allowed = true) {
    this.log('command', 'execute', { command, source, allowed });
  }

  commandBlocked(command, reason, source = 'unknown') {
    this.log('security', 'command_blocked', { command, reason, source });
  }

  // Remote support
  supportSessionStarted(sessionId, accessCode) {
    this.log('remote', 'session_start', {
      sessionId,
      accessCodePrefix: accessCode?.substring(0, 4) + '***'
    });
  }

  supportSessionEnded(sessionId, duration) {
    this.log('remote', 'session_end', { sessionId, durationMs: duration });
  }

  remoteCommandReceived(sessionId, tool, params) {
    this.log('remote', 'command_received', {
      sessionId,
      tool,
      params: this.sanitizeParams(params)
    });
  }

  supportConnected(sessionId) {
    this.log('remote', 'support_connected', { sessionId });
  }

  // AI operations
  aiToolUsed(tool, params, source = 'ai_assistant') {
    this.log('ai', 'tool_used', {
      tool,
      params: this.sanitizeParams(params),
      source
    });
  }

  aiChatMessage(role, contentLength) {
    this.log('ai', 'chat', { role, contentLength });
  }

  // Security events
  pathAccessDenied(path, reason) {
    this.log('security', 'path_denied', { path, reason });
  }

  authAttempt(success, method, details = {}) {
    this.log('security', 'auth_attempt', { success, method, ...details });
  }

  rateLimitHit(action, identifier) {
    this.log('security', 'rate_limit', { action, identifier });
  }

  // App lifecycle
  appStarted() {
    this.log('app', 'started', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    });
  }

  appClosed() {
    this.log('app', 'closed', {});
    this.flush(); // Ensure final flush
  }

  // Cleanup operations
  cleanupPerformed(type, result) {
    this.log('cleanup', type, result);
  }

  /**
   * Sanitize parameters to avoid logging sensitive data
   */
  sanitizeParams(params) {
    if (!params) return {};

    const sanitized = { ...params };

    // Remove or mask sensitive fields
    const sensitiveFields = ['password', 'token', 'key', 'secret', 'credential', 'auth'];
    for (const field of sensitiveFields) {
      for (const key of Object.keys(sanitized)) {
        if (key.toLowerCase().includes(field)) {
          sanitized[key] = '***REDACTED***';
        }
      }
    }

    // Truncate long content
    for (const key of Object.keys(sanitized)) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 200) {
        sanitized[key] = sanitized[key].substring(0, 200) + '...[truncated]';
      }
    }

    return sanitized;
  }

  /**
   * Flush buffer to disk
   */
  flush() {
    if (this.buffer.length === 0) return;

    try {
      // Check if we need to rotate
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size > this.maxLogSize) {
          this.rotateLogFile();
        }
      }

      // Append to log file
      const content = this.buffer.join('\n') + '\n';
      fs.appendFileSync(this.currentLogFile, content);
      this.buffer = [];
    } catch (e) {
      console.error('[AuditLogger] Flush error:', e);
    }
  }

  /**
   * Clean old log files
   */
  cleanOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.startsWith('audit-')) continue;

        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > this.maxLogAge) {
          fs.unlinkSync(filePath);
          console.log(`[AuditLogger] Deleted old log: ${file}`);
        }
      }
    } catch (e) {
      console.error('[AuditLogger] Cleanup error:', e);
    }
  }

  /**
   * Get recent log entries
   */
  getRecentEntries(count = 100, category = null) {
    try {
      const entries = [];
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('audit-'))
        .sort()
        .reverse();

      for (const file of files) {
        if (entries.length >= count) break;

        const content = fs.readFileSync(path.join(this.logDir, file), 'utf8');
        const lines = content.trim().split('\n').reverse();

        for (const line of lines) {
          if (entries.length >= count) break;
          try {
            const entry = JSON.parse(line);
            if (!category || entry.category === category) {
              entries.push(entry);
            }
          } catch (e) {
            // Skip malformed lines
          }
        }
      }

      return entries;
    } catch (e) {
      console.error('[AuditLogger] Read error:', e);
      return [];
    }
  }

  /**
   * Export logs for a date range
   */
  exportLogs(startDate, endDate) {
    const entries = [];
    const files = fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('audit-'))
      .sort();

    for (const file of files) {
      const fileDate = file.replace('audit-', '').replace('.jsonl', '');
      if (fileDate >= startDate && fileDate <= endDate) {
        const content = fs.readFileSync(path.join(this.logDir, file), 'utf8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch (e) {
            // Skip malformed
          }
        }
      }
    }

    return entries;
  }

  /**
   * Shutdown the logger
   */
  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

// Singleton instance
let instance = null;

function getAuditLogger() {
  if (!instance) {
    instance = new AuditLogger();
  }
  return instance;
}

module.exports = { AuditLogger, getAuditLogger };
