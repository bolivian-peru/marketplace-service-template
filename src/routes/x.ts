import { Hono, type Context } from 'hono';
import { build402Response, extractPayment, verifyPayment } from '../payment';
import { getProxy, proxyFetch } from '../proxy';
import { getXThread, getXTrending, getXUser, getXUserTweets, searchX, type XSortMode } from '../scrapers/x-scraper';

export const xRouter = new Hono();

const PRICE_SEARCH = 0.01;
const PRICE_TRENDING = 0.005;
const PRICE_USER = 0.01;
const PRICE_THREAD = 0.02;

function getWalletAddress(): string {
  return process.env.WALLET_ADDRESS ?? "";
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? String(fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseCountry(raw: string | undefined): string {
  if (!raw) return 'US';
  const country = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return 'US';
  return country;
}

function parseSort(raw: string | undefined): XSortMode {
  return raw?.toLowerCase() === 'top' ? 'top' : 'latest';
}

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      timeoutMs: 8_000,
      maxRetries: 1,
    });

    if (!r.ok) return null;
    const payload = await r.json() as { ip?: unknown };
    return typeof payload.ip === 'string' ? payload.ip : null;
  } catch {
    return null;
  }
}

async function verifyPaidRequest(c: Context, price: number, resource: string, description: string, outputSchema: Record<string, unknown>) {
  const walletAddress = getWalletAddress();
  if (!walletAddress) {
    return { response: c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500) };
  }

  const payment = extractPayment(c);
  if (!payment) {
    return { response: c.json(build402Response(resource, description, price, walletAddress, outputSchema), 402) };
  }

  const verification = await verifyPayment(payment, walletAddress, price);
  if (!verification.valid) {
    return { response: c.json({ error: 'Payment verification failed', reason: verification.error }, 402) };
  }

  return {
    payment,
    verification,
    response: null,
  };
}

