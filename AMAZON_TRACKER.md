# Amazon BSR Tracker Integration

This service allows the marketplace to track Amazon's Best Sellers Rank (BSR) for any given ASIN.

## Usage
```typescript
import { AmazonBSRTracker } from './services/AmazonBSRTracker';

const result = await AmazonBSRTracker.getBSR("B00X4WHP5E", "SECURE_AMAZON_URL");
console.log(result);
```

## Security
- **SSRF Protection**: Only official Amazon domains are allowed.
- **Protocol**: HTTPS strictly enforced.
