import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';
import {
  detectAdNetworks,
  scoreBrandSafety,
  estimateViewability,
} from '../src/scrapers/ad-verification';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_003 = '0x0000000000000000000000000000000000000000000000000000000000007530'; // 0.03 USDC (30000 / 10^6)
const USDC_AMOUNT_005 = '0x000000000000000000000000000000000000000000000000000000000000c350'; // 0.05 USDC (50000 / 10^6)

let txCounter = 100;
let restoreFetch: (() => void) | null = null;

// Set proxy env vars so getProxy() doesn't throw
process.env.PROXY_HOST = '127.0.0.1';
process.env.PROXY_HTTP_PORT = '8080';
process.env.PROXY_USER = 'testuser';
process.env.PROXY_PASS = 'testpass';

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

const GOOGLE_SEARCH_HTML_WITH_ADS = `
<html>
<head><title>best vpn - Google Search</title></head>
<body>
<div id="tads" class="uEierd">
  <div class="mnr-c">
    <a href="/aclk?adurl=https://www.nordvpn.com/deal&sa=l" data-rw>
      <h3>NordVPN - #1 VPN Service</h3>
    </a>
    <div class="MUxGbd">Military-grade encryption. 5,000+ servers worldwide. Get 68% off.</div>
    <a class="fl sitelink" href="https://nordvpn.com/pricing">Pricing</a>
    <a class="fl sitelink" href="https://nordvpn.com/features">Features</a>
  </div>
  <div class="mnr-c">
    <a href="/aclk?adurl=https://www.expressvpn.com/offer&sa=l" data-rw>
      <h3>ExpressVPN - Trusted VPN</h3>
    </a>
    <div class="MUxGbd">Lightning-fast VPN. 94 countries. From $6.67/mo. Try risk-free.</div>
  </div>
</div>
<div id="rso">
  <div class="MjjYud"><div class="g"><h3>10 Best VPNs of 2024</h3></div></div>
  <div class="MjjYud"><div class="g"><h3>VPN Comparison Guide</h3></div></div>
  <div class="MjjYud"><div class="g"><h3>Reddit: Best VPN recommendations</h3></div></div>
</div>
<div id="bottomads">
  <div class="mnr-c">
    <a href="/aclk?adurl=https://www.surfshark.com/deal&sa=l" data-rw>
      <h3>Surfshark VPN - Best Deal</h3>
    </a>
    <div class="MUxGbd">Unlimited devices. 3,200+ servers. 82% off + 2 months free.</div>
  </div>
</div>
<script src="https://www.googletagmanager.com/gtag/js"></script>
</body>
</html>
`;

const WEBPAGE_WITH_DISPLAY_ADS = `
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://securepubads.g.doubleclick.net/gpt/pubads_impl.js"></script>
  <script src="https://pagead2.googlesyndication.com/tag/js/gpt.js"></script>
</head>
<body>
  <div id="gpt-ad-header" class="ad-slot dfp-ad">
    <iframe src="https://tpc.googlesyndication.com/safeframe/ad123" width="320" height="50"></iframe>
  </div>
  <article>
    <h1>Tech News Article</h1>
    <p>Some safe news content about technology.</p>
  </article>
  <div class="adsbygoogle-container">
    <ins class="adsbygoogle" data-ad-slot="1234567890" style="display:block"></ins>
  </div>
  <div class="ad-unit banner" id="ad-sidebar">
    <a href="https://example-advertiser.com/product?utm_source=display">
      <img src="https://cdn.example.com/banner.jpg" width="300" height="250">
    </a>
    <img src="https://tracking.criteo.com/pixel?id=123" width="1" height="1" style="display:none">
  </div>
  <script src="https://cdn.taboola.com/libtrc/loader.js"></script>
  <script>
    fbq('track', 'PageView');
  </script>
  <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
</body>
</html>
`;

function installFetchMock(recipientAddress: string, usdcAmount: string, mockHtml: string): string[] {
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
              toTopicAddress('0x2222222222222222222222222222222222222222'),
              toTopicAddress(recipientAddress),
            ],
            data: usdcAmount,
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Mock proxy/Google/web fetches
    return new Response(mockHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }) as typeof fetch;

  restoreFetch = () => { globalThis.fetch = originalFetch; };
  return calls;
}

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

// ─── UNIT TESTS ─────────────────────────────────────

describe('Ad Network Detection', () => {
  test('detects Google ad networks', () => {
    const html = '<script src="https://pagead2.googlesyndication.com/tag/js/gpt.js"></script>';
    const networks = detectAdNetworks(html);
    expect(networks.length).toBeGreaterThan(0);
    expect(networks.some(n => n.name.startsWith('google'))).toBe(true);
  });

  test('detects multiple ad networks', () => {
    const html = `
      <script src="https://cdn.taboola.com/loader.js"></script>
      <script src="https://connect.facebook.net/fbevents.js"></script>
      <script src="https://securepubads.g.doubleclick.net/gpt.js"></script>
    `;
    const networks = detectAdNetworks(html);
    expect(networks.length).toBeGreaterThanOrEqual(2);
  });

  test('returns empty for clean page', () => {
    const html = '<html><body><p>Hello world</p></body></html>';
    const networks = detectAdNetworks(html);
    expect(networks.length).toBe(0);
  });
});

