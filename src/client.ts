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
    "function pay(address token, address merchant, uint256 amount, bytes32 orderId) public",
    "function payWithPermit(address payer, address token, address merchant, uint256 amount, bytes32 orderId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public"
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

  /**
   * Executes a payment using EIP-2612 Permit — single-tx approve + pay.
   * The payer signs the permit offline, and any relayer (e.g. AI Agent) can submit it on-chain.
   * @param contractAddr PayNode Router address
   * @param payerAddress The address that holds the tokens and signed the permit
   * @param tokenAddr ERC20 token with EIP-2612 support (e.g. USDC)
   * @param merchantAddr Merchant receiving 99% of payment
   * @param amount Token amount in smallest unit (e.g. 1000000 = 1 USDC)
   * @param orderId Order identifier as bytes32
   * @param deadline Unix timestamp after which the permit is invalid
   * @param v ECDSA recovery id
   * @param r ECDSA signature component
   * @param s ECDSA signature component
   */
  async payWithPermit(
    contractAddr: string,
    payerAddress: string,
    tokenAddr: string,
    merchantAddr: string,
    amount: bigint,
    orderId: string,
    deadline: number,
    v: number,
    r: string,
    s: string
  ): Promise<string> {
    const routerContract = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);

    const tx = await routerContract.payWithPermit(
      payerAddress,
      tokenAddr,
      merchantAddr,
      amount,
      orderId,
      deadline,
      v,
      r,
      s,
      { gasLimit: 300000 }
    );

    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Helper: Generate an EIP-2612 Permit signature for USDC/ERC20.
   * The wallet that calls this must be the token holder (payer).
   * @returns { deadline, v, r, s } to pass to payWithPermit
   */
  async signPermit(
    tokenAddr: string,
    spenderAddr: string,
    amount: bigint,
    deadlineSeconds: number = 3600
  ): Promise<{ deadline: number; v: number; r: string; s: string }> {
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;

    // EIP-2612 domain & types
    const tokenContract = new ethers.Contract(tokenAddr, [
      "function name() view returns (string)",
      "function nonces(address owner) view returns (uint256)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)"
    ], this.wallet);

    const [name, nonce, chainId] = await Promise.all([
      tokenContract.name(),
      tokenContract.nonces(this.wallet.address),
      this.provider.getNetwork().then(n => n.chainId)
    ]);

    const domain = {
      name,
      version: '2', // USDC uses version "2"
      chainId: Number(chainId),
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

    const sig = await this.wallet.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(sig);

    return { deadline, v, r, s };
  }
}
