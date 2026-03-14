import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_03 = '0x0000000000000000000000000000000000000000000000000000000000007530'; // 0.03 USDC (covers all endpoint prices)

let txCounter = 200;
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

    // Mock Base RPC for payment verification
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
            data: USDC_AMOUNT_0_03,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mock Facebook Marketplace HTML responses
    if (url.includes('facebook.com/marketplace')) {
      const mockHtml = `
        <html><head><title>Marketplace - Facebook</title></head>
        <body>
          <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "iPhone 14 Pro 128GB",
            "productID": "1234567890",
            "description": "Like new condition, comes with case and charger",
            "url": "/marketplace/item/1234567890",
            "image": "https://scontent.fbcdn.net/v/test.jpg",
            "offers": {
              "price": "750.00",
              "priceCurrency": "USD",
              "availability": "InStock"
            },
            "itemCondition": "UsedLikeNewCondition"
          }
          </script>
          <div data-testid="marketplace_feed_item">
            <a href="/marketplace/item/1234567890">
              <img src="https://scontent.fbcdn.net/v/test.jpg" />
              <span>iPhone 14 Pro 128GB</span>
              <span>$750</span>
            </a>
          </div>
          <div>
            <span>Listed by</span>
            <a href="/profile.php?id=9876543210">John Seller</a>
            <span>Joined Facebook in 2015</span>
            <span>Verified</span>
            <span>Very responsive</span>
            <span>12 items for sale</span>
            <span>Lives in Austin, TX</span>
          </div>
        </body></html>
      `;
      return new Response(mockHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Default fallback
    return new Response('', { status: 200 });
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

// ─── TESTS ──────────────────────────────────────────

describe('Facebook Marketplace Monitor', () => {
  test('GET /health includes facebook endpoints', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.endpoints).toContain('/api/facebook/search');
    expect(body.endpoints).toContain('/api/facebook/listing/:id');
    expect(body.endpoints).toContain('/api/facebook/seller/:id');
    expect(body.endpoints).toContain('/api/facebook/price-alerts');
    expect(body.endpoints).toContain('/api/facebook/deal-score/:id');
    expect(body.endpoints).toContain('/api/facebook/deals');
  });

  test('GET / discovery includes facebook endpoints', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const paths = body.endpoints.map((e: any) => e.path);
    expect(paths).toContain('/api/facebook/search');
    expect(paths).toContain('/api/facebook/listing/:id');
    expect(paths).toContain('/api/facebook/seller/:id');
    expect(paths).toContain('/api/facebook/price-alerts');
    expect(paths).toContain('/api/facebook/deal-score/:id');
    expect(paths).toContain('/api/facebook/deals');
  });

  test('GET /api/facebook/search returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/search?query=iphone'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
    expect(body.resource).toBe('/api/facebook/search');
    expect(body.price.currency).toBe('USDC');
    expect(body.networks).toBeArray();
    expect(body.networks.length).toBe(2);
  });

  test('GET /api/facebook/listing/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/listing/12345'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
    expect(body.resource).toBe('/api/facebook/listing/:id');
  });

  test('GET /api/facebook/seller/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/seller/67890'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
    expect(body.resource).toBe('/api/facebook/seller/:id');
  });

  test('GET /api/facebook/price-alerts returns 402 without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/facebook/price-alerts?listing_ids=123&target_price=50'),
    );
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/facebook/deal-score/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/deal-score/12345'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/facebook/deals returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/deals?query=laptop'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.message).toBe('Payment required');
  });

  test('402 response contains correct x402 structure', async () => {
    const res = await app.fetch(new Request('http://localhost/api/facebook/search?query=test'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;

    // Verify x402 protocol structure
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('resource');
    expect(body).toHaveProperty('price');
    expect(body).toHaveProperty('networks');
    expect(body).toHaveProperty('headers');
    expect(body.price).toHaveProperty('amount');
    expect(body.price).toHaveProperty('currency');
    expect(body.headers).toHaveProperty('required');
    expect(body.headers.required).toContain('Payment-Signature');

    // Verify both Solana and Base networks available
    const solana = body.networks.find((n: any) => n.network === 'solana');
    const base = body.networks.find((n: any) => n.network === 'base');
    expect(solana).toBeTruthy();
    expect(base).toBeTruthy();
    expect(solana.asset).toBe('USDC');
    expect(base.asset).toBe('USDC');
  });

  test('GET /api/facebook/search returns 200 with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/facebook/search?query=iphone&location=Austin+TX', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.query).toBe('iphone');
    expect(body.location).toBe('Austin TX');
    expect(Array.isArray(body.listings)).toBe(true);
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('facebook.com/marketplace'))).toBe(true);
  });

  test('GET /api/facebook/search validates missing query param', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/facebook/search', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing required parameter');
  });

  test('GET /api/facebook/listing/:id returns 200 with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/facebook/listing/1234567890', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe('1234567890');
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/facebook/deal-score/:id returns 200 with valid payment', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/facebook/deal-score/1234567890', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.listing_id).toBe('1234567890');
    expect(typeof body.score).toBe('number');
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);
    expect(['excellent', 'good', 'fair', 'poor']).toContain(body.rating);
    expect(Array.isArray(body.factors)).toBe(true);
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/facebook/price-alerts validates required params', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    // Missing listing_ids
    const res1 = await app.fetch(
      new Request('http://localhost/api/facebook/price-alerts?target_price=100', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );
    expect(res1.status).toBe(400);
    const body1 = await res1.json() as any;
    expect(body1.error).toContain('listing_ids');

    // Missing target_price
    const txHash2 = nextBaseTxHash();
    const res2 = await app.fetch(
      new Request('http://localhost/api/facebook/price-alerts?listing_ids=123', {
        headers: {
          'X-Payment-Signature': txHash2,
          'X-Payment-Network': 'base',
        },
      }),
    );
    expect(res2.status).toBe(400);
    const body2 = await res2.json() as any;
    expect(body2.error).toContain('target_price');
  });

  test('GET /api/facebook/price-alerts returns 200 with valid params', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    // 0.02 USDC amount for price-alerts
    const res = await app.fetch(
      new Request('http://localhost/api/facebook/price-alerts?listing_ids=1234567890&target_price=800', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.target_price).toBe(800);
    expect(typeof body.total_checked).toBe('number');
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.payment.settled).toBe(true);
  });
});
