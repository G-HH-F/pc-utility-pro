/**
 * Handlers Index
 * Central export for all IPC handler modules
 */

const { registerCleanupHandlers } = require('./cleanupHandlers');
const { registerSystemInfoHandlers, getFriendlyAppName, formatUptime } = require('./systemInfoHandlers');

/**
 * Register all modular handlers
 * @param {Object} dependencies - Shared dependencies (auditLogger, etc.)
 */
function registerAllHandlers(dependencies = {}) {
  const { auditLogger } = dependencies;

  // Register cleanup handlers
  registerCleanupHandlers(auditLogger);

  // Register system info handlers
  registerSystemInfoHandlers();

  console.log('[Handlers] All modular handlers registered');
}

module.exports = {
  registerAllHandlers,
  // Re-export utilities for use in main.js
  getFriendlyAppName,
  formatUptime
};
