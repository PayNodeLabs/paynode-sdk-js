import { ErrorCode } from '../errors';
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
  verifyDepegPrice?: boolean; // placeholder for depeg check
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
      throw new Error("rpcUrls must be provided");
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

    // Build accepted token set: user-provided or chain-default
    // acceptedTokens=undefined → use chain default; acceptedTokens=[] → explicitly disable whitelist
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

  async verifyPayment(txHash: string, expected: ExpectedPayment): Promise<{ isValid: boolean; error?: { code: ErrorCode; message: string } }> {
    try {
      // 0. Dust Exploit Check (Minimum Payment)
      const expectedAmount = BigInt(expected.amount);
      if (expectedAmount < MIN_PAYMENT_AMOUNT) {
        return { isValid: false, error: { code: ErrorCode.AMOUNT_TOO_LOW, message: `Payment amount ${expected.amount} is below the minimum threshold of ${MIN_PAYMENT_AMOUNT}.` } };
      }

      // 1. Token Whitelist Check (Anti-FakeToken)
      if (this.acceptedTokens && !this.acceptedTokens.has(expected.tokenAddress.toLowerCase())) {
        return { isValid: false, error: { code: ErrorCode.TOKEN_NOT_ACCEPTED, message: `Token ${expected.tokenAddress} is not in the accepted whitelist.` } };
      }

      // 1. Idempotency Check
      if (this.store) {
        // Assume TTL of 24 hours for replay protection
        const isNew = await this.store.checkAndSet(txHash, 86400);
        if (!isNew) {
          return { isValid: false, error: { code: ErrorCode.RECEIPT_ALREADY_USED, message: 'Transaction hash has already been consumed.' } };
        }
      }

      // 2. Fetch Receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { isValid: false, error: { code: ErrorCode.TRANSACTION_NOT_FOUND, message: "Transaction not found on-chain." } };
      }
      if (receipt.status !== 1) {
        return { isValid: false, error: { code: ErrorCode.TRANSACTION_FAILED, message: "Transaction reverted on-chain." } };
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
        return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: "No PaymentReceived event found in transaction." } };
      }

      const args = paymentLog.parsed.args;

      // 4. Verify Merchant
      if (args.merchant.toLowerCase() !== expected.merchantAddress.toLowerCase()) {
        return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: `Merchant mismatch. Expected ${expected.merchantAddress}, got ${args.merchant}` } };
      }

      // 5. Verify Token
      if (args.token.toLowerCase() !== expected.tokenAddress.toLowerCase()) {
        return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: `Token mismatch. Expected ${expected.tokenAddress}, got ${args.token}` } };
      }

      // 6. Verify Amount
      if (BigInt(args.amount) < BigInt(expected.amount)) {
        return { isValid: false, error: { code: ErrorCode.INSUFFICIENT_FUNDS, message: `Expected amount ${expected.amount}, received ${args.amount}` } };
      }

      // 7. Verify ChainId (Cross-chain replay protection)
      const expectedChainId = BigInt(this.chainId || (await this.provider.getNetwork()).chainId);
      if (BigInt(args.chainId) !== expectedChainId) {
        return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: "ChainId mismatch. Invalid network." } };
      }

      // 8. Order Id Check (Optional)
      if (expected.orderId) {
        // Contract orderId is bytes32. Just comparing strings directly if it was passed cleanly, or checking startsWith etc.
        // Ethers returns bytes32 as 0x-prefixed hex string. We should format expected to bytes32 if it's text.
        // For simplicity, assume they match format or we enforce formatting in the caller.
        if (args.orderId !== expected.orderId) {
           return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: "OrderId mismatch." } };
        }
      }

      return { isValid: true };
    } catch (e: any) {
      return { isValid: false, error: { code: ErrorCode.INTERNAL_ERROR, message: e.message } };
    }
  }
}
