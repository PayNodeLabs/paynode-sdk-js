import dotenv from 'dotenv';
import { PayNodeAgentClient } from '../src/client';

dotenv.config();

/**
 * 🚀 PAYNODE MAINNET LIVE TEST (JS)
 * --------------------------------
 * This script performs a real-world payment on Base Mainnet.
 * Target: https://www.paynode.dev/api/pom?network=mainnet
 */
async function runMainnetLiveTest() {
  const privateKey = process.env.PAYNODE_PRIVATE_KEY;
  const rpcUrl = process.env.BASE_MAINNET_RPC || "https://mainnet.base.org";
  const targetUrl = "https://www.paynode.dev/api/pom?network=mainnet";

  if (!privateKey) {
    console.error("❌ Error: PAYNODE_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  console.log("🛠️ Initializing PayNode Mainnet Client...");
  const client = new PayNodeAgentClient(privateKey, rpcUrl);

  try {
    console.log(`📡 Sending request to protected API: ${targetUrl}`);
    
    // requestGate automatically handles 402 -> Pay -> Retry
    const response = await client.requestGate(targetUrl, {
      method: 'POST',
      json: { agent_name: "JS-Mainnet-Explorer-Agent" }
    });

    const result = await response.json();

    if (response.status === 200) {
      console.log("✅ SUCCESS! Access Granted to Mainnet Resource.");
      console.log(`📜 Merchant Message: ${result.message}`);
      console.log(`🔗 Transaction Hash: ${result.txHash}`);
      console.log(`🌍 View on Explorer: https://www.paynode.dev/pom`);
    } else {
      console.error(`❌ Failed with status ${response.status}:`, result);
    }
  } catch (error: any) {
    console.error("❌ Execution Error:", error.message);
  }
}

runMainnetLiveTest();
