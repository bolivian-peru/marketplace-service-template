/**
 * Generate this agent's taskmarket listing JSON from its own config, ready to
 * PR into the registry. Prints to stdout (redirect to a file) — the framework
 * fills the six hardening attestations and points discovery at your live URL.
 *
 *   bun run publish-listing -- https://your-agent.example.com > listing.json
 *
 * The registry validator (taskmarket/scripts/validate-listings.mjs) checks the
 * result; the recipient wallet is intentionally NOT in the listing — it lives
 * only in your live 402 accepts[].
 */

import agent from '../src/agent.config';
import { listing } from '../src/framework/generate';

const baseUrl = process.argv[2] || agent.identity.url || 'https://your-agent.example.com';
const out = listing(agent, { baseUrl });
console.log(JSON.stringify(out, null, 2));
