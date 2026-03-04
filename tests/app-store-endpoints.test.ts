import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20';

let txCounter = 200;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installAppStoreFetchMock(recipientAddress: string): string[] {
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

    if (url.startsWith('https://itunes.apple.com/us/rss/topfreeapplications')) {
      return new Response(JSON.stringify({
        feed: {
          entry: [
            {
              id: { attributes: { 'im:id': '324684580' } },
              'im:name': { label: 'Spotify: Music and Podcasts' },
              'im:artist': { label: 'Spotify AB' },
              category: { attributes: { label: 'Music' } },
              'im:price': { attributes: { amount: '0.00' } },
              'im:image': [{ label: 'https://cdn/icon-53.png' }, { label: 'https://cdn/icon-75.png' }, { label: 'https://cdn/icon-100.png' }],
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://itunes.apple.com/lookup?id=324684580')) {
      return new Response(JSON.stringify({
        resultCount: 1,
        results: [
          {
            trackId: 324684580,
            bundleId: 'com.spotify.music',
            averageUserRating: 4.8,
            userRatingCount: 128000,
            price: 0,
            features: ['iosUniversal', 'gameCenter', 'in-app-purchases'],
            currentVersionReleaseDate: '2026-02-20T10:00:00Z',
            fileSizeBytes: '205520896',
            artworkUrl512: 'https://cdn/spotify-512.png',
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://play.google.com/store/apps/details?id=com.spotify.music')) {
      return new Response(`
        <html>
          <h1><span>Spotify: Music and Podcasts</span></h1>
          <a href="/store/apps/dev?id=spotify">Spotify AB</a>
          <meta itemprop="ratingValue" content="4.4" />
          <meta itemprop="ratingCount" content="31500000" />
          <meta itemprop="image" content="https://play-lh.googleusercontent.com/spotify-icon" />
          <a href="/store/apps/category/MUSIC_AND_AUDIO">Music & Audio</a>
          <div>In-app purchases</div>
        </html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch URL in app-store test: ${url}`);
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
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('App Store intelligence /api/run', () => {
  test('returns x402 payload when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=rankings&store=apple&country=US&category=games'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.02');
    expect(body.message).toBe('Payment required');
  });

  test('returns rankings for Apple with valid payment', async () => {
    const calls = installAppStoreFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?type=rankings&store=apple&country=US&category=games&limit=1', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('/rss/topfreeapplications/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.type).toBe('rankings');
    expect(body.store).toBe('apple');
    expect(body.country).toBe('US');
    expect(Array.isArray(body.rankings)).toBe(true);
    expect(body.rankings[0].appName).toContain('Spotify');
    expect(body.rankings[0].appId).toBe('com.spotify.music');
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.settled).toBe(true);
  });

  test('returns Google app details with valid payment', async () => {
    const calls = installAppStoreFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?type=app&store=google&country=DE&appId=com.spotify.music', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.startsWith('https://play.google.com/store/apps/details?id=com.spotify.music'))).toBe(true);

    const body = await res.json() as any;
    expect(body.type).toBe('app');
    expect(body.store).toBe('google');
    expect(body.app.appName).toContain('Spotify');
    expect(body.app.appId).toBe('com.spotify.music');
    expect(body.app.rating).toBe(4.4);
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
  });
});
