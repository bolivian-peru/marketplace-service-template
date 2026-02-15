# RustChain Wallet Distribution Dashboard

Real-time wallet balance monitoring dashboard for RustChain.

## Features

- **Live Balance Tracking**: Monitor multiple wallet addresses
- **Auto-Refresh**: Configurable refresh interval (default 30s)
- **Web Dashboard**: Beautiful HTML interface
- **Statistics**: Total balance, average, wallet count

## Quick Start

```bash
python dashboard.py
```

Access: http://localhost:8080

## API Endpoints

```
GET /                   - Dashboard UI
GET /api/wallets       - JSON wallet data
GET /api/stats         - Dashboard statistics
```

## Configuration

```python
from dashboard import WalletDashboard

dashboard = WalletDashboard(rpc_url="https://50.28.86.131")
dashboard.add_wallet("address", "Label")
```

## Bounty

This is part of Bounty #159 - 40 RTC
