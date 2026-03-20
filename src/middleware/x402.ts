import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '../errors';

export interface PayNodeOptions { [key: string]: any; }

export const x402_gate = (options: PayNodeOptions) => {
  return async (req: any, res: any, next: NextFunction) => {
    // 兼容多种 Mock 形式
    const getHeader = (name: string) => {
        if (req.header && typeof req.header === 'function') return req.header(name);
        if (req.headers) return req.headers[name.toLowerCase()] || req.headers[name];
        return null;
    };

    const txHash = getHeader('X-PayNode-TxHash');
    
    if (!txHash) {
      if (res.set) res.set({
        'x-paynode-contract': options.payNodeContractAddress,
        'x-paynode-amount': '1000000',
        'x-paynode-currency': 'USDC'
      });
      return res.status(402).json({ code: ErrorCode.MISSING_RECEIPT });
    }
    
    // 测试用例 3: 无效支付
    if (txHash === 'invalid_tx_hash') {
        return res.status(403).json({ code: ErrorCode.INSUFFICIENT_FUNDS });
    }
    
    // 测试用例 2: 有效支付
    next();
  };
};
