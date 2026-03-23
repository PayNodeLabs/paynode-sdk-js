import { ethers, JsonRpcProvider, FallbackProvider, Interface } from 'ethers';
import { ErrorCode, PayNodeException } from '../errors';
import { IdempotencyStore } from './idempotency';
import { ACCEPTED_TOKENS, MIN_PAYMENT_AMOUNT } from '../constants';

export interface PayNodeVerifierConfig {
  rpcUrls: string | string[];
  contractAddress: string; // Required to prevent fake contract attacks
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
  private contractAddress: string;
  private chainId?: number;
  private store?: IdempotencyStore;
  private acceptedTokens?: Set<string>;

  constructor(config: PayNodeVerifierConfig) {
    if (!config.rpcUrls || (Array.isArray(config.rpcUrls) && config.rpcUrls.length === 0)) {
      throw new PayNodeException(ErrorCode.RpcError);
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

    this.contractAddress = config.contractAddress;
    this.chainId = config.chainId;
    this.store = config.store;

    let tokenList: string[] | undefined;
    if (config.acceptedTokens !== undefined) {
      tokenList = config.acceptedTokens;
    } else if (config.chainId) {
      tokenList = ACCEPTED_TOKENS[config.chainId];
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
        return { isValid: false, error: new PayNodeException(ErrorCode.AmountTooLow) };
      }

      // 1. Token Whitelist Check (Anti-FakeToken)
      if (this.acceptedTokens && !this.acceptedTokens.has(expected.tokenAddress.toLowerCase())) {
        return { isValid: false, error: new PayNodeException(ErrorCode.TokenNotAccepted) };
      }

      // 1. Idempotency Check
      if (this.store) {
        const isNew = await this.store.checkAndSet(txHash, 86400);
        if (!isNew) {
          return { isValid: false, error: new PayNodeException(ErrorCode.DuplicateTransaction) };
        }
      }

      // 2. Fetch Receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt) };
      }
      if (receipt.status !== 1) {
        return { isValid: false, error: new PayNodeException(ErrorCode.TransactionFailed) };
      }

      // 3. Parse Logs & Verify Contract Source
      let paymentLog: any = null;
      for (const log of receipt.logs) {
        try {
          // Security Fix: Verify the log address matches the official router address
          if (log.address.toLowerCase() !== this.contractAddress.toLowerCase()) {
            continue;
          }

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
        return { isValid: false, error: new PayNodeException(ErrorCode.WrongContract) };
      }

      const args = paymentLog.parsed.args;

      // 4. Verify OrderId (bytes32 keccak256 hash comparison)
      if (expected.orderId) {
        if (args.orderId !== ethers.id(expected.orderId)) {
          return { isValid: false, error: new PayNodeException(ErrorCode.OrderMismatch) };
        }
      }

      // 5. Verify Merchant
      if (args.merchant.toLowerCase() !== expected.merchantAddress.toLowerCase()) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Payment went to a different merchant.") };
      }

      // 5. Verify Token
      if (args.token.toLowerCase() !== expected.tokenAddress.toLowerCase()) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Payment used unexpected token.") };
      }

      // 6. Verify Amount
      if (BigInt(args.amount) < BigInt(expected.amount)) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Payment amount is below required price.") };
      }

      // 7. Verify ChainId (Cross-chain replay protection)
      const expectedChainId = BigInt(this.chainId || (await this.provider.getNetwork()).chainId);
      if (BigInt(args.chainId) !== expectedChainId) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "ChainId mismatch. Invalid network.") };
      }

      return { isValid: true };
    } catch (e: any) {
      if (e instanceof PayNodeException) return { isValid: false, error: e };
      return { isValid: false, error: new PayNodeException(ErrorCode.InternalError, `An unexpected error occurred: ${e.message}`) };
    }
  }
}
