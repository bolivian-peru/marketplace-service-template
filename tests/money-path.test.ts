/**
 * Money-path tests — the six hardening guarantees, proven. These run in CI, so
 * a regression that could burn a payer's USDC or route revenue wrong fails the
 * build. Uses a fresh in-memory replay store per test + a purpose-built agent.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createServer, defineAgent, defineTask } from '../src/framework';
import { createReplayStore } from '../src/framework/replay-store';

const TEST_SOL = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const TEST_BASE = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const microHex = (micro: number) => '0x' + micro.toString(16).padStart(64, '0');
const toTopic = (addr: string) => '0x' + '0'.repeat(24) + addr.toLowerCase().replace(/^0x/, '');

let txCounter = 1;
const nextBaseTx = () => '0x' + (txCounter++).toString(16).padStart(64, '0');
let restoreFetch: (() => void) | null = null;

/** Mock Base RPC: a USDC Transfer of `amountMicro` to `recipient`. */
function mockBaseRpc(recipient: string, amountMicro: number) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes('mainnet.base.org')) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { status: '0x1', logs: [{ address: USDC_BASE, topics: [TRANSFER_TOPIC, toTopic('0x' + '0'.repeat(40)), toTopic(recipient)], data: microHex(amountMicro) }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // Any proxied task fetch (ipinfo etc.) returns a stub.
    return new Response(JSON.stringify({ ip: '1.2.3.4', country: 'US' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  restoreFetch = () => { globalThis.fetch = original; };
}

/** A fresh server + its own in-memory store, with a controllable flaky task. */
function makeServer(opts: { failFirst?: boolean } = {}) {
  let calls = 0;
  const agent = defineAgent({
    identity: { name: 'Test Agent', description: 'test', category: 'data', owner: { github: 'x', contact: 'x@x.com' } },
    tasks: [
      defineTask({ id: 'echo', description: 'echo input', priceMicroUsdc: 5000, inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } }, run: async (ctx) => ({ echoed: ctx.input.q }) }),
      defineTask({ id: 'other', description: 'other task', priceMicroUsdc: 5000, run: async () => ({ ok: true }) }),
      defineTask({ id: 'flaky', description: 'fails first call', priceMicroUsdc: 5000, run: async () => { calls++; if (opts.failFirst && calls === 1) throw new Error('boom'); return { attempt: calls }; } }),
    ],
  });
  process.env.REPLAY_STORE = ':memory:';
  return createServer(agent, { store: createReplayStore(), rateLimitPerMin: 10000 });
}

const paidReq = (path: string, txHash: string) =>
  new Request('http://localhost' + path, { headers: { 'X-Payment-Signature': txHash, 'X-Payment-Network': 'base' } });

beforeEach(() => {
  process.env.WALLET_ADDRESS = TEST_SOL;
  process.env.WALLET_ADDRESS_BASE = TEST_BASE;
  process.env.PROXY_HOST = 'proxy.test'; process.env.PROXY_HTTP_PORT = '8080';
  process.env.PROXY_USER = 'u'; process.env.PROXY_PASS = 'p'; process.env.PROXY_COUNTRY = 'US';
  delete process.env.SKIP_PAYMENT_VERIFICATION;
});
afterEach(() => { if (restoreFetch) { restoreFetch(); restoreFetch = null; } });

describe('money path', () => {
  test('402 quote when unpaid, with accepts[] and integer micro price', async () => {
    const app = makeServer();
    const res = await app.fetch(new Request('http://localhost/tasks/echo?q=hi'));
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.taskId).toBe('echo');
    expect(body.price.amountMicroUsdc).toBe('5000');
    expect(body.accepts.some((a: any) => a.network === 'base' && a.maxAmountRequired === '5000')).toBe(true);
  });

  test('advertised recipient == verified recipient (base)', async () => {
    const app = makeServer();
    const res = await app.fetch(new Request('http://localhost/tasks/echo?q=hi'));
    const body = await res.json() as any;
    const base = body.accepts.find((a: any) => a.network === 'base');
    expect(base.payTo.toLowerCase()).toBe(TEST_BASE.toLowerCase()); // the exact wallet the gate checks
  });

  test('valid paid request returns 200 + settlement headers', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    const res = await app.fetch(paidReq('/tasks/echo?q=hello', tx));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Payment-Settled')).toBe('true');
    const body = await res.json() as any;
    expect(body.result.echoed).toBe('hello');
    expect(body.payment.txHash).toBe(tx);
  });

  test('underpayment is rejected (integer micro-USDC, no tolerance)', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 4999); // one micro-USDC short
    const res = await app.fetch(paidReq('/tasks/echo?q=hi', nextBaseTx()));
    expect(res.status).toBe(402);
    expect((await res.json() as any).error).toContain('Payment verification failed');
  });

  test('wrong recipient is rejected', async () => {
    const app = makeServer();
    mockBaseRpc('0x2222222222222222222222222222222222222222', 5000);
    const res = await app.fetch(paidReq('/tasks/echo?q=hi', nextBaseTx()));
    expect(res.status).toBe(402);
  });

  test('replay: second identical request re-serves the stored result idempotently', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    const r1 = await app.fetch(paidReq('/tasks/echo?q=one', tx));
    expect(r1.status).toBe(200);
    // Second call with the SAME tx: no new charge, same stored result.
    const r2 = await app.fetch(paidReq('/tasks/echo?q=DIFFERENT', tx));
    expect(r2.status).toBe(200);
    const b2 = await r2.json() as any;
    expect(b2.result.echoed).toBe('one'); // the ORIGINAL result, not re-run
  });

  test('cross-task replay is rejected (one tx bound to one task)', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    await app.fetch(paidReq('/tasks/echo?q=x', tx));
    const res = await app.fetch(paidReq('/tasks/other', tx)); // reuse the tx elsewhere
    expect(res.status).toBe(409);
  });

  test('bad input does NOT consume payment; same tx redeems after fix', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    const bad = await app.fetch(paidReq('/tasks/echo', tx)); // missing required q
    expect(bad.status).toBe(400);
    // The tx was never claimed — retry with valid input succeeds.
    const good = await app.fetch(paidReq('/tasks/echo?q=fixed', tx));
    expect(good.status).toBe(200);
    expect((await good.json() as any).result.echoed).toBe('fixed');
  });

  test('paid-but-failed leaves the payment redeemable; retry re-runs for free', async () => {
    const app = makeServer({ failFirst: true });
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    const fail = await app.fetch(paidReq('/tasks/flaky', tx));
    expect(fail.status).toBe(502);
    expect((await fail.json() as any).redeemable).toBe(true);
    // Same tx again: the task re-runs (now succeeds), no second payment needed.
    const ok = await app.fetch(paidReq('/tasks/flaky', tx));
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).result.attempt).toBe(2);
  });

  test('receipt lookup re-serves a served result by tx hash', async () => {
    const app = makeServer();
    mockBaseRpc(TEST_BASE, 5000);
    const tx = nextBaseTx();
    await app.fetch(paidReq('/tasks/echo?q=receipted', tx));
    const res = await app.fetch(new Request('http://localhost/receipts/' + tx));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('served');
    expect(body.result.result.echoed).toBe('receipted');
  });

  test('fail-closed: no wallet set refuses to start', () => {
    const saved = process.env.WALLET_ADDRESS; const savedB = process.env.WALLET_ADDRESS_BASE;
    delete process.env.WALLET_ADDRESS; delete process.env.WALLET_ADDRESS_BASE;
    expect(() => makeServer()).toThrow();
    process.env.WALLET_ADDRESS = saved; process.env.WALLET_ADDRESS_BASE = savedB;
  });
});
