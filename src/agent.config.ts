/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  THIS IS THE ONLY FILE YOU EDIT.                                          │
 * │                                                                          │
 * │  Declare who your agent is and the tasks it performs. The framework      │
 * │  generates the HTTP routes, the x402 402 quotes, on-chain verification,  │
 * │  the durable replay store, receipts, the discovery docs, and your        │
 * │  marketplace listing. You write run(); it does the rest.                 │
 * │                                                                          │
 * │  Set your wallet in .env (WALLET_ADDRESS / WALLET_ADDRESS_BASE) — the    │
 * │  agent refuses to start without one, and never falls back to anyone      │
 * │  else's. Prices are INTEGER micro-USDC (1 USDC = 1_000_000).             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { defineAgent, defineTask } from './framework';
import { webScrape } from './tasks/web-scrape';

export default defineAgent({
  identity: {
    name: 'Reference Task Agent',
    description: 'Example agent: returns its mobile exit IP and fetches public web pages through a real carrier proxy.',
    category: 'proxy',
    owner: { github: 'your-github-handle', contact: 'you@example.com' },
  },
  tasks: [
    // A trivial task so your first paid request always succeeds — proves the
    // whole loop end to end (pay → verified → run → result) with zero moving
    // parts. $0.001.
    defineTask({
      id: 'exit-ip',
      description: 'Return the live mobile exit IP the agent routes through.',
      priceMicroUsdc: 1000,
      outputSchema: {
        type: 'object',
        properties: { ip: { type: 'string' }, country: { type: 'string' } },
      },
      run: async (ctx) => {
        const res = await ctx.proxyFetch('https://ipinfo.io/json', { timeoutMs: 15000 });
        const data = (await res.json()) as any;
        return { ip: data.ip ?? (await ctx.exitIp()), country: data.country ?? null, city: data.city ?? null, org: data.org ?? null };
      },
    }),

    // A real, reliable task: fetch any public URL through the mobile proxy and
    // return clean text. Typed input, SSRF-guarded. $0.005.
    defineTask({
      id: 'web-scrape',
      description: 'Fetch a public URL through a real mobile IP and return the page title and clean text.',
      priceMicroUsdc: 5000,
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch', pattern: '^https?://' },
          maxChars: { type: 'integer', description: 'Max characters of text to return', minimum: 100, maximum: 200000, default: 20000 },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' }, status: { type: 'integer' }, title: { type: 'string' },
          textLength: { type: 'integer' }, text: { type: 'string' }, exitIp: { type: 'string' },
        },
      },
      example: { url: 'https://example.com', maxChars: 5000 },
      run: (ctx) => webScrape(ctx),
    }),
  ],
});
