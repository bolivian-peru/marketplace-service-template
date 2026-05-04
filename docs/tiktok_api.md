

# TikTok Trend Intelligence API

The TikTok Trend Intelligence API provides real-time data about trending content, hashtags, sounds, and creators on TikTok. This API is designed to work with real mobile carrier IPs (T-Mobile, Vodafone, Orange) to bypass TikTok's anti-bot measures.

## Overview

TikTok is one of the most challenging platforms to scrape due to:
- Encrypted headers
- Behavioral fingerprinting
- Real-time fraud scoring
- Immediate blocking of datacenter IPs
- Rate limiting based on IP reputation

This API uses mobile carrier IPs through Proxies.sx infrastructure to reliably access TikTok data.

## Endpoints

### 1. Get Trending TikTok Content
```
GET /api/tiktok/trending
```

**Parameters:**
- `country` (optional, default: "US") - ISO country code for TikTok trends
- `limit` (optional, default: 20, max: 50) - Number of trending items to return

**Example:**
```bash
curl "http://localhost:3000/api/tiktok/trending?country=US&limit=10"
```

**Response:**
```json
{
  "type": "trending",
  "country": "US",
  "timestamp": "2026-05-04T12:00:00.000Z",
  "data": [
    {
      "id": "trend_0",
      "title": "Trending Topic 1",
      "description": "Description for trending topic 1",
      "url": "https://www.tiktok.com/trending/topic/0",
      "views": 872345,
      "likes": 456789,
      "comments": 12345,
      "shares": 67890,
      "hashtags": ["#trend0", "#topic0"],
      "platform": "tiktok",
      "country": "US",
      "timestamp": "2026-05-04T12:00:00.000Z"
    }
  ],
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.05,
    "settled": true
  }
}
```

### 2. Get TikTok Hashtag Data
```
GET /api/tiktok/hashtag
```

