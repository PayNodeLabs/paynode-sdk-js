export type X402Version = 2;

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

/**
 * PaymentRequirements describes a single payment option returned
 * in the `accepts[]` array of a 402 challenge.
 *
 * NOTE: The `orderId` (legacy) is DEPRECATED. All SDKs MUST read
 * and write the request ID exclusively via the
 * `X-402-Order-Id` HTTP header. This field exists only for
 * backward compatibility with paynode-js <= 2.2.x and must
 * not be used by new implementations.
 *
 * Protocol: x402 v2
 * Canonical orderId transport: X-402-Order-Id header
 */
export interface PaymentRequirements {
  scheme: string;
  type?: "onchain" | "eip3009";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  router?: string;
  /** @deprecated Use X-402-Order-Id header exclusively. Legacy alias only. */
  orderId?: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, any>;
}

export interface Extension {
  info: Record<string, any>;
  schema: Record<string, any>;
}

export interface PaymentRequiredResponse {
  x402Version: X402Version;
  error?: string;
  orderId?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, Extension>;
}

export interface PaymentPayload {
  x402Version: X402Version;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: Record<string, any> | ExactEVMPayload | { txHash: string };
  extensions?: Record<string, any>;
  _paynode?: {
    sdkVersion: string;
    type: "onchain" | "eip3009";
    orderId: string;
  };
}

export interface ExactEVMPayload {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  extensions?: Record<string, any>;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface UnifiedPaymentPayload {
  x402Version: X402Version;
  type: "onchain" | "eip3009";
  orderId: string;
  router?: string;
  payload: {
    txHash?: string;
    signature?: string;
    authorization?: any;
  } | ExactEVMPayload;
  _paynode?: {
    sdkVersion: string;
  };
}

export interface SupportedKind {
  x402Version: X402Version;
  scheme: string;
  network: string;
  extra?: Record<string, any>;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}
