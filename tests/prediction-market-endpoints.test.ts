import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_05 = '0x000000000000000000000000000000000000000000000000000000000000c350';

let txCounter = 100;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installPredictionFetchMock(recipientAddress: string): string[] {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    calls.push(url);

    // x402 verification
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
            data: USDC_AMOUNT_0_05,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Polymarket
    if (url.startsWith('https://gamma-api.polymarket.com/events')) {
      return new Response(JSON.stringify([
        {
          title: 'Will Bitcoin ETF inflows exceed $1B this week?',
          slug: 'bitcoin-etf-inflows-1b-week',
          volume24hr: 1500000,
          liquidity: 5200000,
          markets: [
            {
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.62","0.38"]',
            },
          ],
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Kalshi
    if (url.startsWith('https://api.elections.kalshi.com/trade-api/v2/markets')) {
      return new Response(JSON.stringify({
        markets: [
          {
            title: 'Bitcoin ETF inflows over $1B this week',
            ticker: 'KXBITCOINETF-1B',
            yes_ask: 58,
            yes_bid: 57,
            last_price: 58,
            volume_24h: 800000,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Metaculus (auth required in real world — return denied)
    if (url.startsWith('https://www.metaculus.com/api2/questions/')) {
      return new Response('Permission Error', { status: 403 });
    }

    // Twitter search via SearXNG bridge
    if (url.startsWith('http://100.91.53.54:8890/search')) {
      const results = Array.from({ length: 12 }).map((_, idx) => ({
        url: `https://x.com/tester/status/${idx + 1}`,
        title: `Bitcoin ETF signal ${idx + 1}`,
        content: idx % 3 === 0 ? 'bullish breakout approved inflows surge' : 'mixed market chatter',
        score: 0.9 - idx * 0.03,
      }));

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reddit sentiment feed
    if (url.startsWith('https://www.reddit.com/search.json')) {
      return new Response(JSON.stringify({
        data: {
          after: null,
          children: [
            {
              data: {
                title: 'ETF approval is bullish for bitcoin',
                selftext: 'Strong inflow momentum and upside expectations',
                author: 'alice',
                subreddit: 'CryptoCurrency',
                score: 123,
                upvote_ratio: 0.93,
                num_comments: 55,
                created_utc: 1700000000,
                permalink: '/r/CryptoCurrency/comments/abc/etf/',
                url: 'https://reddit.com/r/CryptoCurrency/comments/abc/etf/',
                is_self: true,
                link_flair_text: null,
                total_awards_received: 0,
                over_18: false,
              },
            },
            {
              data: {
                title: 'Some traders fear ETF pullback',
                selftext: 'Could still be volatile short-term',
                author: 'bob',
                subreddit: 'wallstreetbets',
                score: 77,
                upvote_ratio: 0.81,
                num_comments: 12,
                created_utc: 1700000001,
                permalink: '/r/wallstreetbets/comments/def/etf/',
                url: 'https://reddit.com/r/wallstreetbets/comments/def/etf/',
                is_self: true,
                link_flair_text: null,
                total_awards_received: 0,
                over_18: false,
              },
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // TikTok sentiment signal
    if (url.startsWith('https://www.tiktok.com/search')) {
      return new Response('<html>"playCount":"1000" "playCount":"2500" "diggCount":"300"</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch URL in prediction test: ${url}`);
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

describe('Prediction market /api/run variants', () => {
  test('GET /api/run?type=signal returns 402 payload when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=signal&market=bitcoin-etf'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.05');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/run?type=signal returns signal JSON after valid payment', async () => {
    const calls = installPredictionFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/run?type=signal&market=bitcoin+etf', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://gamma-api.polymarket.com/events'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://api.elections.kalshi.com/trade-api/v2/markets'))).toBe(true);

    const body = await res.json() as any;
    expect(body.type).toBe('signal');
    expect(body.market).toContain('bitcoin');
    expect(body.odds.polymarket.yes).toBe(0.62);
    expect(body.odds.kalshi.yes).toBe(0.58);
    expect(body.signals.arbitrage.detected).toBe(true);
    expect(body.sentiment.twitter.volume).toBeGreaterThan(0);
    expect(body.sentiment.reddit.volume).toBeGreaterThan(0);
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});
