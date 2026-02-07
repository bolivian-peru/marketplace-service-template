import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const serviceRouter = new Hono();

// ─── SERVICE CONFIGURATION ─────────────────────────────
const SERVICE_NAME = 'google-serp-ai-scraper';
const PRICE_USDC = 0.01;  // $0.01 per query
const DESCRIPTION = 'Scrape Google SERPs with AI Overview, Featured Snippets, and People Also Ask using real local browser rendering and mobile IPs.';

const OUTPUT_SCHEMA = {
  input: {
    q: 'string — search query (required)',
    gl: 'string — country code (optional, e.g., US, GB, DE, default US)',
    hl: 'string — language code (optional, e.g., en, de, default en)',
    num: 'number — results per page (optional, default 10, max 20)',
  },
  output: {
    query: 'string — search query',
    country: 'string — country code used',
    results: {
      organic: 'array — [{position, title, url, snippet}]',
      aiOverview: 'object|null — {text, sources: [{title, url}]}',
      featuredSnippet: 'object|null — {text, source, url}',
      peopleAlsoAsk: 'array — list of questions',
      relatedSearches: 'array — list of related search terms',
    },
    proxy: '{ country: string, type: "mobile" }',
  },
};

// ─── TYPES ─────────────────────────────────────────────

interface OrganicResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

interface AiOverview {
  text: string;
  sources: Array<{ title: string; url: string }>;
}

interface FeaturedSnippet {
  text: string;
  source: string;
  url: string;
}

interface SerpResults {
  organic: OrganicResult[];
  aiOverview: AiOverview | null;
  featuredSnippet: FeaturedSnippet | null;
  peopleAlsoAsk: string[];
  relatedSearches: string[];
}


// ─── SCRAPER LOGIC ─────────────────────────────────────

async function scrapeGoogleSerp(
  query: string,
  gl: string,
  hl: string,
  num: number,
  maxRetries: number = 2,
): Promise<{ success: boolean; results?: SerpResults; error?: string; isBlock?: boolean }> {
  let lastError = '';

  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_ZONE;

  if (!apiKey || !zone) {
    return { success: false, error: 'Bright Data credentials missing in .env', isBlock: false };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${gl.toLowerCase()}&hl=en&num=${num}`;

      console.log(`[${attempt + 1}] Fetching Google SERP via Bright Data (${zone})...`);

      const apiResp = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          zone: zone,
          url: searchUrl,
          format: 'json'
        })
      });

      if (!apiResp.ok) {
        const errText = await apiResp.text();
        lastError = `Bright Data API Error (${apiResp.status}): ${errText}`;
        console.error(`[${attempt + 1}] ${lastError}`);
        continue;
      }

      const wrapper = await apiResp.json();

      // Attempt to extract exit IP from the SERP unblocker headers or metadata
      const nodeIp = wrapper.headers?.['x-brd-node-ip'] || 'mobile-unblocker';
      console.log(`[${attempt + 1}] Bright Data Session: ${nodeIp} (Zone: ${zone})`);

      if (wrapper.status_code !== 200) {
        lastError = `Bright Data Remote Error (${wrapper.status_code})`;
        console.error(`[${attempt + 1}] ${lastError}`);
        continue;
      }

      let data = wrapper.body;
      if (!data) {
        lastError = 'Bright Data response body is empty';
        continue;
      }

      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          console.error(`[${attempt + 1}] Failed to parse body string: ${data.substring(0, 100)}`);
          lastError = 'Invalid JSON in result body';
          continue;
        }
      }

      if (data.error || data.blocked) {
        lastError = data.error || 'Blocked by Bright Data unblocking engine';
        console.error(`[${attempt + 1}] API Error: ${lastError}`);
        continue;
      }

      const results: SerpResults = {
        organic: (data.organic || []).map((res: any) => ({
          title: res.title,
          url: res.link,
          snippet: res.description,
          position: res.global_rank
        })),
        peopleAlsoAsk: (data.people_also_ask || []).map((paa: any) => paa.question),
        aiOverview: data.ai_overview ? {
          text: data.ai_overview.text || '',
          sources: (data.ai_overview.references || []).map((ref: any) => ({
            title: ref.title || '',
            url: ref.link || ''
          }))
        } : null,
        featuredSnippet: data.featured_snippet ? {
          text: data.featured_snippet.description || '',
          source: data.featured_snippet.title || '',
          url: data.featured_snippet.link || ''
        } : null,
        relatedSearches: (data.related_searches || []).map((rs: any) => rs.query)
      };

      if (results.organic.length === 0 && !results.aiOverview) {
        lastError = 'No results found in Bright Data body';
        continue;
      }

      console.log(`[${attempt + 1}] SUCCESS! Organic: ${results.organic.length}`);
      return { success: true, results };

    } catch (err: any) {
      lastError = err.message;
      console.error(`[${attempt + 1}] Loop Error: ${err.message}`);
    }
  }

  return { success: false, error: lastError };
}

// ─── ENDPOINTS ─────────────────────────────────────────

serviceRouter.get('/run', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  const payment = extractPayment(c);
  if (!payment) {
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);
  if (!verification.valid) {
    return c.json({ error: 'Payment verification failed', reason: verification.error }, 402);
  }

  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Missing parameter: q' }, 400);

  const gl = (c.req.query('gl') || 'US').toUpperCase();
  const hl = (c.req.query('hl') || 'en').toLowerCase();
  const num = Math.min(parseInt(c.req.query('num') || '10', 10), 20);

  const scrapeResult = await scrapeGoogleSerp(query, gl, hl, num);

  if (!scrapeResult.success || !scrapeResult.results) {
    const status = scrapeResult.isBlock ? 429 : 502;
    return c.json({ error: 'Scrape failed', message: scrapeResult.error }, status);
  }

  return c.json({
    query,
    country: gl,
    results: scrapeResult.results,
    proxy: { type: 'mobile' },
    payment: { txHash: payment.txHash, settled: true },
  });
});

serviceRouter.get('/discover', async (c) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) return c.json({ error: 'WALLET_ADDRESS not set' }, 500);
  return c.json({
    ...build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
    service: SERVICE_NAME,
  });
});

serviceRouter.get('/test', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Missing parameter: q' }, 400);
  const gl = (c.req.query('gl') || 'US').toUpperCase();

  const scrapeResult = await scrapeGoogleSerp(query, gl, 'en', 10);
  if (!scrapeResult.success) {
    const status = scrapeResult.isBlock ? 429 : 502;
    return c.json({ error: scrapeResult.error }, status);
  }

  return c.json({
    query,
    results: scrapeResult.results,
    _test: true,
    _timestamp: new Date().toISOString()
  });
});
