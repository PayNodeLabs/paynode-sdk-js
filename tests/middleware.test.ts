import { Request, Response } from 'express';
import { x402_gate, PayNodeOptions } from '../src/middleware/x402';
import { PayNodeVerifier } from '../src/utils/verifier';
import { ErrorCode } from '../src/errors';

// Mock PayNodeVerifier
jest.mock('../src/utils/verifier');

describe('x402_gate middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock = jest.fn();
  
  const options: PayNodeOptions = {
    rpcUrl: 'http://localhost:8545',
    payNodeContractAddress: '0xContract',
    merchantAddress: '0xMerchant',
    chainId: 8453,
    currency: 'USDC',
    tokenAddress: '0xUSDC',
    price: '1.0',
    decimals: 6
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = {
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
  });

  it('should return 402 if x-paynode-receipt is missing', async () => {
    const middleware = x402_gate(options);
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(402);
    expect(mockResponse.set).toHaveBeenCalledWith(expect.objectContaining({
      'x-paynode-contract': options.payNodeContractAddress,
      'x-paynode-amount': '1000000', // 1.0 * 10^6
      'x-paynode-currency': 'USDC'
    }));
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      code: ErrorCode.MISSING_RECEIPT
    }));
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should call next() if payment is valid', async () => {
    // Mock Verifier to return isValid: true
    (PayNodeVerifier.prototype.verifyPayment as jest.Mock).mockResolvedValue({ isValid: true });

    mockRequest.headers = {
      'x-paynode-receipt': '0xValidTx',
      'x-paynode-order-id': 'order_123'
    };

    const middleware = x402_gate(options);
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should return 403 if payment is invalid', async () => {
    // Mock Verifier to return isValid: false
    (PayNodeVerifier.prototype.verifyPayment as jest.Mock).mockResolvedValue({ 
      isValid: false, 
      error: { code: ErrorCode.INSUFFICIENT_FUNDS, message: 'Not enough' } 
    });

    mockRequest.headers = {
      'x-paynode-receipt': '0xInvalidTx',
      'x-paynode-order-id': 'order_123'
    };

    const middleware = x402_gate(options);
    await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      code: ErrorCode.INSUFFICIENT_FUNDS
    }));
    expect(nextFunction).not.toHaveBeenCalled();
  });
});
