/**
 * YouTube Scraper — uses YouTube's public search (no API key) via mobile proxy
 * Parses initial data from search results page.
 */

import { proxyFetch } from '../proxy';
import type { YouTubeVideo } from '../types';

const YT_BASE = 'https://www.youtube.com';

function parseViewCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/[^\d.KMB]/gi, '');
  const num = parseFloat(cleaned);
  if (text.toUpperCase().includes('B')) return Math.round(num * 1_000_000_000);
  if (text.toUpperCase().includes('M')) return Math.round(num * 1_000_000);
  if (text.toUpperCase().includes('K')) return Math.round(num * 1_000);
  return Math.round(num) || 0;
}

function extractYtInitialData(html: string): any {
  // Extract ytInitialData JSON from page
  const patterns = [
    /var ytInitialData\s*=\s*({.+?});\s*(?:var|window|<\/script>)/s,
    /ytInitialData\s*=\s*({.+?});/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Try next pattern
      }
    }
  }
  return null;
}

function extractVideos(ytData: any, days: number): YouTubeVideo[] {
  const videos: YouTubeVideo[] = [];
  const cutoff = Date.now() - days * 86400_000;

  function walkRenderers(obj: any, depth: number = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;

    if (obj.videoRenderer || obj.compactVideoRenderer) {
      const r = obj.videoRenderer || obj.compactVideoRenderer;
      try {
        const id = r.videoId;
        if (!id) return;

        const title = r.title?.runs?.[0]?.text ||
          r.title?.simpleText ||
          'Unknown title';

        const channel = r.ownerText?.runs?.[0]?.text ||
          r.longBylineText?.runs?.[0]?.text ||
          r.shortBylineText?.runs?.[0]?.text ||
          'Unknown channel';

        const viewText = r.viewCountText?.simpleText ||
          r.viewCountText?.runs?.[0]?.text || '0';
        const viewCount = parseViewCount(viewText);

        const publishedText = r.publishedTimeText?.simpleText || '';
        const description = r.detailedMetadataSnippets?.[0]?.snippetText?.runs
          ?.map((x: any) => x.text).join('') || '';

        // Best-effort publish date
        let publishedAt = new Date(Date.now() - 7 * 86400_000).toISOString();
        if (publishedText.includes('hour')) {
          publishedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
        } else if (publishedText.includes('day')) {
          const daysAgo = parseInt(publishedText) || 1;
          publishedAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();
        } else if (publishedText.includes('week')) {
          const weeksAgo = parseInt(publishedText) || 1;
          publishedAt = new Date(Date.now() - weeksAgo * 7 * 86400_000).toISOString();
        } else if (publishedText.includes('month')) {
          const monthsAgo = parseInt(publishedText) || 1;
          publishedAt = new Date(Date.now() - monthsAgo * 30 * 86400_000).toISOString();
        } else if (publishedText.includes('year')) {
          const yearsAgo = parseInt(publishedText) || 1;
          publishedAt = new Date(Date.now() - yearsAgo * 365 * 86400_000).toISOString();
        }

        // Skip videos outside time window (rough estimate)
        if (new Date(publishedAt).getTime() < cutoff) return;

        const engagementScore = viewCount * 0.001; // views are the primary signal

        videos.push({
          platform: 'youtube',
          id,
          title,
          channelTitle: channel,
          viewCount,
          likeCount: 0, // not available in search results
          commentCount: 0, // not available in search results
          publishedAt,
          url: `https://youtube.com/watch?v=${id}`,
          description: description.slice(0, 300),
          engagementScore,
        });
      } catch {
        // Skip malformed
      }
    }

    // Recurse
    if (Array.isArray(obj)) {
      for (const item of obj) walkRenderers(item, depth + 1);
    } else {
      for (const key of Object.keys(obj)) {
        if (key !== 'thumbnails' && key !== 'thumbnail') {
          walkRenderers(obj[key], depth + 1);
        }
      }
    }
  }

  walkRenderers(ytData);
  return videos;
}

/**
 * Search YouTube for videos about a topic.
 */
export async function searchYouTube(
  query: string,
  days: number = 30,
  limit: number = 20,
): Promise<YouTubeVideo[]> {
  // SP parameter: CAISAhAB = sort by date, CAISA hgEA = relevance
  const url = `${YT_BASE}/results?search_query=${encodeURIComponent(query)}&sp=CAISBAgBEAE%3D`;

  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeoutMs: 30_000,
    maxRetries: 2,
  });

  if (!res.ok) {
    throw new Error(`YouTube search failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  const ytData = extractYtInitialData(html);

  if (!ytData) {
    // Fallback: try to extract from JSON embedded differently
    const fallback = html.match(/"videoRenderer":\{"videoId":"([^"]+)","thumbnail".*?"title":\{"runs":\[\{"text":"([^"]+)"/g);
    if (!fallback?.length) {
      return [];
    }
  }

  const videos = ytData ? extractVideos(ytData, days) : [];

  return videos
    .filter(v => v.viewCount > 0)
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, limit);
}

/**
 * Get YouTube trending videos for a region.
 */
export async function getYouTubeTrending(country: string = 'US'): Promise<YouTubeVideo[]> {
  const url = `${YT_BASE}/feed/trending?gl=${country}`;

  const res = await proxyFetch(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml' },
    timeoutMs: 25_000,
    maxRetries: 1,
  });

  if (!res.ok) return [];

  const html = await res.text();
  const ytData = extractYtInitialData(html);

  if (!ytData) return [];

  return extractVideos(ytData, 7)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 20);
}
