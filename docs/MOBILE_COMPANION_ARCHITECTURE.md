# PC Utility Pro - Mobile Companion App Architecture

## Overview

A companion mobile app for iOS and Android that connects to PC Utility Pro running on a Windows PC, enabling remote monitoring, notifications, and basic control.

## Architecture Options

### Option A: React Native (Recommended)

**Pros:**
- Single codebase for iOS and Android
- JavaScript/TypeScript (consistent with Electron app)
- Large ecosystem and community
- Good performance for this use case

**Cons:**
- Requires native modules for some features
- Slightly larger app size

### Option B: Flutter

**Pros:**
- Excellent performance
- Beautiful UI out of the box
- Single codebase

**Cons:**
- Different language (Dart) from main app
- Separate skill set required

### Option C: Progressive Web App (PWA)

**Pros:**
- No app store approval needed
- Works on any device with a browser
- Easiest to implement
- Shares code with desktop app

**Cons:**
- Limited push notification support on iOS
- No background sync on iOS
- Less "native" feel

---

## Recommended: React Native + Local Network Communication

### Communication Protocol

```
┌─────────────────┐         WebSocket/HTTP         ┌─────────────────┐
│                 │◄──────────────────────────────►│                 │
│  Mobile App     │        Local Network           │  PC Utility Pro │
│  (React Native) │                                │  (Electron)     │
│                 │◄──────────────────────────────►│                 │
└─────────────────┘      Push Notifications        └─────────────────┘
                              (FCM/APNs)
```

### Desktop App Changes Required

Add a local API server to `main.js`:

```javascript
// New file: src/main/services/mobileApi.js

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

class MobileApiServer {
  constructor(port = 8878) {
    this.port = port;
    this.app = express();
    this.clients = new Set();
    this.pairingCode = null;
    this.pairedDevices = [];
  }

  start() {
    this.app.use(cors());
    this.app.use(express.json());

    // Pairing endpoint
    this.app.post('/api/pair', (req, res) => {
      const { code, deviceName } = req.body;
      if (code === this.pairingCode) {
        const deviceId = generateDeviceId();
        this.pairedDevices.push({ id: deviceId, name: deviceName });
        this.pairingCode = null;
        res.json({ success: true, deviceId });
      } else {
        res.status(401).json({ error: 'Invalid pairing code' });
      }
    });

    // Status endpoint
    this.app.get('/api/status', this.authenticate, async (req, res) => {
      const mood = await getPcMood();
      res.json(mood);
    });

    // Quick actions
    this.app.post('/api/action/:action', this.authenticate, async (req, res) => {
      // Handle cleanup, speed test, etc.
    });

    // WebSocket for real-time updates
    this.wss = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    });

    this.server = this.app.listen(this.port);
  }

  generatePairingCode() {
    this.pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setTimeout(() => { this.pairingCode = null; }, 300000); // 5 min expiry
    return this.pairingCode;
  }

  broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}
```

### Mobile App Structure

```
pc-utility-mobile/
├── src/
│   ├── screens/
│   │   ├── PairingScreen.tsx      # QR code / manual code entry
│   │   ├── DashboardScreen.tsx    # PC health overview
│   │   ├── SpeedTestScreen.tsx    # Remote speed test trigger
│   │   ├── CleanupScreen.tsx      # One-tap cleanup actions
│   │   └── SettingsScreen.tsx     # Notification preferences
│   ├── services/
│   │   ├── api.ts                 # HTTP client for PC API
│   │   ├── websocket.ts           # Real-time connection
│   │   ├── discovery.ts           # mDNS/Bonjour PC discovery
│   │   └── notifications.ts       # Push notification handling
│   ├── stores/
│   │   ├── connectionStore.ts     # Connection state (Zustand)
│   │   └── pcStatusStore.ts       # Cached PC status
│   └── components/
│       ├── HealthGauge.tsx        # Circular health indicator
│       ├── MetricCard.tsx         # CPU/RAM/Storage cards
│       └── ActionButton.tsx       # Quick action buttons
├── android/
├── ios/
└── package.json
```

