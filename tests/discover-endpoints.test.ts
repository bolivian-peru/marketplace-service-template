import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20'; // 0.02 * 1e6

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <item>
    <title><![CDATA[AI agents reshape enterprise workflows]]></title>
    <link>https://example.com/ai-agents-enterprise</link>
    <source url="https://example.com">Example Tech</source>
    <description><![CDATA[<img src="https://img.example.com/1.jpg"/>New wave of AI tooling for ops teams.]]></description>
    <pubDate>Wed, 04 Mar 2026 01:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Short video: Mobile growth hacks</title>
    <link>https://youtube.com/watch?v=abc123</link>
    <source>Creator News</source>
    <description>Marketing clips and benchmarks.</description>
    <pubDate>Wed, 04 Mar 2026 02:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

let txCounter = 5001;
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
            topics: [TRANSFER_TOPIC, toTopicAddress('0x0000000000000000000000000000000000000000'), toTopicAddress(recipientAddress)],
            data: USDC_AMOUNT_0_02,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://news.google.com/rss/search')) {
      return new Response(RSS_SAMPLE, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
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

describe('Google Discover /api/run mode', () => {
  test('returns 402 schema in discover mode when payment missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?country=US&category=technology'));
    expect(res.status).toBe(402);

    const body = await res.json() as any;
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.02');
  });

  test('returns 200 discover feed for valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?country=US&category=technology&limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((u) => u.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((u) => u.startsWith('https://news.google.com/rss/search'))).toBe(true);

    const body = await res.json() as any;
    expect(body.country).toBe('US');
    expect(body.category).toBe('technology');
    expect(Array.isArray(body.discover_feed)).toBe(true);
    expect(body.discover_feed.length).toBe(2);
    expect(body.discover_feed[0].position).toBe(1);
    expect(body.discover_feed[0].source).toBe('Example Tech');
    expect(body.proxy.type).toBe('mobile');
    expect(body.proxy.carrier).toBe('T-Mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.verified).toBe(true);
  });
});
