import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

// Use a hex address so Base payment verification (to.toLowerCase() === expectedRecipient.toLowerCase()) works in tests
const TEST_WALLET = '0xC0140eEa19bD90a7cA75882d5218eFaF20426e42';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// 0.02 USDC = 20000 micro-USDC
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20';

// Minimal Amazon HTML stubs — enough for scrapers to return empty results without throwing
const AMAZON_SEARCH_HTML = `<html><head><title>Amazon.com - wireless headphones</title></head>
<body><span class="a-color-state a-text-bold">Results</span>
<div data-component-type="s-search-result" data-asin="B09XYZ1234">
  <h2><a href="/dp/B09XYZ1234"><span class="a-text-normal">Test Headphones</span></a></h2>
  <span class="a-offscreen">$29.99</span>
  <span class="a-icon-alt">4.5 out of 5 stars</span>
</div></body></html>`;

const AMAZON_PRODUCT_HTML = `<html><head><title>Test Product - Amazon</title></head>
<body>
<span id="productTitle">Test Product Title</span>
<span class="a-offscreen">$29.99</span>
<span id="acrCustomerReviewText">128 ratings</span>
<span class="a-icon-alt">4.2 out of 5 stars</span>
<span id="availability"><span>In Stock.</span></span>
</body></html>`;

const AMAZON_BSR_HTML = `<html><head><title>Best Sellers in Electronics - Amazon</title></head>
<body>
<div class="zg-item-immersion">
  <span class="zg-bdg-text">#1</span>
  <a href="/dp/B08H93ZRK9">Best Seller Item</a>
  <span class="a-offscreen">$49.99</span>
</div>
</body></html>`;

const AMAZON_REVIEWS_HTML = `<html><head><title>Customer reviews for Test Product</title></head>
<body>
<div data-hook="review">
  <a data-hook="review-title"><span>Great product</span></a>
  <span class="a-icon-alt">5.0 out of 5 stars</span>
  <span class="a-profile-name">Test User</span>
  <span data-hook="review-date">Reviewed in the United States on January 1, 2026</span>
  <div data-hook="review-body"><span>This product is excellent.</span></div>
  <span>Verified Purchase</span>
</div>
</body></html>`;

