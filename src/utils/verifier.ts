import { ErrorCode, PayNodeException } from '../errors';
import { JsonRpcProvider, FallbackProvider, Interface } from 'ethers';
import { IdempotencyStore } from './idempotency';

/**
 * Default accepted token addresses across supported chains.
 * SDK will reject any payment involving a token NOT in this whitelist,
 * preventing fake-token attacks at the verification layer.
 */
export const ACCEPTED_TOKENS: Record<string, string[]> = {
  // Base Mainnet (chainId: 8453)
  '8453': [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  ],
  // Base Sepolia (chainId: 84532)
  '84532': [
    '0xeAC1f2C7099CdaFfB91Aa3b8Ffd653Ef16935798', // USDC (Sandbox)
  ],
};

/** Minimum allowed payment amount to prevent dust exploits (1000 = 0.001 USDC) */
export const MIN_PAYMENT_AMOUNT = 1000n;

export interface PayNodeVerifierConfig {
  rpcUrls: string | string[];
  chainId?: number;
  store?: IdempotencyStore;
  /** Override the default accepted token whitelist. If provided, only these addresses are allowed. */
  acceptedTokens?: string[];
}

export interface ExpectedPayment {
  merchantAddress: string;
  tokenAddress: string;
  amount: string | number | bigint;
  orderId?: string;
}

const PAYNODE_ABI = [
  "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
];

const iface = new Interface(PAYNODE_ABI);

export class PayNodeVerifier {
  private provider: JsonRpcProvider | FallbackProvider;
  private chainId?: number;
  private store?: IdempotencyStore;
  private acceptedTokens?: Set<string>;

  constructor(config: PayNodeVerifierConfig) {
    if (!config.rpcUrls || (Array.isArray(config.rpcUrls) && config.rpcUrls.length === 0)) {
      throw new PayNodeException("Failed to connect to any provided RPC nodes.", ErrorCode.RPC_ERROR);
    }
    
    // Support RpcPool / FallbackProvider
    if (Array.isArray(config.rpcUrls)) {
      const providers = config.rpcUrls.map((url, i) => {
        return {
          provider: new JsonRpcProvider(url, config.chainId),
          priority: i,
          stallTimeout: 1500,
          weight: 1
        };
      });
      this.provider = new FallbackProvider(providers);
    } else {
      this.provider = new JsonRpcProvider(config.rpcUrls, config.chainId);
    }
    this.chainId = config.chainId;
    this.store = config.store;

    let tokenList: string[] | undefined;
    if (config.acceptedTokens !== undefined) {
      tokenList = config.acceptedTokens;
    } else if (config.chainId) {
      tokenList = ACCEPTED_TOKENS[config.chainId.toString()];
    }
    if (tokenList && tokenList.length > 0) {
      this.acceptedTokens = new Set(tokenList.map(t => t.toLowerCase()));
    }
  }

  async verifyPayment(txHash: string, expected: ExpectedPayment): Promise<{ isValid: boolean; error?: PayNodeException }> {
    try {
      // 0. Dust Exploit Check (Minimum Payment)
      const expectedAmount = BigInt(expected.amount);
      if (expectedAmount < MIN_PAYMENT_AMOUNT) {
        return { isValid: false, error: new PayNodeException("Payment amount is below the protocol minimum (1000).", ErrorCode.AMOUNT_TOO_LOW) };
      }

      // 1. Token Whitelist Check (Anti-FakeToken)
      if (this.acceptedTokens && !this.acceptedTokens.has(expected.tokenAddress.toLowerCase())) {
        return { isValid: false, error: new PayNodeException("The provided token address is not in the whitelist.", ErrorCode.TOKEN_NOT_ACCEPTED) };
      }

      // 1. Idempotency Check
      if (this.store) {
        const isNew = await this.store.checkAndSet(txHash, 86400);
        if (!isNew) {
          return { isValid: false, error: new PayNodeException("This transaction hash has already been consumed.", ErrorCode.DUPLICATE_TRANSACTION) };
        }
      }

      // 2. Fetch Receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { isValid: false, error: new PayNodeException("The provided receipt (TxHash) is malformed or invalid.", ErrorCode.INVALID_RECEIPT) };
      }
      if (receipt.status !== 1) {
        return { isValid: false, error: new PayNodeException("On-chain transaction reverted or failed.", ErrorCode.TRANSACTION_FAILED) };
      }

      // 3. Parse Logs
      let paymentLog: any = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === 'PaymentReceived') {
            paymentLog = { parsed, logAddress: log.address };
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!paymentLog) {
        return { isValid: false, error: new PayNodeException("No valid PaymentReceived event found in transaction.", ErrorCode.INVALID_RECEIPT) };
      }

      const args = paymentLog.parsed.args;

      // 4. Verify Merchant
      if (args.merchant.toLowerCase() !== expected.merchantAddress.toLowerCase()) {
        return { isValid: false, error: new PayNodeException("Payment went to a different merchant.", ErrorCode.INVALID_RECEIPT) };
      }

      // 5. Verify Token
      if (args.token.toLowerCase() !== expected.tokenAddress.toLowerCase()) {
        return { isValid: false, error: new PayNodeException("Payment used unexpected token.", ErrorCode.INVALID_RECEIPT) };
      }

      // 6. Verify Amount
      if (BigInt(args.amount) < BigInt(expected.amount)) {
        return { isValid: false, error: new PayNodeException("Payment amount is below required price.", ErrorCode.INVALID_RECEIPT) };
      }

      // 7. Verify ChainId (Cross-chain replay protection)
      const expectedChainId = BigInt(this.chainId || (await this.provider.getNetwork()).chainId);
      if (BigInt(args.chainId) !== expectedChainId) {
        return { isValid: false, error: new PayNodeException("ChainId mismatch. Invalid network.", ErrorCode.INVALID_RECEIPT) };
      }

      return { isValid: true };
    } catch (e: any) {
      if (e instanceof PayNodeException) return { isValid: false, error: e };
      return { isValid: false, error: new PayNodeException(`An unexpected error occurred: ${e.message}`, ErrorCode.INTERNAL_ERROR) };
    }
  }
}
