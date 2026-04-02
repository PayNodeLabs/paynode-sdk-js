# PayNode Master SDK (JS/TS)

> [!NOTE]
> Compatibility policy & legacy header aliases are documented in [COMPATIBILITY.md](./COMPATIBILITY.md).

[![Official Documentation](https://img.shields.io/badge/Docs-docs.paynode.dev-00ff88?style=for-the-badge&logo=readthedocs)](https://docs.paynode.dev)
[![NPM Version](https://img.shields.io/npm/v/@paynodelabs/sdk-js.svg?style=for-the-badge)](https://www.npmjs.com/package/@paynodelabs/sdk-js)
[![License](https://img.shields.io/github/license/paynodeprotocol/paynode?style=for-the-badge)](LICENSE)

The **Master SDK** for the [PayNode Protocol](https://paynode.dev). This JavaScript/TypeScript implementation serves as the **Reference Implementation** for the x402 V2 protocol. All future SDKs (Python, Go, Rust, etc.) are built following the architectural patterns and logic established in this codebase.

The current baseline and cleanup requirements for turning `sdk-js` into the formal multi-language source of truth are documented in [`meta/MULTI_LANGUAGE_BASELINE.md`](../../meta/MULTI_LANGUAGE_BASELINE.md). The protocol source of truth lives in [`meta/SPEC.md`](../../meta/SPEC.md).

PayNode is a stateless, non-custodial M2M payment gateway that standardizes the HTTP 402 "Payment Required" flow for AI Agents, enabling seamless USDC settlement on Base L2.

---

## 🏗️ Reference Implementation Status

As the **Master SDK**, `sdk-js` defines the gold standard for:
- **x402 V2 Handshake**: The JSON-based negotiation protocol between Agents and Merchants.
- **Dual-Mode Settlement**: Seamless switching between high-speed off-chain signatures (EIP-3009) and robust on-chain receipts.
- **Proof-of-Intent**: Standardized cryptographic signatures for M2M commerce.
- **Stateless Verification**: Logic for verifying payments without requiring complex backend databases.

> [!TIP]
> Developers building PayNode SDKs for other languages should treat this repository as the **Source of Truth** for internal logic and protocol compliance.

---

## ⚡ Quick Start

### Installation

```bash
npm install @paynodelabs/sdk-js ethers
```

### Agent Client (Payer)
The `PayNodeAgentClient` automatically identifies 402 challenges and executes the best settlement path (On-chain or EIP-3009).

```typescript
import { PayNodeAgentClient } from "@paynodelabs/sdk-js";

// Initialize with Private Key and Base RPC
const client = new PayNodeAgentClient("YOUR_PRIVATE_KEY", ["https://mainnet.base.org"]);

async function main() {
  // Automatically handles 402 challenges, settles USDC, and retries the request
  const response = await client.requestGate("https://api.merchant.com/premium-data");
  const result = await response.json();
  console.log("Success:", result);
}
main();
```

### Merchant Gateway (Seller)
Starting from **v2.3.0**, the SDK provides a unified middleware for **PayNode Market Proxy** requests. It handles discovery probes, signature verification, and body unwrap in a single line.

```typescript
import { PayNodeMerchant } from "@paynodelabs/sdk-js";
import express from "express";

const app = express();
const merchant = new PayNodeMerchant({
  sharedSecret: "YOUR_MARKET_SECRET" // Obtainable from PayNode Market Hub
});

// Unified Middleware (Manifest + Auth + Discovery)
app.post("/api/v1/tools", merchant.middleware({
    manifest: {
      slug: "gpt-researcher",
      name: "GPT Researcher",
      description: "Research endpoint",
      price_per_call: "0.05",
      currency: "USDC"
    },
    price: "0.05"  // Also set price directly — manifest.price_per_call is for Market Hub sync only
  }), (req, res) => {
    // req.body is automatically unwrapped for valid Market Proxy requests
    res.json({ result: "Data for " + req.body.query });
  }
);
```

---

## 🚀 Key Features

- **Zero-Wait Checkout**: Off-chain EIP-3009 signatures allow **<50ms** checkout times by bypassing block confirmation delays.
- **Autonomous Recovery**: Built-in RPC failover and retry logic for high-availability agent environments.
- **Double-Spend Protection**: Memory-efficient `IdempotencyStore` for high-frequency replay protection.
- **EIP-2612 & EIP-3009**: Native support for gasless approvals and off-chain transfers.
- **Market Proxy Middleware**: Drop-in Express support for PayNode Market discovery, authentication, and payload unwrap.

---

## 🧭 Roadmap & Ecosystem

As the lead SDK, this package drives the protocol forward. Current initiatives:
- 🐍 **Python SDK**: Porting `sdk-js` logic to Python for LangChain/AutoGPT integration.
- 🦀 **Rust SDK**: High-performance implementation for edge compute.
- 📡 **Cross-chain Settlement**: Integration with Solana (USDC) and TRON (USDT).

---

## 🛠️ Development & Testing

### Run the Demo
1. **Setup Env**: `cp .env.example .env` and set `CLIENT_PRIVATE_KEY`. If you want to run the merchant demo too, also set `MERCHANT_ADDRESS`.
2. **Mint Test USDC**: `npx ts-node examples/mint-test-tokens.ts` (Base Sepolia).
3. **Start Merchant**: `npm run example:server`
4. **Run Agent**: `npx ts-node examples/agent-client.ts`

---

## 📖 Versioning

| Component | Current Version |
| :--- | :--- |
| **Protocol (x402)** | `v2` |
| **SDK Implementation** | `v2.4.0` |

> [!IMPORTANT]
> Protocol and SDK package versioning are not the same thing. Treat the protocol as `x402 v2`, and treat `2.4.0` as the current JS SDK implementation version.

---

_Built for the Autonomous AI Economy by PayNodeLabs._
