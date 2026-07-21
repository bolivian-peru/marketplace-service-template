/**
 * On-chain USDC payment verification — Solana + Base, zero heavy deps (raw
 * JSON-RPC). Hardened over the v1 verifier:
 *   - INTEGER micro-USDC math throughout (no float divide-before-compare, no
 *     silent 2% under-payment; overpay is fine, underpay is rejected).
 *   - Per-network recipient passed in by the caller, so the address we verify
 *     is exactly the one the 402 advertised.
 *   - No replay state here — replay is the durable store's job (see
 *     replay-store.ts); this module only answers "did this tx really pay?".
 */

import type { Context } from 'hono';
import type { Network, PaymentInfo, VerifyResult } from './types';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Extract the payment from request headers. Null if none present. */
export function extractPayment(c: Context): PaymentInfo | null {
  const txHash = c.req.header('payment-signature') || c.req.header('x-payment-signature');
  if (!txHash) return null;

  const networkHeader = c.req.header('x-payment-network')?.toLowerCase();
  let network: Network;
  if (networkHeader === 'solana' || networkHeader === 'base') {
    network = networkHeader;
  } else if (txHash.startsWith('0x') && txHash.length === 66) {
    network = 'base';
  } else if (/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(txHash)) {
    network = 'solana';
  } else {
    return null;
  }
  return { txHash, network };
}

/**
 * Verify a payment on-chain against `expectedRecipient` for at least
 * `expectedMicroUsdc` base units. `expectedRecipient` MUST be the wallet for
 * `payment.network` (the caller resolves per-network so advertised == verified).
 */
export async function verifyPayment(
  payment: PaymentInfo,
  expectedRecipient: string,
  expectedMicroUsdc: bigint,
): Promise<VerifyResult> {
  try {
    return payment.network === 'solana'
      ? await verifySolana(payment.txHash, expectedRecipient, expectedMicroUsdc)
      : await verifyBase(payment.txHash, expectedRecipient, expectedMicroUsdc);
  } catch (err: any) {
    return { valid: false, error: `Verification failed: ${err.message}` };
  }
}

async function verifySolana(
  txHash: string,
  expectedRecipient: string,
  expectedMicroUsdc: bigint,
): Promise<VerifyResult> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }],
    }),
  });
  const data = (await res.json()) as any;
  if (!data.result) return { valid: false, error: 'Transaction not found or not finalized' };

  const tx = data.result;
  if (tx.meta?.err) return { valid: false, error: 'Transaction failed on-chain' };

  // Map token-account address -> owner wallet, so we can match the true owner.
  const accountKeys = tx.transaction?.message?.accountKeys || [];
  const tokenAccountOwners = new Map<string, string>();
  for (const bal of tx.meta?.postTokenBalances || []) {
    if (bal.mint === USDC_SOLANA_MINT && bal.owner) {
      const accountAddr = accountKeys[bal.accountIndex]?.pubkey;
      if (accountAddr) tokenAccountOwners.set(accountAddr, bal.owner);
    }
  }

  const instructions = tx.transaction?.message?.instructions || [];
  const inner = tx.meta?.innerInstructions?.flatMap((i: any) => i.instructions) || [];
  for (const ix of [...instructions, ...inner]) {
    const parsed = ix.parsed;
    if (!parsed || ix.program !== 'spl-token') continue;
    if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') continue;

    const info = parsed.info;
    if (parsed.type === 'transferChecked' && info.mint !== USDC_SOLANA_MINT) continue;

    // INTEGER base units — transferChecked exposes tokenAmount.amount (string);
    // plain transfer exposes amount (string). Never parse the float uiAmount.
    const raw = parsed.type === 'transferChecked' ? info.tokenAmount?.amount : info.amount;
    let amountMicro: bigint;
    try { amountMicro = BigInt(raw ?? '0'); } catch { continue; }
    if (amountMicro < expectedMicroUsdc) continue;

    const destOwner = tokenAccountOwners.get(info.destination) || info.destination;
    if (destOwner === expectedRecipient) {
      return { valid: true, amountMicroUsdc: amountMicro.toString(), sender: info.source || info.authority, recipient: destOwner };
    }
  }
  return { valid: false, error: 'No matching USDC transfer to recipient found' };
}

async function verifyBase(
  txHash: string,
  expectedRecipient: string,
  expectedMicroUsdc: bigint,
): Promise<VerifyResult> {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
  });
  const data = (await res.json()) as any;
  if (!data.result) return { valid: false, error: 'Transaction not found or not confirmed' };

  const receipt = data.result;
  if (receipt.status !== '0x1') return { valid: false, error: 'Transaction reverted' };

  const want = expectedRecipient.toLowerCase();
  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== USDC_BASE_CONTRACT) continue;
    if (log.topics?.[0] !== ERC20_TRANSFER_TOPIC) continue;

    const to = ('0x' + log.topics[2]?.slice(26)).toLowerCase();
    // log.data is the uint256 value in base units — BigInt(hex) IS micro-USDC.
    let amountMicro: bigint;
    try { amountMicro = BigInt(log.data); } catch { continue; }
    if (to === want && amountMicro >= expectedMicroUsdc) {
      const from = '0x' + log.topics[1]?.slice(26);
      return { valid: true, amountMicroUsdc: amountMicro.toString(), sender: from, recipient: to };
    }
  }
  return { valid: false, error: 'No matching USDC transfer to recipient found' };
}
