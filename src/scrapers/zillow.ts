import { proxyFetch } from '../proxy';

// ─── Zillow Real Estate Scraper ───

interface ZillowProperty {
  zpid: string;
  address: string;
  price: number;
  zestimate: number | null;
  price_history: Array<{ date: string; event: string; price: number }>;
  details: {
    bedrooms: number;
    bathrooms: number;
    sqft: number;
    lot_sqft: number | null;
    year_built: number | null;
    type: string;
    status: string;
  };
  neighborhood: {
    walk_score: number | null;
    transit_score: number | null;
    median_home_value: number | null;
    median_rent: number | null;
  };
  photos: string[];
  url: string;
}

interface ZillowSearchResult {
  zpid: string;
  address: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  type: string;
  status: string;
  photo: string;
  url: string;
}

interface ZillowMarketStats {
  zip: string;
  median_home_value: number | null;
  median_rent: number | null;
  median_list_price: number | null;
  active_listings: number;
  avg_days_on_market: number | null;
  price_range: { min: number; max: number } | null;
}

const ZILLOW_BASE = 'https://www.zillow.com';

const ZILLOW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

function extractJsonFromScript(html: string, key: string): any {
  // Zillow embeds data in __NEXT_DATA__ or inline scripts
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      return data?.props?.pageProps?.[key] || data?.props?.pageProps;
    } catch {}
  }

  // Try preloaded state
  const preloadMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*({.*?});\s*<\/script>/s);
  if (preloadMatch) {
    try { return JSON.parse(preloadMatch[1]); } catch {}
  }

  // Try inline JSON with zpid
  const inlineMatch = html.match(/"zpid"\s*:\s*"?(\d+)"?.*?"price"\s*:\s*(\d+)/s);
  if (inlineMatch) return { zpid: inlineMatch[1], price: parseInt(inlineMatch[2]) };

  return null;
}

function parsePropertyFromHtml(html: string, zpid: string): ZillowProperty | null {
  const data = extractJsonFromScript(html, 'property') || extractJsonFromScript(html, 'componentProps');

  // Extract from structured data or fall back to regex parsing
  const getMatch = (pattern: RegExp) => { const m = html.match(pattern); return m ? m[1] : null; };

  const price = data?.price || parseInt(getMatch(/"price"\s*:\s*(\d+)/) || '0');
  const zestimate = data?.zestimate || parseInt(getMatch(/"zestimate"\s*:\s*(\d+)/) || '0') || null;
  const bedrooms = data?.bedrooms || parseInt(getMatch(/"bedrooms"\s*:\s*(\d+)/) || '0');
  const bathrooms = data?.bathrooms || parseFloat(getMatch(/"bathrooms"\s*:\s*([\d.]+)/) || '0');
  const sqft = data?.livingArea || parseInt(getMatch(/"livingArea"\s*:\s*(\d+)/) || '0');
  const yearBuilt = data?.yearBuilt || parseInt(getMatch(/"yearBuilt"\s*:\s*(\d+)/) || '0') || null;
  const homeType = data?.homeType || getMatch(/"homeType"\s*:\s*"([^"]+)"/) || 'Unknown';
  const homeStatus = data?.homeStatus || getMatch(/"homeStatus"\s*:\s*"([^"]+)"/) || 'Unknown';

  const addressStr = data?.address
    ? `${data.address.streetAddress}, ${data.address.city}, ${data.address.state} ${data.address.zipcode}`
    : getMatch(/"streetAddress"\s*:\s*"([^"]+)"/) || '';

  // Extract price history
  const priceHistory: Array<{ date: string; event: string; price: number }> = [];
  const historyMatch = html.match(/"priceHistory"\s*:\s*(\[.*?\])/s);
  if (historyMatch) {
    try {
      const hist = JSON.parse(historyMatch[1]);
      for (const h of hist.slice(0, 10)) {
        priceHistory.push({ date: h.date || h.time || '', event: h.event || h.priceChangeRate ? 'Price Change' : 'Listed', price: h.price || 0 });
      }
    } catch {}
  }

  // Extract photos
  const photos: string[] = [];
  const photoMatches = html.matchAll(/"url"\s*:\s*"(https:\/\/photos\.zillowstatic\.com[^"]+)"/g);
  for (const m of photoMatches) { if (photos.length < 5) photos.push(m[1]); }

  // Neighborhood scores
  const walkScore = parseInt(getMatch(/"walkScore"\s*:\s*(\d+)/) || '0') || null;
  const transitScore = parseInt(getMatch(/"transitScore"\s*:\s*(\d+)/) || '0') || null;

  return {
    zpid, address: addressStr, price, zestimate,
    price_history: priceHistory,
    details: { bedrooms, bathrooms, sqft, lot_sqft: parseInt(getMatch(/"lotSize"\s*:\s*(\d+)/) || '0') || null, year_built: yearBuilt, type: homeType.replace('_', ' '), status: homeStatus.replace('_', ' ') },
    neighborhood: { walk_score: walkScore, transit_score: transitScore, median_home_value: null, median_rent: null },
    photos, url: `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`
  };
}

