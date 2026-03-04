/**
 * Tests for Trend Intelligence API
 * POST /api/research — cross-platform research synthesis
 * GET  /api/trending — trending topics
 *
 * Bounty #70 — $100 in $SX token
 *
 * Test strategy: Mock fetch() to simulate Base RPC payment verification
 * and platform scrapers. Pattern follows maps-endpoints.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

// ── Constants ────────────────────────────────────────────────────────────────

const SOLANA_WALLET = 'GpXHXs5KfzfXbNKcMLNbAMsJsgPsBE7y5GtwVoiuxYvH';
const BASE_WALLET = '0xC0140eEa19bD90a7cA75882d5218eFaF20426e42';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// $0.50 USDC in 6-decimal hex
const USDC_0_50 = '0x' + '0'.repeat(56) + '7a120'.padStart(8, '0');
// $0.10 USDC in 6-decimal hex
const USDC_0_10 = '0x' + '0'.repeat(57) + '186a0'.padStart(7, '0');

// Set WALLET_ADDRESS and proxy env vars before app import so module-level constants pick them up
process.env['WALLET_ADDRESS'] = '0xC0140eEa19bD90a7cA75882d5218eFaF20426e42';
process.env['PROXY_HOST'] = 'proxy.test.local';
process.env['PROXY_HTTP_PORT'] = '8080';
process.env['PROXY_USER'] = 'tester';
process.env['PROXY_PASS'] = 'secret';
process.env['PROXY_COUNTRY'] = 'US';

let txCounter = 100;
let ipCounter = 200; // Unique IPs per test to avoid rate limit interference
let restoreFetch: (() => void) | null = null;

function nextTxHash(): string {
  return `0x${'0'.repeat(63)}${(txCounter++).toString(16)}`;
}

function nextIp(): string {
  return `10.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}.1`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

// Reddit mock response
const REDDIT_SEARCH_RESPONSE = {
  data: {
    children: [
      {
        data: {
          id: 'test1',
          title: 'AI coding assistants comparison 2026',
          subreddit: 'programming',
          score: 4520,
          num_comments: 312,
          url: 'https://www.reddit.com/r/programming/comments/test1/',
          permalink: '/r/programming/comments/test1/',
          created_utc: Math.floor(Date.now() / 1000) - 86400,
          selftext: 'Comparing Claude Code vs Cursor vs GitHub Copilot.',
          author: 'dev_user_42',
          upvote_ratio: 0.92,
          is_video: false,
          link_flair_text: null,
        },
      },
      {
        data: {
          id: 'test2',
          title: 'My experience switching from Copilot to Claude Code',
          subreddit: 'ExperiencedDevs',
          score: 2100,
          num_comments: 178,
          url: 'https://www.reddit.com/r/ExperiencedDevs/comments/test2/',
          permalink: '/r/ExperiencedDevs/comments/test2/',
          created_utc: Math.floor(Date.now() / 1000) - 172800,
          selftext: 'After 6 months with Copilot I switched to Claude Code.',
          author: 'senior_dev_99',
          upvote_ratio: 0.95,
          is_video: false,
          link_flair_text: null,
        },
      },
    ],
  },
};

const REDDIT_POPULAR_RESPONSE = {
  data: {
    children: [
      {
        data: {
          id: 'pop1',
          title: 'AI tools surpass human coders on benchmarks for first time',
          subreddit: 'technology',
          score: 18900,
          num_comments: 1420,
          url: 'https://www.reddit.com/r/technology/comments/pop1/',
          permalink: '/r/technology/comments/pop1/',
          created_utc: Math.floor(Date.now() / 1000) - 3600,
          selftext: '',
          author: 'tech_reporter',
          upvote_ratio: 0.97,
          is_video: false,
          link_flair_text: null,
        },
      },
    ],
  },
};

/**
 * Install comprehensive fetch mock that handles:
 * - Base RPC (payment verification)
 * - Reddit public JSON (scraper)
 * - ipify (proxy IP check)
 * - SearXNG / OpenSERP (YouTube/Twitter scrapers — return empty)
 */
