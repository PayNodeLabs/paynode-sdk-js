import express from 'express';
import { x402_gate } from '../src/middleware/x402'; // Correct path to middleware
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from same directory or parent
dotenv.config();

const app = express();
const port = process.env.MERCHANT_PORT || 3000;

/**
 * PayNode Merchant Configuration (Base Sepolia)
 * 
 * To run this demo:
 * 1. Install dependencies: npm install express paynode-sdk-js dotenv
 * 2. Setup your .env file
 * 3. Run: npx ts-node examples/express-server.ts
 */

const PAYNODE_CONFIG = {
    rpcUrls: [process.env.PAYNODE_RPC_URL || "https://sepolia.base.org"], // Base Sepolia RPC
    chainId: parseInt(process.env.CHAIN_ID || "84532"),                       // Base Sepolia Chain ID
    contractAddress: process.env.PAYNODE_CONTRACT_ADDRESS || "0xB587Bc36aaCf65962eCd6Ba59e2DA76f2f575408", // PayNode Router on Sepolia
    merchantAddress: process.env.MERCHANT_ADDRESS || "0xYourMerchantWalletAddress", 
    tokenAddress: process.env.MERCHANT_TOKEN_ADDRESS || "0xYourDeployedTokenAddress",    // Replace with your own test token
    currency: process.env.CURRENCY || "USDC",
    price: process.env.PRICE || "0.01",                       // 0.01 USDC
    decimals: parseInt(process.env.TOKEN_DECIMALS || "6"),
};

// Apply PayNode Middleware to protect specific routes
// This will automatically intercept requests WITHOUT a valid receipt
// and return a 402 Payment Required response with the necessary metadata.
const paynodeMiddleware = x402_gate(PAYNODE_CONFIG);

app.get('/api/premium-data', paynodeMiddleware, (req: any, res) => {
    /**
     * If this handler is reached, it means the middleware has already:
     * 1. Verified the transaction hash (receipt) exists in headers.
     * 2. Verified the transaction is successful on-chain.
     * 3. Verified the payment was sent to the correct merchant and amount.
     * 4. Verified the token is in the protocol whitelist.
     */
    const { receiptHash, orderId } = req.paynode;
    
    console.log(`[PayNode] ✅ Payment Verified for Order: ${orderId}`);
    console.log(`[PayNode] 📄 TxHash: ${receiptHash}`);

    res.json({
        status: "success",
        data: {
            message: "This is premium content only accessible after x402 payment.",
            secret_code: "BASE_BUILD_101",
            timestamp: new Date().toISOString()
        },
        payment_info: {
            receipt: receiptHash,
            order_id: orderId
        }
    });
});

app.listen(port, () => {
    console.log(`🚀 PayNode Merchant Demo running at http://localhost:${port}`);
    console.log(`🔒 Protected Route: http://localhost:${port}/api/premium-data`);
    console.log(`📝 Merchant Address: ${PAYNODE_CONFIG.merchantAddress}`);
});