function parseSearchResults(html: string): ZillowSearchResult[] {
  const results: ZillowSearchResult[] = [];

  // Try __NEXT_DATA__ search results  
  const nextData = extractJsonFromScript(html, 'searchPageState');
  const listResults = nextData?.cat1?.searchResults?.listResults || nextData?.cat1?.searchResults?.mapResults || [];

  for (const r of listResults.slice(0, 20)) {
    results.push({
      zpid: String(r.zpid || r.id || ''),
      address: r.address || r.streetAddress || '',
      price: r.unformattedPrice || r.price || parseInt(String(r.hdpData?.homeInfo?.price || 0)),
      bedrooms: r.beds || r.bedrooms || 0,
      bathrooms: r.baths || r.bathrooms || 0,
      sqft: r.area || r.livingArea || 0,
      type: r.hdpData?.homeInfo?.homeType || 'Unknown',
      status: r.statusType || r.hdpData?.homeInfo?.homeStatus || 'Unknown',
      photo: r.imgSrc || r.hdpData?.homeInfo?.hiResImageLink || '',
      url: r.detailUrl ? (r.detailUrl.startsWith('http') ? r.detailUrl : ZILLOW_BASE + r.detailUrl) : ''
    });
  }

  // Fallback: regex parse cards
  if (results.length === 0) {
    const cardMatches = html.matchAll(/"zpid"\s*:\s*"?(\d+)"?[^}]*?"price"\s*:\s*(\d+)[^}]*?"address"\s*:\s*"([^"]+)"/g);
    for (const m of cardMatches) {
      if (results.length >= 20) break;
      results.push({ zpid: m[1], address: m[3], price: parseInt(m[2]), bedrooms: 0, bathrooms: 0, sqft: 0, type: 'Unknown', status: 'For Sale', photo: '', url: `${ZILLOW_BASE}/homedetails/${m[1]}_zpid/` });
    }
  }

  return results;
}

export async function getZillowProperty(zpid: string): Promise<ZillowProperty | null> {
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  const resp = await proxyFetch(url, { headers: ZILLOW_HEADERS });
  const html = await resp.text();
  if (!html || html.length < 1000) return null;
  return parsePropertyFromHtml(html, zpid);
}

export async function searchZillow(query: string, filters?: { type?: string; min_price?: number; max_price?: number; beds?: number }): Promise<ZillowSearchResult[]> {
  // Zillow search URLs: /homes/{query}_rb/ or /homes/for_sale/{zip}_rb/
  const slug = query.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  let searchUrl = `${ZILLOW_BASE}/homes/${slug}_rb/`;

  const params: string[] = [];
  if (filters?.type) params.push(`type=${filters.type}`);
  if (filters?.min_price) params.push(`price_min=${filters.min_price}`);
  if (filters?.max_price) params.push(`price_max=${filters.max_price}`);
  if (filters?.beds) params.push(`beds_min=${filters.beds}`);
  if (params.length) searchUrl += '?' + params.join('&');

  const resp = await proxyFetch(searchUrl, { headers: ZILLOW_HEADERS });
  const html = await resp.text();
  return parseSearchResults(html);
}

export async function getZillowMarketStats(zip: string): Promise<ZillowMarketStats> {
  const url = `${ZILLOW_BASE}/homes/${zip}_rb/`;
  const resp = await proxyFetch(url, { headers: ZILLOW_HEADERS });
  const html = await resp.text();

  const getNum = (pattern: RegExp) => { const m = html.match(pattern); return m ? parseInt(m[1].replace(/,/g, '')) : null; };

  const listings = parseSearchResults(html);
  const prices = listings.map(l => l.price).filter(p => p > 0);

  return {
    zip,
    median_home_value: getNum(/"medianHomeValue"\s*:\s*(\d+)/) || (prices.length ? prices.sort((a,b) => a-b)[Math.floor(prices.length/2)] : null),
    median_rent: getNum(/"medianRentalPrice"\s*:\s*(\d+)/),
    median_list_price: prices.length ? prices.sort((a,b) => a-b)[Math.floor(prices.length/2)] : null,
    active_listings: listings.length,
    avg_days_on_market: getNum(/"daysOnZillow"\s*:\s*(\d+)/),
    price_range: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null
  };
}

export async function getZillowComps(zpid: string, radius: number = 0.5): Promise<ZillowSearchResult[]> {
  // Zillow renders comps on the property page
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  const resp = await proxyFetch(url, { headers: ZILLOW_HEADERS });
  const html = await resp.text();

  // Extract nearby comps from page data
  const compsMatch = html.match(/"comps"\s*:\s*(\[.*?\])/s);
  if (compsMatch) {
    try {
      const comps = JSON.parse(compsMatch[1]);
      return comps.slice(0, 10).map((c: any) => ({
        zpid: String(c.zpid || ''),
        address: c.address || '',
        price: c.price || 0,
        bedrooms: c.bedrooms || 0,
        bathrooms: c.bathrooms || 0,
        sqft: c.livingArea || 0,
        type: c.homeType || 'Unknown',
        status: c.homeStatus || 'Sold',
        photo: c.imgSrc || '',
        url: c.detailUrl ? ZILLOW_BASE + c.detailUrl : ''
      }));
    } catch {}
  }

  return [];
}
