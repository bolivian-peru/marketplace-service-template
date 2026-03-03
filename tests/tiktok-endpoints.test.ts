import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x2222222222222222222222222222222222222222';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20'; // 20,000 (6 decimals)

let txCounter = 1000;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function sampleTikTokHtml(): string {
  const state = {
    ItemModule: {
      '7341234567890': {
        id: '7341234567890',
        desc: 'Video caption here #fyp #ai #viral',
        createTime: '1762257600',
        author: 'creator',
        stats: {
          playCount: 5400000,
          diggCount: 340000,
          commentCount: 12000,
          shareCount: 45000,
        },
        music: {
          id: 'sound_1',
          title: 'Original Sound',
          authorName: 'creator',
        },
        authorStats: {
          followerCount: 1200000,
        },
      },
    },
    UserModule: {
      users: {
        creator: {
          uniqueId: 'creator',
          followerCount: 1200000,
        },
      },
    },
    MusicModule: {
      sound_1: {
        id: 'sound_1',
        title: 'Original Sound',
        authorName: 'creator',
      },
    },
  };

  return `<!doctype html><html><head></head><body><script id="SIGI_STATE" type="application/json">${JSON.stringify(state)}</script></body></html>`;
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
            data: USDC_AMOUNT_0_02,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('tiktok.com')) {
      return new Response(sampleTikTokHtml(), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
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

describe('TikTok endpoints on /api/run', () => {
  test('GET /api/run?type=trending returns 402 with TikTok schema when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/run?type=trending&country=US'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.02');
    expect(body.description).toContain('TikTok');
    expect(body.outputSchema?.input?.type).toBeDefined();
  });

  test('GET /api/run?type=trending returns structured data for valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?type=trending&country=US', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('tiktok.com'))).toBe(true);

    const body = await res.json() as any;
    expect(body.type).toBe('trending');
    expect(body.country).toBe('US');
    expect(body.data.videos.length).toBeGreaterThan(0);
    expect(body.data.trending_hashtags.length).toBeGreaterThan(0);
    expect(body.data.trending_sounds.length).toBeGreaterThan(0);
    expect(body.proxy.type).toBe('mobile');
    expect(body.proxy.carrier).toBe('T-Mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/run?type=hashtag returns 400 when tag is missing', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?type=hashtag&country=US', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('tag');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
  });
});
