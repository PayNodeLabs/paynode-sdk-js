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
import { 
  PaymentRequiredResponse, 
  PaymentPayload, 
  ExactEVMPayload,
  UnifiedPaymentPayload
} from '../types/x402';

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
  description?: string;
  maxTimeoutSeconds?: number;
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
      // Robust fallback for non-standard number strings (avoiding floating point math)
      const parts = options.price.split('.');
      const integerPart = parts[0] || '0';
      let fractionPart = parts[1] || '0';
      fractionPart = fractionPart.slice(0, decimals).padEnd(decimals, '0');
      rawAmount = BigInt(integerPart + fractionPart);
  }

  const defaultOrderIdGen = (req: any) => `agent_js_${Date.now()}`;

  return async (req: Request | any, res: Response | any, next: NextFunction) => {
    // ... rest of the logic
    const getHeader = (name: string): string | null => {
        if (req.header && typeof req.header === 'function') return req.header(name);
        if (req.headers) return req.headers[name.toLowerCase()] || req.headers[name];
        return null;
    };

    const v2PayloadHeader = getHeader('X-402-Payload');
    let orderId = getHeader('X-402-Order-Id');

    if (!orderId) {
      orderId = (options.generateOrderId || defaultOrderIdGen)(req);
    }

    // Handle x402 v2 Unified Payload
    let unifiedPayload: UnifiedPaymentPayload | null = null;
    if (v2PayloadHeader) {
      try {
        unifiedPayload = JSON.parse(Buffer.from(v2PayloadHeader, 'base64').toString());
      } catch (e) {
        console.error("❌ [PayNode-Middleware] Failed to decode X-402-Payload header:", e);
      }
    }

    if (unifiedPayload) {
      const result = await verifier.verify(
        unifiedPayload,
        {
          merchantAddress: options.merchantAddress,
          tokenAddress: tokenAddress,
          amount: rawAmount.toString(),
          orderId: orderId
        },
        unifiedPayload.type === 'eip3009' ? { name: currency, version: "2" } : {}
      );

      if (result.isValid) {
        req.paynode = { unifiedPayload, orderId };
        return next();
      } else {
        return res.status(403).json({
          error: "Forbidden",
          code: result.error?.code || ErrorCode.InvalidReceipt,
          message: result.error?.message || "Invalid X402 payment payload"
        });
      }
    }

    // No valid payment found, return 402 with X-402-Required
    const v2Response: PaymentRequiredResponse = {
      x402Version: 2,
      error: "Payment Required by PayNode",
      resource: {
        url: req.protocol + '://' + req.get('host') + req.originalUrl,
        description: options.description || "Protected Resource",
        mimeType: req.header('accept') || "application/json"
      },
      accepts: [
        {
          scheme: "exact",
          type: "eip3009",
          network: `eip155:${chainId}`,
          amount: rawAmount.toString(),
          asset: tokenAddress,
          payTo: options.merchantAddress,
          maxTimeoutSeconds: options.maxTimeoutSeconds || 3600,
          extra: {
            name: currency,
            version: "2"
          }
        },
        {
          scheme: "exact",
          type: "onchain",
          network: `eip155:${chainId}`,
          amount: rawAmount.toString(),
          asset: tokenAddress,
          payTo: options.merchantAddress,
          maxTimeoutSeconds: options.maxTimeoutSeconds || 3600,
          router: contractAddress
        }
      ]
    };

    const b64Required = Buffer.from(JSON.stringify(v2Response)).toString('base64');

    if (res.set) {
      res.set('X-402-Required', b64Required);
      res.set('X-402-Order-Id', orderId);
    }

    return res.status(402).json(v2Response);
  };
};