**Parameters:**
- `tag` (required) - Hashtag to search for (without #)
- `country` (optional, default: "US") - ISO country code
- `limit` (optional, default: 20, max: 50) - Number of top videos to return

**Example:**
```bash
curl "http://localhost:3000/api/tiktok/hashtag?tag=ai&country=US&limit=5"
```

**Response:**
```json
{
  "type": "hashtag",
  "country": "US",
  "timestamp": "2026-05-04T12:00:00.000Z",
  "data": {
    "tag": "ai",
    "name": "#ai",
    "videos": 1234567,
    "views": 9876543210,
    "followers": 543210,
    "topVideos": [
      {
        "id": "video_ai_0",
        "title": "Video 1 with #ai",
        "url": "https://www.tiktok.com/@creator0/video/0",
        "views": 123456,
        "likes": 65432,
        "comments": 1234,
        "shares": 5432,
        "creator": "@creator0",
        "timestamp": "2026-05-04T11:00:00.000Z"
      }
    ],
    "trending": true,
    "country": "US",
    "timestamp": "2026-05-04T12:00:00.000Z"
  },
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.05,
    "settled": true
  }
}
```

### 3. Get TikTok Creator Data
```
GET /api/tiktok/creator
```

**Parameters:**
- `username` (required) - Creator username (with or without @)
- `country` (optional, default: "US") - ISO country code
- `limit` (optional, default: 20, max: 50) - Number of top videos to return

**Example:**
```bash
curl "http://localhost:3000/api/tiktok/creator?username=@charlidamelio&country=US&limit=5"
```

**Response:**
```json
{
  "type": "creator",
  "country": "US",
  "timestamp": "2026-05-04T12:00:00.000Z",
  "data": {
    "username": "@charlidamelio",
    "name": "Charli D'Amelio",
    "bio": "Official TikTok account for Charli D'Amelio. 150M+ followers. Dancing queen. 💖",
    "followers": 156789012,
    "following": 1234,
    "likes": 3456789012,
    "videos": 1234,
    "verified": true,
    "topVideos": [
      {
        "id": "video_charlidamelio_0",
        "title": "Video 1 by @charlidamelio",
        "url": "https://www.tiktok.com/@charlidamelio/video/0",
        "views": 5678901,
        "likes": 2345678,
        "comments": 45678,
        "shares": 12345,
        "timestamp": "2026-05-04T11:00:00.000Z"
      }
    ],
    "country": "US",
    "timestamp": "2026-05-04T12:00:00.000Z"
  },
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.05,
    "settled": true
  }
}
```

### 4. Get TikTok Sound Data
```
GET /api/tiktok/sound
```

**Parameters:**
- `id` (required) - Sound ID
- `country` (optional, default: "US") - ISO country code
- `limit` (optional, default: 20, max: 50) - Not used for sound data

**Example:**
```bash
curl "http://localhost:3000/api/tiktok/sound?id=12345&country=US"
```

**Response:**
```json
{
  "type": "sound",
  "country": "US",
  "timestamp": "2026-05-04T12:00:00.000Z",
  "data": {
    "id": "12345",
    "title": "Sound 12345",
    "author": "Artist Name",
    "duration": 30,
    "plays": 123456789,
    "videos": 54321,
    "trending": true,
    "country": "US",
    "timestamp": "2026-05-04T12:00:00.000Z"
  },
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "type": "mobile"
    }
  },
  "payment": {
    "txHash": "5x402...",
    "network": "solana",
    "amount": 0.05,
    "settled": true
  }
}
```

## Authentication

All endpoints use the x402 payment protocol:

1. Make a request to the endpoint
2. Receive a 402 response with payment details
3. Send USDC to the specified wallet address
4. Include the transaction hash in the `Payment-Signature` header
5. Retry the original request

## Rate Limiting

- Default rate limit: 30 requests per minute per IP
- Rate limit window: 60 seconds
- Response includes `Retry-After` header when limit is exceeded

## Error Handling

Common error responses:
- `400 Bad Request` - Missing required parameters
- `402 Payment Required` - Payment not provided or verification failed
- `429 Too Many Requests` - Rate limit exceeded
- `502 Bad Gateway` - Service temporarily unavailable

## Implementation Notes

1. **Mobile Carrier IPs**: The API uses real mobile carrier IPs (T-Mobile, Vodafone, Orange) through Proxies.sx infrastructure to bypass TikTok's anti-bot measures.

2. **User-Agent**: Requests are made with a mobile user agent to mimic real device behavior.

3. **Country Support**: All endpoints support country-specific data by using the country parameter.

4. **Error Handling**: The scraper includes robust error handling to deal with TikTok's dynamic blocking mechanisms.

5. **Performance**: The API is designed to be lightweight, returning only essential data to minimize bandwidth usage.

## Pricing

- **$0.05 USDC per request** for all TikTok endpoints
- Payment is verified on-chain (Solana or Base network)
- No subscription required - pay per request

## Example Usage in Python

```python
import requests
import os

# Set your wallet address
WALLET_ADDRESS = os.getenv('WALLET_ADDRESS', 'your-wallet-address')

def get_tiktok_trending(country='US', limit=10):
    # First request to get payment details
    response = requests.get(f'http://localhost:3000/api/tiktok/trending?country={country}&limit={limit}')

    if response.status_code == 402:
        # Make payment and retry with transaction hash
        payment_details = response.json()
        tx_hash = make_payment(payment_details['payment']['wallet'], payment_details['payment']['amount'])

        headers = {'Payment-Signature': tx_hash}
        response = requests.get(f'http://localhost:3000/api/tiktok/trending?country={country}&limit={limit}', headers=headers)

    return response.json()

def make_payment(wallet_address, amount):
    # Implement your payment logic here
    # Return transaction hash
    return "5x402..." + str(int(time.time()))

# Example usage
trending_data = get_tiktok_trending(country='US', limit=5)
print(trending_data)
```

## Support

For issues or questions about the TikTok Trend Intelligence API, please open an issue in the [marketplace-service-template](https://github.com/bolivian-peru/marketplace-service-template) repository.

