import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_003 = '0x0000000000000000000000000000000000000000000000000000000000000bb8';

let txCounter = 1;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function makeSerpHtml(page: number): string {
  const suffix = page === 1 ? 'Page Two' : 'Page One';
  return `
    <html>
      <body>
        <div id="result-stats">About 12,345 results</div>
        Sponsored <a href="https://ads.example.com/${page}">Best VPN Ad ${page}</a><div>Fast private browsing</div>
        <a href="https://example.com/${page}">AI agents ${suffix}</a>
        <div>Example snippet for ${suffix}</div>
        <div data-q="What is AI overview?"><div class="wDYxhc">It is a generated summary.</div><a href="https://faq.example.com/${page}"></a></div>
        <div data-attrid="hero ai overview">
          AI overview summary for page ${page} with enough content to be extracted correctly.
          <a href="https://source.example.com/${page}">Source ${page}</a>
        </div>
        <a href="/search?q=related+query+${page}" class="related">related query ${page}</a>
      </body>
    </html>
  `;
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
            data: USDC_AMOUNT_0_003,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '172.56.168.66' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.google.com/search?')) {
      const page = url.includes('start=10') ? 1 : 0;
      return new Response(makeSerpHtml(page), {
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
  process.env.SERP_PRICE_USDC = '0.003';
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

describe('SERP run modes', () => {
  test('GET /api/run type=serp returns 402 with SERP pricing when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=serp&query=ai+agents'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.003');
  });

  test('GET /api/run rejects unsupported type values before payment verification', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=unknown'));
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain('Unsupported type');
  });

  test('GET /api/run type=serp returns aggregated SERP results across pages', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?type=serp&query=ai+agents&country=us&language=en&pages=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.mode).toBe('serp');
    expect(body.meta.pages).toBe(2);
    expect(body.results.organic.length).toBeGreaterThanOrEqual(2);
    expect(body.results.ads).toHaveLength(2);
    expect(body.results.relatedSearches).toEqual(['related query 0', 'related query 1']);
    expect(body.results.aiOverview.text).toContain('AI overview summary');
    expect(body.payment.txHash).toBe(txHash);
    expect(calls.filter((url) => url.startsWith('https://www.google.com/search?'))).toHaveLength(2);
  });

  test('GET /api/run type=ai_overview returns focused AI summary payload', async () => {
    installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?type=ai_overview&query=best+ai+agents', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.mode).toBe('ai_overview');
    expect(body.aiOverview.text).toContain('AI overview summary');
    expect(body.supportingOrganicResults[0].title).toContain('AI agents');
    expect(body.relatedQuestions[0].question).toBe('What is AI overview?');
    expect(body.totalOrganicResults).toBeGreaterThanOrEqual(1);
    expect(body.totalAds).toBe(1);
  });
});
