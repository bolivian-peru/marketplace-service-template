# Proof: Real Airbnb Data via US Mobile Proxy

## Data Collection Summary

Real Airbnb listing data was fetched via a US mobile residential proxy (T-Mobile) on 2026-02-26.

### Proxy Details
- **Proxy IP:** 172.56.168.66 (T-Mobile US mobile residential)
- **Provider:** Proxies.sx
- **Verified via:** `http://ifconfig.me` through proxy

### Data Sources

| File | Source | Records |
|------|--------|---------|
| sample-1.json | Airbnb v2 explore_tabs API | 6 listings (full detail) |
| sample-2.json | Airbnb v2 explore_tabs API (superhost filter) | 6 superhost listings |
| sample-3.json | Airbnb search page HTML (StaySearchResult) | 10 listing summaries |

### API Endpoint Used

```
GET https://www.airbnb.com/api/v2/explore_tabs
  ?version=1.8.3
  &satori_version=1.1.0
  &items_per_grid=18
  &locale=en
  &currency=USD
  &_format=for_explore_search_web
  &refinement_paths[]=homes
  &place_id=ChIJOwg_06VPwokRYv534QaPC8g
  &query=New+York
  &checkin=2026-03-10
  &checkout=2026-03-15
  &adults=2
```

Response: `346,283` bytes, 18 listings with full detail.

### Sample Listings Found

| Listing ID | Name | City | Rating | Price (5 nights) | Host |
|-----------|------|------|--------|-----------------|------|
| 41295524 | Hotel like place - private patio and bathroom | Brooklyn | 5.0 (317 reviews) | $851 | Caio Julio (Superhost) |
| 5298896 | Unique NYC Loft - Guest Room | New York | 5.0 (375 reviews) | — | Luke (Superhost) |
| 1070270537377163305 | One King room at Brooklyn - Newly Renovated! | Brooklyn | 5.0 (568 reviews) | — | Hilton Brooklyn |
| 22946469 | Room w/ private bath in Soho | New York | 5.0 (315 reviews) | $903 | Elaine (Superhost) |

### HTML Search Page Extraction

The search page (`/s/New-York--NY/homes`) was also fetched (695,906 bytes). The page contains 44 `StaySearchResult` entries in the JavaScript bundle, yielding 29 unique listing IDs with rating and price data.

### What the Service Returns

The Airbnb Intelligence service (PR #98) indexes listing data from the explore API, enriches it with pricing and host information, and surfaces it through a normalized REST API for consumption by downstream agents and services.