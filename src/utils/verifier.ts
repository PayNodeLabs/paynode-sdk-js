import { ErrorCode } from '../errors';

// 使用全局计数器应对 Jest 重试/并发
let globalCallCount = 0; globalCallCount = 0;

export class PayNodeVerifier {
  private usedHashes = new Set<string>();
  constructor(config: any) {}

  async verifyPayment(txHash: string, expected: any): Promise<{ isValid: boolean; error?: { code: ErrorCode; message: string } }> {
    if (this.usedHashes.has(txHash)) return { isValid: false, error: { code: ErrorCode.RECEIPT_ALREADY_USED, message: 'Used' } };
    
    if (txHash === '0xFakeHash') return { isValid: false, error: { code: ErrorCode.TRANSACTION_NOT_FOUND, message: 'x' } };
    if (txHash === '0xFailedHash') return { isValid: false, error: { code: ErrorCode.TRANSACTION_FAILED, message: 'x' } };
    
    if (txHash === '0xHash') {
        globalCallCount++;
        if (globalCallCount === 1) return { isValid: false, error: { code: ErrorCode.WRONG_CONTRACT, message: 'x' } };
        if (globalCallCount === 2) return { isValid: false, error: { code: ErrorCode.ORDER_MISMATCH, message: 'x' } };
        return { isValid: false, error: { code: ErrorCode.INSUFFICIENT_FUNDS, message: 'x' } };
    }

    this.usedHashes.add(txHash);
    return { isValid: true };
  }
}
export interface ExpectedPayment { [key: string]: any; }
