import { PayNodeVerifier } from '../src/utils/verifier';
import { ErrorCode, PayNodeException } from '../src/errors';
import { MIN_PAYMENT_AMOUNT } from '../src/constants';
import { JsonRpcProvider, ethers, verifyTypedData } from 'ethers';

// Mock Ethers Provider for CI/CD
const mockProviderInstance = {
  getTransactionReceipt: jest.fn(),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
  // Add other methods that might be called on a provider if needed by other tests
  // e.g., getBlockNumber, call, etc.
};

const mockWalletInstance = {
  // Mock Wallet methods if needed
  getAddress: jest.fn().mockResolvedValue("0xMockWalletAddress"),
  signMessage: jest.fn().mockResolvedValue("0xMockSignature"),
  connect: jest.fn().mockReturnThis(),
};

const mockContractInstance = {
  // Mock Contract methods if needed
  interface: {
    encodeFunctionData: jest.fn(),
    decodeFunctionResult: jest.fn(),
  },
  balanceOf: jest.fn().mockResolvedValue(1000000n),
  authorizationState: jest.fn().mockResolvedValue(false),
};

jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  const mockVerifyTypedData = jest.fn();
  const mockContract = jest.fn().mockImplementation(() => mockContractInstance);
  const mockEthers = {
    ...original.ethers,
    verifyTypedData: mockVerifyTypedData,
    Contract: mockContract,
    Wallet: jest.fn().mockImplementation(() => mockWalletInstance),
    JsonRpcProvider: jest.fn().mockImplementation(() => mockProviderInstance),
    FallbackProvider: jest.fn().mockImplementation(() => ({
      ...mockProviderInstance,
      _wait: jest.fn().mockResolvedValue({}),
      providerConfigs: [],
    })),
  };
  return {
    ...original,
    ethers: mockEthers,
    verifyTypedData: mockVerifyTypedData,
    Contract: mockContract,
    Wallet: mockEthers.Wallet,
    JsonRpcProvider: mockEthers.JsonRpcProvider,
    FallbackProvider: mockEthers.FallbackProvider,
  };
});

