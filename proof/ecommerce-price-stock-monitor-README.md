# E-Commerce Price & Stock Monitor — proof notes

## Status

Implementation added in this branch:

- `src/scrapers/ecommerce-monitor.ts`
- `GET /api/ecommerce/check`
- `POST /api/ecommerce/batch`
- `listings/ecommerce-price-stock-monitor.json`

## Verification performed

- TypeScript compile/typecheck passes with `npm run typecheck`.
- 402 discovery response is implemented for Base USDC payments to the new MetaMask/Base wallet.
- Input validation blocks invalid/private URLs.
- Parser supports JSON-LD Product objects, OpenGraph product metadata, and store-specific fallback patterns for Amazon, Walmart, Target, and eBay.

## Live mobile-proxy proof still needed before final marketplace acceptance

The repo's marketplace standard asks for three real outputs through a mobile proxy. This container does not currently have usable Proxies.sx proxy credentials or Bun runtime, so I did **not** fabricate fake proof. The service is ready for live proof generation once deployed in the Proxies.sx runtime or run locally with:

```bash
PROXY_HOST=...
PROXY_HTTP_PORT=...
PROXY_USER=...
PROXY_PASS=...
WALLET_ADDRESS_BASE=0x5f03897c6c77dD00F65222A2420a3Cff5507079D
bun run start
```

Suggested proof queries:

1. Amazon product URL with `expectedPrice`
2. Walmart product URL
3. eBay product URL

Save API responses as:

- `proof/ecommerce-sample-amazon.json`
- `proof/ecommerce-sample-walmart.json`
- `proof/ecommerce-sample-ebay.json`
