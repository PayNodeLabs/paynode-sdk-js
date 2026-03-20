const { ethers } = require('ethers');

async function main() {
  const SERVER_URL = 'http://localhost:3000/api/data';
  const RPC_URL = 'http://localhost:8545';
  
  // Use a sample wallet from Anvil (usually has 10000 ETH)
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);

  console.log(`[AI Agent] Client wallet: ${wallet.address}`);

  // Step 1: Initial call - Expecting 402
  console.log(`[AI Agent] Attempting call without payment...`);
  const response1 = await fetch(SERVER_URL);
  
  if (response1.status !== 402) {
    console.error(`Expected 402, got ${response1.status}`);
    process.exit(1);
  }

  const contract = response1.headers.get('x-paynode-contract');
  const amount = response1.headers.get('x-paynode-amount');
  const merchant = response1.headers.get('x-paynode-merchant');
  const orderId = response1.headers.get('x-paynode-order-id');
  const tokenAddress = response1.headers.get('x-paynode-token-address');

  console.log(`[AI Agent] Handshake received!`);
  console.log(` - Contract: ${contract}`);
  console.log(` - Amount: ${amount}`);
  console.log(` - Merchant: ${merchant}`);
  console.log(` - OrderID: ${orderId}`);

  // Step 2: Pay on-chain
  // In this demo, we use PayNodeRouter.pay()
  // ABI matched: function pay(address token, address merchant, uint256 amount, bytes32 orderId)
  const ABI = [
    "function pay(address token, address merchant, uint256 amount, bytes32 orderId) external"
  ];
  const payNode = new ethers.Contract(contract, ABI, wallet);

  console.log(`[AI Agent] Executing payment on chain...`);
  // Order of arguments: token, merchant, amount, hashedOrderId
  const tx = await payNode.pay(tokenAddress, merchant, amount, ethers.id(orderId));
  const receipt = await tx.wait();
  console.log(`[AI Agent] Payment confirmed: ${receipt.hash}`);

  // Step 3: Retry call with receipt
  console.log(`[AI Agent] Retrying call with receipt...`);
  const response2 = await fetch(SERVER_URL, {
    headers: {
      'x-paynode-receipt': receipt.hash,
      'x-paynode-order-id': orderId
    }
  });

  if (response2.status === 200) {
    const data = await response2.json();
    console.log(`[AI Agent] SUCCESS! Data received:`, data);
  } else {
    const error = await response2.json();
    console.error(`[AI Agent] FAILED with status ${response2.status}:`, error);
  }
}

main().catch(console.error);
