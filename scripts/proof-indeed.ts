import { scrapeIndeed } from '../src/scrapers/job-scraper';
import { getProxy, proxyFetch } from '../src/proxy';

async function getExitIp() {
  try {
    const r = await proxyFetch('https://api.ipify.org?format=json', { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j: any = await r.json();
    return typeof j?.ip === 'string' ? j.ip : null;
  } catch {
    return null;
  }
}

async function main() {
  const [query = 'Software Engineer', location = 'Remote', runsRaw = '10'] = process.argv.slice(2);
  const runs = Math.max(1, Math.min(parseInt(runsRaw, 10) || 10, 50));

  const proxy = getProxy();
  const ip = await getExitIp();

  const all: any[] = [];
  for (let i = 0; i < runs; i++) {
    const startedAt = new Date().toISOString();
    try {
      const results = await scrapeIndeed(query, location, 20);
      all.push({
        i,
        ok: true,
        startedAt,
        count: results.length,
        sample: results.slice(0, 3),
      });
      // small delay to reduce rate-limit spikes
      await new Promise((r) => setTimeout(r, 350));
    } catch (e: any) {
      all.push({ i, ok: false, startedAt, error: e?.message || String(e) });
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const payload = {
    query,
    location,
    runs,
    proxy: { ip, country: proxy.country, host: proxy.host, type: 'mobile' },
    results: all,
    generatedAt: new Date().toISOString(),
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync('listings', { recursive: true });
  const outPath = path.join('listings', `indeed-proof-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote proof → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
