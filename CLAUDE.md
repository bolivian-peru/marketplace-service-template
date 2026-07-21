# CLAUDE.md

> For an AI coding assistant authoring a task in this repo. Read this fully before editing. It is written so you get a new task right on the first try.

## The ONLY file you edit

`src/agent.config.ts`. You declare the agent's identity and its `tasks[]` there. You may add helper files under `src/tasks/` and import them into a task's `run()`. That is the entire authoring surface.

Do NOT edit any of these. They implement the money guarantees, and changing them is out of scope:

- `src/framework/**` (config validation, payment gate, chain verification, replay store, discovery generators, server).
- `src/index.ts` (the entry point).
- `src/proxy.ts`, `tsconfig.json`, `package.json`, `tests/**`, `scripts/**`, `examples/**`.

If a task cannot be expressed by editing only `src/agent.config.ts` plus a helper in `src/tasks/`, stop and say so rather than touching the framework.

## The defineTask contract

Import `defineTask` from `./framework`. Every field, from `src/framework/types.ts`:

| Field | Type | Rule |
|---|---|---|
| `id` | string | REQUIRED. kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique across the agent. Becomes `/tasks/:id`. |
| `description` | string | REQUIRED. <= 200 chars, factual. Reused verbatim in the 402, discovery, and listing. |
| `method` | `'GET'` \| `'POST'` | Optional, default `'GET'`. GET reads input from query params; POST reads it from the JSON body. |
| `priceMicroUsdc` | number | REQUIRED. **Positive INTEGER micro-USDC. NOT a float, NOT dollars.** `1 USDC = 1_000_000`. `$0.005` is `5000`. `$0.001` is `1000`. A non-integer or `<= 0` value fails boot validation. |
| `pricingModel` | `'per-request'` \| `'per-unit'` | Optional, default `'per-request'`. Advisory label in discovery and listing. |
| `inputSchema` | JsonSchema | Optional. Validated at request time before any charge. See docs/tasks-api.md for the supported subset. |
| `outputSchema` | JsonSchema | Optional. Advisory: published in the 402 and discovery, not enforced on your return value. |
| `example` | object | Optional. Example input rendered in discovery and echoed in 400 errors. |
| `run` | `(ctx) => Promise<unknown>` | REQUIRED. Your logic. Runs ONLY after payment is verified and atomically claimed. |

Prices are validated at boot: `Number.isInteger(priceMicroUsdc) && priceMicroUsdc > 0`, or the agent refuses to start.

## The run(ctx) contract

`ctx` is a `TaskContext` (from `src/framework/types.ts`):

- `ctx.input`: `Record<string, unknown>`. For GET, the query params coerced against `inputSchema` (numbers and booleans get typed). For POST, the parsed JSON body. Already validated against `inputSchema` before `run()` is called, so a required field is present. Values are typed loosely, so still coerce with `String(...)` / `Number(...)` at the edges.
- `ctx.proxyFetch(url, options?)`: fetch through the operator's metered mobile proxy. `options` extend `RequestInit` with `{ maxRetries?: number (default 2), timeoutMs?: number (default 30000) }`. Use this for all outbound web requests; do not call bare `fetch` for task work.
- `ctx.exitIp()`: `Promise<string>`. The proxy's live exit IP, for result metadata.
- `ctx.payment`: `{ txHash, network, amountMicroUsdc }`. The verified payment that unlocked this run, if you need it in the result.

Return any JSON-serializable value. The gate wraps it as `{ taskId, result: <your value>, payment: {...} }`, stores it, and re-serves it idempotently. Do NOT implement payment checks, replay checks, receipts, or verification inside `run()`. The gate already did all of that before calling you. If `run()` throws after payment, the gate marks the payment failed-but-redeemable, so throw a clear `Error` on a genuine failure rather than returning a bad result.

## How to add a task

1. Open `src/agent.config.ts`.
2. Add a `defineTask({ ... })` block to the `tasks` array with the fields above.
3. Put non-trivial fetch and extract logic in a new file under `src/tasks/` (mirror `src/tasks/web-scrape.ts`), export a function taking `ctx`, and call it from `run`.
4. Set `priceMicroUsdc` as an integer. Sanity check: dollars times `1_000_000`.
5. If the task takes input, add an `inputSchema` and, for a public URL fetch, guard against private and metadata hosts the way `web-scrape.ts` does.
6. Run the checks below.

## How to test

```bash
bun run typecheck        # types must pass
bun test                 # money-path suite + your task
```

To exercise the live 402, pay, 200 loop locally without real USDC, set `SKIP_PAYMENT_VERIFICATION=1` (dev only; the server refuses to boot with it when `NODE_ENV=production`), then:

```bash
bun run dev
curl "http://localhost:3000/tasks/<your-id>"                      # -> 402 quote
curl "http://localhost:3000/tasks/<your-id>" -H "Payment-Signature: testtx"   # -> 200 result
```

## Money invariants the framework already enforces (do not re-implement)

- Fail-closed per-network wallet resolution from `.env`, no fallback address.
- Integer micro-USDC pricing and integer on-chain verification.
- One shared payment gate for every task route.
- Durable replay and receipt store (SQLite by default), one tx bound to one task.
- Idempotent re-serve of a stored result.
- Paid-but-failed stays redeemable (retry the same tx re-runs free).

Your job is only the task logic in `run()`. If you find yourself writing verification, wallet handling, replay tracking, or 402 construction, delete it: the framework owns it.

## Commands

```bash
bun install                                  # dependencies
bun run dev                                  # hot-reload dev server (:3000)
bun run start                                # production
bun run typecheck                            # tsc --noEmit
bun test                                     # tests
bun run publish-listing -- https://your-url  # generate taskmarket listing JSON
```
