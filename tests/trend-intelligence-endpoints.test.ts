import { afterEach, describe, expect, test } from 'bun:test';

process.env.WALLET_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.PROXY_HOST = 'proxy.test.local';
process.env.PROXY_HTTP_PORT = '8080';
process.env.PROXY_USER = 'tester';
process.env.PROXY_PASS = 'secret';
process.env.PROXY_COUNTRY = 'US';

import app from '../src/index';

const TEST_WALLET = process.env.WALLET_ADDRESS!;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_10 = '0x00000000000000000000000000000000000000000000000000000000000186a0';

let txCounter = 10_000;
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

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    calls.push(url);

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
            data: USDC_AMOUNT_0_10,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '198.51.100.10' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.reddit.com/search.json')) {
      return new Response(JSON.stringify({
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'abc123',
                title: 'AI coding assistants are improving rapidly',
                subreddit: 'programming',
                score: 250,
                num_comments: 42,
                url: 'https://example.com/post',
                permalink: '/r/programming/comments/abc123/test',
                created_utc: Math.floor(Date.now() / 1000),
                selftext: 'Lots of momentum for tool adoption.',
                author: 'dev_user',
                upvote_ratio: 0.96,
                is_video: false,
                link_flair_text: null,
              },
            },
          ],
          after: null,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;

  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  return calls;
}

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('Trend intelligence endpoints', () => {
  test('POST /api/research returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'AI coding assistants', platforms: ['reddit'] }),
      }),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/research');
    expect(body.message).toBe('Payment required');
    expect(body.outputSchema).toBeDefined();
  });

  test('POST /api/research returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/research', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
        body: JSON.stringify({
          topic: 'AI coding assistants',
          platforms: ['reddit'],
          days: 30,
          country: 'US',
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.reddit.com/search.json'))).toBe(true);

    const body = await res.json() as any;
    expect(body.topic).toBe('AI coding assistants');
    expect(body.timeframe).toBe('last 30 days');
    expect(Array.isArray(body.top_discussions)).toBe(true);
    expect(body.meta?.proxy?.type).toBe('mobile');
    expect(body.payment?.settled).toBe(true);
    expect(body.payment?.txHash).toBe(txHash);
  });

  test('POST /api/research returns 400 for invalid parameters', async () => {
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/research', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
        body: JSON.stringify({
          topic: 'AI coding assistants',
          platforms: ['reddit', 'unknown-platform'],
          days: 120,
          country: 'USA',
        }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Unsupported platform');
  });
});
