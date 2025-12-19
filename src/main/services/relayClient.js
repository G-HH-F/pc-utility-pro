/**
 * Relay Server WebSocket Client
 * Handles connection to the support relay server
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

class RelayClient extends EventEmitter {
  constructor(serverUrl) {
    super();
    this.serverUrl = serverUrl;
    this.ws = null;
    this.sessionId = null;
    this.accessCode = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.pingInterval = null;
  }

  /**
   * Connect to relay server
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
          console.log('[RelayClient] Connected to relay server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (e) {
            console.error('[RelayClient] Invalid message:', e);
          }
        });

        this.ws.on('close', () => {
          console.log('[RelayClient] Connection closed');
          this.connected = false;
          this.stopPingInterval();
          this.emit('disconnected');
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[RelayClient] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages
   */
  handleMessage(message) {
    switch (message.type) {
      case 'session:created':
        this.sessionId = message.sessionId;
        this.accessCode = message.accessCode;
        this.emit('session:created', {
          sessionId: message.sessionId,
          accessCode: message.accessCode,
          expiresAt: message.expiresAt,
        });
        break;

      case 'support:connected':
        this.emit('support:connected', message);
        break;

      case 'support:disconnected':
        this.emit('support:disconnected', message);
        break;

      case 'chat:message':
        this.emit('chat:message', {
          from: message.from,
          content: message.content,
          timestamp: message.timestamp,
        });
        break;

      case 'command:request':
        this.emit('command:request', {
          commandId: message.commandId,
          tool: message.tool,
          params: message.params,
        });
        break;

      case 'pong':
        // Heartbeat acknowledged
        break;

      case 'error':
        this.emit('error', new Error(message.error));
        break;

      default:
        console.log('[RelayClient] Unknown message type:', message.type);
    }
  }

  /**
   * Request support (creates session)
   */
  requestSupport(systemInfo, userMessage) {
    if (!this.connected) {
      throw new Error('Not connected to relay server');
    }

    this.send({
      type: 'user:connect',
      systemInfo,
      message: userMessage,
    });
  }

  /**
   * Send chat message
   */
  sendChatMessage(content) {
    if (!this.connected || !this.sessionId) {
      throw new Error('No active session');
    }

    this.send({
      type: 'chat:message',
      content,
    });
  }

  /**
   * Send command response
   */
  sendCommandResponse(commandId, result, error = null) {
    this.send({
      type: 'command:response',
      commandId,
      result,
      error,
    });
  }

  /**
   * Send message to server
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Start ping interval for keepalive
   */
  startPingInterval() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt reconnection
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[RelayClient] Max reconnect attempts reached');
      this.emit('reconnect:failed');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[RelayClient] Reconnecting (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Will retry on close
      });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.sessionId = null;
    this.accessCode = null;
  }

  /**
   * Get current session info
   */
  getSessionInfo() {
    return {
      connected: this.connected,
      sessionId: this.sessionId,
      accessCode: this.accessCode,
    };
  }
}

module.exports = { RelayClient };
