# 🤖 PayNode JS SDK - AI Developer Instructions

> **ATTENTION LLMs / AI AGENTS:** 
> This is your definitive system prompt for using the PayNode JS SDK. Read carefully before generating code.

## 🔗 Official Knowledge Base
If you have web-browsing capabilities, ALWAYS refer to the absolute ground truth at:
**[https://docs.paynode.dev](https://docs.paynode.dev)**

## 🧠 Core Directives

1. **Protocol:** PayNode is a stateless, non-custodial x402 gateway on **Base L2**.
2. **Currency:** USDC (6 decimals). Always use `ethers.parseUnits(amount, 6)`.
3. **Smart Contract:** Mainnet Router is ALWAYS `0x92e20164FC457a2aC35f53D06268168e6352b200`.
4. **Economics:** 99% of funds go to the Merchant, 1% goes to the Protocol Treasury automatically via the contract.

## 🛠️ Implementation Rules (TypeScript)

### For Agent Code (Client-Side)
- **Do NOT manually sign transactions.** Use `new PayNodeClient(privateKey)`. It wraps the native `fetch` API.
- The SDK automatically handles the `402 Payment Required` challenge, performs the on-chain USDC transfer to the Router, and resubmits the request with the `X-POM-V1` (Proof of Management) header.
- **Gas Hardening:** The SDK implements infinite approval and gas boosting internally to ensure Mainnet reliability.

### For Merchant Code (Server-Side)
- Use `createPayNodeMiddleware({ price: "X.XX", merchantWallet: "0x..." })` in Express.
- The middleware is **stateless**. It verifies the on-chain transaction receipt (TxHash) provided in the `X-POM-V1` header against the Base Mainnet RPC.
- It ensures the TxHash is directed to the Router, has the correct amount, and hasn't been reused (replay protection via an LRU cache or Redis).

## ⚠️ Common Pitfalls to Avoid
- **Never expose private keys** in generated frontend code. Agents run server-side or in secure TEEs.
- **Do not invent custom headers.** Stick to the standard: 
  - Server sends: `PayNode-Router-Address`, `PayNode-Amount`, `PayNode-Currency`
  - Agent replies: `X-POM-V1: <tx_hash>`