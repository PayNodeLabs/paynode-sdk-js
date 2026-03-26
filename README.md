# PayNode JavaScript SDK

[![Official Documentation](https://img.shields.io/badge/Docs-docs.paynode.dev-00ff88?style=for-the-badge&logo=readthedocs)](https://docs.paynode.dev)
[![NPM Version](https://img.shields.io/npm/v/@paynodelabs/sdk-js.svg?style=for-the-badge)](https://www.npmjs.com/package/@paynodelabs/sdk-js)

The official TypeScript/JavaScript SDK for the **PayNode Protocol (v3.1)**. PayNode is a stateless, non-custodial M2M payment gateway that standardizes the HTTP 402 "Payment Required" flow for AI Agents, with support for both on-chain receipts and off-chain signatures (EIP-3009).

## 📖 Read the Docs

**For complete installation guides, advanced usage, API references, and architecture details, please visit our official documentation:**
👉 **[docs.paynode.dev](https://docs.paynode.dev)**

## ⚡ Quick Start

### Installation

```bash
npm install @paynodelabs/sdk-js ethers
```

### Agent Client (Payer)

```typescript
import { PayNodeAgentClient } from "@paynodelabs/sdk-js";

const client = new PayNodeAgentClient("YOUR_AGENT_PRIVATE_KEY", ["https://mainnet.base.org", "https://rpc.ankr.com/base"]);

async function main() {
  // Automatically handles 402 challenges, pays USDC, and retries the request
  const response = await client.requestGate("https://api.merchant.com/premium-data");
  console.log(await response.text());
}
main();
```

### Key Features (v2.1)
- **Zero-Wait Checkout**: API response speed drops from 5 seconds to **under 50ms** by using local signatures instead of waiting for on-chain inclusion.
- **Double-Spend Protection**: 
  - **L1 (Memory)**: High-speed local replay protection via `IdempotencyStore`.
  - **L2 (RPC)**: Real-time on-chain `authorizationState` verification.
- **Empty-Wallet Proof**: Integrated `balanceOf` probes to block malicious agents using empty wallets to generate valid signatures.
- **EIP-3009 Support**: Sign payments off-chain using `TransferWithAuthorization`.
- **X402 V2 Protocol**: JSON-based handshake for structured agent interaction.
- **Dual Flow**: Automatic switch between V1 (on-chain receipts) and V2 (off-chain signatures).

## 🗺️ Roadmap
- **TRON Support**: USDT (TRC-20) payment integration.
- **Solana Support**: SPL USDC/USDT payment integration.
- **Cross-chain**: Universal settlement via bridges.

## 🚀 Run the Demo

The SDK includes a full merchant/agent demonstration in the `examples/` directory.

### 1. Setup Environment

```bash
cp .env.example .env
# Edit .env with your PRIVATE_KEY and RPC_URL
```

### 2. Get Test Tokens (Required for Base Sepolia)

If you're testing on Sepolia, run the helper script to mint 1,000 mock USDC:

```bash
npx ts-node examples/mint-test-tokens.ts
```

### 3. Run the Merchant Server (Express)

```bash
npx ts-node examples/express-server.ts
```

### 4. Run the Agent Client

In another terminal:

```bash
npx ts-node examples/agent-client.ts
```

The demo will perform a full loop: `402 Handshake -> On-chain Payment -> 200 Verification`.

---

## 📦 Publishing to NPM

To publish a new version of the SDK:

1. **Build the project**:
   ```bash
   npm run build
   ```
2. **Login to NPM** (if not already):
   ```bash
   npm login
   ```
3. **Publish**:
   ```bash
   npm publish --access public
   ```

---

_Built for the Autonomous AI Economy by PayNodeLabs._
