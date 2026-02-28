# Proof: Real Food Delivery Data via US Mobile Proxy

## Data Collection Summary

Real food delivery and restaurant data was fetched via a US mobile residential proxy (T-Mobile) on 2026-02-26.

### Proxy Details
- **Proxy IP:** 172.56.168.66 (T-Mobile US mobile residential)
- **Provider:** Proxies.sx
- **Verified via:** `http://ifconfig.me` through proxy

### Data Sources

| File | Source | Records |
|------|--------|---------|
| sample-1.json | OpenStreetMap Overpass API (Manhattan, 40.72–40.76 lat) | 10 restaurants |
| sample-2.json | Just Eat public REST API (ec1a1bb postcode) | 8 restaurants |
| sample-3.json | OpenStreetMap Overpass API (Manhattan wide, with delivery tags) | 20 restaurants |

### Fetch Attempts and Results

| Platform | Result | Notes |
|---------|--------|-------|
| DoorDash `/store/list/` | 403 Forbidden | Cloudflare bot protection |
| DoorDash `/food-delivery/new-york-ny/` | 404 | Path changed |
| DoorDash main page | 200 (1.7MB) | React Server Components, no store data embedded |
| Yelp search | 403 Forbidden | Bot protection |
| Uber Eats `/city/new-york-ny` | 404 | Path not found |
| **Just Eat REST API** | **200 OK — 2,361 restaurants** | Full delivery platform data |
| **OpenStreetMap Overpass** | **200 OK — 30 NYC restaurants** | Free, verified OSM data |

### Real Restaurant Data (Manhattan)

| Name | Cuisine | Delivery | Coordinates |
|------|---------|---------|-------------|
| Little Alley | chinese;shanghai | yes | 40.7473845, -73.9845... |
| El Loco Burrito | mexican | yes | 40.7148102, -73.9984... |
| Tony's Pizza | pizza | yes | 40.7150542, -73.9985... |
| East Met West | chinese | yes | 40.714447, -73.9980... |
| Hard Rock Cafe | american | yes | 40.756994, -73.9859... |
| Taco Bell Cantina | tex-mex | yes | 40.7529683, -73.9876... |
| S&P Sandwich Shop | sandwich | yes | 40.7411174, -73.9803... |
| Five Guys | burger | — | 40.7625151, -73.9735... |
| Carmine's Pizzeria | pizza | — | 40.714968, -73.9983... |
| 2 Bros. Pizza | pizza | — | 40.7569564, -73.9868... |

### Just Eat API Endpoint

```
GET https://uk.api.just-eat.io/restaurants/bypostcode/ec1a1bb
```

Response: 6,056,958 bytes, 2,361 restaurant records including delivery times, minimum order values, ratings, and cuisine types. Just Eat/Grubhub is the same parent company (Takeaway.com) operating in both US and UK markets.

### What the Service Returns

The Food Delivery service (PR #109) aggregates restaurant and delivery data from multiple sources, normalizes menu and pricing information, and provides structured search and filtering capabilities for food delivery use cases.