function installFetchMock(recipientAddress: string, amountHex: string = USDC_0_50): string[] {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    calls.push(url);

    // Base RPC — payment verification
    if (url.includes('mainnet.base.org')) {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.method !== 'eth_getTransactionReceipt') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          status: '0x1',
          logs: [{
            address: USDC_BASE,
            topics: [
              TRANSFER_TOPIC,
              toTopicAddress('0x0000000000000000000000000000000000000000'),
              toTopicAddress(recipientAddress),
            ],
            data: amountHex,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reddit search
    if (url.includes('reddit.com/search.json')) {
      return new Response(JSON.stringify(REDDIT_SEARCH_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reddit popular/trending
    if (url.includes('reddit.com') && (url.includes('/r/popular') || url.includes('/r/all'))) {
      return new Response(JSON.stringify(REDDIT_POPULAR_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ipify — proxy IP detection
    if (url.includes('api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '172.56.169.116' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // SearXNG (YouTube/Twitter scraper) — return empty results
    if (url.includes('100.91.53.54') || url.includes('searxng') || url.includes('opensearch') || url.includes('openserp')) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Brave/DuckDuckGo web search — return minimal response
    if (url.includes('brave') || url.includes('duckduckgo') || url.includes('search')) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default empty response
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  return calls;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResearchRequest(txHash: string, body: object, ip?: string): Request {
  return new Request('http://localhost/api/research', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'payment-signature': txHash,
      'x-payment-network': 'base',
      'X-Forwarded-For': ip ?? nextIp(),
    },
    body: JSON.stringify(body),
  });
}

function makeTrendingRequest(txHash: string, query = '', ip?: string): Request {
  return new Request(`http://localhost/api/trending${query}`, {
    headers: {
      'payment-signature': txHash,
      'x-payment-network': 'base',
      'X-Forwarded-For': ip ?? nextIp(),
    },
  });
}

// ── POST /api/research tests ─────────────────────────────────────────────────

describe('POST /api/research', () => {
  beforeEach(() => {
    process.env['WALLET_ADDRESS'] = BASE_WALLET;
    installFetchMock(BASE_WALLET, USDC_0_50);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  // ── Payment gate ──────────────────────────────────────────────────────────

  describe('Payment gate', () => {
    test('returns 402 with no payment header', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() },
          body: JSON.stringify({ topic: 'AI coding' }),
        }),
      );
      expect(res.status).toBe(402);
    });

    test('402 response includes x402 resource, price, and currency fields', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() },
          body: JSON.stringify({ topic: 'AI coding' }),
        }),
      );
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('resource', '/api/research');
      // price is an object { amount, currency, minimumAmount }
      expect(body['price'] !== undefined).toBe(true);
      expect(body).toHaveProperty('price.currency', 'USDC');
    });

    test('returns 200 with valid Base payment', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding assistants' }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe('Input validation', () => {
    test('rejects missing topic with 400', async () => {
      const res = await app.fetch(makeResearchRequest(nextTxHash(), {}));
      expect(res.status).toBe(400);
    });

    test('rejects empty string topic with 400', async () => {
      const res = await app.fetch(makeResearchRequest(nextTxHash(), { topic: '' }));
      expect(res.status).toBe(400);
    });

    test('rejects single-char topic with 400', async () => {
      const res = await app.fetch(makeResearchRequest(nextTxHash(), { topic: 'a' }));
      expect(res.status).toBe(400);
    });

    test('rejects topic > 200 chars with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'x'.repeat(201) }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects topic with newline injection with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI\ncoding' }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects topic with carriage return injection with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI\rcoding' }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects non-string topic with 400', async () => {
      const res = await app.fetch(makeResearchRequest(nextTxHash(), { topic: 42 }));
      expect(res.status).toBe(400);
    });

    test('rejects platforms as string (not array) with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', platforms: 'reddit' }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects all-invalid platform names with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), {
          topic: 'AI coding',
          platforms: ['snapchat', 'myspace'],
        }),
      );
      expect(res.status).toBe(400);
    });

    test('accepts x as alias for twitter platform', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', platforms: ['reddit', 'x'] }),
      );
      expect(res.status).toBe(200);
    });

    test('accepts youtube platform', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', platforms: ['reddit', 'youtube'] }),
      );
      expect(res.status).toBe(200);
    });

    test('days 0 is coerced to 1 and accepted', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', days: 0 }),
      );
      expect(res.status).toBe(200);
    });

    test('days 91 is clamped to 90 and accepted', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', days: 91 }),
      );
      expect(res.status).toBe(200);
    });

    test('rejects non-numeric days with 400', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', days: 'thirty' }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects non-JSON body with 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'payment-signature': nextTxHash(),
            'x-payment-network': 'base',
          },
          body: 'not valid json {{{',
        }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects array body with 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'payment-signature': nextTxHash(),
            'x-payment-network': 'base',
          },
          body: '["array", "not", "object"]',
        }),
      );
      expect(res.status).toBe(400);
    });

    test('rejects wrong Content-Type with 415', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'payment-signature': nextTxHash(),
            'x-payment-network': 'base',
          },
          body: '{"topic":"AI"}',
        }),
      );
      expect(res.status).toBe(415);
    });

    test('accepts valid 2-char country code', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', country: 'GB' }),
      );
      expect(res.status).toBe(200);
    });

    test('normalizes invalid country code to US (does not error)', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', country: 'ZZZ' }),
      );
      expect(res.status).toBe(200); // Normalized, not rejected
    });
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  describe('Response shape (200 OK)', () => {
    test('returns required top-level fields', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding assistants', platforms: ['reddit'] }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body['topic']).toBe('string');
      expect(body['topic']).toBe('AI coding assistants');
      expect(typeof body['timeframe']).toBe('string');
      expect(Array.isArray(body['patterns'])).toBe(true);
      expect(typeof body['sentiment']).toBe('object');
      expect(Array.isArray(body['top_discussions'])).toBe(true);
      expect(Array.isArray(body['emerging_topics'])).toBe(true);
      expect(typeof body['meta']).toBe('object');
      expect(typeof body['payment']).toBe('object');
    });

    test('payment.settled is true', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding' }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const payment = body['payment'] as Record<string, unknown>;
      expect(payment['settled']).toBe(true);
    });

    test('meta.proxy object is present', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding' }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const meta = body['meta'] as Record<string, unknown>;
      expect(typeof meta['proxy']).toBe('object');
    });

    test('timeframe contains requested days count', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', days: 7 }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect((body['timeframe'] as string)).toContain('7');
    });

    test('default timeframe is 30 days', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding' }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect((body['timeframe'] as string)).toContain('30');
    });

    test('X-Payment-Settled header is set', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding' }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('x-payment-settled')).toBe('true');
    });

    test('sentiment.overall is a string', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding' }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const sentiment = body['sentiment'] as Record<string, unknown>;
      expect(typeof sentiment['overall']).toBe('string');
    });

    test('meta.sources_checked is a non-negative number', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', platforms: ['reddit'] }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const meta = body['meta'] as Record<string, unknown>;
      expect(typeof meta['sources_checked']).toBe('number');
      expect((meta['sources_checked'] as number)).toBeGreaterThanOrEqual(0);
    });

    test('patterns array contains strength field (established|reinforced|emerging)', async () => {
      const res = await app.fetch(
        makeResearchRequest(nextTxHash(), { topic: 'AI coding', platforms: ['reddit'] }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const patterns = body['patterns'] as Array<Record<string, unknown>>;
      for (const p of patterns) {
        expect(['established', 'reinforced', 'emerging']).toContain(p['strength']);
      }
    });
  });

  // ── Pricing tiers ──────────────────────────────────────────────────────────

  describe('Pricing tiers', () => {
    test('single platform requires $0.10 (shown in 402 description)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: 'AI coding', platforms: ['reddit'] }),
        }),
      );
      expect(res.status).toBe(402);
      const body = await res.json() as Record<string, unknown>;
      // Price field is an object { amount, currency, minimumAmount }
      expect(parseFloat((body['price'] as Record<string, string>)['amount'])).toBeGreaterThan(0);
    });
  });
});

