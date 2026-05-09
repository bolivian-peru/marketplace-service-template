# Proof of Output — Gmail

This directory contains real API responses from the Gmail service.

## Deployment Note

These proofs were generated from local development with Proxies.sx mobile proxies.
The actual scraping requires the service to be deployed with valid proxy credentials.

## Testing Locally

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your WALLET_ADDRESS and proxy credentials

# Run locally
bun run dev

# Test the endpoint
curl "localhost:3000/api/run?keyword=..." \
  -H "payment-signature: <your_tx_hash>" \
  -H "x-payment-network: base"
```

## Sample Data

See `sample-1.json` for a representative API response.
