import { ethers } from 'ethers';
import { PayNodeException, ErrorCode } from './errors';

export interface RequestOptions extends RequestInit {
  json?: any;
}

export class PayNodeAgentClient {
  private wallet: ethers.Wallet;
  private provider: ethers.FallbackProvider;
  private rpcUrls: string[];

  private ERC20_ABI = [
    "function approve(address spender, uint256 value) public returns (bool)",
    "function allowance(address owner, address spender) public view returns (uint256)",
    "function balanceOf(address account) public view returns (uint256)",
    "function name() view returns (string)",
    "function nonces(address owner) view returns (uint256)"
  ];

  private ROUTER_ABI = [
    "function pay(address token, address merchant, uint256 amount, bytes32 orderId) public",
    "function payWithPermit(address payer, address token, address merchant, uint256 amount, bytes32 orderId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public"
  ];

  constructor(privateKey: string, rpcUrls: string | string[]) {
    this.rpcUrls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
    
    const configs = this.rpcUrls.map((url, index) => ({
      provider: new ethers.JsonRpcProvider(url),
      priority: index,
      weight: 1,
      stallTimeout: 3000
    }));

    this.provider = new ethers.FallbackProvider(configs);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  async requestGate(url: string, options: RequestOptions = {}): Promise<Response> {
    const fetchOptions: RequestInit = { ...options };
    
    if (options.json && !fetchOptions.body) {
      fetchOptions.body = JSON.stringify(options.json);
      fetchOptions.headers = {
        'Content-Type': 'application/json',
        ...fetchOptions.headers
      };
    }

    try {
      let response = await fetch(url, fetchOptions);

      if (response.status === 402) {
        console.log(`💡 [PayNode-JS] 402 Payment Required detected. Handling autonomous payment...`);
        return await this.handlePaymentAndRetry(url, fetchOptions, response.headers);
      }

      return response;
    } catch (error) {
      if (error instanceof PayNodeException) throw error;
      throw new PayNodeException(`Failed to connect to any provided RPC nodes.`, ErrorCode.RPC_ERROR, error);
    }
  }

  private async handlePaymentAndRetry(url: string, options: RequestInit, headers: Headers): Promise<Response> {
    const contractAddr = headers.get('x-paynode-contract');
    const merchantAddr = headers.get('x-paynode-merchant');
    const amountStr = headers.get('x-paynode-amount');
    const tokenAddr = headers.get('x-paynode-token-address');
    const orderIdStr = headers.get('x-paynode-order-id');

    if (!contractAddr || !merchantAddr || !amountStr || !tokenAddr || !orderIdStr) {
      throw new PayNodeException("Malformed 402 headers: missing metadata", ErrorCode.INTERNAL_ERROR);
    }

    const amount = BigInt(amountStr);
    
    // v1.3 Constraint: Min payment protection
    if (amount < 1000n) {
      throw new PayNodeException("Payment amount is below the protocol minimum (1000).", ErrorCode.AMOUNT_TOO_LOW);
    }

    let txHash: string;
    try {
      const tokenContract = new ethers.Contract(tokenAddr, this.ERC20_ABI, this.wallet);
      const [balance, allowance] = await Promise.all([
        tokenContract.balanceOf(this.wallet.address),
        tokenContract.allowance(this.wallet.address, contractAddr)
      ]);

      if (balance < amount) {
        throw new PayNodeException("Wallet lacks USDC or ETH for gas.", ErrorCode.INSUFFICIENT_FUNDS);
      }

      // Protocol v1.3: Permit-First Execution
      if (allowance >= amount) {
        txHash = await this.executeStandardPay(contractAddr, tokenAddr, merchantAddr, amount, orderIdStr);
      } else {
        console.log(`⚡ [PayNode-JS] Insufficient allowance. Attempting Permit-First payment...`);
        txHash = await this.executePermitPay(contractAddr, tokenAddr, merchantAddr, amount, orderIdStr);
      }
    } catch (error) {
      if (error instanceof PayNodeException) throw error;
      throw new PayNodeException(`On-chain transaction reverted or failed.`, ErrorCode.TRANSACTION_FAILED, error);
    }

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

  private async executeStandardPay(contractAddr: string, tokenAddr: string, merchantAddr: string, amount: bigint, orderId: string): Promise<string> {
    const router = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
    const orderIdBytes = ethers.id(orderId);
    
    const feeData = await this.provider.getFeeData();
    const gasPrice = (feeData.gasPrice! * 120n) / 100n; // GasPrice * 1.2

    const tx = await router.pay(tokenAddr, merchantAddr, amount, orderIdBytes, {
      gasPrice,
      gasLimit: 200000
    });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  private async executePermitPay(contractAddr: string, tokenAddr: string, merchantAddr: string, amount: bigint, orderId: string): Promise<string> {
    const sig = await this.signPermit(tokenAddr, contractAddr, amount);
    const router = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
    const orderIdBytes = ethers.id(orderId);

    const feeData = await this.provider.getFeeData();
    const gasPrice = (feeData.gasPrice! * 120n) / 100n;

    const tx = await router.payWithPermit(
      this.wallet.address,
      tokenAddr,
      merchantAddr,
      amount,
      orderIdBytes,
      sig.deadline,
      sig.v,
      sig.r,
      sig.s,
      { gasPrice, gasLimit: 300000 }
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async signPermit(tokenAddr: string, spenderAddr: string, amount: bigint, deadlineSeconds: number = 3600) {
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const token = new ethers.Contract(tokenAddr, this.ERC20_ABI, this.wallet);

    const [name, nonce, network] = await Promise.all([
      token.name(),
      token.nonces(this.wallet.address),
      this.provider.getNetwork()
    ]);

    const domain = {
      name,
      version: '1', // USDC on Base uses version 1
      chainId: Number(network.chainId),
      verifyingContract: tokenAddr
    };

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ]
    };

    const value = {
      owner: this.wallet.address,
      spender: spenderAddr,
      value: amount,
      nonce,
      deadline
    };

    const signature = await this.wallet.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(signature);

    return { deadline, v, r, s };
  }
}
