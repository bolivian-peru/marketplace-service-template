import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x2222222222222222222222222222222222222222';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

let txCounter = 4000;
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
            data: '0x00000000000000000000000000000000000000000000000000000000000f4240', // 1.0 USDC
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '203.0.113.50' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('m.facebook.com/marketplace/search/')) {
      return new Response(`
        <html><body>
          <div class="listing">
            <a href="/marketplace/item/111111111111111/" data-title="iPhone 15 Pro Max 256GB" data-price="$850" data-location="Brooklyn, NY" data-condition="Used - Like New">
              2h ago seller name John D. joined 2019 rating 5/5
              <img src="https://cdn.example.com/iphone-15.jpg" />
            </a>
          </div>
          <div class="listing">
            <a href="/marketplace/item/222222222222222/" data-title="iPhone 14" data-price="$600" data-location="Queens, NY" data-condition="Used - Good">
              2d ago seller name Alex P. joined 2020 rating 4.8/5
              <img src="https://cdn.example.com/iphone-14.jpg" />
            </a>
          </div>
        </body></html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.includes('m.facebook.com/marketplace/item/111111111111111/')) {
      return new Response(`
        <html><body>
          <main>
            <a href="/marketplace/item/111111111111111/" data-title="iPhone 15 Pro Max 256GB" data-price="$850" data-location="Brooklyn, NY" data-condition="Used - Like New">
              1h ago seller name John D. joined 2019 rating 5/5
              <img src="https://cdn.example.com/iphone-15.jpg" />
            </a>
          </main>
        </body></html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url === 'https://m.facebook.com/marketplace/?location=New%20York') {
      return new Response(`
        <html><body>
          <a href="/marketplace/category/electronics">Electronics</a>
          <a href="/marketplace/category/property-rentals">Property Rentals</a>
          <a href="/marketplace/category/vehicles">Vehicles</a>
        </body></html>
      `, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch URL in marketplace endpoint test: ${url}`);
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
  process.env.PROXY_CARRIER = 'Verizon';
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('Facebook Marketplace endpoints', () => {
  test('GET /api/marketplace/search returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/marketplace/search?query=iphone'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/marketplace/search');
    expect(body.price.amount).toBe('0.01');
  });

  test('GET /api/marketplace/search returns structured listings for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/marketplace/search?query=iphone+15&location=New+York&min_price=500&max_price=1000&limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('m.facebook.com/marketplace/search/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].id).toBe('111111111111111');
    expect(body.results[0].title).toContain('iPhone 15');
    expect(body.results[0].price).toBe(850);
    expect(body.meta.proxy.country).toBe('US');
    expect(body.payment.txHash).toBe(txHash);
  });

  test('GET /api/marketplace/listing/:id returns listing detail for paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/marketplace/listing/111111111111111', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.includes('/marketplace/item/111111111111111/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.listing.id).toBe('111111111111111');
    expect(body.listing.title).toContain('iPhone 15');
    expect(body.listing.location).toBe('Brooklyn, NY');
  });

  test('GET /api/marketplace/categories returns parsed categories without payment', async () => {
    installFetchMock(TEST_WALLET);

    const res = await app.fetch(new Request('http://localhost/api/marketplace/categories?location=New%20York'));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories).toContain('electronics');
    expect(body.categories).toContain('property rentals');
  });

  test('GET /api/marketplace/new filters listings by time window', async () => {
    installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/marketplace/new?query=iphone&since=4h', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results.every((item: any) => item.id !== '222222222222222')).toBe(true);
    expect(body.meta.new_count).toBe(body.results.length);
  });
});
