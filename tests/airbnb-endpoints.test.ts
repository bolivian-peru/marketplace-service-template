import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_01 = '0x0000000000000000000000000000000000000000000000000000000000002710';
const USDC_AMOUNT_0_02 = '0x0000000000000000000000000000000000000000000000000000000000004e20';
const USDC_AMOUNT_0_05 = '0x000000000000000000000000000000000000000000000000000000000000c350';

let txCounter = 1000;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function airbnbSearchHtml(): string {
  return `
    <html><body>
      data-testid="card-container"
      <a href="/rooms/12345678">room</a>
      <div data-testid="listing-card-title">Oceanfront Studio in South Beach</div>
      <div data-testid="listing-card-subtitle">Entire apartment · 1 bedroom · 1 bathroom · 4 guests</div>
      <div>$189 per night</div>
      <div>4.9 (234 reviews)</div>
      <div>Superhost</div>
      <img src="https://a0.muscache.com/im/pictures/sample-1.jpg" />
      data-testid="card-container"
      <a href="/rooms/87654321">room</a>
      <div data-testid="listing-card-title">Downtown Loft</div>
      <div data-testid="listing-card-subtitle">Entire loft · 2 bedrooms · 1 bathroom · 5 guests</div>
      <div>$220 per night</div>
      <div>4.7 (120 reviews)</div>
      <img src="https://a0.muscache.com/im/pictures/sample-2.jpg" />
    </body></html>
  `;
}

function airbnbListingHtml(): string {
  return `
    <html><body>
      <script type="application/ld+json">{"name":"Oceanfront Studio in South Beach","description":"Walk to the beach and enjoy ocean views.","aggregateRating":{"ratingValue":"4.92","reviewCount":"234"}}</script>
      <div data-testid="listing-type">Entire apartment</div>
      <div>$189 per night</div>
      <div>Hosted by Maria</div>
      <div>1 bedroom · 1 bathroom · 4 guests</div>
      <div>Superhost</div>
      <img src="https://a0.muscache.com/im/pictures/sample-1.jpg" />
      <div>Check-in: 3:00 PM</div>
      <div>Checkout: 11:00 AM</div>
    </body></html>
  `;
}

function airbnbReviewsHtml(): string {
  return `
    <html><body>
      data-testid="pdp-review"
      <h3 class="review-author">Alex</h3>
      <div>January 2026</div>
      <div>5 out of 5 stars</div>
      <span data-testid="pdp-review-text">Great stay, very clean and close to the beach.</span>
      <span>Response from host: Thanks for staying with us!</span>
      data-testid="pdp-review"
      <h3 class="review-author">Jordan</h3>
      <div>December 2025</div>
      <div>4 out of 5 stars</div>
      <span data-testid="pdp-review-text">Good location and smooth check-in.</span>
    </body></html>
  `;
}

function installFetchMock(usdcAmountHex: string): string[] {
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
              toTopicAddress(TEST_WALLET),
            ],
            data: usdcAmountHex,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '198.51.100.25' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.airbnb.com/s/')) {
      return new Response(airbnbSearchHtml(), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://www.airbnb.com/rooms/12345678/reviews')) {
      return new Response(airbnbReviewsHtml(), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://www.airbnb.com/rooms/12345678')) {
      return new Response(airbnbListingHtml(), {
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
  process.env.SOLANA_WALLET_ADDRESS = TEST_WALLET;
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

describe('Airbnb endpoints', () => {
  test('GET /api/airbnb/search returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/search?location=Miami+Beach'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/airbnb/search');
  });

  test('GET /api/airbnb/search returns listings for a valid paid request', async () => {
    const calls = installFetchMock(USDC_AMOUNT_0_02);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/airbnb/search?location=Miami+Beach&guests=2&limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.airbnb.com/s/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.location).toBe('Miami Beach');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results[0].id).toBe('12345678');
    expect(body.results[0].price_per_night).toBe(189);
    expect(body.market_overview.avg_daily_rate).toBeGreaterThan(0);
    expect(body.payment.txHash).toBe(txHash);
  });

  test('GET /api/airbnb/listing/:id returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/listing/12345678'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/airbnb/listing/:id');
  });

  test('GET /api/airbnb/listing/:id returns listing details for paid request', async () => {
    installFetchMock(USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/airbnb/listing/12345678', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.listing.id).toBe('12345678');
    expect(body.listing.title).toContain('Oceanfront Studio');
    expect(body.listing.host.name).toContain('Maria');
    expect(body.payment.txHash).toBe(txHash);
  });

  test('GET /api/airbnb/reviews/:listing_id returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/reviews/12345678'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/airbnb/reviews/:listing_id');
  });

  test('GET /api/airbnb/reviews/:listing_id returns reviews for paid request', async () => {
    installFetchMock(USDC_AMOUNT_0_01);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/airbnb/reviews/12345678?limit=2', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(body.reviews.length).toBe(2);
    expect(body.reviews[0].author).toBe('Alex');
    expect(body.payment.txHash).toBe(txHash);
  });

  test('GET /api/airbnb/market-stats returns 402 when payment is missing', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/market-stats?location=Miami+Beach'));

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.resource).toBe('/api/airbnb/market-stats');
  });

  test('GET /api/airbnb/market-stats returns computed occupancy + revenue fields', async () => {
    installFetchMock(USDC_AMOUNT_0_05);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(new Request('http://localhost/api/airbnb/market-stats?location=Miami+Beach', {
      headers: {
        'X-Payment-Signature': txHash,
        'X-Payment-Network': 'base',
      },
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.stats.avg_daily_rate).toBeGreaterThan(0);
    expect(body.stats.avg_occupancy_estimate).toBeGreaterThan(0);
    expect(body.stats.monthly_revenue_potential).toBeGreaterThan(0);
  });
});
