/**
 * The ONE payment gate. Every task route runs through this exact code — there
 * is no per-route copy to drift, and every money guarantee lives here:
 *
 *   discover → 402 quote (this body is the contract)
 *   validate input BEFORE charging (bad input = 400, tx stays redeemable)
 *   verify on-chain against the per-network recipient (advertised == verified)
 *   atomic claim (durable, cross-restart, one tx = one task)
 *   run → store result → idempotent re-serve (a lost response never re-charges)
 *   task threw AFTER payment → mark failed-redeemable (retry same tx, free)
 */

import type { Context } from 'hono';
import { extractPayment, verifyPayment } from './chain';
import { recipientFor } from './config';
import { build402 } from './generate';
import { coerceQuery, validateInput } from './schema';
import { proxyFetch, getProxyExitIp } from '../proxy';
import type { ReplayStore, TaskContext, TaskDefinition, Wallets } from './types';

const SKIP = process.env.SKIP_PAYMENT_VERIFICATION === '1' && process.env.NODE_ENV !== 'production';

function settlementHeaders(c: Context, txHash: string, network: string, amountMicroUsdc: string) {
  const receipt = { status: 'settled', txHash, network, amountMicroUsdc };
  c.header('X-Payment-Settled', 'true');
  c.header('X-Payment-TxHash', txHash);
  c.header('payment-response', Buffer.from(JSON.stringify(receipt)).toString('base64'));
}

async function runTask(task: TaskDefinition, input: Record<string, unknown>, payment: { txHash: string; network: string; amountMicroUsdc: string }): Promise<unknown> {
  const ctx: TaskContext = {
    input,
    payment: { txHash: payment.txHash, network: payment.network as any, amountMicroUsdc: payment.amountMicroUsdc },
    proxyFetch,
    exitIp: getProxyExitIp,
  };
  return task.run(ctx);
}

/** Build the Hono handler for one task. */
export function taskHandler(task: TaskDefinition, wallets: Wallets, store: ReplayStore) {
  const method = task.method ?? 'GET';

  return async (c: Context) => {
    const resource = `/tasks/${task.id}`;

    // 1. Gather input (typed query for GET, JSON body for POST).
    let input: Record<string, unknown>;
    if (method === 'POST') {
      try { input = (await c.req.json()) as Record<string, unknown>; }
      catch { input = {}; }
    } else {
      input = coerceQuery(c.req.query() as Record<string, string>, task.inputSchema);
    }

    // 2. No payment header → 402 quote (the contract).
    const payment = extractPayment(c);
    if (!payment) return c.json(build402(task, wallets, resource), 402);

    // 3. Fast paths off the durable store, before any RPC.
    const existing = store.get(payment.txHash);
    if (existing) {
      if (existing.taskId !== task.id) {
        return c.json({ error: 'Payment already used for a different task', taskId: existing.taskId }, 409);
      }
      if (existing.status === 'served' && existing.result) {
        settlementHeaders(c, payment.txHash, existing.network, existing.amountMicroUsdc);
        return c.json(JSON.parse(existing.result));
      }
      if (existing.status === 'claimed') {
        return c.json({ error: 'Payment is being processed, retry shortly' }, 409);
      }
      // status === 'failed' → payment was proven once; re-attempt (see step 7b).
    }

    // 4. Validate input BEFORE charging. Bad input never consumes the payment.
    if (task.inputSchema) {
      const errors = validateInput(input, task.inputSchema);
      if (errors.length) {
        return c.json({ error: 'Invalid input', details: errors, inputSchema: task.inputSchema, example: task.example ?? null }, 400);
      }
    }

    // 5. Resolve the recipient for THIS network — must be one we advertised.
    const recipient = recipientFor(wallets, payment.network);
    if (!recipient && !SKIP) {
      return c.json({ error: `Network not accepted: ${payment.network}. Pay on a network listed in the 402 accepts[].` }, 402);
    }

    // 6. Verify on-chain (unless dev bypass). Integer micro-USDC, exact recipient.
    let amountMicroUsdc = String(task.priceMicroUsdc);
    if (!existing) {
      if (SKIP) {
        amountMicroUsdc = String(task.priceMicroUsdc);
      } else {
        const v = await verifyPayment(payment, recipient!, BigInt(task.priceMicroUsdc));
        if (!v.valid) {
          return c.json({ error: 'Payment verification failed', reason: v.error, hint: 'Confirm the tx is finalized and pays the exact micro-USDC amount to the recipient in accepts[].' }, 402);
        }
        amountMicroUsdc = v.amountMicroUsdc!;
      }

      // 7. Atomic claim. Winner runs; a racing loser reads the winner's outcome.
      const claim = store.claim(payment.txHash, task.id, payment.network, amountMicroUsdc);
      if (!claim.ok) {
        const e = claim.existing;
        if (e.taskId !== task.id) return c.json({ error: 'Payment already used for a different task' }, 409);
        if (e.status === 'served' && e.result) {
          settlementHeaders(c, payment.txHash, e.network, e.amountMicroUsdc);
          return c.json(JSON.parse(e.result));
        }
        if (e.status === 'claimed') return c.json({ error: 'Payment is being processed, retry shortly' }, 409);
        // failed → fall through and re-run.
        amountMicroUsdc = e.amountMicroUsdc;
      }
    } else {
      amountMicroUsdc = existing.amountMicroUsdc; // 7b. re-running a failed claim
    }

    // 8. Run the task. Success stores + serves; failure stays redeemable.
    try {
      const result = await runTask(task, input, { txHash: payment.txHash, network: payment.network, amountMicroUsdc });
      const body = { taskId: task.id, result, payment: { txHash: payment.txHash, network: payment.network, amountMicroUsdc, settled: true } };
      store.markServed(payment.txHash, JSON.stringify(body));
      settlementHeaders(c, payment.txHash, payment.network, amountMicroUsdc);
      return c.json(body);
    } catch (err: any) {
      store.markFailed(payment.txHash);
      return c.json({
        error: 'Task failed after payment',
        message: err?.message || String(err),
        redeemable: true,
        hint: 'Your payment is not lost. Retry the SAME request with the same Payment-Signature to re-run the task at no extra charge.',
      }, 502);
    }
  };
}
