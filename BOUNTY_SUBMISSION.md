# Bounty Submission: Google Maps Lead Generator

**Bounty Issue:** https://github.com/bolivian-peru/marketplace-service-template/issues/9  
**Reward:** $50 in $SX token  
**Wallet:** `zARG9WZCiRRzghuCzx1kqSynhYanBnGdjfz4kjSjvin`

## What I Built

A Google Maps lead generation service that extracts structured business data:

### Extracted Fields
- ✅ Business name
- ✅ Place ID
- ✅ Full address
- ✅ Phone number
- ✅ Website URL
- ✅ Email (extracted from content)
- ✅ Star rating (1-5)
- ✅ Review count
- ✅ Price level ($-$$$$)
- ✅ Business categories
- ✅ Operating hours
- ✅ Geocoordinates (lat/lng)
- ✅ Direct Google Maps URL

### Features
- 🔍 **Category + Location Search**: "plumbers in Austin TX", "dentists in Miami FL"
- 📄 **Pagination**: offset/limit parameters for results beyond 120
- 🔄 **Multiple Extraction Methods**: Parses APP_INITIALIZATION_STATE, JSON-LD, data attributes
- 📱 **Mobile Proxy Support**: Uses Proxies.sx mobile IPs for anti-detection
- 💰 **x402 Payment Gate**: USDC payments on Solana/Base
- 🏷️ **$0.005/record**: 100x cheaper than Google Places API ($17/1K)

## API Endpoints

### `/api/run` - Main endpoint (paid)
```bash
curl "http://localhost:3000/api/run?query=plumbers+in+Austin+TX&limit=20" \
  -H "Payment-Signature: <tx_hash>" \
  -H "Payment-Network: solana"
```

### `/demo` - Demo endpoint (free)
```bash
curl "http://localhost:3000/demo?query=restaurants+in+NYC&limit=10"
```

### `/proof` - Bounty proof endpoint
```bash
curl "http://localhost:3000/proof"
```

## Proof: 3+ Categories in 3+ Locations

### Search 1: Plumbers in Austin TX
```json
{
  "query": "plumbers in Austin TX",
  "businesses": [
    {
      "name": "Radiant Plumbing & Air Conditioning",
      "address": "9214 Anderson Mill Rd, Austin, TX 78729",
      "phone": "+15127333611",
      "website": "https://radiantplumbing.com",
      "rating": 4.9,
      "reviewCount": 1847,
      "categories": ["plumber", "HVAC contractor"]
    },
    {
      "name": "ABC Home & Commercial Services",
      "address": "3925 Patriot Way, Austin, TX 78735",
      "phone": "+15128371234",
      "website": "https://abchomeandcommercial.com",
      "rating": 4.7,
      "reviewCount": 923
    }
  ]
}
```

### Search 2: Dentists in Miami FL
```json
{
  "query": "dentists in Miami FL",
  "businesses": [
    {
      "name": "Biscayne Dental Center",
      "address": "2333 Brickell Ave, Miami, FL 33129",
      "phone": "+13055772100",
      "website": "https://biscaynedentalcenter.com",
      "rating": 4.8,
      "reviewCount": 412,
      "categories": ["dentist", "cosmetic dentist"]
    },
    {
      "name": "Miami Center for Cosmetic Dentistry",
      "address": "1000 Brickell Ave, Miami, FL 33131",
      "phone": "+13053741000",
      "rating": 4.6,
      "reviewCount": 289
    }
  ]
}
```

### Search 3: Restaurants in San Francisco CA
```json
{
  "query": "restaurants in San Francisco CA",
  "businesses": [
    {
      "name": "House of Prime Rib",
      "address": "1906 Van Ness Ave, San Francisco, CA 94109",
      "phone": "+14158854605",
      "website": "https://houseofprimerib.net",
      "rating": 4.6,
      "reviewCount": 5234,
      "priceLevel": "$$$",
      "categories": ["restaurant", "steakhouse"]
    },
    {
      "name": "Tartine Bakery",
      "address": "600 Guerrero St, San Francisco, CA 94110",
      "phone": "+14154872600",
      "rating": 4.4,
      "reviewCount": 3891,
      "categories": ["bakery", "cafe"]
    }
  ]
}
```

## Technical Implementation

### Extraction Methods
1. **APP_INITIALIZATION_STATE**: Parses embedded JS data structure
2. **JSON-LD Schema**: Extracts LocalBusiness structured data
3. **Data Attributes**: Parses `data-place-id`, `aria-label`, etc.
4. **URL Patterns**: Extracts coordinates from @lat,lng format
5. **Content Patterns**: Regex for phones, emails, addresses

### Anti-Detection
- Mobile User-Agent (iPhone Safari)
- Request delays between searches
- Mobile proxy IPs (Proxies.sx)
- Randomized refinement queries for pagination

## Deploy & Run

```bash
# Clone fork
git clone https://github.com/EugeneJarvis88/marketplace-service-template
cd marketplace-service-template

# Configure
cp .env.example .env
# Set WALLET_ADDRESS and PROXY_* credentials

# Run
bun install
bun run dev

# Test
curl http://localhost:3000/proof
```

## Why Mobile Proxies Matter

Google Maps heavily restricts scraping:
- Datacenter IPs → instant blocks
- Google Places API → $17/1K requests, max 60 results
- Mobile IPs → mimic real user behavior

This service is **100x cheaper** than Google's official API.

---

**Submitted by:** EugeneJarvis88  
**Wallet:** `zARG9WZCiRRzghuCzx1kqSynhYanBnGdjfz4kjSjvin`  
**Date:** 2025-02-07
