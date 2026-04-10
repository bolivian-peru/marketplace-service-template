import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_03 = '0x0000000000000000000000000000000000000000000000000000000000007530';

let txCounter = 1000;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function buildInstagramUser(
  username: string,
  followers: number,
  captions: string[],
  isBusiness = false,
): any {
  return {
    username,
    full_name: username === 'traveljane' ? 'Jane Travel' : 'Biz Account',
    biography: username === 'traveljane'
      ? 'Travel influencer. #ad collabs welcome.'
      : 'Business profile for local products.',
    profile_pic_url: 'https://example.com/pic.jpg',
    edge_followed_by: { count: followers },
    edge_follow: { count: 500 },
    edge_owner_to_timeline_media: {
      count: captions.length,
      edges: captions.map((caption, i) => ({
        node: {
          id: `${username}-${i + 1}`,
          shortcode: `${username.toUpperCase()}${i + 1}`,
          __typename: 'GraphImage',
          edge_media_to_caption: { edges: [{ node: { text: caption } }] },
          edge_liked_by: { count: 1200 - i * 50 },
          edge_media_to_comment: { count: 70 - i * 3 },
          taken_at_timestamp: 1712500000 - i * 86400,
          display_url: `https://example.com/${username}-${i + 1}.jpg`,
          video_url: null,
          is_ad: caption.includes('#ad'),
        },
      })),
    },
    is_verified: false,
    is_business_account: isBusiness,
    is_private: false,
    category_name: isBusiness ? 'Business' : 'Creator',
    external_url: null,
  };
}

function installFetchMock(recipientAddress: string): string[] {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  const users: Record<string, any> = {
    traveljane: buildInstagramUser(
      'traveljane',
      125000,
      [
        'Amazing travel adventure in Bali #travel #lifestyle #ad',
        'Sunset at the beach and food tour #travel #food',
        'Mountain hiking weekend #adventure #travel',
      ],
      false,
    ),
    bizco: buildInstagramUser(
      'bizco',
      8500,
      [
        'New product launch this week #business',
        'Office highlights and team culture #startup',
      ],
      true,
    ),
  };

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
            data: USDC_AMOUNT_0_03,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://i.instagram.com/api/v1/users/web_profile_info/')) {
      const username = new URL(url).searchParams.get('username') || '';
      const user = users[username];
      if (!user) {
        return new Response(JSON.stringify({ data: { user: null } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { user } }), {
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
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('Instagram discover endpoint', () => {
  test('GET /api/instagram/discover returns 402 when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/instagram/discover?usernames=traveljane,bizco'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/instagram/discover');
    expect(body.price.amount).toBe('0.03');
  });

  test('GET /api/instagram/discover returns filtered matches for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request(
        'http://localhost/api/instagram/discover?usernames=traveljane,bizco&niche=travel&min_followers=10000&account_type=influencer&sentiment=neutral&brand_safe=true&limit=5',
        {
          headers: {
            'X-Payment-Signature': txHash,
            'X-Payment-Network': 'base',
          },
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some(url => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some(url => url.includes('i.instagram.com/api/v1/users/web_profile_info'))).toBe(true);

    const body = await res.json() as any;
    expect(body.total_processed).toBe(2);
    expect(body.total_matched).toBe(1);
    expect(body.accounts.length).toBe(1);
    expect(body.accounts[0].username).toBe('traveljane');
    expect(body.accounts[0].match_score).toBeGreaterThanOrEqual(80);
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});
