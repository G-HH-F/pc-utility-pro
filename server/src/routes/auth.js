/**
 * Authentication Routes
 * Magic link email authentication
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const router = express.Router();

// In-memory store for magic links (use Redis in production)
const magicLinks = new Map();
const MAGIC_LINK_EXPIRY = 15 * 60 * 1000; // 15 minutes

// Admin emails that can act as support
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

// Email transporter
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Request magic link
 * POST /api/auth/magic-link
 */
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if this email is allowed (for support role)
    const isSupport = ADMIN_EMAILS.includes(normalizedEmail);

    // Generate magic token
    const token = crypto.randomBytes(32).toString('hex');

    magicLinks.set(token, {
      email: normalizedEmail,
      isSupport,
      createdAt: Date.now(),
      expiresAt: Date.now() + MAGIC_LINK_EXPIRY,
    });

    // Clean up expired links
    setTimeout(() => magicLinks.delete(token), MAGIC_LINK_EXPIRY);

    // Build magic link URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const magicUrl = `${baseUrl}/auth/verify?token=${token}`;

    // Send email
    if (transporter) {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'PC Utility Pro <noreply@pcutilitypro.com>',
        to: normalizedEmail,
        subject: 'Sign in to PC Utility Pro',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Sign in to PC Utility Pro</h2>
            <p>Click the button below to sign in. This link expires in 15 minutes.</p>
            <a href="${magicUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px;">
              If you didn't request this, you can safely ignore this email.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 12px;">PC Utility Pro</p>
          </div>
        `,
        text: `Sign in to PC Utility Pro\n\nClick this link to sign in: ${magicUrl}\n\nThis link expires in 15 minutes.`,
      });

      res.json({ success: true, message: 'Check your email for the sign-in link' });
    } else {
      // Dev mode - return token directly
      console.log(`[Auth] Magic link for ${normalizedEmail}: ${magicUrl}`);
      res.json({
        success: true,
        message: 'Magic link generated (dev mode)',
        devToken: token,
        devUrl: magicUrl,
      });
    }
  } catch (error) {
    console.error('Magic link error:', error);
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

/**
 * Verify magic link and get JWT
 * GET /api/auth/verify?token=xxx
 */
router.get('/verify', (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const linkData = magicLinks.get(token);

    if (!linkData) {
      return res.status(400).json({ error: 'Invalid or expired link' });
    }

    if (Date.now() > linkData.expiresAt) {
      magicLinks.delete(token);
      return res.status(400).json({ error: 'Link has expired' });
    }

    // Delete the magic link (one-time use)
    magicLinks.delete(token);

    // Generate JWT
    const jwtToken = jwt.sign(
      {
        email: linkData.email,
        isSupport: linkData.isSupport,
        iat: Math.floor(Date.now() / 1000),
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token: jwtToken,
      email: linkData.email,
      isSupport: linkData.isSupport,
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * Verify JWT token
 * POST /api/auth/verify-token
 */
router.post('/verify-token', (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    res.json({
      valid: true,
      email: decoded.email,
      isSupport: decoded.isSupport,
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    });
  } catch (error) {
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

/**
 * Middleware to verify JWT from Authorization header
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to require support role
 */
function requireSupport(req, res, next) {
  if (!req.user?.isSupport) {
    return res.status(403).json({ error: 'Support role required' });
  }
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireSupport = requireSupport;
