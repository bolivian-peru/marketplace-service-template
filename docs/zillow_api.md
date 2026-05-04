

# Zillow Real Estate Listing Intelligence API

The Zillow Real Estate Listing Intelligence API provides access to property listings, price history, Zestimate values, comparable sales, neighborhood data, and market trends from Zillow.

## Overview

This API extracts real estate data from Zillow, which is the most popular real estate platform in the US. The API is designed to work with mobile proxies to bypass Zillow's aggressive blocking of datacenter proxies.

## Base URL

```
https://api.proxies.sx/v1/x402/zillow
```

## Authentication

All requests require x402 payment authentication. You'll receive a 402 response with payment instructions, then include the payment signature in subsequent requests.

## Endpoints

### 1. Search Properties

**Endpoint:** `GET /api/realestate/search`

**Parameters:**

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| address | string | Full address to search for | No |
| zip | string | ZIP code to search in | No |
| city | string | City to search in | No |
| type | enum | Filter by listing type: `for_sale`, `for_rent`, or `sold` | No |
| min_price | number | Minimum price filter | No |
| max_price | number | Maximum price filter | No |
| bedrooms | number | Minimum number of bedrooms | No |
| bathrooms | number | Minimum number of bathrooms | No |
| property_type | string | Property type filter (e.g., "Single Family", "Condo") | No |
| radius | string | Search radius in miles (e.g., "0.5mi") | No |

**Example Request:**

```bash
curl "https://api.proxies.sx/v1/x402/zillow/api/realestate/search?address=123+Main+St+New+York&type=for_sale&min_price=500000"
```

**Example Response:**

```json
{
  "results": [
    {
      "zpid": "2080998336",
      "address": "123 Main St, New York, NY 10001",
      "price": 1250000,
      "link": "https://www.zillow.com/homedetails/123-Main-St-New-York-NY-10001/2080998336_zpid/"
    },
    {
      "zpid": "123456789",
      "address": "456 Oak Ave, New York, NY 10002",
      "price": 950000,
      "link": "https://www.zillow.com/homedetails/456-Oak-Ave-New-York-NY-10002/123456789_zpid/"
    }
  ]
}
```

### 2. Get Property Details

**Endpoint:** `GET /api/realestate/property/:zpid`

**Parameters:**

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| zpid | string | Zillow Property ID | Yes |

**Example Request:**

```bash
curl "https://api.proxies.sx/v1/x402/zillow/api/realestate/property/2080998336"
```

**Example Response:**

```json
{
  "zpid": "2080998336",
  "address": "123 Main St, New York, NY 10001",
  "price": 1250000,
  "zestimate": 1180000,
  "price_history": [
    { "date": "2026-01-15", "event": "Listed", "price": 1250000 },
    { "date": "2024-06-20", "event": "Sold", "price": 980000 }
  ],
  "details": {
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1800,
    "lot_sqft": 2500,
    "year_built": 2005,
    "type": "Single Family",
    "status": "For Sale"
  },
  "neighborhood": {
    "walk_score": 92,
    "transit_score": 88,
    "median_home_value": 1100000,
    "median_rent": 3200
  },
  "photos": [
    "https://photos.zillow.com/123_main_st_1.jpg",
    "https://photos.zillow.com/123_main_st_2.jpg"
  ],
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T"
    }
  }
}
```

### 3. Get Market Data

**Endpoint:** `GET /api/realestate/market`

**Parameters:**

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| zip | string | ZIP code to get market data for | Yes |

**Example Request:**

```bash
curl "https://api.proxies.sx/v1/x402/zillow/api/realestate/market?zip=10001"
```

**Example Response:**

```json
{
  "zip": "10001",
  "median_home_value": 1100000,
  "median_rent": 3200,
  "inventory": 50,
  "last_updated": "2026-05-04T17:28:00.000Z",
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T"
    }
  }
}
```

### 4. Get Comparable Sales

**Endpoint:** `GET /api/realestate/comps/:zpid`

