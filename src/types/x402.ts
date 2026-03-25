export type X402Version = 2;

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirements {
  scheme: string;
  type?: "onchain" | "eip3009";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  router?: string;
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
  payload: Record<string, any>;
  extensions?: Record<string, any>;
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
  version: "3.1";
  type: "onchain" | "eip3009";
  orderId: string;
  payload: {
    txHash?: string;
    signature?: string;
    authorization?: any;
  } | ExactEVMPayload;
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
