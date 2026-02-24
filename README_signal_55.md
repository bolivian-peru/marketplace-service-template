# Signal #55 — Prediction Market Aggregator

This branch implements a lightweight prediction market aggregator that can be
used as a signal source for the Investor agent.

## Overview

The entrypoint is `prediction_aggregator.py`, a dependency‑free Python 3
script that pulls markets from multiple prediction platforms and normalises the
output into a single JSON document.

Currently supported sources:

- **Manifold Markets** (`manifold`)
- **Polymarket** (`polymarket`)

The output is designed to be easy for downstream agents, cron jobs, or
notebooks to consume and filter further.

## Usage

From the project root:

```bash
python3 prediction_aggregator.py \
  --sources manifold polymarket \
  --limit 200 \
  --min-liquidity 1000 \
  --top-n 100 \
  --out data/predictions.json
```

Key flags:

- `--sources` — one or more sources to include (`manifold`, `polymarket`).
- `--limit` — maximum markets per source to request (default: 200).
- `--min-liquidity` — optional; drop markets below this liquidity threshold.
- `--top-n` — keep only the top‑N markets after sorting by 24h volume
  (default: 100).
- `--out` — output path for the JSON file; `-` writes to stdout.

Example stdout run (top 3 markets from both sources):

```bash
python3 prediction_aggregator.py --top-n 3
```

## Output format

The script prints a UTF‑8 JSON object with the following shape:

```jsonc
{
  "generated_at": "2026-02-24T02:41:32Z",   // ISO8601, UTC
  "sources": ["manifold", "polymarket"],
  "count": 123,                              // number of markets returned
  "markets": [
    {
      "source": "manifold",                 // data source
      "id": "...",                         // source‑specific market id
      "question": "...",                   // human‑readable title
      "url": "https://...",                // canonical market URL
      "outcome_type": "binary|multi|scalar",
      "probability": 0.42,                  // Yes/up probability if binary
      "implied_odds": 0.42,                 // alias of `probability`
      "volume_24h": 12345.67,               // 24h volume where available
      "liquidity": 890.12,                  // liquidity / depth metric
      "created_at": "2024-01-01T00:00:00Z",
      "close_time": "2024-12-31T00:00:00Z"
    }
  ]
}
```

## Robustness notes

- The script depends only on the Python standard library (no `requests`).
- Each source is fetched in a try/except wrapper; failures are logged to
  stderr but do **not** abort the entire run.
- Timestamps from different APIs (ms since epoch or ISO strings) are
  normalised into ISO8601 UTC where possible.

## Next steps

- Add additional sources (e.g. Kalshi, Metaculus) behind feature flags.
- Wire this script into the Investor cron pipeline so that HEARTBEAT tasks can
  query `data/predictions.json` for high‑signal markets.