let txCounter = 1;
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

    // Base L2 RPC — return a confirmed USDC transfer receipt
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

    // Amazon search
    if (url.includes('amazon.com/s?') || url.includes('amazon.co.uk/s?') ||
        url.includes('amazon.de/s?') || url.includes('amazon.fr/s?')) {
      return new Response(AMAZON_SEARCH_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Amazon product page
    if (url.includes('/dp/')) {
      return new Response(AMAZON_PRODUCT_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Amazon bestsellers
    if (url.includes('/zgbs/') || url.includes('/best-sellers/') || url.includes('bestsellers')) {
      return new Response(AMAZON_BSR_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Amazon product reviews
    if (url.includes('/product-reviews/')) {
      return new Response(AMAZON_REVIEWS_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch URL in Amazon test: ${url}`);
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

// ─── 402 GATE TESTS ────────────────────────────────────────────────────────

describe('Amazon endpoints — 402 gate (no payment)', () => {
  test('GET /api/amazon/search returns 402 with x402 payload', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/search?query=wireless+headphones'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/amazon/search');
    expect(body.price.amount).toBe('0.02');
    expect(body.message).toBe('Payment required');
    expect(body.outputSchema).toBeDefined();
  });

  test('GET /api/amazon/product/:asin returns 402 with x402 payload', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/product/B08N5WRWNW'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/amazon/product/:asin');
    expect(body.price.amount).toBe('0.02');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/amazon/bestsellers returns 402 with x402 payload', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/bestsellers?category=electronics'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/amazon/bestsellers');
    expect(body.price.amount).toBe('0.02');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/amazon/reviews/:asin returns 402 with x402 payload', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/reviews/B08N5WRWNW'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/amazon/reviews/:asin');
    expect(body.price.amount).toBe('0.02');
    expect(body.message).toBe('Payment required');
  });
});

// ─── PAID RESPONSE TESTS ───────────────────────────────────────────────────

describe('Amazon endpoints — paid responses (Base USDC payment via header)', () => {
  test('GET /api/amazon/search returns 200 with results after payment', async () => {
    const txHash = nextBaseTxHash();
    installFetchMock(TEST_WALLET);

    const res = await app.fetch(
      new Request('http://localhost/api/amazon/search?query=wireless+headphones', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    const body = await res.json() as any;
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body).toHaveProperty('meta');
    expect(body).toHaveProperty('payment');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/amazon/product/:asin returns 200 with product after payment', async () => {
    const txHash = nextBaseTxHash();
    installFetchMock(TEST_WALLET);

    const res = await app.fetch(
      new Request('http://localhost/api/amazon/product/B08N5WRWNW', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    const body = await res.json() as any;
    expect(body).toHaveProperty('product');
    expect(body).toHaveProperty('payment');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/amazon/bestsellers returns 200 with bestsellers after payment', async () => {
    const txHash = nextBaseTxHash();
    installFetchMock(TEST_WALLET);

    const res = await app.fetch(
      new Request('http://localhost/api/amazon/bestsellers?category=electronics', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    const body = await res.json() as any;
    expect(body).toHaveProperty('bestsellers');
    expect(Array.isArray(body.bestsellers)).toBe(true);
    expect(body).toHaveProperty('payment');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/amazon/reviews/:asin returns 200 with reviews after payment', async () => {
    const txHash = nextBaseTxHash();
    installFetchMock(TEST_WALLET);

    const res = await app.fetch(
      new Request('http://localhost/api/amazon/reviews/B08N5WRWNW', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    const body = await res.json() as any;
    expect(body).toHaveProperty('reviews');
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body).toHaveProperty('asin');
    expect(body.asin).toBe('B08N5WRWNW');
    expect(body).toHaveProperty('payment');
    expect(body.payment.settled).toBe(true);
  });
});

// ─── VALIDATION TESTS ──────────────────────────────────────────────────────

describe('Amazon endpoints — input validation', () => {
  test('GET /api/amazon/search returns 402 without query param (still requires payment)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/search'),
    );
    // Without payment, should get 402 regardless of missing query
    expect(res.status).toBe(402);
  });

  test('GET /api/amazon/reviews/:asin returns 400 for invalid ASIN format after payment', async () => {
    const txHash = nextBaseTxHash();
    installFetchMock(TEST_WALLET);

    // ASIN must be exactly 10 alphanumeric chars — "INVALID!" fails regex [A-Z0-9]{10}
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/reviews/INVALID%21%21!', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    // ASIN validation runs after payment is verified — invalid format returns 400
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Invalid ASIN');
  });

  test('GET /api/amazon/product/:asin returns 402 for any ASIN without payment', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/product/B0INVALID'),
    );
    expect(res.status).toBe(402);
  });

  test('GET /api/amazon/search 402 body includes marketplace in schema', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/search?query=test'),
    );
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    // Should include marketplace info in input/output schema
    const bodyStr = JSON.stringify(body);
    expect(bodyStr.includes('marketplace')).toBe(true);
  });

  test('GET /api/amazon/bestsellers 402 body includes category hint', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/amazon/bestsellers'),
    );
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(JSON.stringify(body)).toContain('category');
  });

  test('Payment rejection returns 402 when tx receipt shows reverted transaction', async () => {
    const txHash = nextBaseTxHash();
    const originalFetch = globalThis.fetch;

    // Mock a reverted/failed transaction (status 0x0)
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.toString()
        : input.url;
      if (url.includes('mainnet.base.org')) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (payload?.method === 'eth_getTransactionReceipt') {
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { status: '0x0', logs: [] }, // REVERTED tx
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch in rejection test: ${url}`);
    }) as typeof fetch;

    restoreFetch = () => { globalThis.fetch = originalFetch; };

    const res = await app.fetch(
      new Request('http://localhost/api/amazon/search?query=test', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body).toHaveProperty('error');
  });
});
