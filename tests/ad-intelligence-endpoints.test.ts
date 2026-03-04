import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_03 = '0x0000000000000000000000000000000000000000000000000000000000007530';

const SEARCH_HTML = `
<html>
  <body>
    <div id="tads">
      Sponsored
      <a href="https://nordvpn.com/deal">NordVPN - #1 VPN Service</a>
      <div>Military-grade encryption. 5,000+ servers.</div>
    </div>
    <div class="g">
      <a href="https://www.wired.com/story/best-vpn/">Best VPNs</a>
      <span class="st">Independent editorial review.</span>
    </div>
  </body>
</html>
`;

const DISPLAY_HTML = `
<html>
  <body>
    <iframe src="https://googleads.g.doubleclick.net/pagead/id"></iframe>
    <script src="https://cdn.taboola.com/libtrc/universal.js"></script>
    <img src="https://www.googleadservices.com/pagead/aclk?x=1" />
  </body>
</html>
`;

const ADVERTISER_HTML = `
<html><body>
<script>
{"headline":"Summer VPN Sale","targetUrl":"https:\\/\\/nordvpn.com\\/offer"}
</script>
</body></html>
`;

let txCounter = 100;
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
            data: USDC_AMOUNT_0_03,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.google.com/search?')) {
      return new Response(SEARCH_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://techcrunch.com')) {
      return new Response(DISPLAY_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://adstransparency.google.com/')) {
      return new Response(ADVERTISER_HTML, {
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

describe('Ad intelligence via /api/run', () => {
  test('returns 402 payload for ad mode without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/run?type=search_ads&query=best+vpn&country=US'));
    expect(res.status).toBe(402);

    const body = await res.json() as any;
    expect(body.resource).toBe('/api/run');
    expect(body.price.amount).toBe('0.03');
    expect(body.outputSchema?.input?.type).toContain('search_ads');
  });

  test('returns search ads payload for paid request', async () => {
    const calls = installFetchMock();
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/run?type=search_ads&query=best+vpn&country=US', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.type).toBe('search_ads');
    expect(body.query).toBe('best vpn');
    expect(body.country).toBe('US');
    expect(body.total_ads).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.ads)).toBe(true);
    expect(body.payment.txHash).toBe(txHash);
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/search?'))).toBe(true);
  });

  test('supports display_ads and advertiser modes', async () => {
    installFetchMock();

    const txDisplay = nextBaseTxHash();
    const displayRes = await app.fetch(new Request('http://localhost/api/run?type=display_ads&url=https://techcrunch.com&country=DE', {
      headers: {
        'X-Payment-Signature': txDisplay,
        'X-Payment-Network': 'base',
      },
    }));

    expect(displayRes.status).toBe(200);
    const displayBody = await displayRes.json() as any;
    expect(displayBody.type).toBe('display_ads');
    expect(displayBody.country).toBe('DE');
    expect(displayBody.total_ads).toBeGreaterThanOrEqual(1);

    const txAdvertiser = nextBaseTxHash();
    const advertiserRes = await app.fetch(new Request('http://localhost/api/run?type=advertiser&domain=nordvpn.com&country=US', {
      headers: {
        'X-Payment-Signature': txAdvertiser,
        'X-Payment-Network': 'base',
      },
    }));

    expect(advertiserRes.status).toBe(200);
    const advertiserBody = await advertiserRes.json() as any;
    expect(advertiserBody.type).toBe('advertiser');
    expect(advertiserBody.domain).toBe('nordvpn.com');
    expect(Array.isArray(advertiserBody.ads_found)).toBe(true);
  });
});
