/**
 * Support Routes
 * API endpoints for support dashboard
 */

const express = require('express');
const { requireAuth, requireSupport } = require('./auth');

const router = express.Router();

/**
 * Get active support sessions
 * GET /api/support/sessions
 */
router.get('/sessions', requireAuth, requireSupport, (req, res) => {
  try {
    const sessionManager = req.app.get('sessionManager');
    const sessions = sessionManager.getActiveSessions();

    res.json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * Get session details
 * GET /api/support/sessions/:id
 */
router.get('/sessions/:id', requireAuth, requireSupport, (req, res) => {
  try {
    const sessionManager = req.app.get('sessionManager');
    const session = sessionManager.getSession(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        status: session.status,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        systemInfo: session.systemInfo,
        userMessage: session.userMessage,
        messages: session.messages.slice(-50), // Last 50 messages
        hasSupport: !!session.supportWs,
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * End a support session
 * POST /api/support/sessions/:id/end
 */
router.post('/sessions/:id/end', requireAuth, requireSupport, (req, res) => {
  try {
    const sessionManager = req.app.get('sessionManager');
    const success = sessionManager.endSession(req.params.id);

    if (!success) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ success: true, message: 'Session ended' });
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * Get support dashboard stats
 * GET /api/support/stats
 */
router.get('/stats', requireAuth, requireSupport, (req, res) => {
  try {
    const sessionManager = req.app.get('sessionManager');
    const sessions = sessionManager.getActiveSessions();

    const stats = {
      activeSessions: sessions.length,
      waitingSessions: sessions.filter(s => s.status === 'waiting').length,
      connectedSessions: sessions.filter(s => s.status === 'active').length,
      timestamp: new Date().toISOString(),
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * Validate access code (for support staff to join)
 * POST /api/support/validate-code
 */
router.post('/validate-code', requireAuth, requireSupport, (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code required' });
    }

    const sessionManager = req.app.get('sessionManager');
    const clientIp = req.ip || req.connection.remoteAddress;
    const session = sessionManager.validateAccessCode(code, clientIp);

    if (!session) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    res.json({
      success: true,
      sessionId: session.id,
      systemInfo: session.systemInfo,
      userMessage: session.userMessage,
    });
  } catch (error) {
    console.error('Validate code error:', error);
    res.status(500).json({ error: 'Failed to validate code' });
  }
});

module.exports = router;
