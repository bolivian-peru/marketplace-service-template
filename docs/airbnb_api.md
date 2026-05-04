

# Airbnb & Short-Term Rental Intelligence API

The Airbnb & Short-Term Rental Intelligence API provides access to Airbnb property listings, pricing, availability calendars, reviews, and host data for any market. Calculate average daily rates, occupancy estimates, and revenue potential by neighborhood.

## Overview

This API is designed to provide the same data as AirDNA (which charges $99-999/month) at micropayment prices. It uses mobile proxies to bypass Airbnb's bot detection and JavaScript rendering to extract data from Airbnb's mobile app endpoints.

## Authentication

All endpoints use the x402 payment protocol. When you make a request without payment, you'll receive a 402 response with payment instructions. After sending the required USDC payment, you can make the request again with the payment signature.

## Endpoints

### 1. Search Listings

**Endpoint:** `GET /api/airbnb/search`

**Description:** Search for Airbnb listings in a specific location with filters for dates, guests, and price range.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| location | string | Yes | Location to search (e.g., "Miami Beach") |
| checkin | string | Yes | Check-in date (YYYY-MM-DD) |
| checkout | string | Yes | Check-out date (YYYY-MM-DD) |
| guests | number | No | Number of guests (default: 2) |
| price_min | number | No | Minimum price per night |
| price_max | number | No | Maximum price per night |
| limit | number | No | Maximum results to return (default: 20, max: 100) |

**Example Request:**

```bash
curl "http://localhost:3000/api/airbnb/search?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2&limit=10"
```

**Example Response:**

```json
{
  "location": "Miami Beach, FL",
  "results": [
    {
      "id": "12345678",
      "title": "Oceanfront Studio in South Beach",
      "type": "Entire apartment",
      "price_per_night": 189,
      "total_price": 1323,
      "currency": "USD",
      "rating": 4.9,
      "reviews_count": 234,
      "superhost": true,
      "bedrooms": 1,
      "bathrooms": 1,
      "max_guests": 4,
      "amenities": ["Pool", "Beach access", "WiFi"],
      "images": ["https://a0.muscache.com/im/pictures/..."],
      "url": "https://airbnb.com/rooms/12345678",
      "lat": 25.7907,
      "lng": -80.1301
    }
  ],
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5x402...",
      "network": "solana",
      "amount": 0.02,
      "settled": true
    }
  }
}
```

### 2. Listing Details

**Endpoint:** `GET /api/airbnb/listing/:id`

**Description:** Get detailed information for a specific Airbnb listing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Airbnb listing ID (in URL path) |

**Example Request:**

```bash
curl "http://localhost:3000/api/airbnb/listing/12345678"
```

**Example Response:**

```json
{
  "listing": {
    "id": "12345678",
    "title": "Oceanfront Studio in South Beach",
    "type": "Entire apartment",
    "price_per_night": 189,
    "total_price": null,
    "currency": "USD",
    "rating": 4.9,
    "reviews_count": 234,
    "superhost": true,
    "bedrooms": 1,
    "bathrooms": 1,
    "max_guests": 4,
    "amenities": ["Pool", "Beach access", "WiFi", "Kitchen", "Air conditioning"],
    "images": [
      "https://a0.muscache.com/im/pictures/...",
      "https://a0.muscache.com/im/pictures/...",
      "https://a0.muscache.com/im/pictures/..."
    ],
    "url": "https://airbnb.com/rooms/12345678",
    "lat": 25.7907,
    "lng": -80.1301,
    "description": "Beautiful oceanfront studio in the heart of South Beach...",
    "neighborhood": "South Beach",
    "host_name": "John Smith",
    "host_superhost": true,
    "host_response_rate": "98%",
    "host_response_time": "Within an hour",
    "house_rules": [
      "No smoking",
      "No pets",
      "Check-in after 3PM",
      "Check-out by 11AM"
    ],
    "check_in_time": "3:00 PM",
    "check_out_time": "11:00 AM",
    "cancellation_policy": "Free cancellation until 48 hours before check-in"
  },
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5x402...",
      "network": "solana",
      "amount": 0.01,
      "settled": true
    }
  }
}
```

### 3. Market Statistics

**Endpoint:** `GET /api/airbnb/market-stats`

**Description:** Get market statistics for a specific location, including average daily rates, occupancy estimates, and revenue potential.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| location | string | Yes | Location to analyze |
| checkin | string | Yes | Check-in date (YYYY-MM-DD) |
| checkout | string | Yes | Check-out date (YYYY-MM-DD) |
| guests | number | No | Number of guests (default: 2) |

**Example Request:**

