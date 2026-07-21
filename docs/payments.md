# Payments

How a paid request works end to end, accurate to `src/framework/payment-gate.ts`, `src/framework/chain.ts`, `src/framework/config.ts`, and `src/framework/replay-store.ts`. You never write any of this; it is here so you understand the guarantees you are shipping.

## The 402 contract

A request to `/tasks/:id` with no `Payment-Signature` header returns HTTP `402` with the quote body built by `build402` in `src/framework/generate.ts`. That body is the integration contract:

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

`accepts[]` lists one entry per network you configured a wallet for. `maxAmountRequired` is the integer micro-USDC to pay; `payTo` is the exact recipient; `assetAddress` is the USDC mint on Solana (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) or the USDC contract on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).

## The lifecycle: extract, verify, claim, serve

For a request that carries a payment, the gate runs this exact sequence:

1. **Gather input.** GET reads coerced query params against `inputSchema`; POST reads the parsed JSON body.
2. **Extract payment.** `extractPayment` reads `Payment-Signature` (or `X-Payment-Signature`). Network is taken from `X-Payment-Network`, else inferred: a `0x` 66-char hash is Base, a base58 hash matching `^[1-9A-HJ-NP-Za-km-z]{86,88}$` is Solana. No header means the 402 quote is returned instead.
3. **Fast path off the durable store, before any RPC.** If this tx is already on record: a different `taskId` returns `409`; a `served` result is re-served from storage; a `claimed` (in-flight) tx returns `409` "retry shortly"; a `failed` tx falls through to re-run.
4. **Validate input before charging.** If `inputSchema` fails, the gate returns `400` with the errors and the payment is never consumed.
5. **Resolve the recipient for this network.** `recipientFor` returns the wallet for the paid network. If that network was not advertised (no wallet set), the request is rejected with `402`. The address verified is exactly the address advertised.
6. **Verify on-chain.** `verifyPayment` confirms a finalized USDC transfer of at least `priceMicroUsdc` base units to that recipient. Failure returns `402` with the reason.
7. **Atomic claim.** `store.claim(txHash, taskId, ...)` inserts the tx as `claimed` in one atomic write. The winner runs the task; a racing loser reads the winner's outcome (served result, in-flight 409, or a failed record to re-run).
8. **Run and settle.** On success the result is stored (`markServed`) and returned as `{ taskId, result, payment }` with settlement headers. On a thrown error the tx is marked `failed` and the response is `502` with `redeemable: true`.

## Integer micro-USDC

Money math is integer base units throughout. `priceMicroUsdc` is a positive integer (`1 USDC = 1_000_000`). On-chain, verification reads the raw base-unit amount: on Solana, `transferChecked.tokenAmount.amount` or a plain `transfer.amount` (never the float `uiAmount`); on Base, `BigInt(log.data)` of the ERC-20 Transfer event. A transfer is accepted when `amountMicro >= expectedMicroUsdc`, so overpay is fine and any under-payment is rejected. There is no divide-before-compare and no float tolerance.

## Per-network recipient (advertised equals verified)

Wallets resolve fail-closed in `resolveWallets` (`src/framework/config.ts`):

- `WALLET_ADDRESS` is the Solana recipient, validated against the base58 address pattern.
- `WALLET_ADDRESS_BASE` is the Base recipient, validated against `^0x[0-9a-fA-F]{40}$`.
- At least one must be set, or the agent refuses to start. There is no fallback address anywhere. An unset network is simply not offered in `accepts[]`.

Because the gate resolves the recipient per paid network and passes that same address into `verifyPayment`, the address a payer sees in the 402 is the address the chain check requires. There is no path where revenue routes to an address you did not set.

## The durable replay store

State lives in `src/framework/replay-store.ts`. Default backend is a SQLite file at `REPLAY_STORE_PATH` (default `./data/payments.sqlite`, WAL mode), which survives restarts, so a spent tx stays spent. `REPLAY_STORE=:memory:` is for tests only and is not production-safe.

The record for a tx is one row keyed by `tx_hash` with `task_id`, `network`, `amount_micro`, `status` (`claimed` | `served` | `failed`), `result`, and timestamps. `claim` is a single `INSERT OR IGNORE` under SQLite's single-writer lock: if the insert changed a row, this caller owns the claim and runs the task; otherwise it loads and returns the existing record. That atomicity is what prevents two concurrent requests with the same tx from both running.

### Swapping in a shared store for multi-replica

A single SQLite file is durable but single-box. To run multiple replicas, implement the same `ReplayStore` interface (from `src/framework/types.ts`) over a shared backend such as Postgres or Redis, keeping `claim` a single atomic conditional insert, and inject it. `createServer(agent, { store })` accepts a store; wire your shared implementation there. The gate code does not change: it depends only on the interface.

```typescript
interface ReplayStore {
  get(txHash: string): PaymentRecord | null;
  claim(txHash: string, taskId: string, network: string, amountMicroUsdc: string):
    { ok: true } | { ok: false; existing: PaymentRecord };
  markServed(txHash: string, result: string): void;
  markFailed(txHash: string): void;
  close?(): void;
}
```

The one invariant your `claim` must uphold: it is atomic, so exactly one caller ever gets `{ ok: true }` for a given `txHash`.

## Receipts and redeemable failures

- **Receipts.** `GET /receipts/:txHash` re-serves a stored result for a tx, free. A `served` record returns the result; a `failed` record returns `{ status: 'failed', redeemable: true }`; an unknown tx returns `404`. A served response also carries `X-Payment-Settled`, `X-Payment-TxHash`, and a base64 `payment-response` header.
- **Idempotent re-serve.** Re-sending the same paid request returns the stored result rather than charging again. A lost response never costs a second payment.
- **Redeemable failures.** If `run()` throws after payment, the tx is marked `failed`, not served. Retrying the exact same request with the same `Payment-Signature` re-runs the task at no extra charge. A failed run does not burn the payment.

## Replay and cross-task protection

- A tx is bound to one `taskId` on first claim. Reusing it against a different task returns `409` "Payment already used for a different task".
- A spent (`served`) tx re-serves its stored result rather than re-running.
- An in-flight (`claimed`) tx returns `409` "retry shortly" so a duplicate request does not double-run.
- Durability across restarts and, with a shared store, across replicas means a tx spent anywhere is spent everywhere.

## Dev bypass

`SKIP_PAYMENT_VERIFICATION=1` skips step 6 (on-chain verification) so you can rehearse the loop locally with any `Payment-Signature` value. The store still claims, serves, and re-serves as normal. Boot validation throws if this flag is set while `NODE_ENV=production`, so paid tasks can never be served for free in production.

## Networks and settlement

| Network | chainId | Settlement | USDC asset |
|---|---|---|---|
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `~400ms` | mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Base | `eip155:8453` | `~2s` | contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

RPC endpoints default to the public Solana and Base mainnet URLs and can be overridden with `SOLANA_RPC_URL` and `BASE_RPC_URL`.