**Parameters:**

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| zpid | string | Zillow Property ID | Yes |
| radius | string | Search radius in miles (e.g., "0.5mi") | No |

**Example Request:**

```bash
curl "https://api.proxies.sx/v1/x402/zillow/api/realestate/comps/2080998336?radius=0.5mi"
```

**Example Response:**

```json
{
  "zpid": "2080998336",
  "radius": "0.5mi",
  "comparable_sales": [
    {
      "address": "456 Oak Ave, New York, NY 10002",
      "price": 950000,
      "sqft": 1600,
      "bedrooms": 3,
      "bathrooms": 2,
      "link": "https://www.zillow.com/homedetails/456-Oak-Ave-New-York-NY-10002/123456789_zpid/"
    },
    {
      "address": "789 Pine St, New York, NY 10003",
      "price": 1100000,
      "sqft": 1900,
      "bedrooms": 3,
      "bathrooms": 2.5,
      "link": "https://www.zillow.com/homedetails/789-Pine-St-New-York-NY-10003/987654321_zpid/"
    }
  ],
  "count": 2,
  "meta": {
    "proxy": {
      "ip": "123.45.67.89",
      "country": "US",
      "carrier": "AT&T"
    }
  }
}
```

## Pricing

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| `/api/realestate/search` | $0.01 | Per search query (up to 20 results) |
| `/api/realestate/property/:zpid` | $0.02 | Per property lookup |
| `/api/realestate/market` | $0.05 | Per market report (ZIP code stats) |
| `/api/realestate/comps/:zpid` | $0.03 | Per comparable sales lookup |

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request**
```json
{
  "error": "Invalid request parameters"
}
```

**402 Payment Required**
```json
{
  "price": 0.02,
  "wallet": "YourSolanaWalletAddress",
  "networks": ["solana", "base"]
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to process request"
}
```

## Rate Limiting

The API is rate limited to 60 requests per minute per IP address.

## Proxy Requirements

This API requires mobile proxies to work with Zillow. The service automatically routes all requests through Proxies.sx mobile proxies with US carrier IPs.

## Implementation Notes

1. **Mobile User-Agent**: All requests use a mobile user-agent to mimic real mobile devices.
2. **JavaScript Rendering**: Zillow heavily relies on JavaScript for dynamic content loading. In a production environment, you would need to use a headless browser like Puppeteer or Playwright to fully render the page.
3. **Data Extraction**: The current implementation uses regex for data extraction, which is simplified. In a production environment, you would use a proper HTML parser like Cheerio.
4. **Error Handling**: The API includes basic error handling, but a production implementation would need more robust error handling and retry logic.
5. **Caching**: For better performance, consider implementing caching for frequently accessed properties.

## Example Usage with x402 Payment Flow

```javascript
// Step 1: Make initial request
const response = await fetch('https://api.proxies.sx/v1/x402/zillow/api/realestate/search?address=123+Main+St+New+York');

// Step 2: Get 402 response with payment instructions
if (response.status === 402) {
  const paymentData = await response.json();
  console.log(`Please pay ${paymentData.price} USDC to ${paymentData.wallet} on ${paymentData.networks.join(' or ')}`);

  // Step 3: Send payment and get transaction hash
  const txHash = await sendPayment(paymentData.price, paymentData.wallet, paymentData.networks[0]);

  // Step 4: Retry request with payment signature
  const finalResponse = await fetch('https://api.proxies.sx/v1/x402/zillow/api/realestate/search?address=123+Main+St+New+York', {
    headers: {
      'Payment-Signature': txHash
    }
  });

  const data = await finalResponse.json();
  console.log(data);
}
```

## Live Deployment

To deploy this API:

1. Set up a server with Bun
2. Install dependencies: `bun install`
3. Configure environment variables in `.env`:
   ```
   WALLET_ADDRESS=your_solana_wallet_address
   PROXY_API_KEY=your_proxy_api_key
   ```
4. Start the server: `bun run dev`

## Support

For issues or questions, please open an issue in the [GitHub repository](https://github.com/bolivian-peru/marketplace-service-template/issues).

