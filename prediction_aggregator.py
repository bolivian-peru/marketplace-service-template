#!/usr/bin/env python3
"""Prediction Market Aggregator (Signal #55)

Pulls markets from several prediction platforms and emits a unified JSON snapshot
that can be consumed by other agents or cron jobs.

Usage examples:

    python3 prediction_aggregator.py --sources manifold polymarket \
        --min-liquidity 1000 --top-n 50 --out data/predictions.json

The script is intentionally dependency-light (only `requests`) so it can run
inside lightweight cron environments.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Iterable, List, Optional
from urllib.parse import urlencode
from urllib.request import urlopen, Request

ISO8601 = "%Y-%m-%dT%H:%M:%SZ"


@dataclass
class Market:
    source: str
    id: str
    question: str
    url: str
    outcome_type: str  # e.g. "binary", "multi", "scalar"
    probability: Optional[float]  # 0-1 for the main bullish outcome (Yes / up)
    implied_odds: Optional[float]  # alias of probability, kept for clarity
    volume_24h: Optional[float]
    liquidity: Optional[float]
    created_at: Optional[str]
    close_time: Optional[str]


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime(ISO8601)


# ------------------------ Manifold Markets ------------------------


def fetch_manifold(limit: int = 200) -> List[Market]:
    """Fetch markets from Manifold's public API.

    API docs (as of 2024-10): https://manifold.markets/docs/api
    """

    url = "https://api.manifold.markets/v0/markets"
    params = {"limit": str(limit)}

    query = urlencode(params)
    with urlopen(Request(url + "?" + query, headers={"User-Agent": "prediction-aggregator/0.1"}), timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    markets: List[Market] = []
    for m in data:
        # We focus on YES probability for binary markets.
        prob = m.get("probability") if m.get("outcomeType") == "BINARY" else None

        markets.append(
            Market(
                source="manifold",
                id=m.get("id", ""),
                question=m.get("question", ""),
                url=f"https://manifold.markets/{m.get('creatorUsername', '')}/{m.get('slug', m.get('id', ''))}",
                outcome_type=(m.get("outcomeType") or "").lower(),
                probability=prob,
                implied_odds=prob,
                volume_24h=float(m.get("volume24Hours")) if m.get("volume24Hours") is not None else None,
                liquidity=float(m.get("elasticity")) if m.get("elasticity") is not None else None,
                created_at=_to_iso(m.get("createdTime")),
                close_time=_to_iso(m.get("closeTime")),
            )
        )

    return markets


# ------------------------ Polymarket ------------------------


def fetch_polymarket(limit: int = 200) -> List[Market]:
    """Fetch markets from Polymarket's public Gamma API.

    Docs are not officially stable; this uses a best-effort public endpoint that
    worked as of 2024-10. It's fine if Polymarket tweaks the schema – the
    aggregator will simply skip fields it cannot map.
    """

    url = "https://gamma-api.polymarket.com/events"
    params = {
        "includeClosedMarkets": "false",
        "limit": str(limit),
    }

    query = urlencode(params)
    with urlopen(Request(url + "?" + query, headers={"User-Agent": "prediction-aggregator/0.1"}), timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    # Some deployments may return a bare list of events instead of an object.
    if isinstance(data, list):
        events = data
    else:
        events = data.get("events") or []
    markets: List[Market] = []

    for e in events:
        question = e.get("title") or e.get("question") or ""
        url_slug = e.get("slug") or e.get("id") or ""
        base_url = "https://polymarket.com/event/" + url_slug
        # many events have multiple markets; choose the main one (highest volume)
        best_market = None
        best_volume = -1.0

        for m in e.get("markets") or []:
            vol = float(m.get("volume", 0) or 0.0)
            if vol > best_volume:
                best_volume = vol
                best_market = m

        if not best_market:
            continue

        prices = best_market.get("prices") or []
        prob_yes = float(prices[0]) if prices else None

        markets.append(
            Market(
                source="polymarket",
                id=str(best_market.get("id")),
                question=question,
                url=base_url,
                outcome_type="binary" if len(prices) == 2 else "multi",
                probability=prob_yes,
                implied_odds=prob_yes,
                volume_24h=float(best_market.get("volume")) if best_market.get("volume") is not None else None,
                liquidity=float(best_market.get("liquidity")) if best_market.get("liquidity") is not None else None,
                created_at=_to_iso(e.get("createdAt") or e.get("created_at")),
                close_time=_to_iso(e.get("endDate") or e.get("end_date")),
            )
        )

    return markets


# ------------------------ Helpers ------------------------


def _to_iso(ts_ms_or_iso) -> Optional[str]:
    """Convert a timestamp (ms since epoch or ISO string) to ISO8601.

    Returns None on any parsing error.
    """

    if ts_ms_or_iso in (None, ""):
        return None

    # Already a string-ish timestamp
    if isinstance(ts_ms_or_iso, str):
        # Best-effort: normalize to Z suffix if missing
        try:
            dt = datetime.fromisoformat(ts_ms_or_iso.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).strftime(ISO8601)
        except Exception:
            return None

    # Assume milliseconds since epoch
    try:
        ts_ms = float(ts_ms_or_iso)
        dt = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc)
        return dt.strftime(ISO8601)
    except Exception:
        return None


def aggregate_markets(
    sources: Iterable[str],
    limit: int = 200,
    min_liquidity: Optional[float] = None,
    top_n: Optional[int] = None,
) -> List[Market]:
    """Aggregate markets from the selected sources.

    Filtering is intentionally lightweight; deeper domain-specific filtering
    should be layered on top of this signal.
    """

    all_markets: List[Market] = []

    for src in sources:
        try:
            if src == "manifold":
                all_markets.extend(fetch_manifold(limit=limit))
            elif src == "polymarket":
                all_markets.extend(fetch_polymarket(limit=limit))
            else:
                raise ValueError(f"Unknown source: {src}")
        except Exception as exc:
            # Best-effort: log to stderr and continue with other sources.
            sys.stderr.write(f"[prediction_aggregator] source {src} failed: {exc}\n")

    # Optional filtering by liquidity
    if min_liquidity is not None:
        all_markets = [
            m for m in all_markets if (m.liquidity or 0.0) >= min_liquidity
        ]

    # Sort by 24h volume descending as a simple proxy for importance
    all_markets.sort(key=lambda m: (m.volume_24h or 0.0), reverse=True)

    if top_n is not None:
        all_markets = all_markets[:top_n]

    return all_markets


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prediction Market Aggregator")

    parser.add_argument(
        "--sources",
        nargs="+",
        default=["manifold", "polymarket"],
        choices=["manifold", "polymarket"],
        help="Which prediction market sources to pull from.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Max markets per source to request.",
    )
    parser.add_argument(
        "--min-liquidity",
        type=float,
        default=None,
        help="Minimum liquidity threshold; markets below this are dropped.",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=100,
        help="Return at most this many markets after sorting by 24h volume.",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="-",
        help="Output file path (JSON). Use '-' for stdout.",
    )

    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    try:
        markets = aggregate_markets(
            sources=args.sources,
            limit=args.limit,
            min_liquidity=args.min_liquidity,
            top_n=args.top_n,
        )
    except Exception as exc:
        sys.stderr.write(f"[prediction_aggregator] error: {exc}\n")
        return 1

    payload = {
        "generated_at": now_utc(),
        "sources": args.sources,
        "count": len(markets),
        "markets": [asdict(m) for m in markets],
    }

    text = json.dumps(payload, ensure_ascii=False, indent=2)

    if args.out == "-":
        sys.stdout.write(text + "\n")
    else:
        from pathlib import Path

        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
