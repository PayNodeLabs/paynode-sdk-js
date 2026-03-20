const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const deployer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);

  let nonce = await deployer.getNonce();
  console.log(`[Setup] Deployer: ${deployer.address}, Start Nonce: ${nonce}`);

  // 1. Deploy Mock Token
  const erc20Path = path.join(__dirname, '../../paynode-contracts/out/PayNodeRouter.t.sol/MockToken.json');
  const erc20Json = JSON.parse(fs.readFileSync(erc20Path, 'utf8'));
  
  const ERC20Factory = new ethers.ContractFactory(erc20Json.abi, erc20Json.bytecode, deployer);
  const token = await ERC20Factory.deploy("Mock USDC", "mUSDC", 6, { nonce: nonce++ });
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`[Setup] Mock USDC Deployed at: ${tokenAddress}`);

  // 2. Deploy PayNodeRouter
  const routerPath = path.join(__dirname, '../../paynode-contracts/out/PayNodeRouter.sol/PayNodeRouter.json');
  const routerJson = JSON.parse(fs.readFileSync(routerPath, 'utf8'));

  const RouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode, deployer);
  const router = await RouterFactory.deploy(deployer.address, { nonce: nonce++ });
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`[Setup] PayNodeRouter Deployed at: ${routerAddress}`);

  // 3. Pre-approve
  console.log(`[Setup] Approving Router to spend tokens...`);
  const tx = await token.approve(routerAddress, ethers.MaxUint256, { nonce: nonce++ });
  await tx.wait();

  // 4. Print the env variables needed for the server
  console.log(`\n[Setup] SUCCESS! Copy these to your environment:`);
  console.log(`export PAYNODE_CONTRACT=${routerAddress}`);
  console.log(`export TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`export MERCHANT_ADDRESS=${deployer.address}`); // Self-payment for demo
}

main().catch(console.error);
