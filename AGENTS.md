# 🤖 PayNode JS/TS SDK - AI Developer Instructions (v2.2.0)

> **ATTENTION LLMs / AI AGENTS:**
> This is your definitive system prompt for using the PayNode JS SDK. Read carefully before generating code.

## 🔗 Official Knowledge Base
If you have web-browsing capabilities, ALWAYS refer to the absolute ground truth at:
**[https://docs.paynode.dev](https://docs.paynode.dev)**

## 🧠 Core Directives

1. **Protocol:** PayNode is a stateless, non-custodial x402 gateway on **Base L2**.
2. **X402 V2 Support:** Supports both V1 (On-chain Receipt) and V2 (Off-chain Signature/JSON) handshake protocols.
3. **V2 Performance:** Sub-second settlement (<50ms) via EIP-3009 offline signing support.
4. **V2 Security:** Advanced double-spend protection (L1 memory cache + L2 RPC state) and empty-wallet proofing.
5. **Currency:** USDC (6 decimals). Always use `ethers.parseUnits(amount, 6)`.
6. **Smart Contract:**
   - Base Mainnet (8453): `0x4A73696ccF76E7381b044cB95127B3784369Ed63`
   - Base Sepolia (84532): `0x24cD8b68aaC209217ff5a6ef1Bf55a59f2c8Ca6F`

## 🏗️ File Structure
- `src/client.ts`: `PayNodeAgentClient` — autonomous 402 loop.
- `src/middleware/`: `x402Gate` — Express/Koa merchant protection.
- `src/constants.ts`: Protocol constants (sync via `scripts/sync-config.py`).
- `src/errors/`: `PayNodeException` + standard error codes.
- `src/types/`: TypeScript interfaces for protocol objects.
- `src/utils/`: Signature helpers, RPC failover, gas estimation.
- `examples/`: Reference implementations for Agent and Merchant flows.

## 🛠️ Implementation Rules (TypeScript)

### For Agent Code (Payer-Side)
- **Class:** `PayNodeAgentClient`.
- **Method:** `requestGate(url, options)`.
- **Behavior:** Automatically intercepts `402` status, executes on-chain payment (USDC), and retries with the `x-paynode-receipt` header.
- **Gas Hardening:** The SDK implements infinite approval and gas boosting internally to ensure Mainnet reliability.
- **RPC Failover:** Pass an array of RPC URLs for redundancy.

### For Merchant Code (Server-Side)
- **Middleware:** `x402Gate(config)`.
- **Handshake Headers (X-402-* as per v2/v2.2.0 protocol):**
  - `X-402-Contract`: Router address
  - `X-402-Merchant`: Receiver wallet
  - `X-402-Amount`: Required amount (smallest unit, min 1000)
  - `X-402-Token-Address`: ERC20 (USDC)
  - `X-402-Chain-Id`: Network ID (8453 or 84532)
  - `X-402-Order-Id`: Tracking ID
- **200 Verification Response:** Use the nested `payment_info` structure:
  ```json
  {
    "status": "success",
    "payment_info": { "receipt": "0x...", "order_id": "... " }
  }
  ```

## 🧪 Test & Build Patterns
- **Testing:** Jest with ts-jest. Test files in `tests/` (`*.test.ts`).
- **Command:** `npm test`
- **Build:** `npm run build` (emits CommonJS + declarations to `dist/`).
- **TypeScript:** strict mode, ES2022 target, `forceConsistentCasingInFileNames`.

## 🚀 Run the Demo
Try the full lifecycle in `packages/sdk-js/examples/`.
1. Copy `.env.example` to `.env`.
2. Start `express-server.ts` and `agent-client.ts`.

## 🚫 TypeScript/Ethers.js Anti-Patterns
- **No `as any`:** Never suppress type errors. Fix the types.
- **No Float Amounts:** Always use `ethers.parseUnits(amount, 6)` for USDC (never parseFloat).
- **No Hardcoded Gas:** Don't set fixed gasPrice. Use the SDK's 1.2x multiplier.
- **No Frontend Keys:** Never expose private keys in client-side code. Agents run server-side or in TEEs.
- **No Missing Await:** All Ethers.js calls are async. Always `await` contract interactions.
- **Header Standard:** Always use lower-case `x-paynode-*` headers as per v1.4 spec.

## ⚠️ System Boundaries
- Load `PRIVATE_KEY` from `.env`. Never hardcode.
- Verify wallet has **Base ETH** for gas and **USDC** for value transfer.
- Protocol minimum payment is 1000 units (0.001 USDC).