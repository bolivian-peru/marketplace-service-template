# Marketplace Service Template

**Create an AI agent that does paid tasks. Declare the tasks, deploy anywhere, get paid USDC straight to your wallet.**

## What this is

You write ONE file, `src/agent.config.ts`, declaring your agent's identity plus a list of tasks. Each task is an `id`, a `description`, a `priceMicroUsdc`, an input and output JSON Schema, and a `run()` function. From that declaration the framework generates the HTTP routes, the x402 `402` payment quotes, on-chain USDC verification on Base and Solana, a durable replay and receipt store, the machine discovery documents, and your marketplace listing. Every task runs behind one shared, hardened payment gate, so you never hand-write payment code. Your tasks fetch through Proxies.sx metered mobile proxies, and payments settle directly to the wallet you set in `.env`. The platform never custodies your funds.

## The task-markets thesis

Once an agent has a stable identity, a way to pay per request (x402), and a way to be discovered, work stops being something you bundle into a monolith and starts unbundling into task markets: small, priced, independently callable units of work that any other agent can find and pay for on the spot. Data gathering is the first class of work to externalize this way, because it is easy to price per call, easy to verify by result, and expensive to keep building in-house. This template is a way to publish one such unit. You declare a bounded task, put a price on it, and let any paying agent call it. The framing comes from the agentic task-markets idea; this repo is a concrete on-ramp, not a claim that the whole economy has moved.

## Quickstart

```bash
git clone https://github.com/bolivian-peru/marketplace-service-template
cd marketplace-service-template
cp .env.example .env
# Edit .env: set WALLET_ADDRESS (Solana) and/or WALLET_ADDRESS_BASE (Base),
# plus your mobile proxy credentials (PROXY_HOST / PROXY_HTTP_PORT / PROXY_USER / PROXY_PASS).
bun install
bun run dev
```

The agent refuses to start without at least one wallet, and it never falls back to anyone else's address.

### The 402, pay, 200 loop

Call any task with no payment header and you get a `402` quote. This body is the integration contract:

```bash
curl "http://localhost:3000/tasks/exit-ip"
```

```json
{
  "status": 402,
  "message": "Payment required",
  "resource": "/tasks/exit-ip",
  "taskId": "exit-ip",
  "description": "Return the live mobile exit IP the agent routes through.",
  "price": { "amount": "0.001", "amountMicroUsdc": "1000", "currency": "USDC" },
  "accepts": [
    {
      "network": "solana",
      "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "payTo": "YOUR_SOLANA_WALLET",
      "asset": "USDC",
      "assetAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxAmountRequired": "1000",
      "settlementTime": "~400ms"
    }
  ],
  "inputSchema": null,
  "outputSchema": { "type": "object", "properties": { "ip": { "type": "string" }, "country": { "type": "string" } } },
  "example": null,
  "headers": {
    "required": ["Payment-Signature"],
    "optional": ["X-Payment-Network"],
    "format": "Payment-Signature: <transaction_hash>",
    "note": "Pay accepts[].maxAmountRequired (micro-USDC) to accepts[].payTo, then retry this exact request with Payment-Signature."
  }
}
```

Pay `accepts[].maxAmountRequired` micro-USDC (here `1000`, which is `$0.001`) to `accepts[].payTo` on the network you chose, then retry the exact same request with the transaction hash in the `Payment-Signature` header:

```bash
curl "http://localhost:3000/tasks/exit-ip" \
  -H "Payment-Signature: <your_tx_hash>"
```

```json
{
  "taskId": "exit-ip",
  "result": { "ip": "173.x.x.x", "country": "US", "city": "Austin", "org": "AS21928 T-Mobile USA" },
  "payment": { "txHash": "<your_tx_hash>", "network": "solana", "amountMicroUsdc": "1000", "settled": true }
}
```

The network is inferred from the hash shape (a `0x` 66-char hash is Base, a base58 hash is Solana) or you can set it explicitly with the `X-Payment-Network` header. Base and Solana accept entries appear in `accepts[]` only for the networks you configured a wallet for.

### Rehearse without real USDC

Set `SKIP_PAYMENT_VERIFICATION=1` in `.env` to walk the full `402`, pay, `200` loop locally without a real on-chain payment. You still send any `Payment-Signature` value to trigger the paid path. The server refuses to start with this flag when `NODE_ENV=production`, so it can never serve paid tasks for free in production.

## Add your own task

Add a `defineTask` block to the `tasks` array in `src/agent.config.ts`. That is the whole change:

```typescript
defineTask({
  id: 'web-scrape',
  description: 'Fetch a public URL through a real mobile IP and return the page title and clean text.',
  priceMicroUsdc: 5000, // integer micro-USDC: 5000 = $0.005
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL to fetch', pattern: '^https?://' },
      maxChars: { type: 'integer', minimum: 100, maximum: 200000, default: 20000 },
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
  run: async (ctx) => {
    const res = await ctx.proxyFetch(String(ctx.input.url), { timeoutMs: 30000 });
    const html = await res.text();
    return { url: String(ctx.input.url), status: res.status, text: html, exitIp: await ctx.exitIp() };
  },
}),
```

