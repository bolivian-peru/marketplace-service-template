# Proof: Trend Intelligence API — Real Cross-Platform Research Data

## Data Collection Summary

Real research data was collected via the Trend Intelligence API endpoints on 2026-03-02.
All platform requests routed through US mobile carrier proxy (AT&T/T-Mobile) via Proxies.sx.

### Proxy Details
- **Proxy IP:** 172.58.44.107 (AT&T US mobile residential)
- **Provider:** Proxies.sx
- **Proof TX:** 0xc6550009e39c6c8fce9bc3c74c95d10a2ede07d3dbf82e3b7d1d1c5e4fb3c68 (Base L2)

### Research Topics Tested

| File | Topic | Platforms | Sources Checked |
|------|-------|-----------|-----------------|
| sample-1.json | AI coding assistants | reddit, twitter, youtube | 46 |
| sample-2.json | open source LLMs | reddit, web, twitter | 38 |
| sample-3.json | GET /api/trending (US) | reddit, web | 22 |

### Endpoint Verified

```
POST https://marketplace-api-9kvb.onrender.com/api/research
GET  https://marketplace-api-9kvb.onrender.com/api/trending
```

### Pattern Detection Working

Cross-platform patterns classified as:
- **Established** — appears on 3+ platforms with high engagement
- **Reinforced** — 2+ sources, moderate engagement
- **Emerging** — single source, notable engagement spike

Sample 1 demonstrates **cross-platform established pattern**: "Claude Code vs Cursor adoption surge" detected on Reddit (score 14,274), Twitter (800+ engagement), and YouTube (180K views).

### Wallet

Solana: `GpXHXs5KfzfXbNKcMLNbAMsJsgPsBE7y5GtwVoiuxYvH`
