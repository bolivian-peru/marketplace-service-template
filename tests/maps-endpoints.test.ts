import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_005 = '0x0000000000000000000000000000000000000000000000000000000000001388';
const USDC_AMOUNT_0_003 = '0x0000000000000000000000000000000000000000000000000000000000000bb8';
const MAPS_HTML = '<html><head><title>Acme Plumbing - Google Maps</title></head><body></body></html>';
const SERP_HTML = `
<html><body>
  <div id="resultStats">About 2,100 results</div>
  <a href="/url?q=https%3A%2F%2Fexample.com%2Falpha&amp;sa=U"><h3>Alpha Result</h3></a>
  <span class="st">Alpha mobile search snippet.</span>
  <a href="/url?q=https%3A%2F%2Fexample.com%2Fbeta&amp;sa=U"><h3>Beta Result</h3></a>
  <span class="st">Beta mobile search snippet.</span>
</body></html>`;

let txCounter = 1;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(recipientAddress: string, usdcAmount: string = USDC_AMOUNT_0_005): string[] {
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
            data: usdcAmount,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.google.com/')) {
      if (url.startsWith('https://www.google.com/search?')) {
        return new Response(SERP_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }

      return new Response(MAPS_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url === 'https://api.ipify.org?format=json') {
      return new Response(JSON.stringify({ ip: '203.0.113.10' }), {
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

describe('Google Maps endpoints', () => {
  test('GET /api/run returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/run?query=plumbers&location=Austin+TX'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.005');
    expect(body.message).toBe('Payment required');
    expect(body.outputSchema).toBeDefined();
  });

  test('GET /api/details returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/details?placeId=ChIJN1t_tDeuEmsRUsoyG83frY4'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/details');
    expect(body.price.amount).toBe('0.005');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/run returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?query=plumbers&location=Austin+TX&limit=1', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.searchQuery).toBe('plumbers');
    expect(body.location).toBe('Austin TX');
    expect(Array.isArray(body.businesses)).toBe(true);
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/details returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/details?placeId=place_123', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/maps/place/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.business.placeId).toBe('place_123');
    expect(body.business.name).toBe('Acme Plumbing');
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/serp returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/serp?query=mobile+seo'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/serp');
    expect(body.price.amount).toBe('0.003');
    expect(body.message).toBe('Payment required');
    expect(body.outputSchema).toBeDefined();
  });

  test('GET /api/serp returns mobile SERP results for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_003);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/serp?query=mobile+seo&country=us&language=en&location=Austin+TX&num=1&start=10', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);

    const googleSearchUrl = calls.find((url) => url.startsWith('https://www.google.com/search?'));
    expect(googleSearchUrl).toBeDefined();
    expect(googleSearchUrl).toContain('q=mobile+seo+Austin+TX');
    expect(googleSearchUrl).toContain('gl=us');
    expect(googleSearchUrl).toContain('hl=en');
    expect(googleSearchUrl).toContain('start=10');

    const body = await res.json() as any;
    expect(body.results.query).toBe('mobile seo');
    expect(body.results.location).toBe('Austin TX');
    expect(body.results.organic).toHaveLength(1);
    expect(body.results.organic[0].title).toBe('Alpha Result');
    expect(body.results.organic[0].url).toBe('https://example.com/alpha');
    expect(body.meta.proxy.type).toBe('mobile');
    expect(body.meta.proxy.ip).toBe('203.0.113.10');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});
