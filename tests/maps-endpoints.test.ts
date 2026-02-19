import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_005 = '0x0000000000000000000000000000000000000000000000000000000000001388';
const MAPS_HTML = '<html><head><title>Acme Plumbing - Google Maps</title></head><body></body></html>';

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
            data: USDC_AMOUNT_0_005,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.google.com/')) {
      return new Response(MAPS_HTML, {
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
});
