/**
 * Hardened SERP parser with deep AI Overview + Organic extraction.
 * Built to survive frequent Google DOM/layout variants.
 */

import { Page } from 'playwright';

const MAX_ORGANIC_RESULTS = 25;
const MAX_CITATIONS = 24;

export interface SiteLink {
  title: string;
  url: string;
}

export interface OrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  displayedUrl?: string;
  sourceDomain?: string;
  date?: string;
  siteLinks?: SiteLink[];
}

export interface AICitation {
  id: number;
  title: string;
  url: string;
  sourceDomain?: string;
}

export interface AIOverview {
  text: string;
  citations: AICitation[];
  sources?: AICitation[];
  attribution?: string;
  sections?: string[];
}

export interface SerpResults {
  query: string;
  country: string;
  timestamp: string;
  results: {
    organic: OrganicResult[];
    ads: any[];
    aiOverview: AIOverview | null;
    featuredSnippet: any | null;
    peopleAlsoAsk: string[];
    relatedSearches?: string[];
    knowledgePanel?: any | null;
    localPack?: any[];
    videoSnippets?: any[];
  };
  metadata: {
    totalResults: string;
    searchTime: string;
    scrapedAt: string;
    proxyCountry?: string;
    cacheHit?: boolean;
    cacheAgeMs?: number;
  };
}

interface ExtractedPayload {
  organic: OrganicResult[];
  ads: any[];
  aiOverview: AIOverview | null;
  featuredSnippet: any | null;
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  knowledgePanel: any | null;
  localPack: any[];
  videoSnippets: any[];
  totalResults: string;
  searchTime: string;
}

export async function parseGoogleSerp(page: Page, query: string, country: string): Promise<SerpResults> {
  const extracted = await extractAll(page);

  return {
    query,
    country,
    timestamp: new Date().toISOString(),
    results: {
      organic: extracted.organic,
      ads: extracted.ads,
      aiOverview: extracted.aiOverview,
      featuredSnippet: extracted.featuredSnippet,
      peopleAlsoAsk: extracted.peopleAlsoAsk,
      relatedSearches: extracted.relatedSearches,
      knowledgePanel: extracted.knowledgePanel,
      localPack: extracted.localPack,
      videoSnippets: extracted.videoSnippets,
    },
    metadata: {
      totalResults: extracted.totalResults,
      searchTime: extracted.searchTime,
      scrapedAt: new Date().toISOString(),
    },
  };
}

