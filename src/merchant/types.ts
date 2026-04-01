import { PaymentRequirements, X402Version } from '../types/x402';

export interface MerchantConfig {
  sharedSecret: string;
  marketUrl?: string; // Default: https://mk.paynode.dev
}

export interface ApiManifest {
  slug: string;
  name: string;
  description: string;
  price_per_call: string;
  currency?: string;
  network?: 'mainnet' | 'testnet';
  input_schema?: Record<string, any>;
  sample_response?: Record<string, any>;
}

export interface PayNodeRequestContext {
  orderId: string;
  txHash?: string;
  payer?: string;
  amount?: string;
  network?: string;
  chainId?: string;
}

export interface MerchantMiddlewareOptions {
  manifest?: Partial<ApiManifest>;
  strict?: boolean; // If true, reject requests without valid market signature
}
