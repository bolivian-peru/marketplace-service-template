# Gmail API Integration Service

A monetizable Gmail API service built on the Proxies.sx marketplace template with x402 micropayment support.

## Features

- **Email Search**: Search Gmail by query (from, to, subject, date range, labels)
- **Email Metadata**: Retrieve sender, subject, date, snippet, labels
- **Pagination**: Full support with page tokens
- **OAuth2 Authentication**: Secure refresh token flow
- **Mobile Proxy**: All requests routed through Proxies.sx 4G/5G mobile proxies
- **x402 Payments**: USDC payments on Solana and Base

## API Endpoints

### `GET /api/gmail/search`

Search emails with Gmail query syntax.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Gmail search query |
| maxResults | number | No | Max results (default: 10, max: 50) |
| pageToken | string | No | Pagination token |
| includeBody | boolean | No | Include body preview |

**Example Queries:**
```
from:boss@company.com
subject:invoice after:2024/01/01
to:newsletter@spam.com before:2024/12/31
has:attachment filename:pdf
label:INBOX is:unread
```

**Response:**
```json
{
  "emails": [
    {
      "id": "msg123",
      "threadId": "thread456",
      "subject": "Invoice #12345",
      "from": "billing@company.com",
      "to": "you@gmail.com",
      "date": "2024-03-15T10:30:00.000Z",
      "snippet": "Your invoice for March is ready...",
      "labelIds": ["INBOX", "IMPORTANT"]
    }
  ],
  "total": 10,
  "nextPageToken": "token123",
  "resultSizeEstimate": 42,
  "query": "from:billing@company.com",
  "proxy": { "country": "US", "type": "mobile" },
  "payment": { "txHash": "...", "network": "solana", "amount": 0.01, "settled": true }
}
```

### `GET /api/gmail/message/:id`

Get detailed metadata for a single email.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Gmail message ID |
| format | string | No | 'minimal', 'metadata', 'full', 'raw' |

### `GET /api/gmail/labels`

Get list of all Gmail labels in your account.

### `GET /api/gmail/health`

Check Gmail API connection status without payment.

## Gmail Search Operators

| Operator | Example | Description |
|----------|---------|-------------|
| from: | from:user@example.com | Sender |
| to: | to:recipient@domain.com | Recipient |
| subject: | subject:invoice | Subject contains |
| after: | after:2024/01/01 | After date |
| before: | before:2024/12/31 | Before date |
| has:attachment | has:attachment | Has attachments |
| filename: | filename:pdf | Attachment name |
| list: | list:newsletter.com | Mailing list |
| label: | label:INBOX | Email label |
| is:unread | is:unread | Unread emails |
| is:starred | is:starred | Starred emails |

## Setup

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
4. Create OAuth2 credentials (Desktop app type)
5. Note your CLIENT_ID and CLIENT_SECRET

### 2. Get Refresh Token

```bash
# Build auth URL
# Replace YOUR_CLIENT_ID with your actual client ID
https://accounts.google.com/o/oauth2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https://www.googleapis.com/auth/gmail.readonly&response_type=code&access_type=offline

# Open URL in browser, authorize, copy the code from the URL
# It will look like: 4/0Adeu5BW... (after the "code=")

# Exchange code for tokens
bun run scripts/exchange-gmail-token.ts <auth_code> <client_id> <client_secret>
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
WALLET_ADDRESS=your_solana_wallet
WALLET_ADDRESS_BASE=your_base_wallet

# Proxy credentials from proxies.sx
PROXY_HOST=proxy.proxies.sx
PROXY_HTTP_PORT=8080
PROXY_USER=your_proxy_user
PROXY_PASS=your_proxy_pass
PROXY_COUNTRY=US

# Gmail API credentials
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token
```

### 4. Install & Run

```bash
bun install
bun run dev
```

## Deployment

### Docker

```bash
docker build -t gmail-service .
docker run -p 3000:3000 --env-file .env gmail-service
```

### Direct

```bash
bun install --production
bun run start
```

## Testing

```bash
# Health check (no auth required)
curl http://localhost:3000/api/gmail/health

# Test payment flow (will return 402 with payment info)
curl "http://localhost:3000/api/gmail/search?query=from:test@gmail.com"

# With mock payment headers (for testing)
curl -H "Payment-Signature: test_tx_hash" "http://localhost:3000/api/gmail/search?query=from:test@gmail.com"
```

## Pricing

Default: **$0.01 USDC** per request

Accepted on:
- **Solana** (~400ms settlement)
- **Base** (~2s settlement)

## Rate Limits

- 20 requests/minute per IP (Gmail endpoints)
- 60 requests/minute per IP (all endpoints)

## Security

- OAuth2 with refresh token (no access token stored)
- Payment verification on-chain
- Mobile proxy exits (not your server IP)
- CORS enabled
- Rate limiting

## Project Structure

```
src/
├── routes/
│   └── gmail.ts          ← Gmail API endpoints
├── scrapers/
│   └── gmail-scraper.ts  ← Gmail API integration
├── service.ts            ← Main router
├── index.ts              ← Server entry point
├── payment.ts            ← x402 payment verification
└── proxy.ts             ← Proxies.sx integration
```
