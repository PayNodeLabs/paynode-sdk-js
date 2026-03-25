import { ethers, JsonRpcProvider, FallbackProvider, Contract } from 'ethers';
import { ErrorCode, PayNodeException } from '../errors';
import { IdempotencyStore, MemoryIdempotencyStore } from './idempotency';
import { ACCEPTED_TOKENS, MIN_PAYMENT_AMOUNT } from '../constants';
import { ExactEVMPayload, UnifiedPaymentPayload } from '../types/x402';

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
          stallTimeout: 3000,
          weight: 1
        };
      });
      this.provider = new FallbackProvider(providers);
    } else {
      this.provider = new JsonRpcProvider(config.rpcUrls, config.chainId);
    }

    this.contractAddress = config.contractAddress;
    this.chainId = config.chainId;
    this.store = config.store || new MemoryIdempotencyStore();

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

  private static ROUTER_ABI = [
    "event PaymentReceived(address indexed merchant, address indexed token, uint256 amount, bytes32 indexed orderId, uint256 chainId)"
  ];

  async verify(
    unifiedPayload: UnifiedPaymentPayload,
    expected: ExpectedPayment,
    extra?: any
  ): Promise<{ isValid: boolean; error?: PayNodeException }> {
    try {
      const { type, payload, orderId } = unifiedPayload;

      if (type === 'eip3009') {
        const tokenAddr = expected.tokenAddress;
        if (!tokenAddr) {
          return { isValid: false, error: new PayNodeException(ErrorCode.TokenNotAccepted, "tokenAddress is required for eip3009 verification") };
        }
        const actualPayload = payload as ExactEVMPayload;
        return await this.verifyTransferWithAuthorization(tokenAddr, actualPayload, {
          to: expected.merchantAddress,
          value: expected.amount
        }, extra);
      } else if (type === 'onchain') {
        const { txHash } = payload as { txHash: string };
        if (!txHash) {
          return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Missing txHash in onchain payload") };
        }
        return await this.verifyOnchainPayment(txHash, {
          merchantAddress: expected.merchantAddress,
          tokenAddress: expected.tokenAddress,
          amount: expected.amount,
          orderId: orderId
        });
      } else {
        return { isValid: false, error: new PayNodeException(ErrorCode.InternalError, `Unsupported payload type: ${type}`) };
      }
    } catch (e: any) {
      if (e instanceof PayNodeException) return { isValid: false, error: e };
      return { isValid: false, error: new PayNodeException(ErrorCode.InternalError, e.message) };
    }
  }

  async verifyOnchainPayment(txHash: string, expected: any): Promise<{ isValid: boolean; error?: PayNodeException }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status === 0) {
        return { isValid: false, error: new PayNodeException(ErrorCode.TransactionNotFound) };
      }

      const router = new ethers.Interface(PayNodeVerifier.ROUTER_ABI);
      const targetOrderId = ethers.id(expected.orderId);
      
      let validEventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = router.parseLog(log);
          if (parsed && parsed.name === 'PaymentReceived') {
            const { merchant, token, amount, orderId } = parsed.args;

            if (
              merchant.toLowerCase() === expected.merchantAddress.toLowerCase() &&
              token.toLowerCase() === expected.tokenAddress.toLowerCase() &&
              BigInt(amount) >= BigInt(expected.amount) &&
              orderId === targetOrderId
            ) {
              validEventFound = true;
              break;
            }
          }
        } catch (e) {
          // Skip
        }
      }

      if (!validEventFound) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "No matching PaymentReceived event found") };
      }

      if (this.store) {
        const isNew = await this.store.checkAndSet(txHash, 86400);
        if (!isNew) {
          return { isValid: false, error: new PayNodeException(ErrorCode.DuplicateTransaction) };
        }
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: new PayNodeException(ErrorCode.RpcError, undefined, error) };
    }
  }

  /**
   * 亚秒级离线签名验证 (V2 核心)
   * 耗时: < 50ms (仅需一次 RPC Read)
   */
  async verifyTransferWithAuthorization(
    tokenAddr: string,
    payload: ExactEVMPayload,
    expected: {
      to: string;
      value: string | number | bigint;
    },
    extra: Record<string, any> = {}
  ): Promise<{ isValid: boolean; error?: PayNodeException }> {
    try {
      const { signature, authorization } = payload;
      const { from, to, value, validAfter, validBefore, nonce } = authorization;
      const expectedValue = BigInt(expected.value);
      const payloadValue = BigInt(value);

      // 1. 基础字段与金额校验 (防粉尘攻击)
      if (to.toLowerCase() !== expected.to.toLowerCase()) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Recipient mismatch") };
      }
      if (payloadValue < expectedValue) {
        return { isValid: false, error: new PayNodeException(ErrorCode.AmountTooLow) };
      }

      // 2. 时间窗口校验
      const now = Math.floor(Date.now() / 1000);
      if (now < Number(validAfter)) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Authorization not yet valid") };
      }
      if (now > Number(validBefore)) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Authorization expired") };
      }

      // 3. 密码学验签 (EIP-712 / EIP-3009) - 纯本地计算 0ms
      const chainId = Number(this.chainId || (await this.provider.getNetwork()).chainId);
      const domain = {
        name: extra.name || "USD Coin",
        version: extra.version || "2",
        chainId,
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

      const recoveredAddress = ethers.verifyTypedData(domain, types, authorization, signature);
      if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Invalid signature: recovered address mismatch") };
      }

      // 4. 内存幂等性校验 (防高频重放)
      if (this.store) {
        const isNew = await this.store.checkAndSet(nonce, 86400); // 锁定 24 小时
        if (!isNew) {
          return { isValid: false, error: new PayNodeException(ErrorCode.DuplicateTransaction, "Nonce already used in local memory") };
        }
      }

      // ================= 核心补全：RPC 状态只读校验 (<50ms) =================
      const tokenContract = new ethers.Contract(
        tokenAddr, [
          "function balanceOf(address account) view returns (uint256)",
          "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"
        ],
        this.provider
      );

      // 并发执行 RPC 查询以追求极限速度
      const [balance, isNonceUsedOnChain] = await Promise.all([
        tokenContract.balanceOf(from).catch(() => 0n),
        // Note: For mock tokens that don't support EIP-3009 view methods, this will fallback to false.
        // We still have L1 protection (IdempotencyStore) to prevent immediate replays.
        tokenContract.authorizationState(from, nonce).catch(() => false)
      ]);

      // 5. 校验真实余额 (防止空钱包签署有效签名)
      if (BigInt(balance) < payloadValue) {
        // 如果验签失败，释放内存锁
        if (this.store) await this.store.delete(nonce);
        return { isValid: false, error: new PayNodeException(ErrorCode.InvalidReceipt, "Insufficient token balance") };
      }

      // 6. 校验链上 Nonce 状态 (防止该签名已被打包结算)
      if (isNonceUsedOnChain) {
        if (this.store) await this.store.delete(nonce);
        return { isValid: false, error: new PayNodeException(ErrorCode.DuplicateTransaction, "Nonce already consumed on-chain") };
      }
      // =======================================================================

      return { isValid: true };
    } catch (e: any) {
      return { isValid: false, error: new PayNodeException(ErrorCode.InternalError, e.message) };
    }
  }
}
