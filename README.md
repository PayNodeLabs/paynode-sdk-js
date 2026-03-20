# PayNode JavaScript SDK

[![Official Documentation](https://img.shields.io/badge/Docs-docs.paynode.dev-00ff88?style=for-the-badge&logo=readthedocs)](https://docs.paynode.dev)
[![NPM Version](https://img.shields.io/npm/v/@paynodelabs/sdk-js.svg?style=for-the-badge)](https://www.npmjs.com/package/@paynodelabs/sdk-js)

The official TypeScript/JavaScript SDK for the **PayNode Protocol**. PayNode is a stateless, non-custodial M2M payment gateway that standardizes the HTTP 402 "Payment Required" flow for AI Agents, settling instantly in USDC on Base L2.

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
import { PayNodeClient } from '@paynodelabs/sdk-js';

const client = new PayNodeClient('YOUR_AGENT_PRIVATE_KEY');

async function main() {
    // Automatically handles 402 challenges, pays USDC, and retries the request
    const response = await client.request('https://api.merchant.com/premium-data');
    console.log(await response.text());
}
main();
```

### Merchant Middleware (Receiver)

```typescript
import express from 'express';
import { createPayNodeMiddleware } from '@paynodelabs/sdk-js';

const app = express();

const requirePayment = createPayNodeMiddleware({
    price: "1.50", // 1.50 USDC
    merchantWallet: "0xYourWalletAddress..."
});

app.get('/premium-data', requirePayment, (req, res) => {
    res.json({ secret: "This is paid M2M data." });
});
```

---
*Built for the Autonomous AI Economy by PayNodeLabs.*