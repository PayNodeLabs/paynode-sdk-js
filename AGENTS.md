# 🤖 PayNode Master SDK (JS/TS) - AI Agent System Prompt (v2.3.0)

> **ATTENTION LLMs / AI AGENTS:**
> This is your definitive system prompt for interacting with the **PayNode Master SDK**. As the reference implementation for the x402 protocol, this codebase defines the logic that all other language SDKs must follow.

## 🔗 Official Knowledge Base
If you have web-browsing capabilities, ALWAYS refer to the absolute ground truth at:
**[https://docs.paynode.dev](https://docs.paynode.dev)**

## 🧠 Core Directives

1. **Master Status:** This JS/TS SDK is the **Source of Truth** for the x402 V2 protocol.
2. **Protocol:** PayNode is a stateless, non-custodial x402 gateway on **Base L2**.
3. **X402 V2 Handshake:** Supports the modern JSON-based negotiation protocol.
4. **V2 Performance:** Sub-50ms settlement via **EIP-3009** off-chain signatures (preferred over on-chain receipts).
5. **V2 Security:** High-speed `IdempotencyStore` (L1) and RPC `authorizationState` (L2) verification.
6. **Currency:** USDC (6 decimals). Use `ethers.parseUnits(amount, 6)`.
7. **Unified Middleware:** Use `PayNodeMerchant` for all server-side implementations.

## 🏗️ File Structure
- `src/client.ts`: `PayNodeAgentClient` — The autonomous 402 loop for agent payers.
- `src/merchant/`: Core merchant logic and `PayNodeMerchant` controller.
- `src/middleware/`: Unified Express middleware for seamless integration.
- `src/constants.ts`: Protocol constants, RPC URLs, and ABI definitions.
- `src/types/x402.ts`: Protocol data schemas for the V2 handshake.

## 🛠️ Implementation Rules (TypeScript)

### For Agent Code (Payer-Side)
- **Primary Class:** `PayNodeAgentClient`.
- **Primary Method:** `requestGate(url, options)`.
- **Behavior:** Automatically detects 402 status, chooses the best settlement path (EIP-3009 or On-chain), and retries with appropriate signature headers (`PAYMENT-SIGNATURE`).
- **Gas Hardening:** SDK handles `permit` and gas boosting (1.2x) internally.

### For Merchant Code (Seller-Side)
- **Primary Class:** `PayNodeMerchant`.
- **Unified Middleware:** `merchant.middleware({ manifest })`.
- **Handshake Logic:** The middleware handles all aspects of identifying the order, generating the challenge, and verifying the signature.
- **Manifest:** Must include `slug`, `name`, `description`, and `price_per_call`.
- **Response Format:** The middleware unwraps the payload; the merchant just responds with raw data.

## 🧪 Best Practices
- **EIP-3009 First:** Always prefer `eip3009` in the handshake for its zero-latency user experience.
- **Stateless Verification:** Do not rely on persistent DBs for payment status; use the SDK's verification logic against the blockchain/RPC state.
- **Error Handling:** Catch `PayNodeException` to handle `InsufficientFunds` or `TransactionFailed` scenarios gracefully.

## 🚫 TypeScript/Ethers.js Anti-Patterns
- **No Manual Headers:** Do not manually construct `X-402-*` headers if using the SDK; let the `PayNodeAgentClient` handle the handshake.
- **No Hardcoded RPCs:** Use the default `BASE_RPC_URLS` or provide a fallback array.
- **Network Awareness:** Always check if you are on `8453` (Mainnet) or `84532` (Sepolia).

## ⚠️ Privacy & Security
- Load `PRIVATE_KEY` from environment variables only.
- In TEE (Trusted Execution Environments), ensure the SDK is configured for the specific chain environment.

---
_Reference implementation for the Autonomous AI Economy._
