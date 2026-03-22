import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// USDC amounts: 6 decimals, so $0.03 = 30000, $0.05 = 50000, $0.10 = 100000
const USDC_AMOUNT_0_03 = '0x0000000000000000000000000000000000000000000000000000000000007530';   // 30000
const USDC_AMOUNT_0_05 = '0x000000000000000000000000000000000000000000000000000000000000c350';   // 50000
const USDC_AMOUNT_0_10 = '0x00000000000000000000000000000000000000000000000000000000000186a0';  // 100000

// Minimal LinkedIn profile HTML
const LINKEDIN_PERSON_HTML = `
<html>
<head>
  <title>Jane Doe - LinkedIn</title>
  <meta name="description" content="Software Engineer at Acme Corp. Jane Doe is a software engineer.">
  <script type="application/ld+json">{"@type":"Person","name":"Jane Doe","description":"Software Engineer at Acme Corp","address":{"addressLocality":"San Francisco, CA"}}</script>
</head>
<body></body>
</html>`;

// Minimal LinkedIn company HTML
const LINKEDIN_COMPANY_HTML = `
<html>
<head>
  <title>Acme Corp - LinkedIn</title>
  <meta name="description" content="Acme Corp is a leading technology company.">
  <script type="application/ld+json">{"@type":"Organization","name":"Acme Corp","description":"A leading technology company","address":{"addressLocality":"San Francisco, CA"}}</script>
</head>
<body><span>5,000 employees</span></body>
</html>`;

// Minimal Google search results for LinkedIn profiles
const GOOGLE_SEARCH_HTML = `
<html>
<body>
<a href="https://www.linkedin.com/in/johndoe">
<h3>John Doe - CTO at Tech Co</h3>
</a>
<a href="https://www.linkedin.com/in/janedoe">
<h3>Jane Doe - CTO at Startup</h3>
</a>
</body>
</html>`;

let txCounter = 100;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
  return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(
  recipientAddress: string,
  usdcAmount: string,
  linkedInHtml: string = LINKEDIN_PERSON_HTML,
): string[] {
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
            data: usdcAmount,
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('linkedin.com/in/') || url.includes('linkedin.com/company/')) {
      const isCompany = url.includes('linkedin.com/company/');
      return new Response(isCompany ? LINKEDIN_COMPANY_HTML : linkedInHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://www.google.com/')) {
      return new Response(GOOGLE_SEARCH_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // ipify proxy check
    if (url.includes('ipify.org') || url.includes('ifconfig.me')) {
      return new Response(JSON.stringify({ ip: '1.2.3.4' }), {
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
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('LinkedIn Person Profile endpoint', () => {
  test('GET /api/linkedin/person returns 402 when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person?url=linkedin.com/in/janedoe'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/linkedin/person');
    expect(body.price.amount).toBe('0.03');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/linkedin/person returns 400 when url is missing', async () => {
    installFetchMock(TEST_WALLET, USDC_AMOUNT_0_03);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  test('GET /api/linkedin/person returns 400 for invalid LinkedIn URL', async () => {
    installFetchMock(TEST_WALLET, USDC_AMOUNT_0_03);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person?url=https://example.com/invalid', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
  });

  test('GET /api/linkedin/person returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_03);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person?url=https://linkedin.com/in/janedoe', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('linkedin.com/in/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.person).toBeDefined();
    expect(body.person.name).toBeDefined();
    expect(body.person.meta.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});

describe('LinkedIn Company Profile endpoint', () => {
  test('GET /api/linkedin/company returns 402 when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company?url=linkedin.com/company/acme'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/linkedin/company');
    expect(body.price.amount).toBe('0.05');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/linkedin/company returns 400 when url is missing', async () => {
    installFetchMock(TEST_WALLET, USDC_AMOUNT_0_05, LINKEDIN_COMPANY_HTML);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
  });

  test('GET /api/linkedin/company returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_05, LINKEDIN_COMPANY_HTML);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company?url=https://linkedin.com/company/acme-corp', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.includes('linkedin.com/company/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.company).toBeDefined();
    expect(body.company.name).toBeDefined();
    expect(body.company.meta.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});

describe('LinkedIn People Search endpoint', () => {
  test('GET /api/linkedin/search/people returns 402 when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/search/people?title=CTO'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/linkedin/search/people');
    expect(body.price.amount).toBe('0.1');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/linkedin/search/people returns 400 when title is missing', async () => {
    installFetchMock(TEST_WALLET, USDC_AMOUNT_0_10);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/search/people?location=San+Francisco', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(400);
  });

  test('GET /api/linkedin/search/people returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_10);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/search/people?title=CTO&location=San+Francisco&limit=5', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/'))).toBe(true);

    const body = await res.json() as any;
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.meta.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});

describe('LinkedIn Company Employees endpoint', () => {
  test('GET /api/linkedin/company/:id/employees returns 402 when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company/google/employees'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.status).toBe(402);
    expect(body.price.amount).toBe('0.1');
    expect(body.message).toBe('Payment required');
  });

  test('GET /api/linkedin/company/:id/employees returns 200 for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET, USDC_AMOUNT_0_10);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company/google/employees?title=engineer&limit=5', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.google.com/'))).toBe(true);

    const body = await res.json() as any;
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.meta.proxy.type).toBe('mobile');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.network).toBe('base');
    expect(body.payment.settled).toBe(true);
  });
});
