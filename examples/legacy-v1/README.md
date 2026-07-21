# Legacy v1 services (reference)

These are the original bundled scraping services (Google Maps, SERP, Jobs,
Google Reviews, LinkedIn, Instagram, Reddit, Airbnb, research/trending) from
before the declarative framework. They are kept as **reference implementations
to port**, not as part of the build (excluded from `tsconfig.json` and CI).

To bring one to v2: create a task in `src/agent.config.ts` with `defineTask`,
move the scraper's fetch/extract logic into its `run(ctx)` using
`ctx.proxyFetch`, and delete the corresponding code here. The framework then
generates the route, 402 quote, verification, replay protection, receipts, and
listing for you. See `../../docs/migration-v1-to-v2.md`.
