import { JsonRpcProvider, Contract, Interface, EventLog, Log } from 'ethers';
import * as crypto from 'crypto';
import { PAYNODE_ROUTER_ADDRESS } from '../constants';

/**
 * Configuration for the PayNode Webhook Notifier.
 */
export interface WebhookConfig {
  /** RPC URL to connect to the chain */
  rpcUrl: string;
  /** PayNode Router contract address to monitor (Defaults to Mainnet) */
  contractAddress?: string;
  /** The merchant's webhook endpoint URL */
  webhookUrl: string;
  /** Secret key for HMAC-SHA256 signature (header: X-402-Signature) */
  webhookSecret: string;
  /** Optional: chain ID for payload enrichment */
  chainId?: number;
  /** Polling interval in milliseconds (default: 5000ms) */
  pollIntervalMs?: number;
  /** Optional: custom headers to send with webhook POST */
  customHeaders?: Record<string, string>;
  /** Optional: callback when a webhook delivery fails */
  onError?: (error: Error, event: PaymentEvent) => void;
  /** Optional: callback when a webhook delivery succeeds */
  onSuccess?: (event: PaymentEvent) => void;
}

/**
 * Parsed PaymentReceived event data.
 */
export interface PaymentEvent {
  txHash: string;
  blockNumber: number;
  orderId: string;
  merchant: string;
  payer: string;
  token: string;
  amount: string;
  fee: string;
  chainId: string;
  timestamp: number;
}

const PAYNODE_ABI = [
  "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
];

/**
 * PayNodeWebhookNotifier — listens to on-chain PaymentReceived events
 * and delivers structured webhook POSTs to the merchant's endpoint.
 *
 * Features:
 * - HMAC-SHA256 signature for authenticity verification
 * - Configurable polling interval
 * - Automatic retry with exponential backoff (3 attempts)
 * - Error/Success callbacks
 *
 * @example
 * ```ts
 * const notifier = new PayNodeWebhookNotifier({
 *   rpcUrl: 'https://mainnet.base.org',
 *   contractAddress: '0x4A73696ccF76E7381b044cB95127B3784369Ed63',
 *   webhookUrl: 'https://myshop.com/api/paynode-webhook',
 *   webhookSecret: 'whsec_mysecretkey123',
 * });
 * notifier.start();
 * ```
 */
export class PayNodeWebhookNotifier {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private iface: Interface;
  private config: Required<Pick<WebhookConfig, 'webhookUrl' | 'webhookSecret' | 'contractAddress'>> & WebhookConfig;
  private pollInterval: number;
  private lastBlock: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;

  constructor(config: WebhookConfig) {
    if (!config.rpcUrl) throw new Error('rpcUrl is required');
    if (!config.webhookUrl) throw new Error('webhookUrl is required');
    if (!config.webhookSecret) throw new Error('webhookSecret is required');

    this.config = {
      ...config,
      contractAddress: config.contractAddress || PAYNODE_ROUTER_ADDRESS
    } as any;

    this.pollInterval = config.pollIntervalMs || 5000;
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
    this.iface = new Interface(PAYNODE_ABI);
    this.contract = new Contract(this.config.contractAddress, PAYNODE_ABI, this.provider);
  }

  /**
   * Start polling for new PaymentReceived events.
   * @param fromBlock Optional starting block number. Defaults to 'latest'.
   */
  async start(fromBlock?: number): Promise<void> {
    if (this.timer) {
      console.warn('[PayNode Webhook] Already running.');
      return;
    }

    this.lastBlock = fromBlock ?? (await this.provider.getBlockNumber());
    console.log(`🔔 [PayNode Webhook] Listening from block ${this.lastBlock} on ${this.config.contractAddress}`);

    this.timer = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('🔕 [PayNode Webhook] Stopped.');
    }
  }

  private async poll(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock <= this.lastBlock) {
        this.isProcessing = false;
        return;
      }

      const events = await this.contract.queryFilter(
        'PaymentReceived',
        this.lastBlock + 1,
        currentBlock
      );

      for (const event of events) {
        const paymentEvent = this.parseEvent(event as EventLog);
        if (paymentEvent) {
          await this.deliver(paymentEvent);
        }
      }

      this.lastBlock = currentBlock;
    } catch (error: any) {
      console.error(`❌ [PayNode Webhook] Poll error: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private parseEvent(event: EventLog): PaymentEvent | null {
    try {
      return {
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        orderId: event.args[0],       // bytes32 indexed orderId
        merchant: event.args[1],      // address indexed merchant
        payer: event.args[2],         // address indexed payer
        token: event.args[3],         // address token
        amount: event.args[4].toString(),  // uint256 amount
        fee: event.args[5].toString(),     // uint256 fee
        chainId: event.args[6].toString(), // uint256 chainId
        timestamp: Date.now()
      };
    } catch {
      return null;
    }
  }

  /**
   * Deliver a webhook POST with HMAC signature and retry logic.
   */
  private async deliver(event: PaymentEvent, attempt: number = 1): Promise<void> {
    const MAX_RETRIES = 3;
    const payload = JSON.stringify({
      event: 'payment.received',
      data: event
    });

    const signature = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-402-Signature': `sha256=${signature}`,
      'X-402-Event': 'payment.received',
      'X-402-Delivery-Id': `${event.txHash}-${attempt}`,
      ...(this.config.customHeaders || {})
    };

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: payload
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ [PayNode Webhook] Delivered tx ${event.txHash.slice(0, 10)}... → ${response.status}`);
      this.config.onSuccess?.(event);
    } catch (error: any) {
      console.error(`⚠️ [PayNode Webhook] Delivery failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);

      if (attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.deliver(event, attempt + 1);
      }

      console.error(`❌ [PayNode Webhook] Gave up on tx ${event.txHash} after ${MAX_RETRIES} attempts.`);
      this.config.onError?.(error, event);
    }
  }
}
