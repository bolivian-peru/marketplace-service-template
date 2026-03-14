/**
 * Mobile Ad Verification & Creative Intelligence Routes
 * ──────────────────────────────────────────────────────
 * Endpoints:
 *   GET /api/ads/search   — Search ad verification (Google Search ads)
 *   GET /api/ads/display  — Display ad detection on any URL
 *   GET /api/ads/advertiser — Advertiser intelligence lookup
 *   GET /api/ads/health   — Ad verification health check
 *
 * Pricing (x402 USDC):
 *   Search ads:  $0.03/check
 *   Display ads: $0.03/check
 *   Advertiser:  $0.05/check
 */

import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { getProxy } from '../proxy';
import {
  scrapeSearchAds,
  scrapeDisplayAds,
  lookupAdvertiser,
  detectAdNetworks,
  scoreBrandSafety,
  estimateViewability,
} from '../scrapers/ad-verification';
import type {
  SearchAdsResponse,
  DisplayAdsResponse,
  AdvertiserResponse,
} from '../types/ad-verification';

// ─── CONSTANTS ──────────────────────────────────────

function getWalletAddress(): string {
  return process.env.WALLET_ADDRESS || '';
}

const PRICE_SEARCH_ADS = 0.03;
const PRICE_DISPLAY_ADS = 0.03;
const PRICE_ADVERTISER = 0.05;

const SUPPORTED_COUNTRIES = ['US', 'GB', 'DE', 'FR', 'ES', 'PL'];

const CARRIER_NAMES: Record<string, string> = {
  US: 'T-Mobile',
  GB: 'Vodafone',
  DE: 'Deutsche Telekom',
  FR: 'Orange',
  ES: 'Movistar',
  PL: 'Play',
};

const SEARCH_ADS_DESCRIPTION =
  'Mobile Ad Verification: See exactly which Google Search ads appear for a query from a real mobile device on a real carrier network. ' +
  'Extracts ad copy, positions, extensions, ad networks, brand safety scores, and viewability estimates.';

const DISPLAY_ADS_DESCRIPTION =
  'Display Ad Intelligence: Detect display/banner ads, ad networks, tracking pixels, and brand safety signals on any webpage ' +
  'as seen from a real mobile carrier IP.';

const ADVERTISER_DESCRIPTION =
  'Advertiser Intelligence: Look up an advertiser by domain to see their ad activity, formats, regions, and Google Ads Transparency data.';

const SEARCH_ADS_SCHEMA = {
  input: {
    query: 'string (required) - search query to check ads for',
    country: `string (optional, default: "US") - ISO country code: ${SUPPORTED_COUNTRIES.join(', ')}`,
  },
  output: {
    type: '"search_ads"',
    query: 'string',
    country: 'string',
    ads: 'AdCreative[] - title, description, displayUrl, finalUrl, advertiser, extensions, position, placement',
    organic_count: 'number',
    total_ads: 'number',
    ad_positions: '{ top: number, bottom: number }',
    ad_networks: 'DetectedAdNetwork[] - name, type, trackingDomains, pixelCount',
    brand_safety: 'BrandSafetyScore - overall risk, score 0-100, flagged categories',
    viewability: 'ViewabilityEstimate - score 0-100, aboveFold, adDensity, pageLoadFactors',
    proxy: '{ country, carrier, type }',
  },
};

const DISPLAY_ADS_SCHEMA = {
  input: {
    url: 'string (required) - webpage URL to scan for ads',
    country: `string (optional, default: "US") - ISO country code: ${SUPPORTED_COUNTRIES.join(', ')}`,
  },
  output: {
    type: '"display_ads"',
    url: 'string',
    ads: 'DisplayAd[] - type, advertiser, landingUrl, adNetwork, dimensions, trackingPixels',
    ad_networks: 'DetectedAdNetwork[]',
    brand_safety: 'BrandSafetyScore',
    viewability: 'ViewabilityEstimate',
  },
};

