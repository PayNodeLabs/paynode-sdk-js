import { UnifiedPaymentPayload } from '../types/x402';

export class X402PayloadHelper {
  /**
   * Normalizes a raw payment payload (usually from PAYMENT-SIGNATURE or X-402-Payload headers)
   * into the UnifiedPaymentPayload format used internally by PayNode.
   * 
   * Supports:
   * - standard X402 V2 format
   * - legacy PayNode internal format (base64 encoded JSON)
   * 
   * @param authHeader The base64 encoded payload header
   * @param fallbackOrderId Optional orderId to use if missing from payload
   * @returns UnifiedPaymentPayload
   */
  static normalize(authHeader: string, fallbackOrderId?: string): UnifiedPaymentPayload {
    try {
      const decoded = Buffer.from(authHeader, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);

      // 1. Handle Official X402 V2 Standard Format
      if (parsed.x402Version === 2 && parsed.accepted) {
        let inferredType: "onchain" | "eip3009" = "onchain";

        // Inference logic: signature/authorization presence implies EIP-3009 (USDC Permit/TransferWithAuth)
        if (parsed.payload?.signature || parsed.payload?.authorization) {
          inferredType = "eip3009";
        } else if (parsed.payload?.txHash) {
          inferredType = "onchain";
        }

        return {
          version: "2.3.0",
          type: parsed._paynode?.type || inferredType,
          orderId: parsed._paynode?.orderId || fallbackOrderId || "",
          router: parsed.accepted?.router || parsed.router,
          payload: parsed.payload
        };
      }

      // 2. Handle Legacy or already Unified Format
      if (typeof parsed.version === 'string' && (parsed.version.startsWith("2.2") || parsed.version.startsWith("2.3"))) {
        return {
          ...parsed,
          orderId: parsed.orderId || parsed.order_id || fallbackOrderId || ""
        } as UnifiedPaymentPayload;
      }

      // 3. Fallback for raw internal format
      return parsed as UnifiedPaymentPayload;
    } catch (e) {
      throw new Error(`Failed to normalize PayNode payload: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
