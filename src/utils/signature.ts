import crypto from 'crypto';

export interface SignatureContext {
  signature: string;
  orderId: string;
  timestamp: string;
  sharedSecret: string;
}

/**
 * Verifies the HMAC-SHA256 signature from PayNode Market Proxy
 */
export function verifyMarketSignature(context: SignatureContext): boolean {
  const { signature, orderId, timestamp, sharedSecret } = context;

  if (!signature || !orderId || !timestamp || !sharedSecret) {
    return false;
  }

  // Check for timestamp drift (default 5 minutes to prevent replay)
  const tsDate = new Date(timestamp);
  const now = new Date();
  
  // Accept both ISO string and milliseconds
  const tsMs = isNaN(tsDate.getTime()) ? parseInt(timestamp) : tsDate.getTime();
  
  if (isNaN(tsMs)) return false;

  const drift = Math.abs(now.getTime() - tsMs);
  if (drift > 5 * 60 * 1000) {
    console.warn(`[PayNode-SDK] Signature timestamp drift too high: ${drift}ms`);
    return false;
  }

  const expectedSig = crypto
    .createHmac('sha256', sharedSecret)
    .update(`${orderId}${timestamp}`)
    .digest('hex');

  return signature === expectedSig;
}
