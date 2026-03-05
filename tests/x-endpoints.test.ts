import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x2222222222222222222222222222222222222222';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let txCounter = 2000;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(recipientAddress: string): string[] {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    calls.push(url);

    if (url.includes('mainnet.base.org')) {
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
            data: '0x000000000000000000000000000000000000000000000000000000000007a120', // 0.5 USDC
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '198.51.100.55' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('100.91.53.54:8890/search')) {
      return new Response(JSON.stringify({
        results: [
          {
            url: 'https://x.com/openclaw/status/1234567890',
            title: 'OpenClaw launch thread',
            content: 'OpenClaw is shipping fast #OpenClaw #Agents',
            score: 0.91,
            publishedDate: '2026-03-05T10:00:00Z',
          },
          {
            url: 'https://x.com/openclaw/status/1234567891',
            title: 'Agent updates',
            content: 'New automation capabilities are live #AI',
            score: 0.88,
            publishedDate: '2026-03-05T11:00:00Z',
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://cdn.syndication.twimg.com/widgets/followbutton/info.json')) {
      return new Response(JSON.stringify([
        {
          screen_name: 'openclaw',
          name: 'OpenClaw',
          description: 'Agent automation runtime',
          followers_count: 4200,
          friends_count: 120,
          verified: false,
          profile_image_url_https: 'https://pbs.twimg.com/profile_images/openclaw.jpg',
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://cdn.syndication.twimg.com/tweet-result')) {
      return new Response(JSON.stringify({
        id_str: '1234567890',
        text: 'Root tweet body #OpenClaw',
        favorite_count: 10,
        retweet_count: 3,
        conversation_count: 2,
        created_at: '2026-03-05T09:55:00Z',
        user: {
          screen_name: 'openclaw',
          name: 'OpenClaw',
          followers_count: 4200,
          verified: false,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch URL in X endpoint test: ${url}`);
  }) as typeof fetch;

  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  return calls;
}

beforeEach(() => {
  process.env.WALLET_ADDRESS = TEST_WALLET;
  process.env.PROXY_HOST = 'proxy.test.local';
  process.env.PROXY_HTTP_PORT = '8080';
  process.env.PROXY_USER = 'tester';
  process.env.PROXY_PASS = 'secret';
  process.env.PROXY_COUNTRY = 'US';
  process.env.PROXY_CARRIER = 'T-Mobile';
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('X/Twitter endpoints', () => {
  test('GET /api/x/search returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/x/search?query=openclaw'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/x/search');
    expect(body.price.amount).toBe('0.01');
  });

  test('GET /api/x/search returns search results for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/x/search?query=openclaw&limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('100.91.53.54:8890/search'))).toBe(true);

    const body = await res.json() as any;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].url).toContain('x.com');
    expect(body.results[0].hashtags).toContain('openclaw');
    expect(body.payment.txHash).toBe(txHash);
  });

  test('GET /api/x/user/:handle returns profile data for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/x/user/openclaw', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.startsWith('https://cdn.syndication.twimg.com/widgets/followbutton/info.json'))).toBe(true);

    const body = await res.json() as any;
    expect(body.user.handle).toBe('@openclaw');
    expect(body.user.followers).toBe(4200);
    expect(body.user.description).toContain('automation');
  });

  test('GET /api/x/thread/:tweet_id returns root tweet + conversation', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/x/thread/1234567890?limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.startsWith('https://cdn.syndication.twimg.com/tweet-result'))).toBe(true);

    const body = await res.json() as any;
    expect(body.thread.id).toBe('1234567890');
    expect(body.thread.root_tweet.id).toBe('1234567890');
    expect(Array.isArray(body.thread.conversation)).toBe(true);
  });
});
