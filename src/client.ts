import { ethers } from 'ethers';
import { PayNodeException, ErrorCode } from './errors';
import { BASE_RPC_URLS, ACCEPTED_TOKENS, MIN_PAYMENT_AMOUNT, PAYNODE_ROUTER_ABI, SDK_VERSION } from './constants';
import { 
  PaymentRequiredResponse, 
  PaymentPayload,
  ExactEVMPayload,
  UnifiedPaymentPayload
} from './types/x402';

export interface RequestOptions extends RequestInit {
  json?: any;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class PayNodeAgentClient {
  private wallet: ethers.Wallet;
  private provider: ethers.FallbackProvider;
  private rpcUrls: string[];
  private maxRetries: number;
  private nonceLock: Promise<void> = Promise.resolve();

  private ERC20_ABI = [
    "function approve(address spender, uint256 value) public returns (bool)",
    "function allowance(address owner, address spender) public view returns (uint256)",
    "function balanceOf(address account) public view returns (uint256)",
    "function name() view returns (string)",
    "function nonces(address owner) view returns (uint256)"
  ];

  private ROUTER_ABI = PAYNODE_ROUTER_ABI;

  constructor(privateKey: string, rpcUrls: string | string[] = BASE_RPC_URLS, maxRetries: number = 3) {
    this.rpcUrls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
    this.maxRetries = maxRetries;
    
    const configs = this.rpcUrls.map((url, index) => ({
      provider: new ethers.JsonRpcProvider(url),
      priority: index,
      weight: 1,
      stallTimeout: 3000
    }));

    this.provider = new ethers.FallbackProvider(configs);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  private async _fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        if (!response) {
          throw new Error('fetch returned undefined');
        }

        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          return response;
        }

        if (attempt < this.maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.warn(`⚠️ [PayNode-JS] ${response.status} received. Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        return response;
      } catch (error: any) {
        lastError = error;
        if (attempt < this.maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          console.warn(`⚠️ [PayNode-JS] Request failed: ${error.message}. Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw lastError || new Error('Request failed after max retries');
  }

  async requestGate(url: string, options: RequestOptions = {}): Promise<Response> {
    const fetchOptions: RequestInit = { ...options };
    
    const network = await this.provider.getNetwork();
    const paynodeNetwork = Number(network.chainId) === 8453 ? 'mainnet' : 'testnet';

    fetchOptions.headers = {
      'X-PayNode-Network': paynodeNetwork,
      ...fetchOptions.headers
    };

    if (options.json && !fetchOptions.body) {
      fetchOptions.body = JSON.stringify(options.json);
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'Content-Type': 'application/json'
      };
    }

    try {
      let response = await this._fetchWithRetry(url, fetchOptions);

      if (response.status === 402) {
        console.log(`💡 [PayNode-JS] 402 Payment Required detected. Analyzing protocol version...`);
        
        const contentType = response.headers.get('content-type');
        const b64Required = response.headers.get('PAYMENT-REQUIRED') || response.headers.get('X-402-Required');
        const orderId = response.headers.get('X-402-Order-Id');
        
        let body: any = null;
        let headerBody: any = null;

        if (b64Required) {
          try {
            const decoded = typeof globalThis.Buffer !== 'undefined'
              ? globalThis.Buffer.from(b64Required, 'base64').toString()
              : atob(b64Required);
            headerBody = JSON.parse(decoded);
          } catch (e) {
            console.debug('⚠️ [PayNode-JS] Failed to parse PAYMENT-REQUIRED header:', e);
          }
        }

        if (contentType && contentType.includes('application/json')) {
          try {
            body = await response.clone().json();
          } catch (e) { /* ignore */ }
        }

        // Robustness: Merge header info into body if body is missing critical bits
        if (headerBody && (!body || !body.x402Version)) {
          body = { ...body, ...headerBody };
        }

        if (body && body.x402Version === 2) {
            console.log(`🚀 [PayNode-JS] x402 v2 detected. Handling autonomous payment...`);
            if (orderId && !body.orderId) body.orderId = orderId;
            return await this._handleX402V2(url, fetchOptions, body as PaymentRequiredResponse);
        }

        throw new PayNodeException(ErrorCode.InternalError, "Unsupported or malformed 402 response");
      }

      return response;
    } catch (error: any) {
      if (error instanceof PayNodeException || error?.name === "PayNodeException") throw error;
      console.error(`❌ [PayNode-JS] Critical error in requestGate:`, error);
      throw new PayNodeException(ErrorCode.RpcError, undefined, error);
    }
  }

  private async _handleX402V2(url: string, options: RequestInit, requirements: PaymentRequiredResponse): Promise<Response> {
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    const caip2ChainId = `eip155:${chainId}`;

    // Select suitable requirement
    const requirement = requirements.accepts.find((req) => 
      req.network === caip2ChainId
    );

    if (!requirement) {
      throw new PayNodeException(ErrorCode.TransactionFailed, `No compatible payment requirement found for network ${caip2ChainId}`);
    }

    console.log(`💡 [PayNode-JS] Selected payment method: ${requirement.type || 'onchain'} on ${requirement.network}`);

    // 🛡️ Token Whitelist Check (Case-insensitive)
    const chainTokens = ACCEPTED_TOKENS[chainId]?.map(t => t.toLowerCase());
    if (chainTokens && !chainTokens.includes(requirement.asset.toLowerCase())) {
      throw new PayNodeException(ErrorCode.TokenNotAccepted, `Token ${requirement.asset} is not in the whitelist for chain ${chainId}`);
    }

    const orderId = requirement.orderId || requirements.orderId || url;

    // Dust limit check
    if (BigInt(requirement.amount) < BigInt(MIN_PAYMENT_AMOUNT)) {
      throw new PayNodeException(ErrorCode.AmountTooLow, `Payment amount ${requirement.amount} is below the minimum dust limit`);
    }

    let payload: PaymentPayload;

    if (requirement.type === 'eip3009') {
      const validAfter = Math.floor(Date.now() / 1000) - 60;
      const validBefore = Math.floor(Date.now() / 1000) + (requirement.maxTimeoutSeconds || 3600);
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const authorization = await this.signTransferWithAuthorization(
        requirement.asset,
        requirement.payTo,
        BigInt(requirement.amount),
        validAfter,
        validBefore,
        nonce,
        requirement.extra
      );

      payload = {
        x402Version: 2,
        resource: requirements.resource,
        accepted: {
          scheme: requirement.scheme,
          network: requirement.network,
          amount: requirement.amount,
          asset: requirement.asset,
          payTo: requirement.payTo,
          maxTimeoutSeconds: requirement.maxTimeoutSeconds,
          extra: requirement.extra || {}
        },
        payload: authorization,
        _paynode: {
          version: SDK_VERSION,
          type: 'eip3009',
          orderId: orderId
        }
      };
    } else {
      // type: 'onchain' or fallback
      const routerAddr = requirement.router;
      if (!routerAddr) {
        throw new PayNodeException(ErrorCode.InternalError, "On-chain payment required but no router address provided.");
      }

      console.log(`⚡ [PayNode-JS] Executing on-chain payment to ${requirement.payTo}...`);
      const amount = BigInt(requirement.amount);
      const tokenContract = new ethers.Contract(requirement.asset, this.ERC20_ABI, this.wallet);
      const allowance = await tokenContract.allowance(this.wallet.address, routerAddr);

      let txHash: string;
      if (allowance >= amount) {
        try {
          txHash = await this.pay(routerAddr, requirement.asset, requirement.payTo, amount, orderId);
        } catch (e) {
          console.warn(`⚠️ [PayNode-JS] Direct pay failed (possibly allowance race), falling back to permit:`, e);
          txHash = await this.payWithPermit(routerAddr, requirement.asset, requirement.payTo, amount, orderId, requirement.extra?.version || '2');
        }
      } else {
        txHash = await this.payWithPermit(routerAddr, requirement.asset, requirement.payTo, amount, orderId, requirement.extra?.version || '2');
      }

      payload = {
        x402Version: 2,
        resource: requirements.resource,
        accepted: {
          scheme: requirement.scheme,
          network: requirement.network,
          amount: requirement.amount,
          asset: requirement.asset,
          payTo: requirement.payTo,
          maxTimeoutSeconds: requirement.maxTimeoutSeconds,
          router: requirement.router,
          extra: requirement.extra || {}
        },
        payload: { txHash },
        _paynode: {
          version: SDK_VERSION,
          type: 'onchain',
          orderId: orderId
        }
      };
    }

    const payloadJson = JSON.stringify(payload);
    const b64Payload = typeof globalThis.Buffer !== 'undefined'
      ? globalThis.Buffer.from(payloadJson).toString('base64')
      : btoa(payloadJson);
    
    const paynodeNetwork = chainId === 8453 ? 'mainnet' : 'testnet';

    const retryOptions: RequestInit = {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': b64Payload,
        'X-402-Payload': b64Payload, // Keep for backward compatibility
        'X-402-Order-Id': orderId,
        'X-PayNode-Network': paynodeNetwork
      }
    };

    const retryResponse = await this._fetchWithRetry(url, retryOptions);
    
    if (retryResponse.status === 402) {
      throw new PayNodeException(ErrorCode.TransactionFailed, "Still 402 after payment attempt. The server may have rejected the payment or authorization.");
    }

    // Attempt to parse PAYMENT-RESPONSE header
    const settleHeader = retryResponse.headers.get('PAYMENT-RESPONSE') || retryResponse.headers.get('X-PAYMENT-RESPONSE');
    if (settleHeader) {
      try {
        let decoded: string;
        if (settleHeader.trim().startsWith('{')) {
          decoded = settleHeader;
        } else {
          decoded = typeof globalThis.Buffer !== 'undefined'
            ? globalThis.Buffer.from(settleHeader, 'base64').toString()
            : atob(settleHeader);
        }
        const settleData = JSON.parse(decoded);
        if (settleData.success) {
          console.log(`✅ [PayNode-JS] Settlement confirmed: ${settleData.transaction}`);
        } else {
          console.warn(`⚠️ [PayNode-JS] Settlement failed: ${settleData.errorReason || 'Unknown error'}`);
        }
      } catch (e) {
        console.warn(`⚠️ [PayNode-JS] Failed to parse settlement response:`, e);
      }
    }

    return retryResponse;
  }

