/**
 * Support Session Manager
 * Manages active support sessions with access codes
 */

const crypto = require('crypto');

const CODE_LENGTH = 12;
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

class SupportSessionManager {
  constructor() {
    this.sessions = new Map();
    this.codeAttempts = new Map();

    // Cleanup expired sessions every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Generate secure access code
   */
  generateAccessCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';

    for (let i = 0; i < CODE_LENGTH; i++) {
      code += chars[bytes[i] % chars.length];
    }

    // Format as XXX-XXX-XXX-XXX
    return code.match(/.{1,3}/g).join('-');
  }

  /**
   * Create a new support session
   */
  createSession({ connectionId, ws, systemInfo, userMessage }) {
    const sessionId = crypto.randomUUID();
    const accessCode = this.generateAccessCode();

    const session = {
      id: sessionId,
      accessCode,
      accessCodeNormalized: accessCode.replace(/-/g, ''),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_EXPIRY_MS,
      userConnectionId: connectionId,
      userWs: ws,
      supportConnectionId: null,
      supportWs: null,
      systemInfo,
      userMessage,
      messages: [],
      status: 'waiting', // waiting, active, ended
    };

    this.sessions.set(sessionId, session);

    return {
      id: sessionId,
      accessCode,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate access code with rate limiting
   */
  validateAccessCode(inputCode, clientIp = 'unknown') {
    // Check lockout
    const attempts = this.codeAttempts.get(clientIp);
    if (attempts && attempts.count >= MAX_CODE_ATTEMPTS) {
      if (Date.now() < attempts.lockedUntil) {
        return null; // Still locked out
      }
      this.codeAttempts.delete(clientIp);
    }

    const normalizedInput = inputCode.replace(/[-\s]/g, '').toUpperCase();

    // Find matching session
    for (const [sessionId, session] of this.sessions) {
      if (Date.now() > session.expiresAt) {
        this.sessions.delete(sessionId);
        continue;
      }

      // Timing-safe comparison
      if (normalizedInput.length === session.accessCodeNormalized.length) {
        const inputBuf = Buffer.from(normalizedInput);
        const codeBuf = Buffer.from(session.accessCodeNormalized);

        if (crypto.timingSafeEqual(inputBuf, codeBuf)) {
          // Clear failed attempts on success
          this.codeAttempts.delete(clientIp);
          return session;
        }
      }
    }

    // Track failed attempt
    const currentAttempts = this.codeAttempts.get(clientIp) || { count: 0 };
    currentAttempts.count++;
    if (currentAttempts.count >= MAX_CODE_ATTEMPTS) {
      currentAttempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    this.codeAttempts.set(clientIp, currentAttempts);

    return null;
  }

  /**
   * Connect support staff to a session
   */
  connectSupport(sessionId, { connectionId, ws }) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.supportConnectionId = connectionId;
    session.supportWs = ws;
    session.status = 'active';
    session.supportConnectedAt = Date.now();

    return true;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Extend session expiry
   */
  extendSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'active') {
      session.expiresAt = Date.now() + SESSION_EXPIRY_MS;
      return true;
    }
    return false;
  }

  /**
   * Add message to session log
   */
  addMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      // Keep last 500 messages
      if (session.messages.length > 500) {
        session.messages = session.messages.slice(-500);
      }
    }
  }

  /**
   * End a session
   */
  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'ended';
      session.endedAt = Date.now();

      // Keep for a bit for logging, then delete
      setTimeout(() => {
        this.sessions.delete(sessionId);
      }, 5 * 60 * 1000); // 5 minutes

      return true;
    }
    return false;
  }

  /**
   * Get all active sessions (for dashboard)
   */
  getActiveSessions() {
    const active = [];
    for (const [id, session] of this.sessions) {
      if (session.status !== 'ended' && Date.now() < session.expiresAt) {
        active.push({
          id,
          status: session.status,
          createdAt: new Date(session.createdAt).toISOString(),
          expiresAt: new Date(session.expiresAt).toISOString(),
          hasSupport: !!session.supportWs,
          messageCount: session.messages.length,
          systemSummary: session.systemInfo?.summary || 'Unknown',
        });
      }
    }
    return active;
  }

  /**
   * Cleanup expired sessions
   */
  cleanup() {
    const now = Date.now();

    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt + 60000) { // Grace period
        this.sessions.delete(id);
      }
    }

    for (const [ip, attempts] of this.codeAttempts) {
      if (attempts.lockedUntil && now > attempts.lockedUntil + LOCKOUT_DURATION_MS) {
        this.codeAttempts.delete(ip);
      }
    }
  }
}

module.exports = { SupportSessionManager };
