/**
 * Authoring API + load-time validation + fail-closed wallet resolution.
 *
 * `defineTask` / `defineAgent` are identity helpers that give authors full
 * type-checking on the one file they edit. `validateAgent` runs at boot and
 * refuses to start a misconfigured agent — the money can never silently route
 * to the wrong place, and a bad task never reaches production half-wired.
 */

import type { AgentConfig, Network, TaskDefinition, Wallets } from './types';

export function defineTask(task: TaskDefinition): TaskDefinition {
  return task;
}

export function defineAgent(config: AgentConfig): AgentConfig {
  return config;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Resolve per-network recipient wallets from env, FAIL-CLOSED. There is no
 * fallback wallet anywhere — an unset network is simply not offered, never a
 * silent redirect of the operator's revenue.
 *
 *   WALLET_ADDRESS       — Solana recipient (required; the agent won't serve
 *                          paid routes without at least one wallet)
 *   WALLET_ADDRESS_BASE  — Base recipient (optional; Base offered only if set)
 */
export function resolveWallets(): Wallets {
  const wallets: Wallets = {};
  const sol = process.env.WALLET_ADDRESS?.trim();
  const base = process.env.WALLET_ADDRESS_BASE?.trim();

  if (sol) {
    if (!SOLANA_ADDRESS.test(sol)) throw new Error(`WALLET_ADDRESS is not a valid Solana address: "${sol}"`);
    wallets.solana = sol;
  }
  if (base) {
    if (!EVM_ADDRESS.test(base)) throw new Error(`WALLET_ADDRESS_BASE is not a valid EVM address: "${base}"`);
    wallets.base = base;
  }
  return wallets;
}

/** The recipient for a given network, or undefined if that network isn't offered. */
export function recipientFor(wallets: Wallets, network: Network): string | undefined {
  return network === 'base' ? wallets.base : wallets.solana;
}

/**
 * Validate the whole agent + its environment at boot. Throws (fail-closed) on
 * any problem so a broken agent never accepts payments. Returns the resolved
 * wallets so the server wires the exact addresses it validated.
 */
export function validateAgent(agent: AgentConfig): { wallets: Wallets } {
  const id = agent.identity;
  if (!id?.name || id.name.length > 50) throw new Error('identity.name is required and must be <= 50 chars');
  if (!id.description || id.description.length > 200) throw new Error('identity.description is required and must be <= 200 chars');
  if (!['proxy', 'scraper', 'data', 'automation', 'other'].includes(id.category)) throw new Error(`identity.category invalid: ${id.category}`);
  if (!id.owner?.github || !id.owner?.contact) throw new Error('identity.owner.github and identity.owner.contact are required');

  if (!Array.isArray(agent.tasks) || agent.tasks.length === 0) throw new Error('agent must define at least one task');

  const seen = new Set<string>();
  for (const t of agent.tasks) {
    if (!KEBAB.test(t.id)) throw new Error(`task id "${t.id}" must be kebab-case`);
    if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`);
    seen.add(t.id);
    if (!t.description || t.description.length > 200) throw new Error(`task "${t.id}" description is required and must be <= 200 chars`);
    if (!Number.isInteger(t.priceMicroUsdc) || t.priceMicroUsdc <= 0) throw new Error(`task "${t.id}" priceMicroUsdc must be a positive integer (micro-USDC)`);
    if (typeof t.run !== 'function') throw new Error(`task "${t.id}" must define a run() function`);
  }

  // Wallets: at least one network must be configured, or nothing can be paid.
  const wallets = resolveWallets();
  if (!wallets.solana && !wallets.base) {
    throw new Error('No recipient wallet set. Set WALLET_ADDRESS (Solana) and/or WALLET_ADDRESS_BASE (Base). The agent refuses to serve paid routes without one.');
  }

  // Dev-only bypass must never be on in production.
  if (process.env.NODE_ENV === 'production' && process.env.SKIP_PAYMENT_VERIFICATION === '1') {
    throw new Error('SKIP_PAYMENT_VERIFICATION=1 is set in production. Refusing to start — this would serve paid tasks for free.');
  }

  return { wallets };
}
