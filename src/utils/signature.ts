import crypto from 'crypto';

export interface SignatureContext {
  signature: string;
  orderId: string;
  timestamp: string;
  sharedSecret: string;
  now?: number; // Optional: Override current time (for tests)
  driftWindow?: number; // Optional: Override default 5 min window
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
  const checkTime = context.now || Date.now();
  const driftWindow = context.driftWindow || 5 * 60 * 1000;
  
  // Accept both ISO string and milliseconds
  const tsMs = isNaN(tsDate.getTime()) ? parseInt(timestamp) : tsDate.getTime();
  
  if (isNaN(tsMs)) return false;

  const drift = Math.abs(checkTime - tsMs);
  if (drift > driftWindow) {
    if (driftWindow > 0) {
      console.warn(`[PayNode-SDK] Signature timestamp drift too high: ${drift}ms`);
      return false;
    }
  }

  const expectedSig = crypto
    .createHmac('sha256', sharedSecret)
    .update(`${orderId}:${timestamp}`)
    .digest('hex');

  // Use constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch (e) {
    return false;
  }
}
