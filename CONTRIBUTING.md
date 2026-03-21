# Contributing to Marketplace Service Template

Thanks for your interest in contributing! This is the builder template for the [Proxies.sx Data Marketplace](https://agents.proxies.sx/marketplace/).

## Ways to Contribute

### 1. Build a Marketplace Service (Bounty)

The main way to contribute is by building a new data API service.

**Steps:**
1. Check the [Issues tab](https://github.com/bolivian-peru/marketplace-service-template/issues) for open bounties
2. Comment on the issue to claim it
3. Fork this repo
4. Build your service in `src/service.ts`
5. Deploy to a public URL (Render, Railway, Fly.io)
6. Submit a PR with:
   - Working deployment URL
   - Proof data (real JSON output from 3+ countries via mobile proxies)
   - Your Solana USDC wallet address
   - x402 payment flow working (HTTP 402 → pay → HTTP 200)

**Bounty payments:** $SX tokens, paid after merge and deployment verification.

### 2. Improve the Template

Bug fixes, documentation improvements, and developer experience enhancements are welcome.

### 3. Report Issues

Found a bug or have a feature request? [Open an issue](https://github.com/bolivian-peru/marketplace-service-template/issues/new).

## Submission Requirements

Every bounty PR **must** include:

1. **Live deployment** — public URL on Render, Railway, Fly.io, or similar
2. **Proof data** — real JSON output scraped via Proxies.sx mobile proxies (3+ countries)
3. **Integration** — wired into `src/service.ts` via `/api/run` endpoint
4. **x402 payment** — proper HTTP 402 response with wallet + pricing
5. **Solana USDC wallet** — for bounty payment

PRs without a working deployment are not reviewed.

## Code Standards

- TypeScript (strict mode)
- Use the existing patterns in `src/service.ts`
- No hardcoded credentials — use environment variables
- No unnecessary dependencies — keep it lean
- Test your service works behind a proxy

## Security

- Never commit credentials, API keys, or private keys
- Never add `eval()`, `Function()`, or dynamic code execution
- Never add external HTTP calls to unknown servers
- All user input must be validated
- See [SECURITY.md](SECURITY.md) for the full checklist

## Getting Help

- **Telegram:** [@proxyforai](https://t.me/proxyforai)
- **Twitter:** [@sxproxies](https://x.com/sxproxies)
- **Email:** agents@proxies.sx
- **Discussions:** [GitHub Discussions](https://github.com/bolivian-peru/marketplace-service-template/discussions)
