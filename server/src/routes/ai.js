/**
 * AI Proxy Routes
 * Secure proxy to Claude API
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('./auth');

const router = express.Router();

// Initialize Anthropic client
let anthropic = null;
if (process.env.CLAUDE_API_KEY) {
  anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// Rate limiting per user
const userRequestCounts = new Map();
const MAX_REQUESTS_PER_HOUR = 50;

function checkRateLimit(userId) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  let userData = userRequestCounts.get(userId);
  if (!userData) {
    userData = { requests: [] };
    userRequestCounts.set(userId, userData);
  }

  // Remove old requests
  userData.requests = userData.requests.filter(t => t > hourAgo);

  if (userData.requests.length >= MAX_REQUESTS_PER_HOUR) {
    return false;
  }

  userData.requests.push(now);
  return true;
}

/**
 * Chat with AI
 * POST /api/ai/chat
 */
router.post('/chat', requireAuth, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    const { message, conversationHistory, systemContext } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Check rate limit
    if (!checkRateLimit(req.user.email)) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: 3600,
      });
    }

    // Build messages array
    const messages = [];

    // Add conversation history if provided
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory.slice(-10)) { // Last 10 messages
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Build system prompt
    let systemPrompt = `You are Max, a friendly and helpful PC assistant. You help users with their Windows computer.

You can:
- Explain technical concepts in simple terms
- Help troubleshoot problems
- Suggest solutions and optimizations
- Guide users through steps

Be conversational, friendly, and helpful. If you're not sure about something, say so.`;

    if (systemContext) {
      systemPrompt += `\n\nCurrent system context:\n${JSON.stringify(systemContext, null, 2)}`;
    }

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const assistantMessage = response.content[0]?.text || 'I apologize, but I could not generate a response.';

    res.json({
      success: true,
      message: assistantMessage,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    });
  } catch (error) {
    console.error('AI chat error:', error);

    if (error.status === 429) {
      return res.status(429).json({
        error: 'AI service is busy. Please try again in a moment.',
        retryAfter: 60,
      });
    }

    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

/**
 * AI tool execution (for support staff)
 * POST /api/ai/tool
 */
router.post('/tool', requireAuth, async (req, res) => {
  try {
    if (!anthropic) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    // Only support staff can use AI tools
    if (!req.user.isSupport) {
      return res.status(403).json({ error: 'Support role required for tool access' });
    }

    const { message, systemState, tools } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Define available tools for support
    const supportTools = [
      {
        name: 'get_system_info',
        description: 'Get current system information',
        input_schema: {
          type: 'object',
          properties: {
            info_type: {
              type: 'string',
              enum: ['overview', 'cpu', 'memory', 'disk', 'processes'],
            },
          },
          required: ['info_type'],
        },
      },
      {
        name: 'run_diagnostic',
        description: 'Run a diagnostic check',
        input_schema: {
          type: 'object',
          properties: {
            check_type: {
              type: 'string',
              enum: ['health', 'storage', 'performance'],
            },
          },
          required: ['check_type'],
        },
      },
      {
        name: 'suggest_cleanup',
        description: 'Get cleanup suggestions',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    const systemPrompt = `You are helping a support technician assist a user with their PC.

Current system state:
${JSON.stringify(systemState, null, 2)}

Analyze the system and help the technician diagnose and resolve issues.
Use the available tools when needed to gather more information or take actions.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: supportTools,
    });

    // Process response
    const result = {
      success: true,
      content: [],
      toolCalls: [],
    };

    for (const block of response.content) {
      if (block.type === 'text') {
        result.content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        result.toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    res.json(result);
  } catch (error) {
    console.error('AI tool error:', error);
    res.status(500).json({ error: 'Failed to process AI tool request' });
  }
});

/**
 * Get AI status
 * GET /api/ai/status
 */
router.get('/status', (req, res) => {
  res.json({
    available: !!anthropic,
    model: 'claude-3-5-haiku-20241022',
    rateLimit: {
      maxPerHour: MAX_REQUESTS_PER_HOUR,
    },
  });
});

module.exports = router;
