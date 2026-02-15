# RustChain Protocol Documentation

## Introduction

RustChain is a decentralized blockchain platform built with Rust, featuring high performance, security, and scalability.

## Architecture

### Core Components

```
┌─────────────────────────────────────────┐
│           RustChain Network              │
├─────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐       │
│  │   Nodes     │  │  Miners     │       │
│  └─────────────┘  └─────────────┘       │
│         │               │               │
│         └───────┬───────┘               │
│                 │                       │
│         ┌──────┴──────┐                │
│         │  Consensus  │                │
│         │  Mechanism  │                │
│         └─────────────┘                │
│                 │                       │
│         ┌──────┴──────┐                │
│         │   Ledger    │                │
│         └─────────────┘                │
└─────────────────────────────────────────┘
```

### Key Features

- **High Performance**: Built in Rust for maximum efficiency
- **Security**: Formal verification and cryptographic guarantees
- **Scalability**: Horizontal scaling capabilities
- **Interoperability**: Cross-chain support

## Getting Started

### Node Setup

```bash
# Install RustChain
cargo install rustchain

# Initialize node
rustchain init --network mainnet

# Start node
rustchain start
```

### Wallet Operations

```python
from rustchain import Wallet

# Create wallet
wallet = Wallet.create()

# Get balance
balance = wallet.get_balance()

# Send transaction
tx = wallet.send(to="0x...", amount=1.0)
```

## API Reference

### Node API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Node health check |
| `/epoch` | GET | Current epoch info |
| `/miners` | GET | Active miners list |
| `/balance/<addr>` | GET | Wallet balance |

### Wallet API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/wallet/create` | POST | Create new wallet |
| `/api/v1/wallet/balance` | GET | Query balance |
| `/api/v1/transaction/send` | POST | Send transaction |

## Consensus

RustChain uses a Proof-of-Work consensus mechanism optimized for energy efficiency.

## Security

- All transactions are cryptographically signed
- Multi-signature wallet support
- Hardware wallet integration
- Encrypted private key storage

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

MIT