xRouter.get('/search', async (c) => {
  const verified = await verifyPaidRequest(
    c,
    PRICE_SEARCH,
    '/api/x/search',
    'Search X/Twitter by keyword or hashtag via mobile proxy intelligence.',
    {
      input: {
        query: 'string (required)',
        sort: '"latest" | "top" (default: latest)',
        limit: 'number (default: 20, max: 50)',
      },
      output: {
        query: 'string',
        sort: 'string',
        results: 'XSearchResult[]',
      },
    },
  );
  if (verified.response) return verified.response;

  const query = c.req.query('query');
  if (!query) {
    return c.json({ error: 'Missing required parameter: query', example: '/api/x/search?query=openclaw&sort=latest&limit=20' }, 400);
  }

  const sort = parseSort(c.req.query('sort'));
  const limit = parseLimit(c.req.query('limit'), 20, 50);

  const proxy = getProxy();
  const ip = await getProxyExitIp();
  const results = await searchX(query, sort, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', verified.payment.txHash);

  return c.json({
    query,
    sort,
    results,
    meta: {
      total_results: results.length,
      proxy: { ip, country: proxy.country, carrier: process.env.PROXY_CARRIER || 'mobile', type: 'mobile' },
    },
    payment: {
      txHash: verified.payment.txHash,
      network: verified.payment.network,
      amount: verified.verification.amount,
      settled: true,
    },
  });
});

xRouter.get('/trending', async (c) => {
  const verified = await verifyPaidRequest(
    c,
    PRICE_TRENDING,
    '/api/x/trending',
    'Get trending X/Twitter topics by country.',
    {
      input: {
        country: 'string (optional, default: US)',
        limit: 'number (default: 20, max: 50)',
      },
      output: {
        country: 'string',
        trends: 'XSearchResult[]',
      },
    },
  );
  if (verified.response) return verified.response;

  const country = parseCountry(c.req.query('country'));
  const limit = parseLimit(c.req.query('limit'), 20, 50);

  const proxy = getProxy();
  const ip = await getProxyExitIp();
  const trends = await getXTrending(country, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', verified.payment.txHash);

  return c.json({
    country,
    trends,
    meta: {
      total_results: trends.length,
      proxy: { ip, country: proxy.country, carrier: process.env.PROXY_CARRIER || 'mobile', type: 'mobile' },
    },
    payment: {
      txHash: verified.payment.txHash,
      network: verified.payment.network,
      amount: verified.verification.amount,
      settled: true,
    },
  });
});

xRouter.get('/user/:handle', async (c) => {
  const verified = await verifyPaidRequest(
    c,
    PRICE_USER,
    '/api/x/user/:handle',
    'Get X/Twitter user profile by handle.',
    {
      input: { handle: 'string (required, in URL path)' },
      output: { user: 'XUserProfile' },
    },
  );
  if (verified.response) return verified.response;

  const handle = c.req.param('handle');
  if (!handle) return c.json({ error: 'Missing handle in URL path' }, 400);

  const proxy = getProxy();
  const ip = await getProxyExitIp();
  const user = await getXUser(handle);

  if (!user) {
    return c.json({ error: 'User profile not found or unavailable' }, 404);
  }

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', verified.payment.txHash);

  return c.json({
    user,
    meta: { proxy: { ip, country: proxy.country, carrier: process.env.PROXY_CARRIER || 'mobile', type: 'mobile' } },
    payment: {
      txHash: verified.payment.txHash,
      network: verified.payment.network,
      amount: verified.verification.amount,
      settled: true,
    },
  });
});

xRouter.get('/user/:handle/tweets', async (c) => {
  const verified = await verifyPaidRequest(
    c,
    PRICE_USER,
    '/api/x/user/:handle/tweets',
    'Get recent tweets by X handle.',
    {
      input: {
        handle: 'string (required, in URL path)',
        limit: 'number (default: 20, max: 50)',
      },
      output: { tweets: 'XSearchResult[]' },
    },
  );
  if (verified.response) return verified.response;

  const handle = c.req.param('handle');
  if (!handle) return c.json({ error: 'Missing handle in URL path' }, 400);

  const limit = parseLimit(c.req.query('limit'), 20, 50);
  const proxy = getProxy();
  const ip = await getProxyExitIp();
  const tweets = await getXUserTweets(handle, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', verified.payment.txHash);

  return c.json({
    handle: handle.startsWith('@') ? handle : `@${handle}`,
    tweets,
    meta: {
      total_results: tweets.length,
      proxy: { ip, country: proxy.country, carrier: process.env.PROXY_CARRIER || 'mobile', type: 'mobile' },
    },
    payment: {
      txHash: verified.payment.txHash,
      network: verified.payment.network,
      amount: verified.verification.amount,
      settled: true,
    },
  });
});

xRouter.get('/thread/:tweet_id', async (c) => {
  const verified = await verifyPaidRequest(
    c,
    PRICE_THREAD,
    '/api/x/thread/:tweet_id',
    'Extract root tweet + conversation context by tweet id.',
    {
      input: {
        tweet_id: 'string (required, in URL path)',
        limit: 'number (default: 20, max: 50)',
      },
      output: { thread: 'XThreadResult' },
    },
  );
  if (verified.response) return verified.response;

  const tweetId = c.req.param('tweet_id');
  if (!tweetId) return c.json({ error: 'Missing tweet_id in URL path' }, 400);

  const limit = parseLimit(c.req.query('limit'), 20, 50);
  const proxy = getProxy();
  const ip = await getProxyExitIp();
  const thread = await getXThread(tweetId, limit);

  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', verified.payment.txHash);

  return c.json({
    thread,
    meta: {
      proxy: { ip, country: proxy.country, carrier: process.env.PROXY_CARRIER || 'mobile', type: 'mobile' },
    },
    payment: {
      txHash: verified.payment.txHash,
      network: verified.payment.network,
      amount: verified.verification.amount,
      settled: true,
    },
  });
});
