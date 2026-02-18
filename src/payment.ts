/**
 * x402 Payment Verification
 * ─────────────────────────
 * DON'T EDIT THIS FILE. It verifies USDC payments on Solana and Base.
 *
 * Zero dependencies — uses public RPC endpoints with fetch().
 * Verifies: tx exists, is confirmed, transfers USDC, correct amount + recipient.
 */

import type { Context } from 'hono';

// ─── TYPES ──────────────────────────────────────────

interface PaymentInfo {
  txHash: string;
  network: 'solana' | 'base';
}

interface VerifyResult {
  valid: boolean;
  amount?: number;     // USDC amount transferred
  sender?: string;     // Payer's wallet
  recipient?: string;  // Your wallet
  error?: string;
}

// ─── CONSTANTS ──────────────────────────────────────

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const BASE_RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const USDC_DECIMALS_SOLANA = 6;
const USDC_DECIMALS_BASE = 6;

// Track verified tx hashes to prevent replay (in-memory, resets on restart)
const verifiedTxHashes = new Set<string>();

// ─── PUBLIC API ─────────────────────────────────────

/**
 * Extract payment info from request headers.
 * Returns null if no payment headers present.
 */
export function extractPayment(c: Context): PaymentInfo | null {
  const txHash =
    c.req.header('payment-signature') ||
    c.req.header('x-payment-signature');

  if (!txHash) return null;

  // Detect network from header or tx format
  const networkHeader = c.req.header('x-payment-network')?.toLowerCase();

  let network: 'solana' | 'base';
  if (networkHeader === 'solana' || networkHeader === 'base') {
    network = networkHeader;
  } else if (txHash.startsWith('0x') && txHash.length === 66) {
    network = 'base';
  } else if (/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(txHash)) {
    network = 'solana';
  } else {
    return null; // Unrecognizable format
  }

  return { txHash, network };
}

/**
 * Verify a USDC payment on-chain.
 * Checks: tx confirmed, correct asset (USDC), correct recipient, sufficient amount.
 */
export async function verifyPayment(
  payment: PaymentInfo,
  expectedRecipient: string,
  expectedAmountUSDC: number,
  tolerancePercent: number = 2,
): Promise<VerifyResult> {
  // Replay protection
  if (verifiedTxHashes.has(payment.txHash)) {
    return { valid: false, error: 'Transaction already used (replay)' };
  }

  try {
    const result = payment.network === 'solana'
      ? await verifySolana(payment.txHash, expectedRecipient, expectedAmountUSDC, tolerancePercent)
      : await verifyBase(payment.txHash, expectedRecipient, expectedAmountUSDC, tolerancePercent);

    if (result.valid) {
      verifiedTxHashes.add(payment.txHash);
    }

    return result;
  } catch (err: any) {
    return { valid: false, error: `Verification failed: ${err.message}` };
  }
}

/**
 * Build a standard 402 response for AI agents.
 */
export function build402Response(
  resource: string,
  description: string,
  priceUSDC: number,
  walletAddress: string,
  outputSchema?: Record<string, any>,
) {
  return {
    status: 402,
    message: 'Payment required',
    resource,
    description,
    price: {
      amount: String(priceUSDC),
      currency: 'USDC',
      minimumAmount: String(priceUSDC),
    },
    networks: [
      {
        network: 'solana',
        chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        recipient: walletAddress,
        asset: 'USDC',
        assetAddress: USDC_SOLANA,
      },
      {
        network: 'base',
        chainId: 'eip155:8453',
        recipient: '0x2b7287ec19336AC78c129DD2Da6931e14F3BcE29',
        asset: 'USDC',
        assetAddress: USDC_BASE,
      },
    ],
    headers: {
      required: ['Payment-Signature'],
      optional: ['X-Payment-Network'],
      format: 'Payment-Signature: <transaction_hash>',
    },
    ...(outputSchema ? { outputSchema } : {}),
  };
}

// ─── SOLANA VERIFICATION ────────────────────────────

