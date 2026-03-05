import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x2222222222222222222222222222222222222222';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const PERSON_HTML = `
<html>
  <head>
    <title>Jane Smith | LinkedIn</title>
    <script type="application/ld+json">{"@context":"https://schema.org","name":"Jane Smith","description":"CTO at TechCorp","address":{"addressLocality":"San Francisco, CA"},"knowsAbout":["Python","Machine Learning","System Design"]}</script>
  </head>
  <body>500+ connections</body>
</html>
`;

const COMPANY_HTML = `
<html>
  <head>
    <title>TechCorp | LinkedIn</title>
    <meta name="description" content="TechCorp builds AI infrastructure for enterprises." />
    <script type="application/ld+json">{"@context":"https://schema.org","name":"TechCorp","industry":"Software","address":{"addressLocality":"San Francisco, CA"},"url":"https://techcorp.example"}</script>
  </head>
  <body>
    <div>1,250 employees</div>
    <div>Headcount growth 22%</div>
    <div>34 job openings</div>
    <div>AWS Kubernetes TypeScript PostgreSQL</div>
  </body>
</html>
`;

let txCounter = 1000;
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
            data: '0x00000000000000000000000000000000000000000000000000000000000186a0', // 0.10 USDC
          }],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://api.ipify.org')) {
      return new Response(JSON.stringify({ ip: '198.51.100.24' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.startsWith('https://www.linkedin.com/in/')) {
      return new Response(PERSON_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (url.startsWith('https://www.linkedin.com/company/')) {
      return new Response(COMPANY_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    throw new Error(`Unexpected fetch URL in LinkedIn test: ${url}`);
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
  process.env.PROXY_CARRIER = 'AT&T';
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

describe('LinkedIn enrichment endpoints', () => {
  test('GET /api/linkedin/person returns 402 with x402 payload when payment is missing', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person?url=linkedin.com/in/jane-smith'),
    );

    expect(res.status).toBe(402);
    const body = await res.json() as any;

    expect(body.status).toBe(402);
    expect(body.resource).toBe('/api/linkedin/person');
    expect(body.price.amount).toBe('0.03');
  });

  test('GET /api/linkedin/person returns enriched person data for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/person?url=linkedin.com/in/jane-smith', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.includes('mainnet.base.org'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://www.linkedin.com/in/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.person.name).toBe('Jane Smith');
    expect(body.person.headline).toContain('CTO');
    expect(body.person.skills).toContain('Python');
    expect(body.person.meta.proxy.ip).toBe('198.51.100.24');
    expect(body.person.meta.proxy.carrier).toBe('AT&T');
    expect(body.payment.txHash).toBe(txHash);
    expect(body.payment.settled).toBe(true);
  });

  test('GET /api/linkedin/company returns enriched company data for a valid paid request', async () => {
    const calls = installFetchMock(TEST_WALLET);
    const txHash = nextBaseTxHash();

    const res = await app.fetch(
      new Request('http://localhost/api/linkedin/company?url=linkedin.com/company/techcorp', {
        headers: {
          'X-Payment-Signature': txHash,
          'X-Payment-Network': 'base',
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    expect(calls.some((url) => url.startsWith('https://www.linkedin.com/company/'))).toBe(true);

    const body = await res.json() as any;
    expect(body.company.name).toBe('TechCorp');
    expect(body.company.industry).toBe('Software');
    expect(body.company.employee_count).toBe('1,250');
    expect(body.company.growth_rate).toBe('22%');
    expect(body.company.job_openings).toBe(34);
    expect(Array.isArray(body.company.technology_signals)).toBe(true);
    expect(body.company.technology_signals).toContain('aws');
    expect(body.payment.txHash).toBe(txHash);
  });
});
