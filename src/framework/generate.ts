/**
 * Everything an author used to hand-write and keep in sync — generated once,
 * from the task list, so the price, schema, and recipient are identical across
 * the 402 quote, the discovery doc, the protocol file, the A2A card, the
 * storefront manifest, and the marketplace listing.
 */

import type { AgentConfig, Network, TaskDefinition, Wallets } from './types';

const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CHAIN_ID: Record<Network, string> = {
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  base: 'eip155:8453',
};
const SETTLEMENT: Record<Network, string> = { solana: '~400ms', base: '~2s' };

export const microToUsdcString = (micro: number): string => (micro / 1_000_000).toFixed(6).replace(/\.?0+$/, '');

/** The `accepts[]` entries for the networks this operator can actually receive on. */
function acceptsFor(task: TaskDefinition, wallets: Wallets) {
  const networks: Network[] = [];
  if (wallets.solana) networks.push('solana');
  if (wallets.base) networks.push('base');
  return networks.map((network) => ({
    network,
    chainId: CHAIN_ID[network],
    payTo: network === 'solana' ? wallets.solana : wallets.base,
    asset: 'USDC',
    assetAddress: network === 'solana' ? USDC_SOLANA_MINT : USDC_BASE_CONTRACT,
    maxAmountRequired: String(task.priceMicroUsdc), // INTEGER micro-USDC string
    settlementTime: SETTLEMENT[network],
  }));
}

/** The HTTP 402 body for one task — this body IS the integration contract. */
export function build402(task: TaskDefinition, wallets: Wallets, resource: string) {
  return {
    status: 402,
    message: 'Payment required',
    resource,
    taskId: task.id,
    description: task.description,
    price: { amount: microToUsdcString(task.priceMicroUsdc), amountMicroUsdc: String(task.priceMicroUsdc), currency: 'USDC' },
    accepts: acceptsFor(task, wallets),
    inputSchema: task.inputSchema ?? null,
    outputSchema: task.outputSchema ?? null,
    example: task.example ?? null,
    headers: {
      required: ['Payment-Signature'],
      optional: ['X-Payment-Network'],
      format: 'Payment-Signature: <transaction_hash>',
      note: 'Pay accepts[].maxAmountRequired (micro-USDC) to accepts[].payTo, then retry this exact request with Payment-Signature.',
    },
  };
}

/** GET / — the human+machine discovery document listing every task. */
export function discoveryDoc(agent: AgentConfig, wallets: Wallets) {
  return {
    agent: agent.identity.name,
    description: agent.identity.description,
    category: agent.identity.category,
    owner: agent.identity.owner,
    protocol: 'x402',
    networks: [wallets.solana && 'solana', wallets.base && 'base'].filter(Boolean),
    tasks: agent.tasks.map((t) => ({
      id: t.id,
      method: t.method ?? 'GET',
      path: `/tasks/${t.id}`,
      description: t.description,
      price: microToUsdcString(t.priceMicroUsdc),
      priceMicroUsdc: String(t.priceMicroUsdc),
      pricingModel: t.pricingModel ?? 'per-request',
      inputSchema: t.inputSchema ?? null,
      outputSchema: t.outputSchema ?? null,
    })),
    discovery: {
      wellKnown: '/.well-known/x402.json',
      agentCard: '/agent-card.json',
      manifest: '/manifest.json',
      receipts: '/receipts/:txHash',
    },
    howToPay: [
      'Call any /tasks/:id with no Payment-Signature header to get a 402 quote.',
      'Pay accepts[].maxAmountRequired micro-USDC to accepts[].payTo on Base or Solana.',
      'Retry the same request with header Payment-Signature: <tx_hash>.',
      'Lost the response? GET /receipts/<tx_hash> re-serves it free.',
    ],
  };
}

/** /.well-known/x402.json — protocol discovery. */
export function wellKnownX402(agent: AgentConfig, wallets: Wallets) {
  return {
    x402Version: 1,
    name: agent.identity.name,
    resources: agent.tasks.map((t) => ({
      resource: `/tasks/${t.id}`,
      method: t.method ?? 'GET',
      price: { amountMicroUsdc: String(t.priceMicroUsdc), currency: 'USDC' },
      accepts: acceptsFor(t, wallets),
    })),
  };
}

/** /agent-card.json — A2A-style identity + capabilities. */
export function agentCard(agent: AgentConfig, wallets: Wallets) {
  return {
    name: agent.identity.name,
    description: agent.identity.description,
    provider: agent.identity.owner,
    url: agent.identity.url ?? null,
    capabilities: agent.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      inputSchema: t.inputSchema ?? null,
      outputSchema: t.outputSchema ?? null,
      price: { amountMicroUsdc: String(t.priceMicroUsdc), currency: 'USDC' },
    })),
    payment: { protocol: 'x402', networks: acceptsFor(agent.tasks[0], wallets).map((a) => a.network) },
  };
}

/** /manifest.json — the storefront renderer's task catalog. */
export function manifest(agent: AgentConfig, wallets: Wallets) {
  return {
    name: agent.identity.name,
    description: agent.identity.description,
    tasks: agent.tasks.map((t) => ({
      id: t.id,
      name: t.id,
      live: true,
      method: t.method ?? 'GET',
      path: `/tasks/${t.id}`,
      priceModel: t.pricingModel ?? 'per-request',
      priceUsdc: microToUsdcString(t.priceMicroUsdc),
      priceMicroUsdc: String(t.priceMicroUsdc),
      networks: acceptsFor(t, wallets).map((a) => ({ network: a.network, chainId: a.chainId, settlementTime: a.settlementTime })),
      inputSchema: t.inputSchema ?? null,
      outputSchema: t.outputSchema ?? null,
    })),
  };
}

/**
 * The taskmarket registry listing (matches taskmarket/listings/schema.json).
 * The framework GUARANTEES the six hardening attestations, so an author never
 * hand-asserts them. Recipient wallets are intentionally NOT written here —
 * they live only in the live 402 accepts[] (single source of truth).
 */
export function listing(agent: AgentConfig, opts: { baseUrl: string }) {
  const id = slug(agent.identity.name);
  return {
    id,
    name: agent.identity.name,
    description: agent.identity.description,
    category: agent.identity.category,
    endpoint: `${opts.baseUrl.replace(/\/$/, '')}/tasks/${agent.tasks[0].id}`,
    discovery: {
      manifestUrl: `${opts.baseUrl.replace(/\/$/, '')}/manifest.json`,
      skillUrl: `${opts.baseUrl.replace(/\/$/, '')}/`,
      wellKnownX402: `${opts.baseUrl.replace(/\/$/, '')}/.well-known/x402.json`,
    },
    pricing: {
      model: (agent.tasks[0].pricingModel ?? 'per-request') as 'per-request' | 'per-unit',
      priceUsdc: Number(microToUsdcString(agent.tasks[0].priceMicroUsdc)),
      networks: [{ network: 'solana', chainId: CHAIN_ID.solana, settlementTime: SETTLEMENT.solana }],
    },
    wallet: { note: "recipients live in the service's own 402 accepts[] — never duplicated here" },
    owner: { github: agent.identity.owner.github, contact: agent.identity.owner.contact },
    status: 'pending',
    added: new Date().toISOString().slice(0, 10),
    hardening: {
      durableReplayStore: true,
      failClosedWallet: true,
      sharedPaymentGate: true,
      integerMicroUsdc: true,
      idempotentReServe: true,
      moneyPathCI: true,
    },
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
