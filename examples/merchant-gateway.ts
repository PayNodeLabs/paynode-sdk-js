import express from 'express';
import { PayNodeMerchant } from '../src';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * 🚀 PayNode Merchant Gateway Example (v2.3.0)
 * 
 * This example uses the high-level PayNodeMerchant class and its unified middleware.
 * It handles:
 * 1. Automatic Handshake (402 Payment Required)
 * 2. Market Proxy Authentication (Shared Secret)
 * 3. Body Unwrapping (Safe payload extraction)
 */

const app = express();
app.use(express.json()); // Essential for body parsing

const merchant = new PayNodeMerchant({
  sharedSecret: process.env.MARKET_SHARED_SECRET || "DEV_SECRET_123",
  marketUrl: "https://mk.paynode.dev" // Use testnet for sandbox
});

// Configure the merchant middleware
const gatewayMiddleware = merchant.middleware({
  manifest: {
    slug: "demo-tool",
    price_per_call: "0.05",
    currency: "USDC",
    network: "testnet" // Base Sepolia is testnet
  },
  strict: true // Enforce Market Proxy (Ensures payment verification)
});

// Register a protected endpoint
app.post('/api/tools/weather', gatewayMiddleware, (req: any, res) => {
  // req.body is automatically unwrapped from the market structure
  const { city } = req.body;

  // Payment context is available in req.paynode
  console.log(`[Merchant] Processing request for ${city}. Payment: ${req.paynode.txHash}`);

  res.json({
    result: `The weather in ${city} is 22°C and sunny.`,
    _paynode: {
      orderId: req.paynode.orderId,
      status: "confirmed"
    }
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`\n✅ PayNode Merchant Gateway is live!`);
  console.log(`📍 Endpoint: http://localhost:${port}/api/tools/weather`);
  console.log(`🔑 Shared Secret: ${process.env.MARKET_SHARED_SECRET ? '******' : 'DEV_SECRET_123'}\n`);
});
