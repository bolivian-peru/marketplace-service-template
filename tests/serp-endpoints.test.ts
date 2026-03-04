import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20';

const SERP_HTML = `
<html>
  <body>
    <div id="result-stats">About 12,300 results</div>
    <div class="g">
      <a href="/url?q=https://example.com/guide&sa=U">Best VPN Guide</a>
      <span class="st">Simple guide for privacy tools.</span>
    </div>
    <div class="g">
      <a href="/url?q=https://example.org/review&sa=U">VPN Review 2026</a>
      <span class="st">Hands-on test and benchmark.</span>
    </div>
    <div data-q="What is the safest VPN?"></div>
  </body>
</html>
`;

let txCounter = 200;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(): string[] {
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
              toTopicAddress(TEST_WALLET),
            ],
            data: USDC_AMOUNT_0_02,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.google.com/search?')) {
      return new Response(SERP_HTML, {
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

describe('Google SERP + AI Search mode via /api/run', () => {
  test('returns 402 payload for SERP mode without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=serp&query=best+vpn'));
    expect(res.status).toBe(402);

    const body = await res.json() as any;
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.02');
    expect(body.outputSchema?.input?.type).toContain('serp');
  });

  test('returns SERP payload for paid request', async () => {
    const calls = installFetchMock();
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?type=serp&query=best+vpn&country=us&language=en&pages=1', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.type).toBe('serp');
    expect(body.query).toBe('best vpn');
    expect(Array.isArray(body.organic)).toBe(true);
    expect(body.organic.length).toBeGreaterThanOrEqual(1);
    expect(body.totalResults).toBe('12,300');
    expect(body.payment.txHash).toBe(txHash);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/search?'))).toBe(true);
  });

  test('returns ai_overview shaped response when requested', async () => {
    installFetchMock();
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?type=ai_overview&query=best+vpn', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.type).toBe('ai_overview');
    expect(body.query).toBe('best vpn');
    expect(Array.isArray(body.supportingOrganicResults)).toBe(true);
    expect(Array.isArray(body.relatedSearches)).toBe(true);
    expect(body.payment.txHash).toBe(txHash);
  });
});
