import { PayNodeAgentClient } from '../src';

/**
 * PayNode SDK Compatibility Matrix Test
 * Verifies both V1 (On-chain) and V2 (Signature-based) flows using the official JS SDK.
 */
async function runTests() {
  const DEMO_KEY = process.env.CLIENT_PRIVATE_KEY;
  if (!DEMO_KEY) {
      console.error("❌ CLIENT_PRIVATE_KEY environment variable is required.");
      process.exit(1);
  }
  const RPC_URL = "https://sepolia.base.org"; // Ensure this matches the network in handshakes

  const client = new PayNodeAgentClient(DEMO_KEY, RPC_URL);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚀 STARTING SDK COMPATIBILITY MATRIX TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // TEST 1: Original V1 Interface (/api/pom)
  try {
    console.log("🧪 [TEST 1] Calling V1 Interface: /api/pom");
    console.log("   Handshake -> On-chain Pay -> Retry...");

    // requestGate handles the 402 loop automatically
    const res1 = await client.requestGate("http://localhost:3000/api/pom?network=testnet", {
      method: "POST",
      json: { agent_name: "SDK_Compatibility_V1" }
    });

    const body1 = await res1.json();
    console.log("   ✅ V1 Result:", JSON.stringify(body1, null, 2));
  } catch (error) {
    console.error("   ❌ V1 Test Failed:", error);
  }

  console.log("\n------------------------------------------------\n");

  // TEST 2: New X402 V2 Interface (/api/test/x402)
  try {
    console.log("🧪 [TEST 2] Calling X402 V2 Interface: /api/test/x402");
    console.log("   Handshake -> EIP-3009 Sign -> Retry...");

    const res2 = await client.requestGate("http://localhost:3000/api/test/x402?network=testnet", {
      method: "POST",
      json: { agent_name: "SDK_Compatibility_V2" }
    });

    const body2 = await res2.json();
    console.log("   ✅ V2 Result:", JSON.stringify(body2, null, 2));
  } catch (error) {
    console.error("   ❌ V2 Test Failed:", error);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🏁 COMPATIBILITY MATRIX TEST COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

runTests().catch(console.error);