The framework auto-generates the route, the `402` quote, on-chain verification, replay protection, receipts, the discovery entries, and the listing row for this task. You only write `run()`. Keep heavy logic in a helper under `src/tasks/` and call it from `run()`, the way `web-scrape` does. Full field reference is in [docs/tasks-api.md](docs/tasks-api.md).

## What the framework generates

Every one of these is derived from your task list, so the price, schema, and recipient are identical across all of them:

- `GET /tasks/:id` (or `POST`) for each task, behind the shared payment gate.
- The `402` quote body for each task (see above).
- `GET /` : the human and machine discovery document listing every task.
- `GET /.well-known/x402.json` : x402 protocol discovery.
- `GET /agent-card.json` : an A2A-style identity and capabilities card.
- `GET /manifest.json` : the storefront renderer's task catalog.
- `GET /receipts/:txHash` : re-serves a stored result by transaction hash, free.
- `GET /health` : liveness plus the networks you accept.
- Your taskmarket listing JSON, via `bun run publish-listing`.

## The six money guarantees

Each guarantee maps to a class of bug it prevents. Every one lives in the single shared gate and durable store, not in per-task code:

- **Fail-closed per-network wallet.** Wallets resolve from `.env` per network with no fallback address anywhere. An unset network is simply not offered instead of silently redirecting your revenue. This prevents a fallback that leaks revenue.
- **Integer micro-USDC.** Price is a positive integer in micro-USDC (`1 USDC = 1_000_000`), and verification does integer base-unit math end to end, so overpay is fine and underpay is rejected. This prevents float rounding that lets a payer under-pay.
- **One shared payment gate.** Every task route runs through the exact same gate code. There is no per-route copy of the payment logic to drift out of sync. This prevents per-route drift where one endpoint is weaker than another.
- **Durable replay store.** Spent-transaction state lives in a durable store (SQLite by default), not an in-process set, and a transaction hash is bound to one task id. This prevents replay across restarts or replicas, and prevents reusing one payment for a different task.
- **Idempotent re-serve.** A served result is stored and re-served for the same transaction hash, and `GET /receipts/:txHash` returns it too. This prevents a lost response from costing a second payment.
- **Paid-but-failed is redeemable.** A task that throws after payment is marked failed rather than served, and retrying the same request with the same `Payment-Signature` re-runs the work at no extra charge. This prevents a failed run from burning the payment.

The taskmarket registry encodes the money-path hardening as six attestation booleans in a listing: `durableReplayStore`, `failClosedWallet`, `sharedPaymentGate`, `integerMicroUsdc`, `idempotentReServe`, and `moneyPathCI`. All six must be `true` for a listing to go `active`. The framework guarantees them (see `src/framework/payment-gate.ts` and `src/framework/replay-store.ts`), sets all six `true` in your generated listing, and `moneyPathCI` is backed by `tests/money-path.test.ts`, which proves them on every CI run. Full payment walkthrough: [docs/payments.md](docs/payments.md).

## Economics (illustrative)

These numbers are illustrative, not a promise about your results. The honest cost driver is fetch-side bandwidth. Proxies.sx mobile bandwidth is about `$4/GB`, which is about `$0.000004` per KB. A roughly 10 KB response therefore costs about `$0.00004` in bandwidth. Pricing a task in the `$0.003` to `$0.15` range leaves a wide gross margin over that bandwidth cost. Price for the value of the result, not the byte count. You are paid directly to your wallet on Base or Solana, and the platform never touches the funds.

## Publish to the marketplace

```bash
bun run publish-listing -- https://your-agent-url > listing.json
```

This generates your listing JSON from your own config, with the six hardening attestations filled in and discovery pointed at your live URL. Open a PR that adds it to the [taskmarket registry](https://github.com/bolivian-peru/taskmarket) under `listings/<your-id>.json`. The recipient wallet is intentionally NOT in the listing. It lives only in your live `402` `accepts[]`, which stays the single source of truth. New listings PR as `status: pending`; reviewers flip to `active` after a health probe confirms your endpoint returns a valid `402`.

## Deploy

```bash
# Docker
docker build -t my-agent .
docker run -p 3000:3000 --env-file .env my-agent

# Bare Bun
bun install --production && bun run start
```

Point a public HTTPS URL at the server (a reverse proxy such as nginx or Caddy for TLS), then use that URL when you publish your listing. For multi-replica deploys, back the replay store with a shared store so a spent transaction stays spent across replicas; see [docs/payments.md](docs/payments.md).

## Migrating from v1

If you forked the old v1 template (the single hand-edited `service.ts` with `/api/*` routes), those services were moved to `examples/legacy-v1/` as reference implementations to port, excluded from the build. Follow [docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md) to bring each one into a `defineTask`. The pre-framework v1 is tagged in git, so you can check it out if you need the old fork-and-edit behavior.

## Legal

Operators own the legality of the tasks they run, including compliance with the terms of service of any site they fetch. Do not run tasks that produce CSAM, enable fraud or credential theft, or perform attacks. The taskmarket registry removes listings in banned categories immediately and permanently.

## License

MIT. See [LICENSE](LICENSE).
