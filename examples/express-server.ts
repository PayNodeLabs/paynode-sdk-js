import express from 'express';
import {
    x402Gate,
    PAYNODE_ROUTER_ADDRESS_SANDBOX,
    BASE_USDC_ADDRESS_SANDBOX
} from '../src'; // Assuming exports are at root src
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

/**
 * 🚀 PayNode Express Server Example (Base Sepolia)
 * 
 * Minimal configuration using defaults for Base Mainnet:
 * x402Gate({ merchantAddress: '0x...', price: '1.00' })
 */

const paynodeMiddleware = x402Gate({
    merchantAddress: process.env.MERCHANT_ADDRESS || "0xYourMerchantWalletAddress",
    price: "0.10",
    // Overriding defaults for Sandbox (Sepolia)
    chainId: 84532,
    contractAddress: PAYNODE_ROUTER_ADDRESS_SANDBOX,
    tokenAddress: BASE_USDC_ADDRESS_SANDBOX,
});

app.get('/api/premium-data', paynodeMiddleware, (req: any, res) => {
    const { unifiedPayload, orderId } = req.paynode;

    res.json({
        status: "success",
        message: "This is premium content only accessible after payment.",
        payment_info: {
            receipt: unifiedPayload.payload?.txHash || unifiedPayload.payload?.signature,
            orderId: orderId,
            payment_type: unifiedPayload.type
        }
    });
});

app.listen(port, () => {
    console.log(`🚀 PayNode Merchant Demo running at http://localhost:${port}`);
    console.log(`🔒 Protected Route: http://localhost:${port}/api/premium-data`);
    console.log(`📝 Merchant Address: ${process.env.MERCHANT_ADDRESS}`);
});
