# Marketplace Listings

This folder contains all services listed on the [Proxies.sx Marketplace](https://agents.proxies.sx/marketplace/).

The marketplace page fetches from: `https://raw.githubusercontent.com/bolivian-peru/marketplace-service-template/master/listings/index.json`

## Structure

```
listings/
├── index.json              # All active listings (auto-generated)
├── schema.json             # JSON Schema for validation
├── _template.json          # Copy this to create your listing
├── proxies-sx-mobile.json  # Proxies.sx mobile proxy service
├── proxies-sx-browser.json # Proxies.sx antidetect browser
└── your-service.json       # Your service here!
```

## Submit Your Service

### 1. Build your service

Use the [template](../README.md) or build from scratch. Your service must:
- Accept x402 payments (USDC on Solana and/or Base)
- Return proper 402 responses with payment instructions
- Be publicly accessible

### 2. Create your listing

1. Fork this repo
2. Copy `_template.json` → `your-service-id.json`
3. Fill in all required fields (see schema.json)
4. Commit and push

### 3. Submit a Pull Request

Open a PR with:
- Title: `Add listing: Your Service Name`
- Description: What your service does, endpoint URL, your contact

### 4. We verify and merge

We'll:
- Test your endpoint (hit it, verify 402 response)
- Check payment verification works
- Review pricing and description
- Merge → your service goes live

## Listing Schema

Required fields:
- `id` — Unique identifier (lowercase, hyphens: `my-scraper`)
- `name` — Display name (max 50 chars)
- `description` — One-liner for AI agents (max 200 chars)
- `endpoint` — Base URL
- `pricing` — Model, amount, currency, networks with wallet addresses
- `category` — One of: `proxy`, `browser`, `scraper`, `data`, `automation`, `other`
- `owner` — Name + at least one contact (github/twitter/telegram)
- `status` — Set to `pending` for new submissions

Optional but recommended:
- `longDescription` — Detailed explanation
- `docsUrl` — Documentation link
- `tags` — Search keywords
- `x402.discoveryUrl` — URL that returns 402

See [schema.json](schema.json) for full specification.

## Categories

| Category | Description |
|----------|-------------|
| `proxy` | Proxy services (HTTP, SOCKS, rotating) |
| `browser` | Browser automation, antidetect, screenshots |
| `scraper` | Web scraping, data extraction |
| `data` | Data APIs, enrichment, lookup |
| `automation` | Form filling, account creation, workflows |
| `other` | Everything else |

## Status Values

| Status | Meaning |
|--------|---------|
| `active` | Live and accepting payments |
| `pending` | Submitted, awaiting verification |
| `deprecated` | Still works but being phased out |
| `offline` | Temporarily unavailable |

## Questions?

- Telegram: [@proxyforai](https://t.me/proxyforai)
- Twitter: [@sxproxies](https://x.com/sxproxies)
- GitHub Issues: [Open an issue](https://github.com/bolivian-peru/marketplace-service-template/issues)
