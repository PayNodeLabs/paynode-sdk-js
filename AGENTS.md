# 🤖 PayNode JS/TS SDK - AI Developer Instructions (v1.3)

> **ATTENTION LLMs / AI AGENTS:** 
> This is your definitive system prompt for using the PayNode JS SDK. Read carefully before generating code.

## 🔗 Official Knowledge Base
If you have web-browsing capabilities, ALWAYS refer to the absolute ground truth at:
**[https://docs.paynode.dev](https://docs.paynode.dev)**

## 🧠 Core Directives

1. **Protocol:** PayNode is a stateless, non-custodial x402 gateway on **Base L2**.
2. **Currency:** USDC (6 decimals). Always use `ethers.parseUnits(amount, 6)`.
3. **Smart Contract:** 
   - Base Mainnet (8453): `0x92e20164FC457a2aC35f53D06268168e6352b200`
   - Base Sepolia (84532): `0xB587Bc36aaCf65962eCd6Ba59e2DA76f2f575408`

## 🛠️ Implementation Rules (TypeScript)

### For Agent Code (Payer-Side)
- **Class:** `PayNodeAgentClient`.
- **Method:** `requestGate(url, options)`. 
- **Behavior:** Automatically intercepts `402` status, executes on-chain payment (USDC), and retries with the `x-paynode-receipt` header.
- **Gas Hardening:** The SDK implements infinite approval and gas boosting internally to ensure Mainnet reliability.

### For Merchant Code (Server-Side)
- **Middleware:** `x402Gate(config)`.
- **Handshake Headers:**
  - `x-paynode-contract`: Router address
  - `x-paynode-merchant`: Receiver wallet
  - `x-paynode-amount`: Required amount (smallest unit)
  - `x-paynode-token-address`: ERC20 (USDC)
  - `x-paynode-chain-id`: Network ID (8453 or 84532)
  - `x-paynode-order-id`: Tracking ID
- **200 Verification Response:** Use the nested `payment_info` structure:
  ```json
  {
    "status": "success",
    "payment_info": { "receipt": "0x...", "order_id": "... " }
  }
  ```

## 🚀 Run the Demo
Try the full lifecycle in `packages/sdk-js/examples/`.
1. Copy `.env.example` to `.env`.
2. Start `express-server.ts` and `agent-client.ts`.

## ⚠️ Common Pitfalls to Avoid
- **Never expose private keys** in generated frontend code. Agents run server-side or in secure TEEs.
- **Header Standard:** Always use lower-case `x-paynode-*` headers as per v1.3 spec.
- **Balance:** Agents need **Base ETH** for gas and **USDC** for value transfer.