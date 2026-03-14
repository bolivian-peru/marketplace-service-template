import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_01 = '0x0000000000000000000000000000000000000000000000000000000000002710';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20';
const USDC_AMOUNT_0_03 = '0x0000000000000000000000000000000000000000000000000000000000007530';

// Sample Apple RSS feed response
const APPLE_RSS_RESPONSE = {
  feed: {
    results: [
      { id: '123456', name: 'Test App 1', artistName: 'Dev Corp', artworkUrl100: 'https://example.com/icon1.png', genres: [{ name: 'Games' }], releaseDate: '2026-03-01' },
      { id: '789012', name: 'Test App 2', artistName: 'Indie Dev', artworkUrl100: 'https://example.com/icon2.png', genres: [{ name: 'Utilities' }], releaseDate: '2026-03-10' },
    ],
  },
};

// Sample Apple lookup response
const APPLE_LOOKUP_RESPONSE = {
  resultCount: 2,
  results: [
    { trackId: 123456, trackName: 'Test App 1', artistName: 'Dev Corp', averageUserRating: 4.7, userRatingCount: 125000, formattedPrice: 'Free', fileSizeBytes: '256000000', artworkUrl100: 'https://example.com/icon1.png', primaryGenreName: 'Games', currentVersionReleaseDate: '2026-03-01T00:00:00Z' },
    { trackId: 789012, trackName: 'Test App 2', artistName: 'Indie Dev', averageUserRating: 4.2, userRatingCount: 5000, formattedPrice: 'Free', fileSizeBytes: '52000000', artworkUrl100: 'https://example.com/icon2.png', primaryGenreName: 'Utilities', currentVersionReleaseDate: '2026-03-10T00:00:00Z' },
  ],
};

// Sample Apple search response
const APPLE_SEARCH_RESPONSE = {
  resultCount: 2,
  results: [
    { trackId: 111111, trackName: 'VPN Master', artistName: 'VPN Inc', averageUserRating: 4.5, userRatingCount: 80000, formattedPrice: 'Free', artworkUrl100: 'https://example.com/vpn.png', description: 'Fast and secure VPN', primaryGenreName: 'Utilities' },
    { trackId: 222222, trackName: 'VPN Shield', artistName: 'Shield Co', averageUserRating: 4.1, userRatingCount: 12000, formattedPrice: '$4.99', artworkUrl100: 'https://example.com/shield.png', description: 'Privacy VPN solution', primaryGenreName: 'Utilities' },
  ],
};

// Sample Apple app detail response
const APPLE_DETAIL_RESPONSE = {
  resultCount: 1,
  results: [
    { trackId: 123456, trackName: 'Test App 1', artistName: 'Dev Corp', averageUserRating: 4.7, userRatingCount: 125000, formattedPrice: 'Free', fileSizeBytes: '256000000', artworkUrl100: 'https://example.com/icon1.png', artworkUrl512: 'https://example.com/icon1_512.png', primaryGenreName: 'Games', currentVersionReleaseDate: '2026-03-01T00:00:00Z', description: 'An amazing game.', version: '3.2.1', releaseNotes: 'Bug fixes and improvements', contentAdvisoryRating: '4+', screenshotUrls: ['https://example.com/ss1.png'] },
  ],
};

// Sample Apple reviews response
const APPLE_REVIEWS_RESPONSE = {
  feed: {
    entry: [
      { author: { name: { label: 'JohnDoe' } }, 'im:rating': { label: '5' }, title: { label: 'Great app' }, content: { label: 'Really love this app, works perfectly.' }, updated: { label: '2026-03-12T00:00:00Z' }, 'im:voteSum': { label: '3' } },
      { author: { name: { label: 'JaneSmith' } }, 'im:rating': { label: '2' }, title: { label: 'Disappointing' }, content: { label: 'Too many bugs and crashes frequently.' }, updated: { label: '2026-03-11T00:00:00Z' }, 'im:voteSum': { label: '1' } },
    ],
  },
};

