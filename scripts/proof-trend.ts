import { synthesizeResearch } from '../src/scrapers/research-synthesizer';
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
  const [topic = 'Bitcoin', runsRaw = '3'] = process.argv.slice(2);
  const runs = Math.max(1, Math.min(parseInt(runsRaw, 10) || 3, 10));

  console.log(`Running Trend Intelligence Proof for topic: ${topic} (${runs} runs)...`);

  const all: any[] = [];
  const countries = ['US', 'DE', 'GB']; // Proof across 3 countries

  for (let i = 0; i < runs; i++) {
    const country = countries[i % countries.length];
    process.env.PROXY_COUNTRY = country;
    
    console.log(`Run ${i + 1}/${runs} - Country: ${country}`);
    
    const startedAt = new Date().toISOString();
    try {
      const ip = await getExitIp();
      const payload = await synthesizeResearch({ topic, timeframe: '7d' });
      
      all.push({
        run: i + 1,
        country,
        exit_ip: ip,
        ok: true,
        startedAt,
        data: payload,
      });
      
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e: any) {
      all.push({ run: i + 1, country, ok: false, startedAt, error: e?.message || String(e) });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync('listings', { recursive: true });
  const outPath = path.join('listings', `trend-proof-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`Wrote proof → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
