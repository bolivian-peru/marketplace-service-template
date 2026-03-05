import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_005 = '0x0000000000000000000000000000000000000000000000000000000000001388';

let txCounter = 100;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installPaymentFetchMock(recipientAddress: string): string[] {
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

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;

  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  return calls;
}

beforeEach(() => {
  process.env.WALLET_ADDRESS = TEST_WALLET;
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('Real estate endpoints', () => {
  test('GET /api/realestate/property/:zpid returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/realestate/property/12345'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/realestate/property/:zpid');
  });

  test('GET /api/realestate/property/:zpid returns 200 on valid payment', async () => {
    const calls = installPaymentFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/realestate/property/987654', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);

    const body = await res.json() as any;
    expect(body.property.zpid).toBe('987654');
    expect(Array.isArray(body.property.price_history)).toBe(true);
    expect(typeof body.property.zestimate).toBe('number');
  });

  test('GET /api/realestate/search returns 400 for invalid params', async () => {
    const txHash = nextBaseTxHash();
    installPaymentFetchMock(TEST_WALLET);

    const res = await app.fetch(new Request('http://localhost/api/realestate/search?zip=abcde&min_price=100000&max_price=90000', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Invalid zip');
  });

  test('GET /api/realestate/search returns 200 on valid payment', async () => {
    const txHash = nextBaseTxHash();
    installPaymentFetchMock(TEST_WALLET);

    const res = await app.fetch(new Request('http://localhost/api/realestate/search?zip=94105&type=house&min_price=500000&max_price=1800000&bedrooms=3', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.listings)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  test('GET /api/realestate/market returns 200 on valid payment', async () => {
    const txHash = nextBaseTxHash();
    installPaymentFetchMock(TEST_WALLET);

    const res = await app.fetch(new Request('http://localhost/api/realestate/market?zip=94105&type=condo', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.market.zip).toBe('94105');
    expect(body.market.type).toBe('condo');
    expect(typeof body.market.median_list_price).toBe('number');
  });

  test('GET /api/realestate/comps/:zpid returns 200 on valid payment', async () => {
    const txHash = nextBaseTxHash();
    installPaymentFetchMock(TEST_WALLET);

    const res = await app.fetch(new Request('http://localhost/api/realestate/comps/abc123?zip=94105', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.comps)).toBe(true);
    expect(body.comps.length).toBeGreaterThan(0);
  });
});
