import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '../errors';
import { PayNodeVerifier, PayNodeVerifierConfig } from '../utils/verifier';
import { IdempotencyStore } from '../utils/idempotency';
import { parseUnits } from 'ethers';
import { 
  BASE_RPC_URLS, 
  PAYNODE_ROUTER_ADDRESS, 
  BASE_USDC_ADDRESS 
} from '../constants';

export interface PayNodeMiddlewareOptions {
  merchantAddress: string;
  price: string;
  rpcUrls?: string | string[];
  chainId?: number;
  contractAddress?: string;
  tokenAddress?: string;
  currency?: string;
  decimals?: number;
  store?: IdempotencyStore;
  generateOrderId?: (req: Request | any) => string;
}

export const x402Gate = (options: PayNodeMiddlewareOptions) => {
  const rpcUrls = options.rpcUrls || BASE_RPC_URLS;
  const chainId = options.chainId || 8453;
  const contractAddress = options.contractAddress || PAYNODE_ROUTER_ADDRESS;
  const tokenAddress = options.tokenAddress || BASE_USDC_ADDRESS;
  const currency = options.currency || 'USDC';
  const decimals = options.decimals !== undefined ? options.decimals : 6;

  const verifier = new PayNodeVerifier({ 
    rpcUrls, 
    chainId,
    contractAddress,
    store: options.store
  });

  let rawAmount: bigint;
  try {
      rawAmount = parseUnits(options.price, decimals);
  } catch (e) {
      rawAmount = BigInt(Math.floor(parseFloat(options.price) * (10 ** decimals)));
  }

  const defaultOrderIdGen = (req: any) => `agent_js_${Date.now()}`;

  return async (req: any, res: any, next: NextFunction) => {
    // ... rest of the logic
    const getHeader = (name: string): string | null => {
        if (req.header && typeof req.header === 'function') return req.header(name);
        if (req.headers) return req.headers[name.toLowerCase()] || req.headers[name];
        return null;
    };

    const receiptHash = getHeader('x-paynode-receipt') || getHeader('X-PayNode-TxHash');
    let orderId = getHeader('x-paynode-order-id');

    if (!orderId) {
      orderId = (options.generateOrderId || defaultOrderIdGen)(req);
    }

    if (!receiptHash) {
      if (res.set) {
        res.set({
          'x-paynode-contract': contractAddress,
          'x-paynode-merchant': options.merchantAddress,
          'x-paynode-amount': rawAmount.toString(),
          'x-paynode-currency': currency,
          'x-paynode-token-address': tokenAddress,
          'x-paynode-chain-id': chainId.toString(),
          'x-paynode-order-id': orderId
        });
      }
      return res.status(402).json({ 
        error: "Payment Required",
        code: ErrorCode.MissingReceipt,
        message: "Please pay to PayNode contract and provide 'x-paynode-receipt' header.",
        amount: options.price,
        currency: currency
      });
    }
    
    // Phase 2: On-chain Verification
    const result = await verifier.verifyPayment(receiptHash, {
      merchantAddress: options.merchantAddress,
      tokenAddress: tokenAddress,
      amount: rawAmount,
      orderId: orderId
    });

    if (result.isValid) {
      // Expose to downstream handlers
      req.paynode = { receiptHash, orderId };
      return next();
    } else {
      return res.status(403).json({ 
        error: "Forbidden",
        code: result.error?.code || ErrorCode.InvalidReceipt,
        message: result.error?.message || "Invalid receipt"
      });
    }
  };
};

/** @deprecated Use x402Gate instead. */
export const x402_gate = x402Gate;
