# Gmail API Integration — Bounty Submission

## Service Name
Gmail API Integration Service

## Bounty ID
Gmail API bounty ($200)

## Summary
Built a complete Gmail API integration service that enables email search via Gmail API with OAuth2 authentication, pagination support, and x402 micropayment integration.

## What Was Built

### Endpoints
- `GET /api/gmail/search` — Search emails by query (from, to, subject, date range, labels)
- `GET /api/gmail/message/:id` — Get email metadata by message ID
- `GET /api/gmail/labels` — Get list of Gmail labels
- `GET /api/gmail/health` — Check Gmail API connection status

### Features Implemented
- ✅ Gmail API integration with OAuth2 (client credentials from env)
- ✅ Email search by query (from, to, subject, date range, labels)
- ✅ Returns email metadata (sender, subject, date, snippet)
- ✅ Pagination support (page tokens)
- ✅ Proxies.sx mobile proxy for all outbound requests
- ✅ x402 pay-per-request micropayment (USDC on Solana + Base)
- ✅ Rate limiting (20 Gmail requests/min per IP)
- ✅ Error handling with specific error messages
- ✅ OAuth2 token refresh handling

## Files Created/Modified

### New Files
- `/src/routes/gmail.ts` — Gmail API router with all endpoints
- `/src/scrapers/gmail-scraper.ts` — Gmail API integration with OAuth2
- `/scripts/exchange-gmail-token.ts` — OAuth2 token exchange helper
- `GMAIL_README.md` — Full API documentation
- `BOUNTY_SUBMISSION.md` — This file

### Modified Files
- `/src/service.ts` — Added Gmail router import and mounting
- `/src/index.ts` — Added Gmail endpoints to health and discovery
- `/.env.example` — Added Gmail API credentials documentation

## API Documentation

### Search Emails
```
GET /api/gmail/search?query=from:user@example.com&maxResults=10
```

**Query Parameters:**
- `query` (required): Gmail search query
- `maxResults`: Max results (default: 10, max: 50)
- `pageToken`: Pagination token
- `includeBody`: Include body preview

**Response:**
```json
{
  "emails": [{
    "id": "message_id",
    "threadId": "thread_id",
    "subject": "Email Subject",
    "from": "sender@email.com",
    "to": "recipient@email.com",
    "date": "2024-03-15T10:30:00.000Z",
    "snippet": "Email preview...",
    "labelIds": ["INBOX", "IMPORTANT"]
  }],
  "total": 10,
  "nextPageToken": "token_for_next_page",
  "resultSizeEstimate": 42
}
```

### Supported Gmail Search Operators
- `from:` — Search by sender
- `to:` — Search by recipient
- `subject:` — Search in subject
- `after:` / `before:` — Date range (YYYY/MM/DD)
- `has:attachment` — Has attachments
- `filename:` — Attachment filename
- `label:` — Email label
- `is:unread` / `is:starred` — Status filters

## Setup Instructions

### 1. Google Cloud Console
```bash
1. Go to https://console.cloud.google.com/apis/credentials
2. Enable Gmail API
3. Create OAuth2 Client ID (Desktop app)
4. Note CLIENT_ID and CLIENT_SECRET
```

### 2. Get Refresh Token
```bash
# Build auth URL (replace CLIENT_ID)
https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/gmail.readonly&response_type=code&access_type=offline

# Exchange code for tokens
bun run scripts/exchange-gmail-token.ts <auth_code> <client_id> <client_secret>
```

### 3. Configure Environment
```bash
cp .env.example .env
# Add WALLET_ADDRESS, PROXY_*, and GOOGLE_* variables
```

### 4. Deploy
```bash
bun install
bun run dev  # Development
# or
bun run start  # Production
```

## Pricing
- **$0.01 USDC** per request
- Supported on Solana (~400ms) and Base (~2s)

## Test Commands
```bash
# Health check
curl http://localhost:3000/api/gmail/health

# Test payment flow (returns 402 with payment info)
curl "http://localhost:3000/api/gmail/search?query=from:test@gmail.com"

# Example query
curl "http://localhost:3000/api/gmail/search?query=subject:invoice%20after:2024/01/01&maxResults=5"
```

## Repository
Forked from: https://github.com/bolivian-peru/marketplace-service-template
Working directory: `/home/admin/gmail-service`

---
Built: 2026-05-09
