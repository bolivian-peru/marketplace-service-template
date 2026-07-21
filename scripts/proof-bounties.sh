#!/bin/bash
# Proof: 10 consecutive 402 responses per endpoint
LIVE_URL="https://marketplace-service-template-b91e.onrender.com"

echo "=== Proxies.sx Bounty Proof ==="
echo "Testing 10 consecutive calls per endpoint"

test_endpoint() {
  local name=$1 path=$2
  local success=0
  for i in $(seq 1 10); do
    code=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" "${LIVE_URL}${path}" 2>/dev/null)
    [ "$code" = "402" ] && success=$((success + 1))
  done
  if [ $success -eq 10 ]; then
    echo "  ✅ $name: 10/10"
  else
    echo "  ❌ $name: $success/10"
  fi
}

test_endpoint "price-monitor    " "/api/price/check?url=https://www.amazon.com/dp/B0CBP7YSHF"
test_endpoint "travel-flights   " "/api/travel/flights?origin=NYC&destination=LAX&date=2026-08-01"
test_endpoint "travel-hotels    " "/api/travel/hotels?destination=Paris&checkIn=2026-08-01&checkOut=2026-08-03"
test_endpoint "adspy-search     " "/api/adspy/search?keyword=laptops&country=US"
test_endpoint "adspy-competitor " "/api/adspy/competitor?domain=nike.com&country=US"
test_endpoint "review-monitor   " "/api/reviews/monitor?place=ChIJP3bEZGTGGTARAJ37J0G0n5s&platform=google"
test_endpoint "review-latest    " "/api/reviews/latest?place=ChIJP3bEZGTGGTARAJ37J0G0n5s&limit=5"

echo "=== Done ==="