async function verifySolana(
  txHash: string,
  expectedRecipient: string,
  expectedAmountUSDC: number,
  tolerancePercent: number,
): Promise<VerifyResult> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    }),
  });

  const data = await res.json() as any;

  if (!data.result) {
    return { valid: false, error: 'Transaction not found or not confirmed' };
  }

  const tx = data.result;

  // Check confirmation
  if (tx.meta?.err) {
    return { valid: false, error: 'Transaction failed on-chain' };
  }

  // Build a map of token account address → owner wallet from postTokenBalances
  // This lets us verify that a token account belongs to the expected recipient wallet
  const accountKeys = tx.transaction?.message?.accountKeys || [];
  const tokenAccountOwners = new Map<string, string>();
  for (const bal of tx.meta?.postTokenBalances || []) {
    if (bal.mint === USDC_SOLANA && bal.owner) {
      const accountAddr = accountKeys[bal.accountIndex]?.pubkey;
      if (accountAddr) {
        tokenAccountOwners.set(accountAddr, bal.owner);
      }
    }
  }

  // Find USDC transfer instructions
  const instructions = tx.transaction?.message?.instructions || [];
  const innerInstructions = tx.meta?.innerInstructions?.flatMap((i: any) => i.instructions) || [];
  const allInstructions = [...instructions, ...innerInstructions];
  const minAmount = expectedAmountUSDC * (1 - tolerancePercent / 100);

  for (const ix of allInstructions) {
    const parsed = ix.parsed;
    if (!parsed) continue;

    // SPL Token transfer or transferChecked
    if (
      (parsed.type === 'transfer' || parsed.type === 'transferChecked') &&
      ix.program === 'spl-token'
    ) {
      const info = parsed.info;

      // For transferChecked, verify this is actually USDC
      if (parsed.type === 'transferChecked' && info.mint !== USDC_SOLANA) {
        continue;
      }

      const amount = parsed.type === 'transferChecked'
        ? Number(info.tokenAmount?.uiAmount || 0)
        : Number(info.amount || 0) / 10 ** USDC_DECIMALS_SOLANA;

      if (amount < minAmount) continue;

      // The destination is a token account (ATA), not the wallet address.
      // Resolve the owner wallet via postTokenBalances.
      const destinationTokenAccount = info.destination;
      const recipientWallet = tokenAccountOwners.get(destinationTokenAccount) || destinationTokenAccount;

      if (recipientWallet === expectedRecipient) {
        return {
          valid: true,
          amount,
          sender: info.source || info.authority,
          recipient: recipientWallet,
        };
      }
    }
  }

  return { valid: false, error: 'No matching USDC transfer to recipient found in transaction' };
}

// ─── BASE (EVM) VERIFICATION ────────────────────────

async function verifyBase(
  txHash: string,
  expectedRecipient: string,
  expectedAmountUSDC: number,
  tolerancePercent: number,
): Promise<VerifyResult> {
  // Get transaction receipt
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });

  const data = await res.json() as any;

  if (!data.result) {
    return { valid: false, error: 'Transaction not found or not confirmed' };
  }

  const receipt = data.result;

  // Check success
  if (receipt.status !== '0x1') {
    return { valid: false, error: 'Transaction reverted' };
  }

  // Look for ERC-20 Transfer event from USDC contract
  // Transfer(address from, address to, uint256 value)
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  for (const log of receipt.logs || []) {
    if (
      log.address?.toLowerCase() === USDC_BASE &&
      log.topics?.[0] === transferTopic
    ) {
      const to = '0x' + log.topics[2]?.slice(26);
      const amount = parseInt(log.data, 16) / 10 ** USDC_DECIMALS_BASE;
      const from = '0x' + log.topics[1]?.slice(26);

      const minAmount = expectedAmountUSDC * (1 - tolerancePercent / 100);

      if (
        to.toLowerCase() === expectedRecipient.toLowerCase() &&
        amount >= minAmount
      ) {
        return { valid: true, amount, sender: from, recipient: to };
      }
    }
  }

  return { valid: false, error: 'No matching USDC transfer found in transaction' };
}
