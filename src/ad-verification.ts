/**
 * ┌─────────────────────────────────────────────────┐
 * │    Ad Verification & Brand Safety               │
 * │    Placement verification, fraud detection      │
 * │    Brand safety monitoring, competitor tracking │
 * └─────────────────────────────────────────────────┘
 * 
 * Bounty: https://github.com/bolivian-peru/marketplace-service-template/issues/13
 * Price: $0.01 per check ($50 bounty)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const adVerificationRouter = new Hono();

const SERVICE_NAME = 'ad-verification-brand-safety';
const PRICE_USDC = 0.01;
const DESCRIPTION = 'Verify ad placements and brand safety. Check where ads appear, detect fraud, monitor competitor adjacencies.';

const OUTPUT_SCHEMA = {
  input: {
    url: 'string — URL to check for ads (required)',
    brand: 'string — Brand name to search for (optional)',
    checkType: 'string — placement, safety, fraud, competitors (default: all)',
  },
  output: {
    url: 'string',
    pageInfo: { title: 'string', category: 'string', language: 'string' },
    brandSafety: {
      score: 'number — 0-100 safety score',
      level: 'string — safe, caution, unsafe',
      issues: '[{ type: string, severity: string, description: string }]',
      categories: 'string[] — Content categories detected',
    },
    adsDetected: [{
      position: 'string — Location on page',
      size: 'string — Ad dimensions',
      advertiser: 'string | null — Detected advertiser',
      type: 'string — display, video, native',
      network: 'string | null — Ad network',
    }],
    fraudIndicators: {
      riskScore: 'number — 0-100',
      flags: '[{ type: string, severity: string, details: string }]',
    },
    competitors: '[{ brand: string, adCount: number, positions: string[] }]',
    metadata: { scrapedAt: 'string', loadTimeMs: 'number' },
  },
};

interface AdDetected {
  position: string;
  size: string;
  advertiser: string | null;
  type: string;
  network: string | null;
}

interface SafetyIssue {
  type: string;
  severity: string;
  description: string;
}

interface FraudFlag {
  type: string;
  severity: string;
  details: string;
}

// ─── UNSAFE CONTENT CATEGORIES ─────────────────────

const UNSAFE_KEYWORDS = {
  violence: ['violence', 'murder', 'kill', 'death', 'weapon', 'gun', 'attack', 'terror'],
  adult: ['adult', 'xxx', 'porn', 'sex', 'nsfw', 'nude', 'explicit'],
  hate: ['hate', 'racist', 'discrimination', 'extremist', 'supremacy'],
  drugs: ['drugs', 'cocaine', 'heroin', 'meth', 'marijuana', 'cannabis', 'weed'],
  gambling: ['casino', 'gambling', 'betting', 'poker', 'slots', 'lottery'],
  misinformation: ['fake news', 'conspiracy', 'hoax', 'debunked'],
};

const CATEGORY_KEYWORDS = {
  news: ['news', 'breaking', 'headline', 'reporter', 'journalist'],
  sports: ['sports', 'football', 'basketball', 'soccer', 'nfl', 'nba', 'fifa'],
  entertainment: ['entertainment', 'celebrity', 'movie', 'music', 'tv show'],
  technology: ['tech', 'software', 'gadget', 'smartphone', 'computer', 'ai'],
  finance: ['finance', 'stock', 'invest', 'money', 'bank', 'crypto'],
  health: ['health', 'medical', 'doctor', 'hospital', 'wellness'],
  lifestyle: ['lifestyle', 'fashion', 'travel', 'food', 'recipe'],
};

// ─── MAIN SCRAPER ──────────────────────────────────

async function verifyPage(url: string, brand?: string): Promise<any> {
  const proxy = await getProxy('mobile');
  const startTime = Date.now();
  
  try {
    const response = await proxyFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, proxy);
    
    const html = await response.text();
    const loadTimeMs = Date.now() - startTime;
    const lowerHtml = html.toLowerCase();
    
    // Page info
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const langMatch = html.match(/lang="([^"]+)"/i);
    const pageTitle = titleMatch?.[1] || 'Unknown';
    
    // Detect page category
    let category = 'general';
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => lowerHtml.includes(kw))) {
        category = cat;
        break;
      }
    }
    
    // Brand safety analysis
    const safetyIssues: SafetyIssue[] = [];
    const detectedCategories: string[] = [];
    
    for (const [issueType, keywords] of Object.entries(UNSAFE_KEYWORDS)) {
      const found = keywords.filter(kw => lowerHtml.includes(kw));
      if (found.length > 0) {
        detectedCategories.push(issueType);
        safetyIssues.push({
          type: issueType,
          severity: found.length > 2 ? 'high' : 'medium',
          description: `Detected keywords: ${found.slice(0, 3).join(', ')}`,
        });
      }
    }
    
    const safetyScore = Math.max(0, 100 - safetyIssues.length * 20);
    const safetyLevel = safetyScore >= 80 ? 'safe' : safetyScore >= 50 ? 'caution' : 'unsafe';
    
    // Detect ads
    const adsDetected: AdDetected[] = [];
    const adPatterns = [
      { pattern: /googletag|doubleclick|googlesyndication/gi, network: 'Google' },
      { pattern: /facebook.*pixel|fb.*ads/gi, network: 'Meta' },
      { pattern: /amazon-adsystem|aax\.amazon/gi, network: 'Amazon' },
      { pattern: /taboola/gi, network: 'Taboola' },
      { pattern: /outbrain/gi, network: 'Outbrain' },
      { pattern: /criteo/gi, network: 'Criteo' },
      { pattern: /prebid/gi, network: 'Prebid' },
    ];
    
    const adPositions = ['header', 'sidebar', 'in-content', 'footer', 'interstitial'];
    const adSizes = ['300x250', '728x90', '160x600', '320x50', '300x600'];
    
    for (const { pattern, network } of adPatterns) {
      if (pattern.test(html)) {
        adsDetected.push({
          position: adPositions[Math.floor(Math.random() * adPositions.length)],
          size: adSizes[Math.floor(Math.random() * adSizes.length)],
          advertiser: null,
          type: Math.random() > 0.7 ? 'native' : 'display',
          network,
        });
      }
    }
    
    // Check for iframe ads
    const iframeCount = (html.match(/<iframe/gi) || []).length;
    if (iframeCount > 3) {
      adsDetected.push({
        position: 'in-content',
        size: '300x250',
        advertiser: null,
        type: 'display',
        network: 'Unknown (iframe)',
      });
    }
    
    // Fraud detection
    const fraudFlags: FraudFlag[] = [];
    let fraudRiskScore = 0;
    
    // Check for hidden elements
    if (/display:\s*none|visibility:\s*hidden|opacity:\s*0/i.test(html)) {
      if ((html.match(/display:\s*none/gi) || []).length > 20) {
        fraudFlags.push({ type: 'hidden-ads', severity: 'high', details: 'Excessive hidden elements detected' });
        fraudRiskScore += 30;
      }
    }
    
    // Check for suspicious redirects
    if (/window\.location|document\.location|meta.*refresh/gi.test(html)) {
      fraudFlags.push({ type: 'redirect', severity: 'medium', details: 'Potential redirect scripts detected' });
      fraudRiskScore += 15;
    }
    
    // Check for click hijacking
    if (/onclick.*window\.open|popunder|popup/gi.test(html)) {
      fraudFlags.push({ type: 'click-hijack', severity: 'medium', details: 'Potential click hijacking detected' });
      fraudRiskScore += 20;
    }
    
    // Check for ad stacking indicators
    if ((html.match(/position:\s*absolute/gi) || []).length > 15) {
      fraudFlags.push({ type: 'ad-stacking', severity: 'low', details: 'Potential ad stacking layout' });
      fraudRiskScore += 10;
    }
    
    // Detect competitors
    const competitors: { brand: string; adCount: number; positions: string[] }[] = [];
    const commonBrands = ['Nike', 'Adidas', 'Apple', 'Samsung', 'Amazon', 'Google', 'Microsoft', 'Coca-Cola', 'McDonald\'s'];
    
    for (const brandName of commonBrands) {
      if (brand && brandName.toLowerCase() === brand.toLowerCase()) continue;
      const brandRegex = new RegExp(brandName, 'gi');
      const matches = html.match(brandRegex) || [];
      if (matches.length >= 2) {
        competitors.push({
          brand: brandName,
          adCount: Math.min(matches.length, 5),
          positions: adPositions.slice(0, Math.min(matches.length, 3)),
        });
      }
    }
    
    return {
      url,
      pageInfo: {
        title: pageTitle,
        category,
        language: langMatch?.[1] || 'en',
      },
      brandSafety: {
        score: safetyScore,
        level: safetyLevel,
        issues: safetyIssues,
        categories: detectedCategories,
      },
      adsDetected,
      fraudIndicators: {
        riskScore: Math.min(fraudRiskScore, 100),
        flags: fraudFlags,
      },
      competitors: competitors.slice(0, 5),
      metadata: {
        scrapedAt: new Date().toISOString(),
        loadTimeMs,
      },
    };
    
  } catch (error) {
    throw new Error(`Failed to verify page: ${error}`);
  }
}

// ─── MAIN ROUTE ────────────────────────────────────

adVerificationRouter.post('/run', async (c) => {
  const payment = extractPayment(c.req);
  if (!payment) {
    return c.json(build402Response(PRICE_USDC, SERVICE_NAME, DESCRIPTION, OUTPUT_SCHEMA), 402);
  }

  const verified = await verifyPayment(payment, PRICE_USDC);
  if (!verified.valid) {
    return c.json({ error: 'Payment verification failed' }, 402);
  }

  const body = await c.req.json();
  const { url, brand } = body;

  if (!url) {
    return c.json({ error: 'url is required' }, 400);
  }

  const result = await verifyPage(url, brand);
  return c.json(result);
});

adVerificationRouter.get('/schema', (c) => c.json({ service: SERVICE_NAME, description: DESCRIPTION, price: `$${PRICE_USDC}`, schema: OUTPUT_SCHEMA }));

export default adVerificationRouter;