let txCounter = 100;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(recipientAddress: string, usdcAmount: string): string[] {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    calls.push(url);

    // Base RPC for payment verification
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
            data: usdcAmount,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Apple RSS feed
    if (url.includes('rss.applemarketingtools.com')) {
      return new Response(JSON.stringify(APPLE_RSS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Apple iTunes lookup
    if (url.includes('itunes.apple.com/lookup')) {
      // Check if looking up specific app
      if (url.includes('id=123456') && !url.includes(',')) {
        return new Response(JSON.stringify(APPLE_DETAIL_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(APPLE_LOOKUP_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Apple search
    if (url.includes('itunes.apple.com/search')) {
      return new Response(JSON.stringify(APPLE_SEARCH_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Apple reviews RSS
    if (url.includes('itunes.apple.com/rss/customerreviews')) {
      return new Response(JSON.stringify(APPLE_REVIEWS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Google Play Store
    if (url.includes('play.google.com')) {
      return new Response('<html><body><a href="/store/apps/details?id=com.test.app1" title="Test Google App">Test Google App</a></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Proxy IP check
    if (url.includes('api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '198.51.100.1' }), {
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

describe('App Store Intelligence endpoints', () => {
  // ─── 402 PAYMENT REQUIRED TESTS ─────────────────

  test('GET /api/appstore/rankings returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/appstore/rankings?store=apple&category=games&country=US'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/appstore/rankings');
    expect(body.price.amount).toBe('0.01');
    expect(body.message).toBe('Payment required');
    expect(body.outputSchema).toBeDefined();
  });

  test('GET /api/appstore/app returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/appstore/app?store=apple&appId=123456'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/appstore/app');
    expect(body.price.amount).toBe('0.02');
  });

  test('GET /api/appstore/search returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/appstore/search?store=apple&query=vpn'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/appstore/search');
    expect(body.price.amount).toBe('0.01');
  });

  test('GET /api/appstore/trending returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/appstore/trending?store=apple'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/appstore/trending');
  });

  test('GET /api/appstore/compare returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/appstore/compare?store=apple&appIds=123456,789012'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/appstore/compare');
    expect(body.price.amount).toBe('0.03');
  });

  // ─── VALIDATION TESTS ──────────────────────────

  test('GET /api/appstore/rankings returns 400 without store param', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/rankings?category=games', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('store');
  });

  test('GET /api/appstore/search returns 400 without query param', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/search?store=apple', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('query');
  });

  // ─── PAID REQUEST TESTS ────────────────────────

  test('GET /api/appstore/rankings returns 200 for Apple with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/rankings?store=apple&category=all&country=US&limit=10', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');

    const body = await res.json() as any;
    expect(body.type).toBe('rankings');
    expect(body.store).toBe('apple');
    expect(body.country).toBe('US');
    expect(Array.isArray(body.rankings)).toBe(true);
    expect(body.rankings.length).toBeGreaterThan(0);
    expect(body.rankings[0].appName).toBe('Test App 1');
    expect(body.rankings[0].rank).toBe(1);
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
    expect(body.metadata.totalRanked).toBeGreaterThan(0);
  });

  test('GET /api/appstore/search returns 200 for Apple search with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/search?store=apple&query=vpn&country=GB', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('search');
    expect(body.store).toBe('apple');
    expect(body.query).toBe('vpn');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(2);
    expect(body.results[0].appName).toBe('VPN Master');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/appstore/app returns 200 for Apple app detail with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_02);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/app?store=apple&appId=123456&country=US', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('app');
    expect(body.store).toBe('apple');
    expect(body.app.appName).toBe('Test App 1');
    expect(body.app.developer).toBe('Dev Corp');
    expect(body.app.rating).toBe(4.7);
    expect(body.app.ratingCount).toBe(125000);
    expect(Array.isArray(body.app.reviews)).toBe(true);
    expect(body.reviewSentiment).toBeDefined();
    expect(body.reviewSentiment.overall).toBeDefined();
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/appstore/trending returns 200 for Apple trending with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/appstore/trending?store=apple&country=DE&limit=5', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('trending');
    expect(body.store).toBe('apple');
    expect(Array.isArray(body.trending)).toBe(true);
    expect(body.trending.length).toBeGreaterThan(0);
    expect(body.trending[0].rank).toBe(1);
    expect(body.trending[0].growthSignal).toBeDefined();
    expect(body.payment.settled).toBe(true);
  });

  // ─── HEALTH + DISCOVERY ────────────────────────

  test('GET /health includes appstore endpoints', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.endpoints).toContain('/api/appstore/rankings');
    expect(body.endpoints).toContain('/api/appstore/app');
    expect(body.endpoints).toContain('/api/appstore/search');
    expect(body.endpoints).toContain('/api/appstore/trending');
    expect(body.endpoints).toContain('/api/appstore/compare');
  });

  test('GET / includes appstore endpoints in service discovery', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const paths = body.endpoints.map((e: any) => e.path);
    expect(paths).toContain('/api/appstore/rankings');
    expect(paths).toContain('/api/appstore/app');
    expect(paths).toContain('/api/appstore/search');
    expect(paths).toContain('/api/appstore/trending');
    expect(paths).toContain('/api/appstore/compare');
  });
});
