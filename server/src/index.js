/**
 * PC Utility Pro - Relay Server
 * Handles secure remote support, auth, and AI proxy
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const authRouter = require('./routes/auth');
const aiRouter = require('./routes/ai');
const supportRouter = require('./routes/support');
const { SupportSessionManager } = require('./services/supportSessions');

const app = express();
const server = http.createServer(app);

// WebSocket server for real-time communication
const wss = new WebSocket.Server({ server, path: '/ws' });

// Initialize support session manager
const sessionManager = new SupportSessionManager();

// Make session manager available to routes
app.set('sessionManager', sessionManager);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: { error: 'Too many authentication attempts, please try again later.' },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/ai', aiRouter);
app.use('/api/support', supportRouter);

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const connectionId = uuidv4();
  let clientType = null; // 'user' or 'support'
  let sessionId = null;
  let authenticated = false;

  console.log(`[WS] New connection: ${connectionId}`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        // User's PC connecting to request support
        case 'user:connect': {
          const session = sessionManager.createSession({
            connectionId,
            ws,
            systemInfo: message.systemInfo,
            userMessage: message.message,
          });

          clientType = 'user';
          sessionId = session.id;
          authenticated = true;

          ws.send(JSON.stringify({
            type: 'session:created',
            sessionId: session.id,
            accessCode: session.accessCode,
            expiresAt: session.expiresAt,
          }));

          console.log(`[WS] User session created: ${session.id}`);
          break;
        }

        // Support staff authenticating to a session
        case 'support:auth': {
          const { code, token } = message;

          // Verify JWT token for support staff
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (!decoded.isSupport) {
              throw new Error('Not authorized as support');
            }
          } catch (e) {
            ws.send(JSON.stringify({
              type: 'auth:failed',
              error: 'Invalid or expired authentication',
            }));
            return;
          }

          // Validate access code
          const session = sessionManager.validateAccessCode(code);
          if (!session) {
            ws.send(JSON.stringify({
              type: 'auth:failed',
              error: 'Invalid or expired access code',
            }));
            return;
          }

          // Connect support to session
          sessionManager.connectSupport(session.id, { connectionId, ws });
          clientType = 'support';
          sessionId = session.id;
          authenticated = true;

          ws.send(JSON.stringify({
            type: 'auth:success',
            sessionId: session.id,
            systemInfo: session.systemInfo,
            userMessage: session.userMessage,
          }));

          // Notify user that support has connected
          session.userWs?.send(JSON.stringify({
            type: 'support:connected',
            message: 'Support has connected to help you!',
          }));

          console.log(`[WS] Support connected to session: ${session.id}`);
          break;
        }

        // Chat message (either direction)
        case 'chat:message': {
          if (!authenticated || !sessionId) {
            ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
            return;
          }

          const session = sessionManager.getSession(sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', error: 'Session expired' }));
            return;
          }

          // Relay message to the other party
          const targetWs = clientType === 'user' ? session.supportWs : session.userWs;
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify({
              type: 'chat:message',
              from: clientType,
              content: message.content,
              timestamp: new Date().toISOString(),
            }));
          }

          // Log the message
          sessionManager.addMessage(sessionId, {
            from: clientType,
            content: message.content,
            timestamp: new Date().toISOString(),
          });

          break;
        }

        // Command request from support to user's PC
        case 'command:request': {
          if (clientType !== 'support' || !authenticated) {
            ws.send(JSON.stringify({ type: 'error', error: 'Not authorized' }));
            return;
          }

          const session = sessionManager.getSession(sessionId);
          if (!session || !session.userWs) {
            ws.send(JSON.stringify({ type: 'error', error: 'User not connected' }));
            return;
          }

          // Forward command request to user's PC
          session.userWs.send(JSON.stringify({
            type: 'command:request',
            commandId: message.commandId,
            tool: message.tool,
            params: message.params,
          }));

          break;
        }

        // Command response from user's PC
        case 'command:response': {
          if (clientType !== 'user' || !authenticated) {
            ws.send(JSON.stringify({ type: 'error', error: 'Not authorized' }));
            return;
          }

          const session = sessionManager.getSession(sessionId);
          if (!session || !session.supportWs) {
            return; // Support disconnected, ignore
          }

          // Forward response to support
          session.supportWs.send(JSON.stringify({
            type: 'command:response',
            commandId: message.commandId,
            result: message.result,
            error: message.error,
          }));

          break;
        }

        // Ping/pong for keepalive
        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          if (sessionId) {
            sessionManager.extendSession(sessionId);
          }
          break;
        }

        default:
          console.log(`[WS] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[WS] Message error:', error);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Connection closed: ${connectionId}`);

    if (sessionId) {
      const session = sessionManager.getSession(sessionId);
      if (session) {
        if (clientType === 'user') {
          // Notify support that user disconnected
          session.supportWs?.send(JSON.stringify({
            type: 'user:disconnected',
            message: 'User has disconnected',
          }));
          sessionManager.endSession(sessionId);
        } else if (clientType === 'support') {
          // Notify user that support disconnected
          session.userWs?.send(JSON.stringify({
            type: 'support:disconnected',
            message: 'Support has disconnected',
          }));
          session.supportWs = null;
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[WS] Connection error ${connectionId}:`, error);
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PC Utility Pro Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
