/**
 * Secure Access Code Generation & Validation
 * For remote support sessions
 */

const crypto = require('crypto');

// Configuration
const CODE_LENGTH = 12;  // Increased from 6
const CODE_EXPIRY_MS = 30 * 60 * 1000;  // 30 minutes
const MAX_SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000;  // Absolute max: 4 hours (prevents indefinite extension)
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;  // 15 minutes after max attempts

// In-memory store for active sessions
const activeSessions = new Map();
const failedAttempts = new Map();

/**
 * Generate a cryptographically secure access code
 */
function generateAccessCode() {
  // Use crypto.randomBytes for secure randomness
  const bytes = crypto.randomBytes(9);  // 9 bytes = 12 base64 chars (roughly)

  // Convert to alphanumeric (easier to read/type)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // Removed confusing chars (0, O, I, 1)
  let code = '';

  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = bytes[i % bytes.length] % chars.length;
    code += chars[randomIndex];
  }

  // Format as XXX-XXX-XXX-XXX for readability
  return code.match(/.{1,3}/g).join('-');
}

/**
 * Create a new support session
 */
function createSession(metadata = {}) {
  const code = generateAccessCode();
  const sessionId = crypto.randomUUID();

  const session = {
    id: sessionId,
    code: code,
    codeNormalized: code.replace(/-/g, '').toUpperCase(),
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_EXPIRY_MS,
    authenticated: false,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    activity: [],
  };

  activeSessions.set(sessionId, session);

  // Clean up expired sessions periodically
  cleanupExpiredSessions();

  return {
    sessionId,
    code,
    expiresAt: session.expiresAt,
    expiresIn: CODE_EXPIRY_MS,
  };
}

/**
 * Validate an access code attempt
 */
function validateCode(inputCode, clientIp = 'unknown') {
  // Check for lockout
  const attemptKey = clientIp;
  const attempts = failedAttempts.get(attemptKey);

  if (attempts && attempts.count >= MAX_ATTEMPTS) {
    const lockoutRemaining = attempts.lockedUntil - Date.now();
    if (lockoutRemaining > 0) {
      return {
        valid: false,
        error: 'Too many failed attempts. Please try again later.',
        lockedOut: true,
        lockoutRemaining: Math.ceil(lockoutRemaining / 1000),
      };
    } else {
      // Lockout expired, reset
      failedAttempts.delete(attemptKey);
    }
  }

  // Normalize input
  const normalizedInput = inputCode.replace(/[-\s]/g, '').toUpperCase();

  // Find matching session
  for (const [sessionId, session] of activeSessions.entries()) {
    // Check expiry
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(sessionId);
      continue;
    }

    // Timing-safe comparison to prevent timing attacks
    const inputBuffer = Buffer.from(normalizedInput.padEnd(CODE_LENGTH, '\0'));
    const codeBuffer = Buffer.from(session.codeNormalized.padEnd(CODE_LENGTH, '\0'));

    if (crypto.timingSafeEqual(inputBuffer, codeBuffer)) {
      // Success - clear failed attempts
      failedAttempts.delete(attemptKey);

      session.authenticated = true;
      session.authenticatedAt = Date.now();
      session.authenticatedIp = clientIp;

      return {
        valid: true,
        sessionId: session.id,
        session: session,
      };
    }
  }

  // Failed attempt - track it
  const currentAttempts = failedAttempts.get(attemptKey) || { count: 0 };
  currentAttempts.count++;
  currentAttempts.lastAttempt = Date.now();

  if (currentAttempts.count >= MAX_ATTEMPTS) {
    currentAttempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }

  failedAttempts.set(attemptKey, currentAttempts);

  return {
    valid: false,
    error: 'Invalid access code',
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - currentAttempts.count),
  };
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  const session = activeSessions.get(sessionId);

  if (!session) {
    return null;
  }

  // Check expiry
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Extend session expiry (when actively being used)
 * Respects absolute max session lifetime
 */
function extendSession(sessionId, additionalMs = CODE_EXPIRY_MS) {
  const session = activeSessions.get(sessionId);

  if (session && Date.now() < session.expiresAt) {
    // Calculate absolute max expiry based on session creation time
    const absoluteMaxExpiry = session.createdAt + MAX_SESSION_LIFETIME_MS;
    const proposedExpiry = Date.now() + additionalMs;

    // Use the earlier of proposed expiry or absolute max
    session.expiresAt = Math.min(proposedExpiry, absoluteMaxExpiry);
    return true;
  }

  return false;
}

/**
 * Record activity in session (for audit)
 */
function recordActivity(sessionId, action, details = {}) {
  const session = activeSessions.get(sessionId);

  if (session) {
    session.activity.push({
      timestamp: new Date().toISOString(),
      action,
      details,
    });

    // Keep only last 100 activities
    if (session.activity.length > 100) {
      session.activity = session.activity.slice(-100);
    }
  }
}

/**
 * End a session
 */
function endSession(sessionId) {
  const session = activeSessions.get(sessionId);

  if (session) {
    session.endedAt = Date.now();
    session.activity.push({
      timestamp: new Date().toISOString(),
      action: 'session_ended',
    });

    // Keep for a bit for logging, then delete
    setTimeout(() => {
      activeSessions.delete(sessionId);
    }, 60000);  // Keep for 1 minute after ending

    return true;
  }

  return false;
}

/**
 * Get all active sessions (for dashboard)
 */
function getActiveSessions() {
  cleanupExpiredSessions();

  return Array.from(activeSessions.values()).map(session => ({
    id: session.id,
    createdAt: session.metadata.createdAt,
    expiresAt: new Date(session.expiresAt).toISOString(),
    authenticated: session.authenticated,
    activityCount: session.activity.length,
  }));
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(sessionId);
    }
  }

  // Also clean up old failed attempts
  for (const [key, attempts] of failedAttempts.entries()) {
    if (attempts.lockedUntil && now > attempts.lockedUntil + LOCKOUT_DURATION_MS) {
      failedAttempts.delete(key);
    }
  }
}

module.exports = {
  generateAccessCode,
  createSession,
  validateCode,
  getSession,
  extendSession,
  recordActivity,
  endSession,
  getActiveSessions,
  cleanupExpiredSessions,
  CODE_LENGTH,
  CODE_EXPIRY_MS,
  MAX_SESSION_LIFETIME_MS,
};