```bash
curl "http://localhost:3000/api/airbnb/market-stats?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2"
```

**Example Response:**

```json
{
  "location": "Miami Beach, FL",
  "avg_daily_rate": 215.50,
  "median_daily_rate": 189.00,
  "total_listings": 3400,
  "avg_rating": 4.6,
  "superhost_pct": 12.5,
  "price_distribution": {
    "under_100": 850,
    "range_100_200": 1200,
    "range_200_300": 750,
    "range_300_500": 450,
    "over_500": 150
  },
  "property_types": {
    "Entire apartment": 1800,
    "Private room": 1200,
    "Entire house": 300,
    "Shared room": 100
  },
  "occupancy_estimate": 72.0,
  "revenue_potential": 785.40,
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5x402...",
      "network": "solana",
      "amount": 0.05,
      "settled": true
    }
  }
}
```

### 4. Listing Reviews

**Endpoint:** `GET /api/airbnb/reviews/:listing_id`

**Description:** Get reviews for a specific Airbnb listing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| listing_id | string | Yes | Airbnb listing ID (in URL path) |
| limit | number | No | Maximum reviews to return (default: 10, max: 50) |

**Example Request:**

```bash
curl "http://localhost:3000/api/airbnb/reviews/12345678?limit=10"
```

**Example Response:**

```json
{
  "reviews": [
    {
      "author": "Sarah J.",
      "rating": 5.0,
      "date": "March 2024",
      "text": "Amazing location and very clean! The host was responsive and the place was exactly as described.",
      "response": "Thank you for your review! We're glad you enjoyed your stay."
    },
    {
      "author": "Michael T.",
      "rating": 4.0,
      "date": "February 2024",
      "text": "Great place but a bit noisy at night. Would stay again though.",
      "response": null
    }
  ],
  "meta": {
    "proxy": {
      "country": "US",
      "type": "mobile"
    },
    "payment": {
      "txHash": "5x402...",
      "network": "solana",
      "amount": 0.01,
      "settled": true
    }
  }
}
```

## Pricing

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| Search | $0.02 | Per search query |
| Listing Details | $0.01 | Per listing detail |
| Market Stats | $0.05 | Per market stats report |
| Reviews | $0.01 | Per reviews fetch |

## Technical Details

### Mobile Proxy Support

The API uses mobile proxies to bypass Airbnb's bot detection. This is crucial because:

1. Airbnb uses heavy JavaScript rendering
2. Airbnb has aggressive IP blocking and CAPTCHAs
3. Mobile carrier IPs face far less scrutiny than datacenter or residential proxies

### JavaScript Rendering

Airbnb's website relies heavily on JavaScript to load content. The API uses Selenium with mobile emulation to render JavaScript and extract data from the page.

### Data Extraction

The API extracts comprehensive data from Airbnb listings:

- Basic listing information (title, type, price, rating, etc.)
- Detailed listing information (description, amenities, house rules, etc.)
- Host information (name, superhost status, response rate/time)
- Review data (author, rating, date, text, responses)
- Market statistics (average rates, occupancy estimates, etc.)

### Error Handling

The API includes robust error handling:

- Retry logic for failed requests
- Rate limiting to protect proxy quotas
- Clear error messages with hints for troubleshooting
- Proper HTTP status codes

## Integration with x402 Payment

The API is fully integrated with the x402 payment protocol:

1. When you make a request without payment, you receive a 402 response with payment instructions
2. The response includes the wallet address, network, and price
3. After sending the required USDC payment, you include the transaction hash in subsequent requests
4. The API verifies the payment on-chain before processing your request
5. Successful responses include payment metadata

## Deployment

To deploy the Airbnb API:

1. Set up your environment variables in `.env`:
   ```
   WALLET_ADDRESS=your_solana_wallet_address
   PROXY_API_KEY=your_proxy_api_key
   PROXY_COUNTRY=US  # or other supported country
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the server:
   ```bash
   bun run dev
   ```

4. Test the API:
   ```bash
   curl http://localhost:3000/api/airbnb/search?location=Miami+Beach&checkin=2026-03-01&checkout=2026-03-07&guests=2
   ```

## Limitations

1. **Rate Limiting**: The API has a rate limit of 20 requests per minute per IP to protect proxy quotas.
2. **Data Availability**: Some listings may not be available for certain dates or may have been removed.
3. **Accuracy**: Market statistics and occupancy estimates are based on available data and may not be 100% accurate.
4. **Proxy Reliability**: Mobile proxies may occasionally be blocked or have connectivity issues.

## Support

For issues or questions about the Airbnb API, please open an issue in the GitHub repository.

