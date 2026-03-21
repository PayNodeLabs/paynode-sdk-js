import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '../errors';
import { PayNodeVerifier, PayNodeVerifierConfig } from '../utils/verifier';
import { IdempotencyStore } from '../utils/idempotency';
import { parseUnits } from 'ethers';

export interface PayNodeMiddlewareOptions {
  rpcUrls: string | string[];
  chainId: number;
  contractAddress: string;
  merchantAddress: string;
  tokenAddress: string;
  currency: string;
  price: string;
  decimals: number;
  store?: IdempotencyStore;
  generateOrderId?: (req: Request | any) => string;
}

export const x402_gate = (options: PayNodeMiddlewareOptions) => {
  const verifier = new PayNodeVerifier({ 
    rpcUrls: options.rpcUrls, 
    chainId: options.chainId,
    store: options.store
  });

  let rawAmount: bigint;
  try {
      rawAmount = parseUnits(options.price, options.decimals);
  } catch (e) {
      rawAmount = BigInt(Math.floor(parseFloat(options.price) * (10 ** options.decimals)));
  }

  const defaultOrderIdGen = (req: any) => `agent_js_${Date.now()}`;

  return async (req: any, res: any, next: NextFunction) => {
    // Compatibility with different mock/real environments
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
          'x-paynode-contract': options.contractAddress,
          'x-paynode-merchant': options.merchantAddress,
          'x-paynode-amount': rawAmount.toString(),
          'x-paynode-currency': options.currency,
          'x-paynode-token-address': options.tokenAddress,
          'x-paynode-chain-id': options.chainId.toString(),
          'x-paynode-order-id': orderId
        });
      }
      return res.status(402).json({ 
        error: "Payment Required",
        code: ErrorCode.MISSING_RECEIPT,
        message: "Please pay to PayNode contract and provide 'x-paynode-receipt' header.",
        amount: options.price,
        currency: options.currency
      });
    }
    
    // Phase 2: On-chain Verification
    const result = await verifier.verifyPayment(receiptHash, {
      merchantAddress: options.merchantAddress,
      tokenAddress: options.tokenAddress,
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
        code: result.error?.code || ErrorCode.INVALID_RECEIPT,
        message: result.error?.message || "Invalid receipt"
      });
    }
  };
};
