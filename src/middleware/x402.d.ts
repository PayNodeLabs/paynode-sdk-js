import { Request, Response, NextFunction } from 'express';
export interface PayNodeOptions {
    rpcUrl: string;
    payNodeContractAddress: string;
    merchantAddress: string;
    chainId: number;
    currency: string;
    tokenAddress: string;
    price: string;
    decimals: number;
    generateOrderId?: (req: Request) => string;
}
export declare const x402_gate: (options: PayNodeOptions) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=x402.d.ts.map