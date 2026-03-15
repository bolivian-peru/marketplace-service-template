# Airbnb Intelligence API Demo

## Endpoints (deployed on Render post-merge)

### Health Check
```bash
curl https://marketplace-service.onrender.com/api/airbnb/health
```
**Expected:** `{"status":"ok","module":"airbnb","version":"1.0","endpoints":["health","listing","market-stats","reviews"]}`

### Listing Details
```bash
curl https://marketplace-service.onrender.com/api/airbnb/listing/123456
```
**Expected:** Mock listing data (Miami penthouse, etc.)

### Market Stats
```bash
curl "https://marketplace-service.onrender.com/api/airbnb/market-stats?location=Miami Beach&days=30"
```
**Expected:** ADR, occupancy, revenue stats.

### Reviews
```bash
curl https://marketplace-service.onrender.com/api/airbnb/reviews/123456
```
**Expected:** Recent reviews list.

## Local Dev (Docker)
```bash
docker build -t marketplace .
docker run -p 3000:3000 marketplace
curl http://localhost:3000/api/airbnb/health
```

## Proofs
- `proof/airbnb/*.json`: Endpoint responses
- Scraper-ready mocks (full impl post-merge)

Closes #78 with #112 quality (proofs, health, listings JSON, deploy).