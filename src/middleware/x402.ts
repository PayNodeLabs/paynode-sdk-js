import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '../errors';
import { PayNodeVerifier, PayNodeVerifierConfig } from '../utils/verifier';
import { IdempotencyStore } from '../utils/idempotency';
import { parseUnits } from 'ethers';
import {
  BASE_RPC_URLS,
  PAYNODE_ROUTER_ADDRESS,
  BASE_USDC_ADDRESS,
  PROTOCOL_VERSION,
  SDK_VERSION
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

  const defaultOrderIdGen = (req: any) => `pn_sdk_${Date.now()}`;

  return async (req: Request | any, res: Response | any, next: NextFunction) => {
    // ... rest of the logic
    const getHeader = (name: string): string | null => {
      if (req.header && typeof req.header === 'function') return req.header(name);
      if (req.headers) return req.headers[name.toLowerCase()] || req.headers[name];
      return null;
    };

    const v2PayloadHeader = getHeader('PAYMENT-SIGNATURE') || getHeader('X-402-Payload'); // COMPAT: X-402-Payload is a legacy alias for PAYMENT-SIGNATURE
    let orderId = getHeader('X-402-Order-Id');

    if (!orderId) {
      orderId = (options.generateOrderId || defaultOrderIdGen)(req);
    }

    // Handle x402 v2 Unified Payload
    let unifiedPayload: UnifiedPaymentPayload | null = null;
    if (v2PayloadHeader) {
      try {
        const parsed = JSON.parse(Buffer.from(v2PayloadHeader, 'base64').toString());

        if (parsed.x402Version === 2 && parsed.accepted) {
          // Official X402 V2 format - convert to internal format
          const internalOrderId = parsed._paynode?.orderId
            || orderId
            || `auto_${Date.now()}`;

          let inferredType: "onchain" | "eip3009" = "onchain";
          if (parsed.payload?.signature || parsed.payload?.authorization) {
            inferredType = "eip3009";
          } else if (parsed.payload?.txHash) {
            inferredType = "onchain";
          }

          unifiedPayload = {
            x402Version: PROTOCOL_VERSION as any,
            type: parsed._paynode?.type || inferredType,
            orderId: internalOrderId,
            router: parsed.accepted?.router,
            payload: parsed.payload,
            _paynode: {
              sdkVersion: SDK_VERSION
            }
          };
          orderId = internalOrderId;
        } else if (typeof (parsed.version || parsed.x402Version) === 'string' || typeof parsed.version === 'string') {
          // Legacy PayNode format or old x402 V2 drafts
          unifiedPayload = {
            x402Version: PROTOCOL_VERSION as any,
            type: parsed.type || (parsed.payload?.txHash ? "onchain" : "eip3009"),
            orderId: parsed.orderId || parsed.order_id || orderId || `legacy_${Date.now()}`,
            payload: parsed.payload,
            _paynode: {
              sdkVersion: SDK_VERSION
            }
          };
          orderId = unifiedPayload.orderId;
        }
      } catch (e) {
        console.error("❌ [PayNode-Middleware] Failed to decode payment payload header:", e);
      }
    }

    if (unifiedPayload) {
      const result = await verifier.verify(
        unifiedPayload,
        {
          merchantAddress: options.merchantAddress,
          tokenAddress: tokenAddress,
          amount: rawAmount.toString(),
          orderId: orderId || undefined
        },
        unifiedPayload.type === 'eip3009' ? { name: currency, version: "2" } : {}
      );

      if (result.isValid) {
        // Construct settlement response header
        const settleResponse = {
          success: true,
          transaction: (unifiedPayload.payload as any).txHash || "",
          network: `eip155:${chainId}`,
          payer: result.payer || ""
        };
        const b64Response = Buffer.from(JSON.stringify(settleResponse)).toString('base64');

        if (res.set) {
          res.set('PAYMENT-RESPONSE', b64Response);
          res.set('X-PAYMENT-RESPONSE', b64Response); // COMPAT (legacy): deprecated alias for PAYMENT-RESPONSE
        }

        req.paynode = { unifiedPayload, orderId };
        return next();
      } else {
        const errorReason = result.error?.code || ErrorCode.InvalidReceipt;
        const settleResponse = {
          success: false,
          errorReason: errorReason,
          transaction: "",
          network: `eip155:${chainId}`
        };
        const b64Response = Buffer.from(JSON.stringify(settleResponse)).toString('base64');

        if (res.set) {
          res.set('PAYMENT-RESPONSE', b64Response);
          res.set('X-PAYMENT-RESPONSE', b64Response); // COMPAT (legacy): deprecated alias for PAYMENT-RESPONSE
        }

        return res.status(403).json({
          error: "Forbidden",
          code: errorReason,
          message: result.error?.message || "Invalid X402 payment payload"
        });
      }
    }

    // No valid payment found, return 402 with appropriate headers
    const v2Response: PaymentRequiredResponse = {
      x402Version: PROTOCOL_VERSION as any,
      error: "Payment Required by PayNode",
      resource: {
        url: req.protocol + '://' + req.get('host') + (req.originalUrl || req.url),
        description: options.description || "Protected Resource",
        mimeType: getHeader('accept') || "application/json"
      },
      orderId: orderId || undefined,
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
      res.set('PAYMENT-REQUIRED', b64Required);
      res.set('X-402-Required', b64Required); // COMPAT (legacy): deprecated alias for PAYMENT-REQUIRED
      res.set('X-402-Order-Id', orderId);
    }

    return res.status(402).json(v2Response);
  };
};