### Key Features

#### 1. Pairing Flow
```
Mobile                              Desktop
  │                                    │
  │  1. User clicks "Add Mobile"       │
  │◄───────────────────────────────────┤ Shows 6-digit code + QR
  │                                    │
  │  2. Enter code or scan QR          │
  ├───────────────────────────────────►│
  │                                    │ Validates code
  │  3. Receive device token           │
  │◄───────────────────────────────────┤
  │                                    │
  │  4. Connected!                     │
  └────────────────────────────────────┘
```

#### 2. Dashboard View
- Real-time PC health score (via WebSocket)
- CPU/RAM/Storage usage gauges
- Active process count
- Last speed test results
- Quick action buttons

#### 3. Remote Actions
- Trigger disk cleanup (temp files, browser cache)
- Run speed test and view results
- View running apps
- Send reminder to PC (shows toast notification)

#### 4. Push Notifications
When the desktop app detects issues:
- Low disk space warning
- High CPU/RAM usage sustained
- Speed test completed (if triggered from mobile)
- Cleanup completed

### Network Discovery

Use mDNS/Bonjour for automatic PC discovery on local network:

```javascript
// Desktop: Advertise service
const bonjour = require('bonjour')();
bonjour.publish({
  name: 'PC Utility Pro',
  type: 'pcutility',
  port: 8878,
  txt: { version: '2.4.0', pcName: os.hostname() }
});

// Mobile: Discover services
import Zeroconf from 'react-native-zeroconf';
const zeroconf = new Zeroconf();
zeroconf.scan('pcutility', 'tcp');
zeroconf.on('found', service => {
  // Auto-populate IP address
});
```

### Security Considerations

1. **Local Network Only**: API only accepts connections from local network IPs
2. **Device Pairing**: One-time code required, stored device tokens
3. **Token Expiry**: Refresh tokens periodically
4. **HTTPS**: Use self-signed certificate for local HTTPS
5. **Rate Limiting**: Prevent brute-force pairing attempts

### Implementation Phases

#### Phase 1: MVP (2-3 weeks dev time)
- Basic pairing via manual code entry
- Dashboard with health score and metrics
- View-only mode (no remote actions)
- Local network WebSocket connection

#### Phase 2: Core Features
- Remote cleanup triggers
- Remote speed test
- Push notifications for alerts
- QR code pairing

#### Phase 3: Advanced
- mDNS auto-discovery
- Multiple PC support
- Historical data/charts
- Widget for home screen

---

## Alternative: PWA Approach (Simpler)

If native apps aren't required, a PWA is faster to implement:

### Desktop Changes
Add a web UI endpoint to the existing app:

```javascript
// Serve mobile-optimized web UI
app.use('/mobile', express.static(path.join(__dirname, 'mobile-ui')));
```

### Access Method
1. Open PC Utility Pro on desktop
2. Click "Mobile Access" - shows QR code with local URL
3. Scan QR on phone - opens mobile-optimized web interface
4. Optionally "Add to Home Screen" for app-like experience

### PWA Limitations
- No push notifications on iOS (major limitation)
- Must be on same WiFi network
- Browser must stay running (no true background)

---

## Recommendation

**For your use case, I recommend starting with React Native:**

1. It provides a native app experience users expect
2. Push notifications work reliably on both platforms
3. Can be expanded to include features PWAs can't support
4. TypeScript consistency with your Electron codebase
5. Easier to monetize through app stores if desired

**Next Steps:**
1. Add `mobileApi.js` service to desktop app
2. Create React Native project with Expo (easier setup)
3. Implement pairing flow
4. Build dashboard with real-time updates
5. Add push notification support via Firebase

Would you like me to implement the desktop-side mobile API service first?