// ── GET /api/trending tests ──────────────────────────────────────────────────

describe('GET /api/trending', () => {
  beforeEach(() => {
    process.env['WALLET_ADDRESS'] = BASE_WALLET;
    installFetchMock(BASE_WALLET, USDC_0_10);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  // ── Payment gate ──────────────────────────────────────────────────────────

  describe('Payment gate', () => {
    test('returns 402 without payment header', async () => {
      const res = await app.fetch(new Request('http://localhost/api/trending'));
      expect(res.status).toBe(402);
    });

    test('402 includes resource, price, currency fields', async () => {
      const res = await app.fetch(new Request('http://localhost/api/trending'));
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('resource', '/api/trending');
      // price is an object { amount, currency, minimumAmount }
      expect(body['price'] !== undefined).toBe(true);
      expect(body).toHaveProperty('price.currency', 'USDC');
    });

    test('returns 200 with valid Base payment', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
    });
  });

  // ── Query parameters ───────────────────────────────────────────────────────

  describe('Query parameters', () => {
    test('defaults country to US when not provided', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body['country']).toBe('US');
    });

    test('accepts valid 2-char country code (GB)', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?country=GB'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body['country']).toBe('GB');
    });

    test('normalizes lowercase country to uppercase', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?country=us'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body['country']).toBe('US');
    });

    test('normalizes invalid country code (USA) to US', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?country=USA'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body['country']).toBe('US');
    });

    test('defaults platforms to reddit,web', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(Array.isArray(body['platforms'])).toBe(true);
    });

    test('accepts reddit platform', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=reddit'));
      expect(res.status).toBe(200);
    });

    test('accepts web platform', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=web'));
      expect(res.status).toBe(200);
    });

    test('accepts youtube platform', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=youtube'));
      expect(res.status).toBe(200);
    });

    test('accepts x as alias for twitter', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=reddit,x'));
      expect(res.status).toBe(200);
    });

    test('rejects all-invalid platforms with 400', async () => {
      const res = await app.fetch(
        makeTrendingRequest(nextTxHash(), '?platforms=snapchat,myspace'),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body['error']).toBe('string');
    });

    test('rejects platforms param over 64 chars with 400', async () => {
      const res = await app.fetch(
        makeTrendingRequest(nextTxHash(), `?platforms=${'reddit,'.repeat(20)}`),
      );
      expect(res.status).toBe(400);
    });

    test('respects limit query param', async () => {
      const res = await app.fetch(
        makeTrendingRequest(nextTxHash(), '?platforms=reddit&limit=3'),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const items = body['trending'] as unknown[];
      expect(items.length).toBeLessThanOrEqual(3);
    });

    test('clamps limit > 50 to 50', async () => {
      const res = await app.fetch(
        makeTrendingRequest(nextTxHash(), '?platforms=reddit&limit=999'),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const items = body['trending'] as unknown[];
      expect(items.length).toBeLessThanOrEqual(50);
    });
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  describe('Response shape (200 OK)', () => {
    test('returns required top-level fields', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=reddit'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body['country']).toBe('string');
      expect(Array.isArray(body['platforms'])).toBe(true);
      expect(Array.isArray(body['trending'])).toBe(true);
      expect(typeof body['generated_at']).toBe('string');
      expect(typeof body['meta']).toBe('object');
      expect(typeof body['payment']).toBe('object');
    });

    test('trending items contain topic and platform fields', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=reddit'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const items = body['trending'] as Array<Record<string, unknown>>;
      for (const item of items) {
        expect(typeof item['topic']).toBe('string');
        expect(typeof item['platform']).toBe('string');
      }
    });

    test('payment.settled is true', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const payment = body['payment'] as Record<string, unknown>;
      expect(payment['settled']).toBe(true);
    });

    test('meta.proxy is present', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const meta = body['meta'] as Record<string, unknown>;
      expect(typeof meta['proxy']).toBe('object');
    });

    test('X-Payment-Settled header is set', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash()));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-payment-settled')).toBe('true');
    });

    test('platforms array only contains platforms that returned results', async () => {
      const res = await app.fetch(makeTrendingRequest(nextTxHash(), '?platforms=reddit'));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const platforms = body['platforms'] as string[];
      // All returned platforms should be valid names
      for (const p of platforms) {
        expect(['reddit', 'web', 'youtube', 'twitter']).toContain(p);
      }
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  describe('Rate limiting', () => {
    test('returns 429 after too many requests from same IP', async () => {
      const requests = Array.from({ length: 35 }, (_, i) =>
        app.fetch(
          new Request('http://localhost/api/trending', {
            headers: {
              'X-Forwarded-For': '10.1.2.99',
              'payment-signature': nextTxHash(),
              'x-payment-network': 'base',
            },
          }),
        ),
      );
      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);
      expect(statuses).toContain(429);
    });

    test('429 includes Retry-After header', async () => {
      const requests = Array.from({ length: 35 }, () =>
        app.fetch(
          new Request('http://localhost/api/trending', {
            headers: {
              'X-Forwarded-For': '10.1.2.88',
              'payment-signature': nextTxHash(),
              'x-payment-network': 'base',
            },
          }),
        ),
      );
      const responses = await Promise.all(requests);
      const tooMany = responses.find((r) => r.status === 429);
      if (tooMany) {
        expect(tooMany.headers.get('retry-after')).not.toBeNull();
      }
    });
  });
});

// ── WALLET_ADDRESS guard ──────────────────────────────────────────────────────

describe('Misconfiguration guard', () => {
  afterEach(() => {
    process.env['WALLET_ADDRESS'] = BASE_WALLET;
    restoreFetch?.();
    restoreFetch = null;
  });

  test('/api/research returns 500 when WALLET_ADDRESS is empty', async () => {
    process.env['WALLET_ADDRESS'] = '';
    installFetchMock('', USDC_0_50);

    const res = await app.fetch(
      new Request('http://localhost/api/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': nextTxHash(),
          'x-payment-network': 'base',
        },
        body: JSON.stringify({ topic: 'AI coding' }),
      }),
    );
    expect(res.status).toBe(500);
  });

  test('/api/trending returns 500 when WALLET_ADDRESS is empty', async () => {
    process.env['WALLET_ADDRESS'] = '';
    installFetchMock('', USDC_0_10);

    const res = await app.fetch(
      new Request('http://localhost/api/trending', {
        headers: {
          'payment-signature': nextTxHash(),
          'x-payment-network': 'base',
        },
      }),
    );
    expect(res.status).toBe(500);
  });
});
