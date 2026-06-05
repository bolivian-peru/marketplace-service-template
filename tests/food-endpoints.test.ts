import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_01 = '0x0000000000000000000000000000000000000000000000000000000000002710';

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
            data: USDC_AMOUNT_0_01,
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
  process.env.PROXY_HOST = 'proxy.test.local';
  process.env.PROXY_HTTP_PORT = '8080';
  process.env.PROXY_USER = 'tester';
  process.env.PROXY_PASS = 'secret';
  process.env.PROXY_COUNTRY = 'US';
  process.env.FOOD_SCRAPER_MODE = 'fallback';
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
  delete process.env.FOOD_SCRAPER_MODE;
});

describe('Food endpoints', () => {
  test('GET /api/food/search returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/food/search?query=pizza&address=10001'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/food/search');
    expect(body.price.amount).toBe('0.01');
  });

  test('GET /api/food/search returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/food/search?query=pizza&address=10001&platform=ubereats', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);

    const body = await res.json() as any;
    expect(body.restaurant).toBeDefined();
    expect(Array.isArray(body.menu_items)).toBe(true);
    expect(body.platform).toBe('ubereats');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.settled).toBe(true);
  });
});

