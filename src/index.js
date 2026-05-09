const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Proxies.sx proxy config
const PROXY_HOST = 'gate.proxies.sx';
const PROXY_PORT = '10000';
const PROXY_USER = 'J6aG3GD3QLuf4nDpCX71W2wFYTieJ6T9RtsXAuDhPFTE';
const PROXY_PASS = 'proxy123';

const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// x402 payment config
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || 'DemoWallet123';

// Helper: Extract x402 payment headers
function extractPayment(req) {
  const txHash = req.headers['x-payment-tx'] || req.headers['x-payment-hash'];
  const network = req.headers['x-payment-network'] || 'base';
  const amount = req.headers['x-payment-amount'];
  if (txHash) return { txHash, network, amount: amount ? parseFloat(amount) : 0 };
  return null;
}

// Helper: Build 402 response
function build402Response(description, price) {
  return {
    error: 'Payment required',
    message: description,
    price_USDC: price,
    wallet: WALLET_ADDRESS,
    instructions: {
      network: 'base',
      currency: 'USDC',
      amount: price,
      headers: {
        'x-payment-tx': '<your_transaction_hash>',
        'x-payment-network': 'base'
      }
    }
  };
}

// Fetch through proxy with retry
async function proxyFetch(url, retries = 2) {
  const proxyConfig = {
    host: PROXY_HOST,
    port: parseInt(PROXY_PORT),
    auth: { username: PROXY_USER, password: PROXY_PASS },
    protocol: 'http'
  };

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.get(url, {
        proxy: proxyConfig,
        timeout: 15000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        }
      });
      return response;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Parse SERP results from HTML
function parseSERP(html) {
  const $ = cheerio.load(html);
  const results = [];

  // Try new Google format first (VINE container)
  $('.g, .MjjYud, .vWNYee').each((i, el) => {
    if (i >= 20) return false;
    
    let title = '';
    let url = '';
    let snippet = '';

    // Title
    const titleEl = $(el).find('h3, [role="heading"]').first();
    title = titleEl.text().trim();
    
    // URL
    const linkEl = $(el).find('a[href]').first();
    url = linkEl.attr('href') || '';
    
    // Clean URL (remove Google redirect)
    if (url.includes('google.com/url')) {
      try {
        const params = new URL(url, 'https://www.google.com');
        url = params.searchParams.get('url') || url;
      } catch {}
    }

    // Snippet
    const snippetEl = $(el).find('.VwiC3b, .IsZvec, [data-sncf]').first();
    snippet = snippetEl.text().trim();
    
    // Fallback snippet
    if (!snippet) {
      snippet = $(el).find('span').filter((_, s) => $(s).text().length > 50).first().text().trim();
    }

    if (title && url && !url.startsWith('/')) {
      results.push({
        position: i + 1,
        title,
        url,
        snippet: snippet.substring(0, 300)
      });
    }
  });

  return results;
}

// SERP API endpoint
app.get('/api/serp', async (req, res) => {
  const { keyword, limit = 20 } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ error: 'Missing required parameter: keyword' });
  }

  // Check payment
  const payment = extractPayment(req);
  if (!payment || !payment.txHash) {
    return res.status(402).json(build402Response(
      `SERP tracking for "${keyword}"`,
      0.001
    ));
  }

  try {
    // Verify payment (simplified - in production verify on-chain)
    console.log(`[SERP] Payment received: ${payment.txHash} on ${payment.network}`);

    // Build Google search URL
    const encodedKeyword = encodeURIComponent(keyword);
    const googleUrl = `https://www.google.com/search?q=${encodedKeyword}&hl=en`;
    
    // Fetch through proxy
    const response = await proxyFetch(googleUrl);
    
    // Parse results
    const results = parseSERP(response.data);
    
    // Return results
    res.json({
      success: true,
      keyword,
      results: results.slice(0, parseInt(limit)),
      totalFound: results.length,
      timestamp: new Date().toISOString(),
      payment: {
        tx: payment.txHash,
        network: payment.network
      }
    });
  } catch (err) {
    console.error('[SERP] Error:', err.message);
    res.status(500).json({
      error: 'SERP fetch failed',
      message: err.message,
      tip: 'Try again in a few seconds'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'serp-tracker', timestamp: new Date().toISOString() });
});

// Service discovery
app.get('/', (req, res) => {
  res.json({
    service: 'serp-tracker',
    version: '1.0.0',
    description: 'Google SERP tracking via Proxies.sx mobile proxy network',
    endpoints: {
      'GET /api/serp': {
        params: { keyword: 'string (required)', limit: 'number (default: 20)' },
        price: '0.001 USDC',
        returns: 'Top 20 Google search results with position, title, URL, snippet'
      },
      'GET /health': 'Health check'
    },
    payment: {
      network: 'base',
      currency: 'USDC',
      wallet: WALLET_ADDRESS,
      headers: {
        'x-payment-tx': 'Transaction hash',
        'x-payment-network': 'base'
      }
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[SERP Tracker] Running on http://localhost:${PORT}`);
  console.log(`[SERP Tracker] Proxy: ${PROXY_HOST}:${PROXY_PORT}`);
});

module.exports = app;
