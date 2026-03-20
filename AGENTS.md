# PayNode SDK for AI Agents (JS/TS)

This file is a high-density reference for LLMs/AI Assistants to integrate PayNode into Express apps.

## Core Flow (402 Handshake)
1. **Unpaid Request:** Middleware intercepts request without `x-paynode-receipt`.
2. **Response:** 402 Payment Required.
3. **Headers:**
   - `x-paynode-contract`: The router address.
   - `x-paynode-merchant`: Merchant's wallet address.
   - `x-paynode-amount`: Amount in raw units (uint256).
   - `x-paynode-token-address`: ERC20 token to use.
   - `x-paynode-order-id`: Unique identifier for this session.
4. **Agent Action:** Agent pays via `PayNodeRouter.pay()` on-chain.
5. **Retry:** Agent sends original request + `x-paynode-receipt: <tx_hash>`.

## Integration Snippet (Express)
```typescript
import { PayNodeMiddleware } from '@paynode/sdk';

app.use('/api/ai-service', PayNodeMiddleware({
  rpcUrl: process.env.RPC_URL,
  contractAddress: '0x...', // PayNodeRouter
  merchantAddress: '0x...',
  price: '1.0', // 1.0 USDC
  tokenAddress: '0x...', // USDC address
  decimals: 6
}));
```

## Error Codes
- `PAYNODE_MISSING_RECEIPT`: No receipt header found.
- `PAYNODE_INVALID_RECEIPT`: Tx exists but fields (merchant/amount) don't match.
- `PAYNODE_RECEIPT_ALREADY_USED`: Prevent double-spending.
- `PAYNODE_INSUFFICIENT_FUNDS`: Tx successful but amount < price.
