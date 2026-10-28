// NEXUS AGENTS — Backend Proxy
// Keeps your Anthropic API key safe on the server. The frontend
// (nexus-agents-live.html) talks to THIS server, never to
// api.anthropic.com directly. That's the only safe way to ship
// a real, deployable app to end users.

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); // In production, restrict this to your app's real domain.
app.use(express.json({ limit: '2mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

if (!ANTHROPIC_API_KEY) {
  console.error('⚠️  ANTHROPIC_API_KEY is missing. Set it in a .env file (see .env.example).');
  process.exit(1);
}

// --- Simple in-memory rate limiting per IP (swap for Redis in real production) ---
const rateBuckets = new Map();
const RATE_LIMIT = 30;        // requests
const RATE_WINDOW_MS = 60000; // per 60 seconds

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter(ts => now - ts < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

// --- Main chat proxy endpoint ---
app.post('/api/chat', async (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'تجاوزت عدد الطلبات المسموح. حاول بعد قليل.' });
  }

  const { system, messages, max_tokens } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(max_tokens || 1000, 4096),
        system: system || undefined,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'فشل الاتصال بخادم Claude: ' + err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ NEXUS backend running on http://localhost:${PORT}`));
