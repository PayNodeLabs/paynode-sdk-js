import { ethers } from 'ethers';
import { PayNodeVerifier, ExpectedPayment } from '../src/utils/verifier';
import { ErrorCode } from '../src/errors';

// Standard mock for ethers v6 classes to avoid constructor failures
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getTransactionReceipt: jest.fn()
    })),
    Contract: jest.fn().mockImplementation(() => ({
      target: '0x1234567890123456789012345678901234567890',
      interface: {
        parseLog: jest.fn()
      }
    }))
  };
});

describe('PayNodeVerifier', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockChainId = 8453;
  let verifier: PayNodeVerifier;
  
  // These will be our "active" mocks that we inject
  let mockGetTransactionReceipt: jest.Mock;
  let mockParseLog: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetTransactionReceipt = jest.fn();
    mockParseLog = jest.fn();

    verifier = new PayNodeVerifier({
      rpcUrl: mockRpcUrl,
      payNodeContractAddress: mockContractAddress,
      expectedChainId: mockChainId
    });

    // Manual injection to ensure we are using the exact mock functions we control in the test
    (verifier as any).provider = {
      getTransactionReceipt: mockGetTransactionReceipt
    };
    (verifier as any).contract = {
      target: mockContractAddress,
      interface: {
        parseLog: mockParseLog
      }
    };
  });

  const validExpectedPayment: ExpectedPayment = {
    merchantAddress: '0xMerchantABC',
    tokenAddress: '0xTokenUSDC',
    amount: BigInt(1000000), // 1 USDC
    orderId: 'order_123'
  };

  it('should return error if receipt is not found', async () => {
    mockGetTransactionReceipt.mockResolvedValue(null);

    const result = await verifier.verifyPayment('0xFakeHash', validExpectedPayment);
    
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TRANSACTION_NOT_FOUND);
  });

  it('should return error if transaction reverted', async () => {
    mockGetTransactionReceipt.mockResolvedValue({ status: 0 }); // 0 = Reverted

    const result = await verifier.verifyPayment('0xFailedHash', validExpectedPayment);
    
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TRANSACTION_FAILED);
  });

  it('should return error if sent to wrong contract', async () => {
    mockGetTransactionReceipt.mockResolvedValue({ 
      status: 1,
      to: '0xWrongContractAddress'
    });

    const result = await verifier.verifyPayment('0xHash', validExpectedPayment);
    
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.WRONG_CONTRACT);
  });

  it('should reject payment if order ID does not match', async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      status: 1,
      to: mockContractAddress,
      logs: [{ topics: [], data: '0x' }]
    });

    mockParseLog.mockReturnValue({
      name: 'PaymentReceived',
      args: [
        ethers.id('different_order_id'), 
        validExpectedPayment.merchantAddress, 
        '0xPayer', 
        validExpectedPayment.tokenAddress, 
        validExpectedPayment.amount, 
        BigInt(0)
      ]
    });

    const result = await verifier.verifyPayment('0xHash', validExpectedPayment);
    
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ORDER_MISMATCH);
  });

  it('should reject payment if funds are insufficient', async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      status: 1,
      to: mockContractAddress,
      logs: [{ topics: [], data: '0x' }]
    });

    mockParseLog.mockReturnValue({
      name: 'PaymentReceived',
      args: [
        ethers.id(validExpectedPayment.orderId), 
        validExpectedPayment.merchantAddress, 
        '0xPayer', 
        validExpectedPayment.tokenAddress, 
        BigInt(500000), // Only paid 0.5 USDC instead of 1.0
        BigInt(0)
      ]
    });

    const result = await verifier.verifyPayment('0xHash', validExpectedPayment);
    
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
  });

  it('should accept payment with valid fields and block double spend', async () => {
    const txHash = '0xValidTxHash';
    mockGetTransactionReceipt.mockResolvedValue({
      status: 1,
      to: mockContractAddress,
      logs: [{ topics: [], data: '0x' }]
    });

    mockParseLog.mockReturnValue({
      name: 'PaymentReceived',
      args: [
        ethers.id(validExpectedPayment.orderId), 
        validExpectedPayment.merchantAddress, 
        '0xPayer', 
        validExpectedPayment.tokenAddress, 
        validExpectedPayment.amount, 
        BigInt(10000)
      ]
    });

    // First attempt should succeed
    const firstResult = await verifier.verifyPayment(txHash, validExpectedPayment);
    expect(firstResult.isValid).toBe(true);
    expect(firstResult.error).toBeUndefined();

    // Second attempt with the SAME txHash should fail (Idempotency)
    const secondResult = await verifier.verifyPayment(txHash, validExpectedPayment);
    expect(secondResult.isValid).toBe(false);
    expect(secondResult.error?.code).toBe(ErrorCode.RECEIPT_ALREADY_USED);
  });
});