const ADVERTISER_SCHEMA = {
  input: {
    domain: 'string (required) - advertiser domain to look up (e.g., "nordvpn.com")',
    country: `string (optional, default: "US") - ISO country code: ${SUPPORTED_COUNTRIES.join(', ')}`,
  },
  output: {
    type: '"advertiser"',
    advertiser: 'AdvertiserIntel - domain, name, verifiedByGoogle, adCount, adFormats, regions, transparencyUrl',
    recent_ads: 'AdCreative[] - recent search ads from this advertiser',
  },
};

// ─── VALIDATION ─────────────────────────────────────

function validateCountry(input: string | undefined): string {
  if (!input) return 'US';
  const normalized = input.trim().toUpperCase();
  if (SUPPORTED_COUNTRIES.includes(normalized)) return normalized;
  return 'US';
}

function sanitizeQuery(input: string | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 200) return null;
  if (/[\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

function validateUrl(input: string | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length > 2000) return null;

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

function validateDomain(input: string | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '');
  if (trimmed.length < 3 || trimmed.length > 100) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(trimmed)) return null;
  return trimmed;
}

// ─── ROUTER ─────────────────────────────────────────

export const adVerificationRouter = new Hono();

// Health check
adVerificationRouter.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'mobile-ad-verification',
    version: '1.0.0',
    supported_countries: SUPPORTED_COUNTRIES,
    endpoints: [
      '/api/ads/search',
      '/api/ads/display',
      '/api/ads/advertiser',
    ],
    timestamp: new Date().toISOString(),
  });
});

// ─── SEARCH ADS ENDPOINT ────────────────────────────

adVerificationRouter.get('/search', async (c) => {
  const WALLET_ADDRESS = getWalletAddress();
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/ads/search',
        SEARCH_ADS_DESCRIPTION,
        PRICE_SEARCH_ADS,
        WALLET_ADDRESS,
        SEARCH_ADS_SCHEMA,
      ),
      402,
    );
  }

  // Validate inputs
  const query = sanitizeQuery(c.req.query('query'));
  if (!query) {
    return c.json({ error: 'Missing or invalid "query" parameter. Provide a search query (1-200 chars).' }, 400);
  }

  const country = validateCountry(c.req.query('country'));

  // Verify payment
  let verification;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_SEARCH_ADS);
  } catch (err) {
    console.error('[AD-VERIFY] Payment verification error:', err);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // Scrape search ads
  try {
    const proxyConfig = getProxy();
    const result = await scrapeSearchAds(query, country);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.replace(/[\r\n]/g, '').slice(0, 256));

    const response: SearchAdsResponse = {
      type: 'search_ads',
      query,
      country,
      timestamp: new Date().toISOString(),
      ads: result.ads,
      organic_count: result.organicCount,
      total_ads: result.ads.length,
      ad_positions: {
        top: result.topCount,
        bottom: result.bottomCount,
      },
      ad_networks: result.adNetworks,
      brand_safety: result.brandSafety,
      viewability: result.viewability,
      proxy: {
        country: proxyConfig.country || country,
        carrier: CARRIER_NAMES[country] || 'Mobile',
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        amount: verification.amount ?? PRICE_SEARCH_ADS,
        verified: true,
      },
    };

    return c.json(response);
  } catch (err: any) {
    console.error('[AD-VERIFY] Search ads scrape error:', err);
    return c.json({
      error: 'Ad verification failed',
      message: err.message,
      suggestion: err.message.includes('CAPTCHA')
        ? 'Try again in a few seconds — the proxy IP may need rotation.'
        : 'Please retry the request.',
    }, 503);
  }
});

// ─── DISPLAY ADS ENDPOINT ───────────────────────────

