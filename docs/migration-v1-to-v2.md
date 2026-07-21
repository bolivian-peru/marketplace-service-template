# Migrating v1 to v2

v1 was fork the repo and hand-edit a single large `service.ts`, wire your own `/api/*` routes, and copy the payment code. v2 is declare your agent in one file, `src/agent.config.ts`, and the framework generates routes, 402 quotes, verification, replay protection, receipts, discovery, and your listing. This guide ports an existing v1 fork.

## What moved

- The original bundled scraping services (Google Maps, SERP, Jobs, Google Reviews, LinkedIn, Instagram, Reddit, Airbnb, research/trending) now live under `examples/legacy-v1/` as reference implementations to port. They are excluded from the build (`tsconfig.json` `exclude`) and from CI, so they compile-check and ship nothing.
- Payment code that used to be hand-copied per service is gone from your surface. On-chain verification is now `src/framework/chain.ts`, and replay plus receipts are `src/framework/replay-store.ts`, both driven by the one shared gate in `src/framework/payment-gate.ts`.
- Discovery documents you used to maintain by hand are generated in `src/framework/generate.ts`.
- The pre-framework v1 is tagged in git. Check out that tag if you need to run the old fork-and-edit behavior unchanged.

## Breaking changes

| v1 | v2 |
|---|---|
| Routes were `/api/run`, `/api/details`, etc. | Routes are `/tasks/:id`, one per declared task. |
| One `service.ts` you edited, plus `index.ts`, `payment.ts`, `proxy.ts`. | You edit only `src/agent.config.ts` (plus optional helpers in `src/tasks/`). |
| `payment.ts` did verification, and wallet fell back to `WALLET_ADDRESS` when the Base wallet was unset. | Verification is `src/framework/chain.ts`; wallets are fail-closed with NO fallback. An unset network is not offered. |
| `PRICE_USDC` was a dollar float (`0.005`). | `priceMicroUsdc` is a positive INTEGER micro-USDC (`5000`). |
| Replay tracking, if any, was in-process and lost on restart. | Durable SQLite replay + receipt store; one tx bound to one task; paid-but-failed stays redeemable. |
| You wrote the 402 body and discovery JSON. | The 402, `/`, `/.well-known/x402.json`, `/agent-card.json`, `/manifest.json`, `/receipts/:txHash`, and the listing are all generated. |
| `SERVICE_NAME`, `DESCRIPTION`, `OUTPUT_SCHEMA` constants. | `identity` + per-task `description`, `inputSchema`, `outputSchema` fields. |

The env contract carries over with two changes: `WALLET_ADDRESS_BASE` no longer falls back to `WALLET_ADDRESS` (set it explicitly to accept Base), and there is a new `REPLAY_STORE_PATH` for the durable ledger. Proxy variables (`PROXY_HOST`, `PROXY_HTTP_PORT`, `PROXY_USER`, `PROXY_PASS`, `PROXY_LIST`, `PROXY_COUNTRY`) are unchanged.

## Port one legacy service, step by step

Say you are porting the legacy Google Maps service.

1. **Open `src/agent.config.ts`.** This is the only file you edit.
2. **Add a `defineTask` block** to the `tasks` array. Pick a kebab-case `id` (for example `maps-search`) and a factual `description` under 200 chars.
3. **Set the price as an integer.** Convert the old `PRICE_USDC` dollar float to micro-USDC: `0.005` becomes `priceMicroUsdc: 5000`.
4. **Translate the old input contract into `inputSchema`.** The old handler read query params like `query`, `location`, `limit`. Express them as JSON Schema, marking the required ones and adding bounds:
   ```typescript
   inputSchema: {
     type: 'object',
     required: ['query', 'location'],
     properties: {
       query: { type: 'string', minLength: 1, maxLength: 200 },
       location: { type: 'string', minLength: 1, maxLength: 200 },
       limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
     },
   },
   ```
   Input is validated before any charge, so bad input returns `400` with the payment untouched.
5. **Move the fetch and extract logic into a helper** under `src/tasks/` (mirror `src/tasks/web-scrape.ts`). Export a function taking `ctx` and returning the result object.
6. **Replace payment and proxy plumbing with the context.** Delete the old `extractPayment` / `verifyPayment` / `build402Response` calls entirely; the gate does that. Swap the old proxy fetch for `ctx.proxyFetch(url, { timeoutMs })`, and read inputs from `ctx.input` instead of `c.req.query()`.
7. **Wire `run`:** `run: (ctx) => mapsSearch(ctx)`.
8. **Delete the ported code** from `examples/legacy-v1/`.
9. **Verify:**
   ```bash
   bun run typecheck
   bun test
   SKIP_PAYMENT_VERIFICATION=1 bun run dev
   curl "http://localhost:3000/tasks/maps-search?query=plumbers&location=Austin+TX"           # -> 402 quote
   curl "http://localhost:3000/tasks/maps-search?query=plumbers&location=Austin+TX" \
     -H "Payment-Signature: testtx"                                                            # -> 200 result
   ```

### Before and after

v1 handler (hand-wired payment, discovery, and route):

```typescript
serviceRouter.get('/run', async (c) => {
  const payment = extractPayment(c);
  if (!payment) return build402Response('/api/run', DESCRIPTION, PRICE_USDC, WALLET, OUTPUT_SCHEMA);
  const ok = await verifyPayment(payment, WALLET, PRICE_USDC);
  if (!ok.valid) return c.json({ error: 'payment invalid' }, 402);
  const query = c.req.query('query');
  const location = c.req.query('location');
  // ... business logic ...
  return c.json({ results, payment: { txHash: payment.txHash } });
});
```

v2 declaration (payment, replay, receipts, discovery all generated):

```typescript
defineTask({
  id: 'maps-search',
  description: 'Search Google Maps businesses by query and location through a mobile IP.',
  priceMicroUsdc: 5000,
  inputSchema: { /* as above */ },
  run: (ctx) => mapsSearch(ctx),
});
```

Everything that was payment ceremony in v1 is now the framework's job. You keep only the part that was ever unique to your service: the fetch and extract logic inside `run()`.
