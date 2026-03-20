export interface VerificationConfig {
    rpcUrl: string;
    payNodeContractAddress: string;
    expectedChainId: number;
}
export interface ExpectedPayment {
    merchantAddress: string;
    tokenAddress: string;
    amount: bigint;
    orderId: string;
}
export declare class PayNodeVerifier {
    private provider;
    private contract;
    private expectedChainId;
    private usedReceipts;
    constructor(config: VerificationConfig);
    /**
     * Verifies an on-chain transaction receipt for a specific payment.
     */
    verifyPayment(txHash: string, expected: ExpectedPayment): Promise<boolean>;
}
//# sourceMappingURL=verifier.d.ts.map