adVerificationRouter.get('/display', async (c) => {
  const WALLET_ADDRESS = getWalletAddress();
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/ads/display',
        DISPLAY_ADS_DESCRIPTION,
        PRICE_DISPLAY_ADS,
        WALLET_ADDRESS,
        DISPLAY_ADS_SCHEMA,
      ),
      402,
    );
  }

  // Validate inputs
  const url = validateUrl(c.req.query('url'));
  if (!url) {
    return c.json({
      error: 'Missing or invalid "url" parameter. Provide a valid HTTPS URL.',
      example: '/api/ads/display?url=https://techcrunch.com&country=US',
    }, 400);
  }

  const country = validateCountry(c.req.query('country'));

  // Verify payment
  let verification;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_DISPLAY_ADS);
  } catch (err) {
    console.error('[AD-VERIFY] Payment verification error:', err);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  // Scrape display ads
  try {
    const proxyConfig = getProxy();
    const result = await scrapeDisplayAds(url, country);

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.replace(/[\r\n]/g, '').slice(0, 256));

    const response: DisplayAdsResponse = {
      type: 'display_ads',
      url,
      country,
      timestamp: new Date().toISOString(),
      ads: result.ads,
      total_ads: result.ads.length,
      ad_networks: result.adNetworks,
      brand_safety: result.brandSafety,
      viewability: result.viewability,
      proxy: {
        country: proxyConfig.country || country,
        carrier: CARRIER_NAMES[country] || 'Mobile',
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        amount: verification.amount ?? PRICE_DISPLAY_ADS,
        verified: true,
      },
    };

    return c.json(response);
  } catch (err: any) {
    console.error('[AD-VERIFY] Display ads scrape error:', err);
    return c.json({
      error: 'Display ad scan failed',
      message: err.message,
    }, 503);
  }
});

// ─── ADVERTISER INTELLIGENCE ENDPOINT ───────────────

adVerificationRouter.get('/advertiser', async (c) => {
  const WALLET_ADDRESS = getWalletAddress();
  if (!WALLET_ADDRESS) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response(
        '/api/ads/advertiser',
        ADVERTISER_DESCRIPTION,
        PRICE_ADVERTISER,
        WALLET_ADDRESS,
        ADVERTISER_SCHEMA,
      ),
      402,
    );
  }

  // Validate inputs
  const domain = validateDomain(c.req.query('domain'));
  if (!domain) {
    return c.json({
      error: 'Missing or invalid "domain" parameter. Provide a valid domain (e.g., "nordvpn.com").',
    }, 400);
  }

  const country = validateCountry(c.req.query('country'));

  // Verify payment
  let verification;
  try {
    verification = await verifyPayment(payment, WALLET_ADDRESS, PRICE_ADVERTISER);
  } catch (err) {
    console.error('[AD-VERIFY] Payment verification error:', err);
    return c.json({ error: 'Payment verification temporarily unavailable' }, 502);
  }

  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  try {
    const proxyConfig = getProxy();

    // Parallel: lookup advertiser info + search for their ads
    const [advertiser, searchResult] = await Promise.all([
      lookupAdvertiser(domain, country),
      scrapeSearchAds(domain, country).catch(() => ({
        ads: [],
        organicCount: 0,
        topCount: 0,
        bottomCount: 0,
        adNetworks: [] as any[],
        brandSafety: null,
        viewability: null,
      })),
    ]);

    // Filter ads to only those from this advertiser's domain
    const recentAds = searchResult.ads.filter(
      (ad) => ad.advertiser.includes(domain) || ad.finalUrl.includes(domain),
    );

    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash.replace(/[\r\n]/g, '').slice(0, 256));

    const response: AdvertiserResponse = {
      type: 'advertiser',
      domain,
      country,
      timestamp: new Date().toISOString(),
      advertiser,
      recent_ads: recentAds,
      ad_networks: searchResult.adNetworks,
      proxy: {
        country: proxyConfig.country || country,
        carrier: CARRIER_NAMES[country] || 'Mobile',
        type: 'mobile',
      },
      payment: {
        txHash: payment.txHash,
        amount: verification.amount ?? PRICE_ADVERTISER,
        verified: true,
      },
    };

    return c.json(response);
  } catch (err: any) {
    console.error('[AD-VERIFY] Advertiser lookup error:', err);
    return c.json({
      error: 'Advertiser intelligence failed',
      message: err.message,
    }, 503);
  }
});
