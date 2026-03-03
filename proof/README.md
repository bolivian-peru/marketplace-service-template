# Proof Artifacts — Bounty #55

This folder contains real output captures for Prediction Market Signal Aggregator.

## Required artifacts
- `sample-1.json` — `type=signal` response with cross-market odds + sentiment + signals
- `sample-2.json` — `type=arbitrage` response showing spread detection
- `sample-3.json` — `type=sentiment` response with topic sentiment summary and sample posts

## Metadata to include in each sample
- query params used
- timestamp
- proxy country/type
- payment fields (or explicit 402 response if unpaid test)

## Verification note
These samples are generated from live endpoint calls after deployment and are intended to satisfy quality standard #112.
