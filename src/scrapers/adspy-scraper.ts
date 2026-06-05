/**
 * Ad Spy & Creative Intelligence API
 * ──────────────────────────────────
 * Monitors competitor ads across Google, Facebook Ad Library, and TikTok.
 * Extracts ad copy, images, landing pages, and estimated metrics.
 *
 * Bounty: Wave 2 — $50 Ad Spy & Creative Intelligence
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ───────────────────────────────────────────

export interface AdCreative {
  /** Ad title / headline */
  headline: string;
  /** Ad body text */
  body: string | null;
  /** Call to action */
  cta: string | null;
  /** Landing page URL */
  landingUrl: string | null;
  /** Display URL shown in ad */
  displayUrl: string | null;
  /** Ad image / video URL */
  creativeUrl: string | null;
  /** Advertiser / brand name */
  advertiser: string | null;
  /** Platform where ad was found */
  platform: string;
  /** Ad format (text, image, video, carousel) */
  format: 'text' | 'image' | 'video' | 'carousel' | 'unknown';
  /** Estimated impressions or reach */
  impressions: string | null;
  /** Date ad was first seen */
  firstSeen: string | null;
  /** Date ad was last seen */
  lastSeen: string | null;
  /** Ad ID on platform */
  adId: string | null;
  /** Timestamp of this check */
  checkedAt: string;
}

export interface AdSpyResponse {
  query: { keyword?: string; advertiser?: string; platform?: string };
  results: AdCreative[];
  totalFound: number;
  platforms: string[];
}

// ─── FACEBOOK AD LIBRARY ────────────────────────────

async function scrapeFacebookAds(query: string): Promise<AdCreative[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encoded}&search_type=keyword_unordered&media_type=all`;

  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US' },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) return [];
  const html = await response.text();

  const results: AdCreative[] = [];

  // Extract embedded ad data from Facebook's __datalet payload
  const dataRegex = /"snapshot":\s*\{[^}]+\}/g;
  let match;
  while ((match = dataRegex.exec(html)) !== null) {
    try {
      const block = match[0];
      const adId = block.match(/"adArchiveID":"(\d+)"/)?.[1] || null;
      const headline = block.match(/"pageName":"([^"]+)"/)?.[1] || null;
      const startDate = block.match(/"startDate":(\d+)/)?.[1] || null;
      const imageMatch = block.match(/"imageUrl":"([^"]+)"/);

      if (headline) {
        results.push({
          headline: headline.replace(/\\u[\dA-F]{4}/gi, (u: string) => 
            String.fromCharCode(parseInt(u.replace(/\\u/g, ''), 16))),
          body: null,
          cta: null,
          landingUrl: null,
          displayUrl: null,
          creativeUrl: imageMatch?.[1] || null,
          advertiser: headline,
          platform: 'facebook',
          format: imageMatch ? 'image' : 'text',
          impressions: null,
          firstSeen: startDate ? new Date(parseInt(startDate) * 1000).toISOString().substring(0, 10) : null,
          lastSeen: null,
          adId,
          checkedAt: new Date().toISOString(),
        });
      }
    } catch {}
    if (results.length >= 20) break;
  }

  return results;
}

// ─── GOOGLE ADS TRANSPARENCY ─────────────────────────

async function scrapeGoogleAds(advertiser: string): Promise<AdCreative[]> {
  const encoded = encodeURIComponent(advertiser);
  const url = `https://adstransparency.google.com/advertiser/${encoded}?region=US`;

  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US' },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) return [];
  const html = await response.text();

  const results: AdCreative[] = [];

  // Extract ad cards
  const adCardRegex = /<div[^>]*class="[^"]*ad-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;
  while ((match = adCardRegex.exec(html)) !== null) {
    const card = match[1];
    const headline = card.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\//i)?.[1]?.trim() || null;
    const body = card.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
    const creativeUrl = card.match(/<img[^>]*src="([^"]+)"/i)?.[1] || null;

    if (headline || body) {
      results.push({
        headline: headline || body?.substring(0, 100) || 'Unknown',
        body,
        cta: null,
        landingUrl: null,
        displayUrl: null,
        creativeUrl: creativeUrl?.startsWith('http') ? creativeUrl : null,
        advertiser,
        platform: 'google',
        format: creativeUrl ? 'image' : 'text',
        impressions: null,
        firstSeen: null,
        lastSeen: null,
        adId: null,
        checkedAt: new Date().toISOString(),
      });
    }
    if (results.length >= 20) break;
  }

  return results;
}

// ─── TIKTOK ADS ──────────────────────────────────────

async function scrapeTikTokAds(keyword: string): Promise<AdCreative[]> {
  const encoded = encodeURIComponent(keyword);
  const url = `https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?keyword=${encoded}`;

  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html,application/json', 'Accept-Language': 'en-US' },
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  if (!response.ok) return [];
  const html = await response.text();
  const results: AdCreative[] = [];

  // Try JSON data
  try {
    const jsonMatch = html.match(/"materials":\s*(\[[\s\S]*?\])/);
    if (jsonMatch) {
      const ads = JSON.parse(jsonMatch[1]);
      for (const ad of ads.slice(0, 20)) {
        results.push({
          headline: ad.title || ad.caption || keyword,
          body: ad.caption || null,
          cta: ad.button_text || null,
          landingUrl: ad.click_url || null,
          displayUrl: ad.display_url || null,
          creativeUrl: ad.video_url || ad.image_url || null,
          advertiser: ad.advertiser_name || null,
          platform: 'tiktok',
          format: ad.video_url ? 'video' : ad.image_url ? 'image' : 'unknown',
          impressions: ad.impressions || null,
          firstSeen: ad.create_time ? new Date(ad.create_time * 1000).toISOString().substring(0, 10) : null,
          lastSeen: null,
          adId: ad.id || null,
          checkedAt: new Date().toISOString(),
        });
      }
    }
  } catch {}

  return results;
}

// ─── MAIN ────────────────────────────────────────────

export async function spyOnAds(
  params: { keyword?: string; advertiser?: string; platform?: string },
): Promise<AdSpyResponse> {
  const allResults: AdCreative[] = [];
  const platforms: string[] = [];

  const tasks: Promise<void>[] = [];

  if (!params.platform || params.platform === 'facebook') {
    platforms.push('facebook');
    tasks.push(
      scrapeFacebookAds(params.keyword || params.advertiser || '').then(r => {
        allResults.push(...r);
      }).catch(() => {}),
    );
  }

  if (!params.platform || params.platform === 'google') {
    platforms.push('google');
    tasks.push(
      scrapeGoogleAds(params.advertiser || params.keyword || '').then(r => {
        allResults.push(...r);
      }).catch(() => {}),
    );
  }

  if (!params.platform || params.platform === 'tiktok') {
    platforms.push('tiktok');
    tasks.push(
      scrapeTikTokAds(params.keyword || params.advertiser || '').then(r => {
        allResults.push(...r);
      }).catch(() => {}),
    );
  }

  await Promise.allSettled(tasks);

  return {
    query: params,
    results: allResults.slice(0, 50),
    totalFound: allResults.length,
    platforms,
  };
}
