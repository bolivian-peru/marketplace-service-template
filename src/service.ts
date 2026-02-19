/**
 * Service Router — TikTok Trend Intelligence API (Bounty #51)
 *
 * Endpoints:
 *   GET /api/run?type=trending
 *   GET /api/run?type=hashtag
 *   GET /api/run?type=creator
 *   GET /api/run?type=sound
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { getTrending, getHashtagData, getCreatorProfile, getSoundData } from './scrapers/tiktok-scraper';

export const serviceRouter = new Hono();

const WALLET_ADDRESS = process.env.WALLET_ADDRESS || '6eUdVwsPArTxwVqEARYGCh4S2qwW2zCs7jSEDRpxydnv';

async function getProxyExitIp(): Promise<string | null> {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', {
      headers: { 'Accept': 'application/json' },
      maxRetries: 1,
      timeoutMs: 15_000,
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    return typeof data?.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  }
}

// ─── GET /api/run — unified endpoint per bounty spec ─

serviceRouter.get('/run', async (c) => {
  const type = c.req.query('type');
  if (!type) return c.json({ error: 'Missing required parameter: type', valid_types: ['trending', 'hashtag', 'creator', 'sound'] }, 400);

  const priceMap: Record<string, number> = {
    trending: 0.02,
    hashtag: 0.01,
    creator: 0.02,
    sound: 0.01,
  };

  const price = priceMap[type];
  if (!price) return c.json({ error: `Invalid type: ${type}`, valid_types: Object.keys(priceMap) }, 400);

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(
      `/api/run?type=${type}`,
      `TikTok Trend Intelligence — ${type}. Extract trending content, hashtags, sounds, and creator profiles from TikTok via real mobile proxies.`,
      price,
      WALLET_ADDRESS,
      {
        input: {
          type: `"${type}" (required)`,
          ...(type === 'trending' ? { country: 'string (optional, default: "US")' } : {}),
          ...(type === 'hashtag' ? { tag: 'string (required) — hashtag name without #', country: 'string (optional, default: "US")' } : {}),
          ...(type === 'creator' ? { username: 'string (required) — TikTok username with or without @' } : {}),
          ...(type === 'sound' ? { id: 'string (required) — TikTok sound/music ID' } : {}),
        },
        output: type === 'trending'
          ? { country: 'string', videos: 'TikTokVideo[]', trending_hashtags: '[]', trending_sounds: '[]' }
          : type === 'hashtag'
            ? { tag: 'string', videos: 'TikTokVideo[]', total_views: 'number' }
            : type === 'creator'
              ? { username: 'string', nickname: 'string', followers: 'number', following: 'number', likes: 'number', recent_videos: '[]' }
              : { sound_id: 'string', name: 'string', author: 'string', uses: 'number', videos: '[]' },
      },
    ), 402);
  }

  const verification = await verifyPayment(payment, WALLET_ADDRESS, price);
  if (!verification.valid) return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);

  try {
    const proxy = getProxy();
    const ip = await getProxyExitIp();
    let result: any;

    switch (type) {
      case 'trending': {
        const country = c.req.query('country') || 'US';
        result = await getTrending(country, proxyFetch);
        break;
      }
      case 'hashtag': {
        const tag = c.req.query('tag');
        if (!tag) return c.json({ error: 'Missing required parameter: tag' }, 400);
        const country = c.req.query('country') || 'US';
        result = await getHashtagData(tag, country, proxyFetch);
        break;
      }
      case 'creator': {
        const username = c.req.query('username');
        if (!username) return c.json({ error: 'Missing required parameter: username' }, 400);
        result = await getCreatorProfile(username, proxyFetch);
        break;
      }
      case 'sound': {
        const id = c.req.query('id');
        if (!id) return c.json({ error: 'Missing required parameter: id' }, 400);
        result = await getSoundData(id, proxyFetch);
        break;
      }
    }

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    return c.json({
      type,
      timestamp: new Date().toISOString(),
      data: result,
      proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
      payment: { txHash: payment.txHash, network: payment.network, amount: verification.amount, verified: true },
    });
  } catch (err: any) {
    return c.json({ error: `TikTok ${type} fetch failed`, message: err?.message || String(err) }, 502);
  }
});