describe('Brand Safety Scoring', () => {
  test('scores safe content highly', () => {
    const html = '<html><body><p>This is a normal technology news article about cloud computing.</p></body></html>';
    const score = scoreBrandSafety(html);
    expect(score.overall).toBe('low');
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.categories).toContain('safe');
  });

  test('flags adult content', () => {
    const html = '<html><body><p>This page has porn and xxx adult content nsfw material.</p></body></html>';
    const score = scoreBrandSafety(html);
    expect(score.score).toBeLessThan(80);
    expect(score.pageContent.hasAdultContent).toBe(true);
  });

  test('flags gambling content', () => {
    const html = '<html><body><p>Online casino gambling and betting with slot machine games.</p></body></html>';
    const score = scoreBrandSafety(html);
    expect(score.categories).toContain('gambling');
    expect(score.pageContent.hasGamblingContent).toBe(true);
  });

  test('flags multiple categories', () => {
    const html = '<html><body><p>Buy guns and buy weed from drug dealer. Online casino gambling.</p></body></html>';
    const score = scoreBrandSafety(html);
    expect(score.categories.length).toBeGreaterThan(1);
    expect(score.score).toBeLessThanOrEqual(60);
  });
});

describe('Viewability Estimation', () => {
  test('gives reasonable score for mobile-optimized page', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width"></head><body><p>Content</p></body></html>';
    const estimate = estimateViewability(html, 2);
    expect(estimate.score).toBeGreaterThan(50);
    expect(estimate.pageLoadFactors.mobileOptimized).toBe(true);
  });

  test('penalizes high ad density', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const lowDensity = estimateViewability(html, 1);
    const highDensity = estimateViewability(html, 8);
    expect(lowDensity.score).toBeGreaterThan(highDensity.score);
  });

  test('detects lazy loading', () => {
    const html = '<html><body><img loading="lazy" src="image.jpg"></body></html>';
    const estimate = estimateViewability(html, 1);
    expect(estimate.pageLoadFactors.hasLazyLoading).toBe(true);
  });
});

// ─── ENDPOINT TESTS ─────────────────────────────────

describe('Ad Verification Endpoints', () => {
  test('GET /api/ads/health returns healthy', async () => {
    const res = await app.fetch(new Request('http://localhost/api/ads/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('mobile-ad-verification');
    expect(body.supported_countries).toContain('US');
    expect(body.supported_countries).toContain('DE');
  });

  test('GET /api/ads/search without payment returns 402', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    const res = await app.fetch(new Request('http://localhost/api/ads/search?query=best+vpn&country=US'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/ads/search');
    expect(body.price.amount).toBe('0.03');
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/search without query returns 400', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_003, GOOGLE_SEARCH_HTML_WITH_ADS);

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/search', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(400);
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/search with payment returns ads', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_003, GOOGLE_SEARCH_HTML_WITH_ADS);

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/search?query=best+vpn&country=US', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('search_ads');
    expect(body.query).toBe('best vpn');
    expect(body.country).toBe('US');
    expect(body.ads).toBeDefined();
    expect(body.total_ads).toBeGreaterThanOrEqual(0);
    expect(body.ad_positions).toBeDefined();
    expect(body.brand_safety).toBeDefined();
    expect(body.viewability).toBeDefined();
    expect(body.proxy.type).toBe('mobile');
    expect(body.payment.verified).toBe(true);
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/display without payment returns 402', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    const res = await app.fetch(new Request('http://localhost/api/ads/display?url=https://techcrunch.com&country=US'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/ads/display');
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/display with payment returns ad data', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_003, WEBPAGE_WITH_DISPLAY_ADS);

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/display?url=https://techcrunch.com&country=US', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('display_ads');
    expect(body.url).toBe('https://techcrunch.com');
    expect(body.ads).toBeDefined();
    expect(body.ad_networks).toBeDefined();
    expect(body.brand_safety).toBeDefined();
    expect(body.brand_safety.overall).toBe('low');
    expect(body.viewability).toBeDefined();
    expect(body.payment.verified).toBe(true);
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/display rejects private URLs', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_003, '');

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/display?url=http://192.168.1.1/admin', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(400);
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/advertiser without payment returns 402', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    const res = await app.fetch(new Request('http://localhost/api/ads/advertiser?domain=nordvpn.com&country=US'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/ads/advertiser');
    expect(body.price.amount).toBe('0.05');
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/advertiser with payment returns data', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_005, GOOGLE_SEARCH_HTML_WITH_ADS);

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/advertiser?domain=nordvpn.com&country=US', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe('advertiser');
    expect(body.domain).toBe('nordvpn.com');
    expect(body.advertiser).toBeDefined();
    expect(body.advertiser.domain).toBe('nordvpn.com');
    expect(body.payment.verified).toBe(true);
    delete process.env.WALLET_ADDRESS;
  });

  test('GET /api/ads/advertiser rejects invalid domain', async () => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    installFetchMock(TEST_WALLET, USDC_AMOUNT_005, '');

    const txHash = nextBaseTxHash();
    const res = await app.fetch(new Request('http://localhost/api/ads/advertiser?domain=not-a-domain', {
      headers: {
        'Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));
    expect(res.status).toBe(400);
    delete process.env.WALLET_ADDRESS;
  });
});
