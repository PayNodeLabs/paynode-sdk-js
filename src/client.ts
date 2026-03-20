import { ethers } from 'ethers';

export interface RequestOptions extends RequestInit {
  json?: any;
}

export class PayNodeAgentClient {
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;

  private ERC20_ABI = [
    "function approve(address spender, uint256 value) public returns (bool)"
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
    
    // Handle JSON body convenience
    if (options.json && !fetchOptions.body) {
      fetchOptions.body = JSON.stringify(options.json);
      fetchOptions.headers = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers
      };
    }

    // 1. Initial Attempt
    let response = await fetch(url, fetchOptions);

    // 2. Check for 402 Payment Required
    if (response.status === 402) {
      console.log(`💡 [PayNode-JS] 402 Payment Required detected for ${url}. Initiating autonomous payment...`);
      return await this.handlePaymentAndRetry(url, fetchOptions, response.headers);
    }

    return response;
  }

  private async handlePaymentAndRetry(url: string, options: RequestInit, headers: Headers): Promise<Response> {
    // Extract metadata
    const contractAddr = headers.get('x-paynode-contract');
    const merchantAddr = headers.get('x-paynode-merchant');
    const amountStr = headers.get('x-paynode-amount');
    const tokenAddr = headers.get('x-paynode-token-address');
    const orderIdStr = headers.get('x-paynode-order-id');

    if (!contractAddr || !merchantAddr || !amountStr || !tokenAddr || !orderIdStr) {
      throw new Error("Malformed 402 headers: missing PayNode metadata");
    }

    const amount = BigInt(amountStr);
    const orderIdBytes = ethers.id(orderIdStr); // Keccak256 hash of orderId string

    // 1. Execute Chain Payment
    const txHash = await this.executeChainPayment(contractAddr, merchantAddr, tokenAddr, amount, orderIdBytes);
    console.log(`✅ [PayNode-JS] Payment successful. TxHash: ${txHash}`);

    // 2. Retry with Receipt
    const retryOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        'x-paynode-receipt': txHash,
        'x-paynode-order-id': orderIdStr
      }
    };

    console.log(`🔄 [PayNode-JS] Retrying original request with receipt...`);
    return await fetch(url, retryOptions);
  }

  private async executeChainPayment(
    contractAddr: string, 
    merchantAddr: string, 
    tokenAddr: string, 
    amount: bigint, 
    orderId: string
  ): Promise<string> {
    // A. Approve
    const tokenContract = new ethers.Contract(tokenAddr, this.ERC20_ABI, this.wallet);
    const approveTx = await tokenContract.approve(contractAddr, amount);
    await approveTx.wait();

    // B. Pay
    const routerContract = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
    const payTx = await routerContract.pay(tokenAddr, merchantAddr, amount, orderId);
    const receipt = await payTx.wait();

    return receipt.hash;
  }
}
