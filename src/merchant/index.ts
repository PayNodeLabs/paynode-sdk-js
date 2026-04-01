import { MerchantConfig, MerchantMiddlewareOptions, ApiManifest } from './types';
import { createMerchantMiddleware } from './middleware';
import { PayNodeMiddlewareOptions } from '../middleware/x402';
import { verifyMarketSignature } from '../utils/signature';

/**
 * PayNodeMerchant: The high-level SDK class for Merchant Integration.
 */
export class PayNodeMerchant {
  private config: MerchantConfig;

  constructor(config: MerchantConfig) {
    this.config = {
      marketUrl: 'https://mk.paynode.dev',
      ...config
    };
  }

  /**
   * Registers or syncs the API manifest with the PayNode Market.
   * This ensures the market shows the correct price and input schema.
   */
  async sync(manifest: ApiManifest): Promise<boolean> {
    console.log(`[PayNode-SDK] Syncing API manifest for ${manifest.slug} to ${this.config.marketUrl}`);

    try {
      const response = await fetch(`${this.config.marketUrl}/api/v1/merchant/apis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...manifest,
          gateway_url: manifest.slug
        })

      });

      const result = await response.json();
      if (response.ok && result.success) {
        console.log(`[PayNode-SDK] Successfully synced ${manifest.slug}. Status: ${result.api_id}`);
        return true;
      } else {
        console.warn(`[PayNode-SDK] Sync failed for ${manifest.slug}: ${result.error || response.statusText}`);
        return false;
      }
    } catch (err: any) {
      console.error(`[PayNode-SDK] Network error during sync for ${manifest.slug}:`, err.message);
      return false;
    }
  }

  /**
   * Returns a unified middleware that handles:
   * 1. Market Proxy (Strict Signature Check + Body Unwrap)
   * 2. Auto-Discovery (Market Sync Probe)
   * 3. (Optional) Direct X402 payment
   */
  middleware(options: MerchantMiddlewareOptions & Partial<PayNodeMiddlewareOptions> = {}) {
    return createMerchantMiddleware(this.config, {
      price: options.manifest?.price_per_call || '0.01',
      ...options
    } as any);
  }

  /**
   * Manual verification for Next.js or other non-Express environments.
   * Extracts headers and verifies signature. Returns the unwrapped body and context.
   */
  async verify(req: any) {
    const getHeader = (name: string) => {
      if (typeof req.getHeader === 'function') return (req as any).getHeader(name);
      if (typeof req.get === 'function') return (req as any).get(name);
      if (req.headers?.get && typeof req.headers.get === 'function') return req.headers.get(name);
      if (req.headers) return req.headers[name.toLowerCase()] || req.headers[name];
      return null;
    };

    const signature = getHeader('X-PayNode-Signature');
    const timestamp = getHeader('X-PayNode-Timestamp');
    const requestId = getHeader('X-PayNode-Request-Id') || getHeader('X-402-Order-Id');

    const isValid = verifyMarketSignature({
      signature,
      orderId: requestId,
      timestamp,
      sharedSecret: this.config.sharedSecret,
    });

    if (!isValid) {
      return { isValid: false, error: 'Invalid PayNode Market Signature' };
    }

    // Handle Body Unwrap if it's a JSON body
    let body: any = {};
    try {
      if (typeof req.json === 'function') {
        body = await req.json();
      } else {
        body = req.body;
      }
    } catch (e) { }

    let paynodeContext: any = { orderId: requestId };

    if (body && body.payload && typeof body.payload === 'object') {
      paynodeContext = {
        ...paynodeContext,
        txHash: getHeader('X-PayNode-Transaction-Hash') || body.tx_hash,
        amount: getHeader('X-PayNode-Amount') || body.amount,
        network: getHeader('X-PayNode-Network') || body.network,
        chainId: getHeader('X-PayNode-Chain-Id') || body.chain_id?.toString(),
      };
      body = body.payload;
    }

    return { isValid: true, body, paynodeContext };
  }
}

