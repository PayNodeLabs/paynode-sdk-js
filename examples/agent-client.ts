import { PayNodeAgentClient } from '../src/client';
import { BASE_RPC_URLS_SANDBOX } from '../src/constants';
import * as dotenv from 'dotenv';

// Load .env
dotenv.config();

/**
 * PayNode JS Agent Demo (Base Sepolia)
 * 
 * To run this demo:
 * 1. Install dependencies: npm install paynode-sdk-js dotenv
 * 2. Setup your .env file
 * 3. Run: npx ts-node examples/agent-client.ts
 */

async function runJsAgent() {
    const TESTNET_RPC = BASE_RPC_URLS_SANDBOX[0];
    const PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY || "0xYourPrivateKeyHere"; // Replace with your testnet PK
    const TARGET_URL = process.env.TARGET_MERCHANT_URL || "http://localhost:3000/api/premium-data";

    console.log("🚀 Initializing PayNode JS Agent...");

    const agent = new PayNodeAgentClient(PRIVATE_KEY, TESTNET_RPC);

    try {
        console.log(`📡 Requesting: ${TARGET_URL}`);
        
        // This single call handles:
        // 1. Initial request
        // 2. 402 detection
        // 3. Autonomous on-chain payment (using Permit-First)
        // 4. Retry with receipt
        const response = await agent.requestGate(TARGET_URL);

        if (response.ok) {
            const data = await response.json();
            console.log("🎉 SUCCESS! Received protected data:");
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.error(`❌ Request failed with status: ${response.status}`);
            const errorText = await response.text();
            console.error(errorText);
        }
    } catch (error) {
        console.error("💥 Agent Error:", error);
    }
}

runJsAgent();
