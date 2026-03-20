const express = require('express');
const { x402_gate } = require('@paynode/sdk');

const app = express();
const PORT = 3000;

// Configuration from environment (or hardcoded for demo)
const options = {
  rpcUrl: "http://localhost:8545",
  payNodeContractAddress: process.env.PAYNODE_CONTRACT, 
  merchantAddress: process.env.MERCHANT_ADDRESS,
  chainId: 31337, // Anvil default
  currency: "USDC",
  tokenAddress: process.env.TOKEN_ADDRESS,
  price: "0.01",
  decimals: 6
};

// Protect this route with the PayNode x402 gate
app.get('/api/data', x402_gate(options), (req, res) => {
  res.json({
    status: "Success",
    data: "This is secret data only available after payment.",
    timestamp: Date.now()
  });
});

app.listen(PORT, () => {
  console.log(`[PayNode Demo] Merchant Server running at http://localhost:${PORT}`);
});
