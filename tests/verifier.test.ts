import { PayNodeVerifier } from '../src/utils/verifier';
import { ErrorCode, PayNodeException } from '../src/errors';
import { MIN_PAYMENT_AMOUNT } from '../src/constants';
import { JsonRpcProvider } from 'ethers';

// Mock Ethers Provider for CI/CD
jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  return {
    ...original,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getTransactionReceipt: jest.fn(),
      getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    })),
  };
});

describe('PayNode Verifier Unit Tests', () => {
  let verifier: PayNodeVerifier;
  const mockRpc = "http://localhost:8545";
  const mockMerchant = "0x" + "1".repeat(40);
  const mockToken = "0x109AEddD656Ed2761d1e210E179329105039c784"; // USDC Sepolia
  const mockContractAddress = "0xB587Bc36aaCf65962eCd6Ba59e2DA76f2f575408";
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
    };

    const result = await verifier.verifyPayment("0xTxHash", expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.AmountTooLow);
  });

  test('✅ Should reject non-whitelisted tokens', async () => {
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: "0xFakeTokenAddress",
      amount: 2000n,
    };

    const result = await verifier.verifyPayment("0xTxHash", expected);
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
    };

    const result = await verifierWithStore.verifyPayment("0xDuplicateHash", expected);
    expect(result.isValid).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.DuplicateTransaction);
  });

  test('✅ Should correctly verify a valid PaymentReceived event', async () => {
    const txHash = "0xValidTxHash";
    const expected = {
      merchantAddress: mockMerchant,
      tokenAddress: mockToken,
      amount: 2000n,
    };

    // Create a mock receipt with the PaymentReceived event log using Interface
    const iface = new (require('ethers').Interface)([
      "event PaymentReceived(bytes32 indexed orderId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 fee, uint256 chainId)"
    ]);

    const log = iface.encodeEventLog("PaymentReceived", [
      "0x0000000000000000000000000000000000000000000000000000000000000000", // orderId
      mockMerchant,
      "0x1234567890123456789012345678901234567890", // payer
      mockToken,
      2000n, // amount
      0n,    // fee
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

    const result = await verifierForTest.verifyPayment(txHash, expected);
    if (!result.isValid) console.error("Validation Error:", result.error);
    expect(result.isValid).toBe(true);
  });
});
