import { ethers } from 'ethers';

export interface RequestOptions extends RequestInit {
  json?: any;
}

export class PayNodeAgentClient {
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;

  private ERC20_ABI = [
    "function approve(address spender, uint256 value) public returns (bool)",
    "function allowance(address owner, address spender) public view returns (uint256)",
    "function balanceOf(address account) public view returns (uint256)"
  ];

  private ROUTER_ABI = [
    "function pay(address token, address merchant, uint256 amount, bytes32 orderId) public"
  ];

  constructor(privateKey: string, rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  /**
   * Executes a fetch request and automatically handles the 402 Payment loop if encountered.
   */
  async requestGate(url: string, options: RequestOptions = {}): Promise<Response> {
    const fetchOptions: RequestInit = { ...options };
    
    if (options.json && !fetchOptions.body) {
      fetchOptions.body = JSON.stringify(options.json);
      fetchOptions.headers = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers
      };
    }

    let response = await fetch(url, fetchOptions);

    if (response.status === 402) {
      console.log(`💡 [PayNode-JS] 402 Payment Required detected. Handling autonomous payment...`);
      return await this.handlePaymentAndRetry(url, fetchOptions, response.headers);
    }

    return response;
  }

  private async handlePaymentAndRetry(url: string, options: RequestInit, headers: Headers): Promise<Response> {
    const contractAddr = headers.get('x-paynode-contract');
    const merchantAddr = headers.get('x-paynode-merchant');
    const amountStr = headers.get('x-paynode-amount');
    const tokenAddr = headers.get('x-paynode-token-address');
    const orderIdStr = headers.get('x-paynode-order-id');

    if (!contractAddr || !merchantAddr || !amountStr || !tokenAddr || !orderIdStr) {
      throw new Error("Malformed 402 headers: missing PayNode metadata");
    }

    const amount = BigInt(amountStr);
    const orderIdBytes = ethers.id(orderIdStr);

    const txHash = await this.executeChainPayment(contractAddr, merchantAddr, tokenAddr, amount, orderIdBytes);
    console.log(`✅ [PayNode-JS] Payment confirmed on-chain: ${txHash}`);

    const retryOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        'x-paynode-receipt': txHash,
        'x-paynode-order-id': orderIdStr
      }
    };

    return await fetch(url, retryOptions);
  }

  private async executeChainPayment(
    contractAddr: string, 
    merchantAddr: string, 
    tokenAddr: string, 
    amount: bigint, 
    orderId: string
  ): Promise<string> {
    const tokenContract = new ethers.Contract(tokenAddr, this.ERC20_ABI, this.wallet);
    
    // 1. Check Balance
    const balance = await tokenContract.balanceOf(this.wallet.address);
    if (balance < amount) {
        throw new Error(`Insufficient USDC balance. Have: ${ethers.formatUnits(balance, 6)}, Need: ${ethers.formatUnits(amount, 6)}`);
    }

    // 2. Check and Handle Allowance
    const currentAllowance = await tokenContract.allowance(this.wallet.address, contractAddr);
    if (currentAllowance < amount) {
      console.log(`🔐 [PayNode-JS] Allowance too low (${currentAllowance}). Granting Infinite Approval to Router...`);
      const approveTx = await tokenContract.approve(contractAddr, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`🔓 [PayNode-JS] Infinite Approval confirmed.`);
    }

    // 3. Execute Payment
    const routerContract = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
    
    // Use manually specified gas limit to avoid estimateGas issues with some RPCs
    const payTx = await routerContract.pay(tokenAddr, merchantAddr, amount, orderId, {
        gasLimit: 200000 // Safe overhead for Base
    });
    
    const receipt = await payTx.wait();
    return receipt.hash;
  }
}
