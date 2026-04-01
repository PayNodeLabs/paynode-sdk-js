import { Request, Response, NextFunction } from 'express';
import { MerchantConfig, MerchantMiddlewareOptions } from './types';
import { verifyMarketSignature } from '../utils/signature';
import { PayNodeMiddlewareOptions } from '../middleware/x402';

/**
 * Unified PayNode Merchant Middleware
 * Handles: 
 * 1. Market Proxy (Strict HMAC Signature + Body Unwrapping)
 * 2. Discovery Probes (Auto-respond with API Manifest)
 * 3. Direct Agent Access (Optional X402 Fallback)
 */
export const createMerchantMiddleware = (config: MerchantConfig, options: MerchantMiddlewareOptions & PayNodeMiddlewareOptions) => {
  const { manifest, strict = true } = options;

  return async (req: Request | any, res: Response | any, next: NextFunction) => {
    // 1. Check for Market Proxy Headers
    const signature = req.header('X-PayNode-Signature');
    const timestamp = req.header('X-PayNode-Timestamp');
    const requestId = req.header('X-PayNode-Request-Id') || req.header('X-402-Order-Id');
    const isDiscovery = req.header('X-PayNode-Discovery') === 'true';

    if (signature && requestId && timestamp) {
      // ✅ Verify Signature from PayNode Market
      const isValid = verifyMarketSignature({
        signature,
        orderId: requestId,
        timestamp,
        sharedSecret: config.sharedSecret,
      });

      if (!isValid) {
        console.error(`[PayNode-SDK] Invalid Market Proxy Signature for request ${requestId}`);
        return res.status(401).json({ error: 'unauthorized', message: 'PayNode Market Signature verification failed.' });
      }

      // --- Scene A: Discovery Probe ---
      if (isDiscovery) {
        return res.status(200).json({
          status: 'DISCOVERED',
          version: '2.0.0',
          manifest: manifest || {},
          last_synced: new Date().toISOString()
        });
      }

      // --- Scene B: Proxy Flow - Body Unwrapping ---
      // The Market Proxy wraps original body in { payload: { ... } }
      if (req.body && req.body.payload && typeof req.body.payload === 'object') {
        const metadata = { ...req.body };
        delete metadata.payload;

        // Enrich request context with Proxy details
        req.paynode = {
          orderId: requestId,
          txHash: req.header('X-PayNode-Transaction-Hash') || req.body.tx_hash,
          amount: req.header('X-PayNode-Amount') || req.body.amount,
          network: req.header('X-PayNode-Network') || req.body.network,
          chainId: req.header('X-PayNode-Chain-Id') || req.body.chain_id?.toString(),
          proxyMetadata: metadata
        };

        // Transparently Unwrap Body
        req.body = req.body.payload;
      } else {
        // Direct call via Proxy (unlikely for POST, but possible for some flows)
        req.paynode = { orderId: requestId };
      }

      return next();
    }

    // 2. Scene C: Direct Agent Call (Rejected)
    // PayNodeMerchant component REQUIRES Market Proxy to ensure protocol consistency and fee collection.
    // Use x402Gate directly for standalone/direct 402 integration.
    return res.status(403).json({
      error: 'forbidden',
      message: 'PayNode Market Auth required. This API must be accessed via PayNode Market Proxy for verification.'
    });
  };
};

