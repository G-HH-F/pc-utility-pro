# PC Utility Pro - Production Deployment Guide

This guide covers deploying PC Utility Pro for production use with all security features enabled.

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────────┐
│  User's PC      │   WSS   │   Relay Server       │
│  (Electron App) │◄───────►│   (Node.js)          │
└─────────────────┘         │                      │
                            │  - WebSocket relay   │
┌─────────────────┐   WSS   │  - Auth (magic link) │
│  Support Staff  │◄───────►│  - AI proxy          │
│  (Web Dashboard)│         │  - Session mgmt      │
└─────────────────┘         └──────────────────────┘
```

## 1. Deploy the Relay Server

### Option A: Railway (Recommended - $5/mo)

```bash
cd server

# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set environment variables in Railway dashboard
```

### Option B: Fly.io

```bash
cd server

# Install Fly CLI and login
fly auth login

# Create app
fly launch --name pc-utility-relay

# Set secrets
fly secrets set JWT_SECRET="your-secure-secret"
fly secrets set CLAUDE_API_KEY="your-claude-key"
fly secrets set ADMIN_EMAILS="your@email.com"

# Deploy
fly deploy
```

### Option C: VPS (DigitalOcean, Linode, etc.)

```bash
# On your VPS
git clone your-repo
cd pc-utility-pro/server

# Install dependencies
npm install

# Setup PM2
npm install -g pm2

# Create .env file
cp .env.example .env
nano .env  # Edit with your values

# Start with PM2
pm2 start src/index.js --name pc-utility-server
pm2 save
pm2 startup
```

### Required Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production

# Authentication
JWT_SECRET=generate-a-secure-64-char-random-string

# Claude API (for AI proxy)
CLAUDE_API_KEY=sk-ant-...

# Email (for magic links)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=PC Utility Pro <noreply@yourdomain.com>

# Admin emails (support staff who can login)
ADMIN_EMAILS=admin@example.com,support@example.com

# CORS
ALLOWED_ORIGINS=https://support.yourdomain.com
```

### SSL/HTTPS

For production, always use HTTPS. Most platforms handle this automatically:

- **Railway**: Automatic SSL
- **Fly.io**: Automatic SSL
- **VPS**: Use Caddy or nginx with Let's Encrypt

```nginx
# nginx example
server {
    listen 443 ssl;
    server_name support.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/support.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/support.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 2. Configure the Electron App

Update `config.json` for your users:

```json
{
  "claudeApiKey": "",
  "pushoverUser": "",
  "pushoverToken": "",
  "supportContactName": "Your Support Team",
  "relayServerUrl": "wss://your-relay-server.com/ws",
  "useRelayServer": true,
  "autoCheckUpdates": true
}
```

### API Key Strategy

Choose one:

**A) Users provide their own key:**
- Leave `claudeApiKey` empty in config
- Add settings UI for users to enter their key
- Zero cost to you

**B) You provide via relay server:**
- Set `CLAUDE_API_KEY` on the server
- App proxies AI requests through your server
- You control usage/costs

**C) Hybrid (Recommended):**
- Free tier uses your key with limits
- Power users can add their own key

## 3. Build & Distribute

### Install Dependencies

```bash
# Main app
npm install

# Build for Windows
npm run build:win
```

### Code Signing (Recommended)

To avoid "Unknown publisher" warnings:

1. Purchase a code signing certificate (~$200-400/year)
   - DigiCert, Sectigo, or Comodo

2. Configure electron-builder:

```json
// package.json
{
  "build": {
    "win": {
      "certificateFile": "path/to/cert.pfx",
      "certificatePassword": "your-password"
    }
  }
}
```

3. Or use Azure SignTool / SignPath.io

### Auto-Updates

The app is configured for GitHub Releases:

```json
// package.json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "pc-utility-pro"
    }
  }
}
```

To publish an update:

```bash
# Bump version
npm version patch  # or minor, major

# Build and publish
npm run build:win

# Upload to GitHub Releases (or use electron-builder publish)
```

## 4. Support Dashboard

Access at: `https://your-relay-server.com/`

1. Enter your admin email
2. Check email for magic link
3. Click to authenticate
4. View active sessions
5. Enter access code to connect to user

## 5. Security Checklist

Before going live:

- [ ] JWT_SECRET is a secure random string (64+ chars)
- [ ] ADMIN_EMAILS only contains trusted support staff
- [ ] HTTPS is enabled (no HTTP in production)
- [ ] CORS is configured for your domains only
- [ ] Rate limiting is in place (default: 100 req/15min)
- [ ] Code signing certificate installed
- [ ] Tested the full support flow end-to-end

## 6. Monitoring (Optional)

### Logging

The relay server logs to stdout. Capture with:

```bash
# PM2
pm2 logs pc-utility-server

# Docker
docker logs -f pc-utility-server
```

### Uptime Monitoring

Use a free service like:
- UptimeRobot
- Freshping
- Pingdom (free tier)

Monitor: `https://your-relay-server.com/health`

## 7. Cost Summary

| Item | Monthly Cost |
|------|--------------|
| Relay Server (Railway/Fly.io) | $5-10 |
| Domain Name | ~$1 |
| Claude API (if proxying) | $10-50 |
| Code Signing Certificate | ~$25/mo amortized |
| **Total** | **~$40-90/month** |

## Troubleshooting

### WebSocket Connection Fails

1. Check CORS settings include your domain
2. Ensure WSS (not WS) in production
3. Check firewall allows WebSocket connections

### Magic Link Not Received

1. Check SMTP credentials
2. Check spam folder
3. Try a different email provider (SendGrid, Mailgun)

### Access Code Invalid

1. Codes expire after 30 minutes
2. Max 5 failed attempts triggers 15min lockout
3. Check session hasn't ended on user side

### AI Not Responding

1. Verify CLAUDE_API_KEY is set
2. Check API quota/billing
3. Review server logs for errors

## Support

For issues with this deployment:
- Open a GitHub issue
- Email: support@pcutilitypro.com
