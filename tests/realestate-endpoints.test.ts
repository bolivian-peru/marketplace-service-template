import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_005 = '0x0000000000000000000000000000000000000000000000000000000000001388';

let txCounter = 1;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(recipientAddress: string): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

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

  test('paid request path works for property/search/market/comps', async () => {
    installFetchMock(TEST_WALLET);

    const txHash1 = nextBaseTxHash();
    const propertyRes = await app.fetch(new Request('http://localhost/api/realestate/property/777', {
      headers: { 'X-Payment-Signature': txHash1, 'X-Payment-Network': 'base' },
    }));
    expect(propertyRes.status).toBe(200);
    const propertyBody = await propertyRes.json() as any;
    expect(propertyBody.property.zpid).toBe('777');
    expect(propertyBody.property.zestimate).toBeGreaterThan(0);
    expect(Array.isArray(propertyBody.property.price_history)).toBe(true);

    const txHash2 = nextBaseTxHash();
    const searchRes = await app.fetch(new Request('http://localhost/api/realestate/search?zip=94105&type=house&min_price=400000&max_price=2000000&bedrooms=3', {
      headers: { 'X-Payment-Signature': txHash2, 'X-Payment-Network': 'base' },
    }));
    expect(searchRes.status).toBe(200);
    const searchBody = await searchRes.json() as any;
    expect(Array.isArray(searchBody.listings)).toBe(true);

    const txHash3 = nextBaseTxHash();
    const marketRes = await app.fetch(new Request('http://localhost/api/realestate/market?zip=94105&type=condo', {
      headers: { 'X-Payment-Signature': txHash3, 'X-Payment-Network': 'base' },
    }));
    expect(marketRes.status).toBe(200);
    const marketBody = await marketRes.json() as any;
    expect(marketBody.market.zip).toBe('94105');
    expect(marketBody.market.median_list_price).toBeGreaterThan(0);

    const txHash4 = nextBaseTxHash();
    const compsRes = await app.fetch(new Request('http://localhost/api/realestate/comps/777?zip=94105', {
      headers: { 'X-Payment-Signature': txHash4, 'X-Payment-Network': 'base' },
    }));
    expect(compsRes.status).toBe(200);
    const compsBody = await compsRes.json() as any;
    expect(Array.isArray(compsBody.comps)).toBe(true);
    expect(compsBody.comps.length).toBeGreaterThan(0);
  });

  test('validation failures return 400', async () => {
    installFetchMock(TEST_WALLET);

    const txHash1 = nextBaseTxHash();
    const badZipRes = await app.fetch(new Request('http://localhost/api/realestate/search?zip=94a05', {
      headers: { 'X-Payment-Signature': txHash1, 'X-Payment-Network': 'base' },
    }));
    expect(badZipRes.status).toBe(400);

    const txHash2 = nextBaseTxHash();
    const badTypeRes = await app.fetch(new Request('http://localhost/api/realestate/market?zip=94105&type=villa', {
      headers: { 'X-Payment-Signature': txHash2, 'X-Payment-Network': 'base' },
    }));
    expect(badTypeRes.status).toBe(400);

    const txHash3 = nextBaseTxHash();
    const badRangeRes = await app.fetch(new Request('http://localhost/api/realestate/search?zip=94105&min_price=900000&max_price=100000', {
      headers: { 'X-Payment-Signature': txHash3, 'X-Payment-Network': 'base' },
    }));
    expect(badRangeRes.status).toBe(400);
  });
});