  async signTransferWithAuthorization(
    tokenAddr: string, 
    to: string, 
    amount: bigint, 
    validAfter: number, 
    validBefore: number, 
    nonce: string,
    extra: Record<string, any> = {}
  ): Promise<ExactEVMPayload> {
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    const defaultName = chainId === 8453 ? "USDC" : "USD Coin";
    
    const domain = {
      name: extra.name || defaultName,
      version: extra.version || "2",
      chainId: chainId,
      verifyingContract: tokenAddr
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    };

    const value = {
      from: this.wallet.address,
      to,
      value: amount,
      validAfter,
      validBefore,
      nonce
    };

    const signature = await this.wallet.signTypedData(domain, types, value);

    return {
      signature,
      authorization: {
        from: this.wallet.address,
        to,
        value: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce
      }
    };
  }

  async pay(contractAddr: string, tokenAddr: string, merchantAddr: string, amount: bigint, orderId: string): Promise<string> {
    const unlock = await this._lockNonce();
    try {
      const router = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
      // convention: we hash the raw orderId string to bytes32 internally
      const orderIdBytes = ethers.id(orderId);
      
      const feeData = await this.provider.getFeeData();
      const gasPrice = (feeData.gasPrice! * 120n) / 100n;

      const tx = await router.pay(tokenAddr, merchantAddr, amount, orderIdBytes, {
        gasPrice,
        gasLimit: 200000
      });
      const receipt = await tx.wait();
      return receipt!.hash;
    } finally {
      unlock();
    }
  }

  async payWithPermit(contractAddr: string, tokenAddr: string, merchantAddr: string, amount: bigint, orderId: string, version: string = '2'): Promise<string> {
    const unlock = await this._lockNonce();
    try {
      const sig = await this.signPermit(tokenAddr, contractAddr, amount, 3600, version);
      const router = new ethers.Contract(contractAddr, this.ROUTER_ABI, this.wallet);
      // convention: we hash the raw orderId string to bytes32 internally
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
      return receipt!.hash;
    } finally {
      unlock();
    }
  }

  async signPermit(tokenAddr: string, spenderAddr: string, amount: bigint, deadlineSeconds: number = 3600, version: string = '2') {
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
    const token = new ethers.Contract(tokenAddr, this.ERC20_ABI, this.wallet);

    const [name, nonce, network] = await Promise.all([
      token.name(),
      token.nonces(this.wallet.address),
      this.provider.getNetwork()
    ]);

    const domain = {
      name,
      version,
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

  private async _lockNonce(): Promise<() => void> {
    let resolver: () => void;
    const nextLock = new Promise<void>((resolve) => {
      resolver = resolve;
    });

    const currentLock = this.nonceLock;
    this.nonceLock = nextLock;

    await currentLock;
    return resolver!;
  }
}
