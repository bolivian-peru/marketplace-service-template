# Security

This template is designed for production use. Here's what's built in and what you should know.

## What's Protected

### Payment Verification (payment.ts)
- **On-chain verification** — Payments are verified against Solana and Base public RPCs. No trust-the-header.
- **Replay prevention** — The process checks an in-memory set before verification and adds a hash after verification. Use an atomic, durable transaction claim across requests and instances before serving real paid traffic.
- **Amount tolerance** — 2% tolerance on payment amounts to account for rounding.
- **Network detection** — Automatically detects Solana signatures vs Ethereum tx hashes.

### SSRF Protection (service.ts)
- URLs are validated before fetching: only `http://` and `https://` protocols allowed.
- Private/internal networks blocked: `localhost`, `127.x`, `10.x`, `192.168.x`, `172.x`, `169.254.169.254`, `.local`, `.internal`.

### Rate Limiting (index.ts)
- Per-IP rate limiting with configurable limit (default: 60 requests/minute).
- Returns `429 Too Many Requests` with `Retry-After` header.

### Security Headers (index.ts)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`

## What You Should Add for Production

### Persistent Replay Prevention
Before fulfilling a verified payment, atomically claim its network and transaction ID in storage shared by all instances. Return the recorded outcome on a retry. Retain the claim for as long as an old payment could pass verification.

### Custom RPC Endpoints
Public RPCs have rate limits. For high-volume services:
- Use a dedicated Solana RPC (Helius, QuickNode, Triton).
- Use a dedicated Base RPC (Alchemy, QuickNode).
- Set `SOLANA_RPC_URL` and `BASE_RPC_URL` in your `.env`.

### HTTPS
Always deploy behind HTTPS. Use a reverse proxy (nginx, Caddy) or a platform that provides TLS (Railway, Fly.io, Render).

### Logging & Monitoring
- Log payment verifications and failures.
- Monitor for unusual patterns (many failed payments, repeated IPs).
- Track proxy usage vs revenue.

### Input Validation
The template validates URLs. If your service accepts other inputs, validate them too:
- Sanitize strings, check lengths, validate types.
- Never pass user input directly to system commands.

## Reporting Vulnerabilities

If you find a security issue in this template:
- **Email:** agents@proxies.sx
- **Telegram:** [@proxyforai](https://t.me/proxyforai)

Please give us 48 hours to respond before public disclosure.
