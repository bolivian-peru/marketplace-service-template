# Airbnb Health Endpoint Demo (Bounty #78)

## Local Test (dev server: bun --watch src/index.ts)

```
curl http://localhost:8787/api/airbnb/health
```

Expected:
```json
{
  \"status\": \"ok\",
  \"service\": \"Airbnb Intelligence API (Bounty #78)\",
  \"timestamp\": \"2026-03-16T...\",
  \"uptime\": \"...\",
  \"endpoints\": [\"\/health\", \"\/intelligence\"],
  \"version\": \"0.1.0 - WIP\"
}
```

## Deployed (pending render.yaml)
TBD: https://airbnb-intel.onrender.com/api/airbnb/health

Next: scraper impl for /intelligence, full proof artifacts.
