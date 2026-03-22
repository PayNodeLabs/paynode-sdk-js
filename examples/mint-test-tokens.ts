import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from the examples directory or root
dotenv.config();

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY;
const MOCK_USDC_ADDR = "0xeAC1f2C7099CdaFfB91Aa3b8Ffd653Ef16935798";

if (!PRIVATE_KEY) {
  console.error("❌ Error: CLIENT_PRIVATE_KEY not found in .env");
  process.exit(1);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);
  
  console.log(`💰 Connecting to ${RPC_URL}...`);
  console.log(`🔗 Minting for address: ${wallet.address}`);

  // Minimal Mintable ERC20 ABI
  const abi = ["function mint(address to, uint256 amount) external"];
  const usdc = new ethers.Contract(MOCK_USDC_ADDR, abi, wallet);

  // Mint 1,000 USDC (6 decimals)
  const amount = ethers.parseUnits("1000", 6);
  
  console.log("⏳ Sending mint transaction...");
  try {
    const tx = await usdc.mint(wallet.address, amount);
    console.log(`🚀 Mint Transaction Sent! Hash: ${tx.hash}`);
    
    console.log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log("✅ SUCCESS: You now have 1,000 Test USDC!");
    } else {
      console.log("❌ FAILED: Transaction reverted.");
    }
  } catch (error: any) {
    console.error("❌ Error during minting:", error.message);
  }
}

main().catch(console.error);
