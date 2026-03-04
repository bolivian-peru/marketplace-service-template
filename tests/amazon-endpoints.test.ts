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

let txCounter = 20_000;
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

    if (url.startsWith('https://www.amazon.com/dp/B0BSHF7WHW')) {
      const html = `
        <html><head><title>Apple AirPods Pro - Amazon.com</title></head>
        <body>
          <span id="productTitle">Apple AirPods Pro (2nd Generation)</span>
          <span class="a-price"><span class="a-offscreen">$189.99</span></span>
          <div>List Price: <span>$249.00</span></div>
          <div id="availability"><span>In Stock.</span></div>
          <span id="acrCustomerReviewText">125,432 ratings</span>
          <span aria-label="4.7 out of 5 stars"></span>
          <div>Best Sellers Rank #1 in Electronics (#1 in Headphones)</div>
          <div>Sold by <a>Amazon.com</a></div>
          <div>Ships from <span>Amazon</span></div>
          <a id="bylineInfo">Apple</a>
          <img data-a-dynamic-image='{"https://images.example/1.jpg":[500,500],"https://images.example/2.jpg":[500,500]}' />
        </body></html>
      `;

      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    if (url.startsWith('https://www.amazon.com/product-reviews/B0BSHF7WHW')) {
      const html = `
        <html><body>
          <div data-hook="review" id="R1"><div>
            <a data-hook="review-title">Great sound quality</a>
            <i data-hook="review-star-rating"><span>5.0 out of 5 stars</span></i>
            <span class="a-profile-name">Alice</span>
            <span data-hook="review-date">Reviewed in the United States on March 1, 2026</span>
            <span data-hook="review-body"><span>Loving the noise cancellation.</span></span>
          </div></div>
          <div data-hook="review" id="R2"><div>
            <a data-hook="review-title">Good but pricey</a>
            <i data-hook="review-star-rating"><span>4.0 out of 5 stars</span></i>
            <span class="a-profile-name">Bob</span>
            <span data-hook="review-date">Reviewed in the United States on February 15, 2026</span>
            <span data-hook="review-body"><span>Battery life is excellent.</span></span>
          </div></div>
        </body></html>
      `;

      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
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

describe('Amazon endpoints', () => {
  test('GET /api/amazon/product/:asin returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/amazon/product/B0BSHF7WHW?marketplace=US'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/amazon/product/:asin');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/amazon/product/:asin returns parsed product data for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/amazon/product/B0BSHF7WHW?marketplace=US', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((u) => u.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((u) => u.includes('/dp/B0BSHF7WHW'))).toBe(true);

    const body = await res.json() as any;
    expect(body.asin).toBe('B0BSHF7WHW');
    expect(body.title).toContain('AirPods');
    expect(body.price?.current).toBe(189.99);
    expect(body.bsr?.rank).toBe(1);
    expect(body.rating).toBe(4.7);
    expect(body.reviews_count).toBe(125432);
    expect(body.buy_box?.is_amazon).toBe(true);
    expect(body.meta?.marketplace).toBe('US');
    expect(body.payment?.txHash).toBe(txHash);
  });

  test('GET /api/amazon/reviews/:asin validates marketplace values', async () => {
    installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/amazon/reviews/B0BSHF7WHW?marketplace=ZZ', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Invalid marketplace');
  });

  test('GET /api/amazon/reviews/:asin returns parsed reviews for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/amazon/reviews/B0BSHF7WHW?marketplace=US&sort=recent&limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((u) => u.includes('/product-reviews/B0BSHF7WHW'))).toBe(true);

    const body = await res.json() as any;
    expect(body.total).toBe(2);
    expect(body.reviews[0].title).toContain('Great sound');
    expect(body.reviews[0].rating).toBe(5);
    expect(body.payment?.settled).toBe(true);
  });
});