async function extractAll(page: Page): Promise<ExtractedPayload> {
  try {
    return await page.evaluate(
      ({ maxOrganicResults, maxCitations }: { maxOrganicResults: number; maxCitations: number }) => {
        const clean = (value?: string | null): string => (value || '').replace(/\s+/g, ' ').trim();

        const toAbsoluteUrl = (href?: string | null): string | null => {
          if (!href) return null;
          try {
            const abs = new URL(href, window.location.origin);
            if (abs.pathname === '/url') {
              const redirected = abs.searchParams.get('q') || abs.searchParams.get('url');
              if (redirected) {
                return toAbsoluteUrl(redirected);
              }
            }
            if (!['http:', 'https:'].includes(abs.protocol)) return null;
            return abs.toString();
          } catch {
            return null;
          }
        };

        const getDomain = (url: string): string | undefined => {
          try {
            return new URL(url).hostname.replace(/^www\./, '');
          } catch {
            return undefined;
          }
        };

        const isGoogleInternal = (url: string): boolean => {
          try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            const isGoogleHost =
              host === 'google.com' ||
              host.endsWith('.google.com') ||
              /^google\./.test(host.replace(/^www\./, '')) ||
              host.startsWith('www.google.');
            if (!isGoogleHost) return false;

            const path = parsed.pathname;
            return (
              path === '/url' ||
              path === '/search' ||
              path === '/preferences' ||
              path === '/advanced_search' ||
              path === '/setprefs' ||
              path.startsWith('/imgres') ||
              path.startsWith('/aclk')
            );
          } catch {
            return true;
          }
        };

        const uniqueStrings = (values: string[], max = 50): string[] => {
          const out: string[] = [];
          const seen = new Set<string>();
          for (const raw of values) {
            const value = clean(raw);
            if (!value || seen.has(value.toLowerCase())) continue;
            seen.add(value.toLowerCase());
            out.push(value);
            if (out.length >= max) break;
          }
          return out;
        };

        const parseResultStats = (): { totalResults: string; searchTime: string } => {
          const statsEl =
            document.querySelector('#result-stats') ||
            document.querySelector('[role="status"][aria-live]') ||
            document.querySelector('div#slim_appbar [aria-level]');
          const statsText = clean(statsEl?.textContent);
          if (!statsText) return { totalResults: '', searchTime: '' };

          let totalResults = '';
          let searchTime = '';

          const totalMatch = statsText.match(/([\d.,\s]+)\s+results?/i) || statsText.match(/([\d.,\s]+)/);
          if (totalMatch) totalResults = clean(totalMatch[1]);

          const timeMatch = statsText.match(/([0-9]+(?:[.,][0-9]+)?)\s*(seconds?|secs?|s|sekunden?)/i);
          if (timeMatch) {
            searchTime = `${timeMatch[1].replace(',', '.')}s`;
          }

          return { totalResults, searchTime };
        };

        const extractAIOverview = () => {
          const selectorPool = [
            '.M8OgIe',
            '[data-attrid="SGEOverview"]',
            '[jsname="xXq91c"]',
            '[data-attrid*="Overview"]',
            '[aria-label*="AI Overview"]',
            'div[data-hveid] div[data-attrid*="kc:/"]',
          ];

          const candidates = new Set<Element>();
          for (const selector of selectorPool) {
            document.querySelectorAll(selector).forEach((node) => candidates.add(node));
          }

          const headingFallbacks = Array.from(document.querySelectorAll('h1, h2, h3, div, span')).filter((el) =>
            /(^|\s)ai overview(\s|$)/i.test(clean(el.textContent))
          );
          for (const heading of headingFallbacks) {
            const candidate = heading.closest('section, article, div[data-attrid], div[role="region"], div.g') || heading.parentElement;
            if (candidate) candidates.add(candidate);
          }

          let best: any = null;

          for (const candidate of candidates) {
            const text = clean((candidate as HTMLElement).innerText || candidate.textContent);
            if (text.length < 40) continue;

            const sections = uniqueStrings(
              Array.from(candidate.querySelectorAll('p, li, div[data-sncf], span')).map((node) => node.textContent || ''),
              24
            ).filter((s) => s.length > 24);

            const citations: any[] = [];
            const seenCitationUrls = new Set<string>();
            const links = Array.from(candidate.querySelectorAll('a[href]'));

            for (const link of links) {
              const url = toAbsoluteUrl(link.getAttribute('href'));
              if (!url || isGoogleInternal(url)) continue;

              const normalizedKey = url.toLowerCase();
              if (seenCitationUrls.has(normalizedKey)) continue;
              seenCitationUrls.add(normalizedKey);

              const title = clean(link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent) || getDomain(url) || 'Source';
              citations.push({
                id: citations.length + 1,
                title,
                url,
                sourceDomain: getDomain(url),
              });
              if (citations.length >= maxCitations) break;
            }

            const attribution = clean(
              candidate.querySelector('h2, h3, [role="heading"], .xDKLO, .w8qArf')?.textContent
            );

            const score = text.length + citations.length * 120 + sections.length * 30;
            if (!best || score > best.score) {
              best = { text, citations, sections, attribution, score };
            }
          }

          if (!best) return null;
          if (best.text.length < 80 && best.citations.length === 0) return null;

          return {
            text: best.text,
            citations: best.citations,
            sources: best.citations,
            attribution: best.attribution || undefined,
            sections: best.sections.length ? best.sections.slice(0, 12) : undefined,
          };
        };

        const extractOrganicResults = () => {
          const containers = new Set<Element>();
          const selectors = [
            '#search .MjjYud',
            '#search .tF2Cxc',
            '#search .g',
            '#search div[data-hveid]',
            '#rso > div',
            'main .MjjYud',
          ];
          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach((el) => containers.add(el));
          }

          const results: any[] = [];
          const seenUrls = new Set<string>();

          for (const container of containers) {
            if (results.length >= maxOrganicResults) break;
            if (
              container.closest('#tads, #tadsb, [data-text-ad], .uEierd, .commercial-unit-desktop-top, .ULSxyf')
            ) {
              continue;
            }

            const h3 = container.querySelector('h3');
            if (!h3) continue;

            const primaryLink =
              h3.closest('a[href]') ||
              h3.parentElement?.closest('a[href]') ||
              container.querySelector('a[href]');
            if (!primaryLink) continue;

            const href = toAbsoluteUrl((primaryLink as HTMLAnchorElement).getAttribute('href'));
            if (!href || isGoogleInternal(href)) continue;
            if (seenUrls.has(href.toLowerCase())) continue;

            const title = clean(h3.textContent) || clean((primaryLink as HTMLAnchorElement).textContent);
            if (!title) continue;

            const snippet = clean(
              container.querySelector('.VwiC3b, .lEBKkf, .GI74Re, .s3v9rd, [data-sncf], .st, .yXK7lf')?.textContent ||
              ''
            );
            const displayedUrl = clean(
              container.querySelector('cite, .tjvcx, .qLRx3b span, .byrV5b')?.textContent ||
              ''
            );
            const date = clean(
              container.querySelector('span.MUxGbd, span.f, .kX21rb')?.textContent ||
              ''
            );

            const siteLinks: any[] = [];
            const seenSiteLinks = new Set<string>();
            const siteLinkElements = Array.from(
              container.querySelectorAll('.HiHjCd a[href], .sBJ0ic a[href], .StSImd a[href], .usJj9c a[href], .NJjxre a[href], .eFM0qc a[href]')
            );
            for (const siteLink of siteLinkElements) {
              const siteUrl = toAbsoluteUrl(siteLink.getAttribute('href'));
              if (!siteUrl || isGoogleInternal(siteUrl)) continue;
              const key = siteUrl.toLowerCase();
              if (seenSiteLinks.has(key)) continue;
              seenSiteLinks.add(key);
              const siteTitle = clean(siteLink.textContent) || getDomain(siteUrl) || 'link';
              siteLinks.push({ title: siteTitle, url: siteUrl });
              if (siteLinks.length >= 8) break;
            }

            seenUrls.add(href.toLowerCase());
            results.push({
              position: results.length + 1,
              title,
              url: href,
              snippet,
              displayedUrl: displayedUrl || undefined,
              sourceDomain: getDomain(href),
              date: date || undefined,
              siteLinks: siteLinks.length ? siteLinks : undefined,
            });
          }

          return results;
        };

        const extractAds = () => {
          const ads: any[] = [];
          const seen = new Set<string>();
          const adBlocks = document.querySelectorAll(
            '#tads .uEierd, #tadsb .uEierd, .commercial-unit-desktop-top .uEierd, [data-text-ad] .uEierd'
          );

          for (const block of adBlocks) {
            const title = clean(block.querySelector('h3, .CCgQ5, .v0nnCb')?.textContent);
            const href = toAbsoluteUrl(block.querySelector('a[href]')?.getAttribute('href'));
            if (!title || !href || isGoogleInternal(href)) continue;
            if (seen.has(href.toLowerCase())) continue;
            seen.add(href.toLowerCase());

            ads.push({
              position: ads.length + 1,
              title,
              url: href,
              displayUrl: clean(block.querySelector('cite, .qzEoUe')?.textContent) || undefined,
              description: clean(block.querySelector('.MUxGbd.yDYNvb.lyLwlc, .lyLwlc, .bYSvNd')?.textContent) || undefined,
            });
          }

          return ads;
        };

        const extractFeaturedSnippet = () => {
          const snippetContainer = document.querySelector(
            '[data-attrid="wa:/description"], .ifM9O .xpdopen, .xpdopen .hgKElc, .yuRUbf + .VwiC3b'
          );
          if (!snippetContainer) return null;

          const text = clean(
            snippetContainer.querySelector('.IZ6rdc, .hgKElc, [data-sncf], span, div')?.textContent ||
            snippetContainer.textContent
          );
          if (!text || text.length < 20) return null;

          const sourceAnchor = snippetContainer.querySelector('a[href]') || snippetContainer.closest('div')?.querySelector('a[href]');
          const sourceUrl = toAbsoluteUrl(sourceAnchor?.getAttribute('href'));
          const source = clean(sourceAnchor?.textContent) || (sourceUrl ? getDomain(sourceUrl) : '');

          return {
            text,
            source: source || undefined,
            sourceUrl: sourceUrl || undefined,
          };
        };

        const extractPAA = () =>
          uniqueStrings(
            Array.from(
              document.querySelectorAll(
                '.related-question-pair [role="heading"], .related-question-pair span, [jsname="Cpkphb"], [data-q]'
              )
            ).map((el) => el.textContent || '')
          )
            .filter((q) => q.length >= 12 && q.length <= 220)
            .slice(0, 12);

        const extractLocalPack = () => {
          const places: any[] = [];
          const cards = document.querySelectorAll('.VkpGBb, .rllt__details, .cXedhc, .uMdZh');
          for (const card of cards) {
            const name = clean(card.querySelector('.dbg0pd, [role="heading"], .OSrXXb')?.textContent || card.textContent);
            if (!name || name.length < 2) continue;
            places.push({
              name,
              rating: clean(card.querySelector('.yi40Hd, .MW4etd')?.textContent) || undefined,
              reviews: clean(card.querySelector('.RDApEe, .UY7F9')?.textContent) || undefined,
              address: clean(card.querySelector('.rllt__details div:nth-child(2), .W4Efsd span')?.textContent) || undefined,
            });
            if (places.length >= 5) break;
          }
          return places;
        };

        const extractVideoSnippets = () => {
          const videos: any[] = [];
          const blocks = document.querySelectorAll('g-video-result, .MjjYud .g, .PZPZlf');
          const seen = new Set<string>();
          for (const block of blocks) {
            const anchor = block.querySelector('a[href]');
            const href = toAbsoluteUrl(anchor?.getAttribute('href'));
            const title = clean(block.querySelector('h3, .FCUp0c, [role="heading"]')?.textContent || anchor?.textContent);
            if (!href || !title) continue;
            if (!/youtube\.com|youtu\.be|vimeo\.com/i.test(href)) continue;
            if (seen.has(href.toLowerCase())) continue;
            seen.add(href.toLowerCase());
            videos.push({
              title,
              url: href,
              source: clean(block.querySelector('cite, .NUnG9d span')?.textContent) || undefined,
              snippet: clean(block.querySelector('.VwiC3b, .yXK7lf, .hMJ0yc')?.textContent) || undefined,
            });
            if (videos.length >= 10) break;
          }
          return videos;
        };

        const extractRelatedSearches = () =>
          uniqueStrings(
            Array.from(
              document.querySelectorAll(
                '.k8XOCe, .s75CSd, .EIaa9b, [data-attrid="related-searches"] a, [aria-label*="Related"] a, #bres a'
              )
            ).map((el) => el.textContent || '')
          )
            .filter((term) => term.length >= 2 && term.length <= 120)
            .slice(0, 12);

        const extractKnowledgePanel = () => {
          const panel = document.querySelector('#rhs, .knowledge-panel, [data-attrid="title"]');
          if (!panel) return null;

          const title = clean(
            panel.querySelector('[data-attrid="title"] span, [role="heading"], .SPZz6b')?.textContent
          );
          const description = clean(
            panel.querySelector('[data-attrid="description"] span, .kno-rdesc span, .LGOjhe')?.textContent
          );

          if (!title && !description) return null;
          return { title: title || undefined, description: description || undefined };
        };

        const stats = parseResultStats();

        return {
          organic: extractOrganicResults(),
          ads: extractAds(),
          aiOverview: extractAIOverview(),
          featuredSnippet: extractFeaturedSnippet(),
          peopleAlsoAsk: extractPAA(),
          relatedSearches: extractRelatedSearches(),
          knowledgePanel: extractKnowledgePanel(),
          localPack: extractLocalPack(),
          videoSnippets: extractVideoSnippets(),
          totalResults: stats.totalResults,
          searchTime: stats.searchTime,
        };
      },
      { maxOrganicResults: MAX_ORGANIC_RESULTS, maxCitations: MAX_CITATIONS }
    );
  } catch {
    return {
      organic: [],
      ads: [],
      aiOverview: null,
      featuredSnippet: null,
      peopleAlsoAsk: [],
      relatedSearches: [],
      knowledgePanel: null,
      localPack: [],
      videoSnippets: [],
      totalResults: '',
      searchTime: '',
    };
  }
}
