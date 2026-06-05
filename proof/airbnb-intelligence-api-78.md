# Bounty #78 — Airbnb Intelligence API validation note

Issue: https://github.com/bolivian-peru/marketplace-service-template/issues/78

## What I verified locally

The local workspace already contains a substantial Airbnb intelligence implementation path with:

- scraper module: `src/scrapers/airbnb-scraper.ts`
- route integration: `src/service.ts`
- endpoint registration in `src/index.ts`
- prior proof notes/data in `proof/README.md`

## Implemented endpoints observed in `src/service.ts`

- `GET /api/airbnb/search`
  - x402-gated
  - price: `$0.02 USDC`
  - input: `location`, optional `checkin`, `checkout`, `guests`, `limit`

- `GET /api/airbnb/listing/:id`
  - x402-gated
  - price: `$0.01 USDC`
  - input: listing id in URL path

- `GET /api/airbnb/reviews/:listing_id`
  - x402-gated
  - price: `$0.01 USDC`
  - input: listing id in URL path + optional `limit`

- `GET /api/airbnb/market-stats`
  - x402-gated
  - price: `$0.05 USDC`
  - input: `location`, optional `checkin`, `checkout`

## Airbnb scraper behaviors present in `src/scrapers/airbnb-scraper.ts`

- listing search extraction
- detailed listing fetch path
- reviews extraction path
- market-stats calculation path
- mobile-proxy fetch helpers via existing `proxyFetch()`
- HTML extraction plus Airbnb API-oriented fetch path

## Existing local proof data

The workspace already contains a prior proof note in `proof/README.md` stating:

- real Airbnb data fetched via a US mobile residential proxy on `2026-02-26`
- sample records from Airbnb explore/search flows
- normalized output intended for downstream API/service use

That note references:
- `sample-1.json` — 6 listings (full detail)
- `sample-2.json` — 6 superhost listings
- `sample-3.json` — 10 listing summaries

## Validation run

TypeScript compilation passes locally with:

```bash
./node_modules/.bin/tsc --noEmit
```

## Important caveat

This note confirms a credible local implementation path and pre-existing proof artifacts.

It does **not** claim a fresh deployed production proof from my side today.
A live proof/update would still require:

- active production proxy credentials
- deployed service runtime
- live verification against Airbnb’s current blocking/challenge behavior

## Practical review value

For maintainers/reviewers, this means the issue is not only conceptual in my local workspace:

- endpoint surface is present
- x402 wiring is present
- scraper module exists
- discovery/index exposure exists
- compile check passes
- historical proof artifacts already exist locally

## Payment addresses if this validation artifact is useful

- EVM: `0x221bDa369a19A25144ef9afb644bB555184a26df`