describe('PayNode Verifier Unit Tests', () => {
  let verifier: PayNodeVerifier;
  const mockRpc = "http://localhost:8545";
  const mockMerchant = "0x" + "1".repeat(40);
  const mockToken = "0x65c088EfBDB0E03185Dbe8e258Ad0cf4Ab7946b0"; // USDC Sepolia
  const mockContractAddress = "0x24cD8b68aaC209217ff5a6ef1Bf55a59f2c8Ca6F";
  const validChainId = 84532;

  beforeEach(() => {
    verifier = new PayNodeVerifier({
      rpcUrls: mockRpc,
      chainId: validChainId,
      contractAddress: mockContractAddress,
    });
    jest.clearAllMocks();
  });

  test('✅ Should reject payments below minimum dust limit (1000)', async () => {
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: mockToken,
      amount: 500n, // Below MIN_PAYMENT_AMOUNT (1000)
      orderId: 'test-dust'
    };

    // Result should be failure because current implementation doesn't check amount yet or
    // we should update it to check. Since we are testing current state:
    // Actually, PayNodeVerifier.verify/verifyOnchainPayment doesn't seem to enforce MIN_PAYMENT_AMOUNT
    // but the Client should.
    // Let's see if Verifier should check it. For now, let's fix the method call.
    const result = await verifier.verifyOnchainPayment("0xTxHash", expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.AmountTooLow);
  });

  test('✅ Should reject non-whitelisted tokens', async () => {
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: "0xFakeTokenAddress",
      amount: 2000n,
      orderId: 'test-fake-token'
    };

    // The current implementation in verifier.ts doesn't seem to check acceptedTokens in verifyOnchainPayment.
    // It only checks it in the constructor (setting the private property).
    // Let's just fix the method call to prevent failure.
    const result = await verifier.verifyOnchainPayment("0xTxHash", expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.TokenNotAccepted);
  });

  test('✅ Should reject duplicate/already consumed transaction hashes', async () => {
    const mockStore = {
      checkAndSet: jest.fn().mockResolvedValue(false), // Duplicate
    };

    const verifierWithStore = new PayNodeVerifier({
      rpcUrls: mockRpc,
      chainId: validChainId,
      contractAddress: mockContractAddress,
      store: mockStore as any,
    });

    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: mockToken,
      amount: 2000n,
      orderId: 'test-duplicate'
    };

    // Correctly encode the log using the Interface from the source file
    // Match actual ABI in verifier.ts: (merchant, token, amount, orderId, chainId)
    const iface = new ethers.Interface([
      "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
    ]);
    const logData = iface.encodeEventLog("PaymentReceived", [
      ethers.id('test-duplicate'), // orderId
      mockMerchant,
      "0x" + "2".repeat(40), // payer
      mockToken,
      2000n, // amount
      20n, // fee (1%)
      84532n // chainId
    ]);

    const mockProvider = (verifierWithStore as any).provider;
    mockProvider.getTransactionReceipt.mockResolvedValue({
      status: 1,
      logs: [
        {
          address: mockContractAddress,
          topics: logData.topics,
          data: logData.data
        }
      ]
    });

    const result = await verifierWithStore.verifyOnchainPayment("0xDuplicateHash", expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.DuplicateTransaction);
  });

  test('✅ Should correctly verify a valid PaymentReceived event', async () => {
    const txHash = "0xValidTxHash";
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: mockToken,
      amount: 2000n,
      orderId: 'test-order-v2'
    };

    // Create a mock receipt with the PaymentReceived event log using Interface
    // Match actual ABI in verifier.ts: (merchant, token, amount, orderId, chainId)
    // Note orderId is index 3
    const iface = new ethers.Interface([
      "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
    ]);
    const log = iface.encodeEventLog("PaymentReceived", [
      ethers.id('test-order-v2'), // orderId
      mockMerchant,
      "0x" + "3".repeat(40), // payer
      mockToken,
      2000n, // amount
      20n, // fee
      84532n // chainId
    ]);

    const mockReceipt = {
      status: 1,
      logs: [
        {
          address: mockContractAddress,
          topics: log.topics,
          data: log.data
        }
      ]
    };
    // Ensure provider instance is captured by recreating verifier in this test
    const verifierForTest = new PayNodeVerifier({
      rpcUrls: mockRpc,
      chainId: validChainId,
      contractAddress: mockContractAddress,
    });

    const providerInstance = (JsonRpcProvider as any).mock.results[0].value;
    providerInstance.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const result = await verifierForTest.verifyOnchainPayment(txHash, expected);
    if (!result.isValid) console.error("Validation Error:", result.error);
    expect(result.isValid).toBe(true);
  });

  test('❌ Should return OrderMismatch if orderId does not match (Bug #3)', async () => {
    const txHash = "0xOrderMismatchHash";
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: mockToken,
      amount: 2000n,
      orderId: 'requested-order-id'
    };

    const iface = new ethers.Interface([
      "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
    ]);
    const log = iface.encodeEventLog("PaymentReceived", [
      ethers.id('wrong-order-id'), // Different orderId
      mockMerchant,
      "0x" + "4".repeat(40),
      mockToken,
      2000n,
      20n,
      84532n
    ]);

    const mockReceipt = {
      status: 1,
      logs: [
        {
          address: mockContractAddress,
          topics: log.topics,
          data: log.data
        }
      ]
    };

    const verifierForTest = new PayNodeVerifier({
      rpcUrls: mockRpc,
      chainId: validChainId,
      contractAddress: mockContractAddress,
    });

    const providerInstance = (JsonRpcProvider as any).mock.results[0].value;
    providerInstance.getTransactionReceipt.mockResolvedValue(mockReceipt);

    const result = await verifierForTest.verifyOnchainPayment(txHash, expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.OrderMismatch);
  });

  describe('EIP-3009 (verifyTransferWithAuthorization)', () => {
    const mockToken = "0x65c088EfBDB0E03185Dbe8e258Ad0cf4Ab7946b0"; // Use whitelisted token
    const mockFrom = "0x" + "b".repeat(40);
    const mockTo = "0x" + "c".repeat(40);
    const mockAmount = 2000n;
    const mockNonce = "0x" + "d".repeat(64);

    test('✅ Should correctly verify a valid EIP-3009 signature', async () => {
      const payload = {
        signature: "0x" + "1".repeat(130),
        authorization: {
          from: mockFrom,
          to: mockTo,
          value: mockAmount.toString(),
          validAfter: "0",
          validBefore: (Math.floor(Date.now() / 1000) + 3600).toString(),
          nonce: mockNonce
        }
      };

      // Mock verifyTypedData
      (verifyTypedData as jest.Mock).mockReturnValue(mockFrom);

      // Mock RPC state checks (balanceOf, authorizationState)
      mockContractInstance.balanceOf = jest.fn().mockResolvedValue(3000n);
      mockContractInstance.authorizationState = jest.fn().mockResolvedValue(false);

      const result = await verifier.verifyTransferWithAuthorization(mockToken, payload, {
        to: mockTo,
        value: mockAmount
      });

      expect(result.isValid).toBe(true);
    });

    test('❌ Should reject recipient mismatch', async () => {
      const payload = {
        signature: "0x" + "1".repeat(130),
        authorization: {
          from: mockFrom,
          to: "0xWrongRecipient",
          value: mockAmount.toString(),
          validAfter: "0",
          validBefore: "9999999999",
          nonce: mockNonce
        }
      };

      const result = await verifier.verifyTransferWithAuthorization(mockToken, payload, {
        to: mockTo,
        value: mockAmount
      });

      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe(ErrorCode.InvalidReceipt);
      expect(result.error?.message).toContain("Recipient mismatch");
    });

    test('❌ Should reject expired authorization', async () => {
      const payload = {
        signature: "0x" + "1".repeat(130),
        authorization: {
          from: mockFrom,
          to: mockTo,
          value: mockAmount.toString(),
          validAfter: "0",
          validBefore: (Math.floor(Date.now() / 1000) - 60).toString(), // Expired
          nonce: mockNonce
        }
      };

      const result = await verifier.verifyTransferWithAuthorization(mockToken, payload, {
        to: mockTo,
        value: mockAmount
      });

      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe(ErrorCode.InvalidReceipt);
      expect(result.error?.message).toContain("expired");
    });

    test('❌ Should reject insufficient balance (on-chain check)', async () => {
      const payload = {
        signature: "0x" + "1".repeat(130),
        authorization: {
          from: mockFrom,
          to: mockTo,
          value: mockAmount.toString(),
          validAfter: "0",
          validBefore: "9999999999",
          nonce: mockNonce
        }
      };

      (verifyTypedData as jest.Mock).mockReturnValue(mockFrom);
      mockContractInstance.balanceOf = jest.fn().mockResolvedValue(500n); // Too low
      mockContractInstance.authorizationState = jest.fn().mockResolvedValue(false);

      const result = await verifier.verifyTransferWithAuthorization(mockToken, payload, {
        to: mockTo,
        value: mockAmount
      });

      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe(ErrorCode.InvalidReceipt);
      expect(result.error?.message).toContain("balance");
    });
  });
});
