import { ethers, verifyTypedData, JsonRpcProvider } from 'ethers';
import { verifyMarketSignature } from '../src/utils/signature';
import { PayNodeVerifier } from '../src/utils/verifier';
import { X402PayloadHelper } from '../src/utils/payload';
import * as fs from 'fs';
import * as path from 'path';

// Mock Ethers for Verifier fixture tests
const mockContractInstance = {
  balanceOf: jest.fn(),
  authorizationState: jest.fn(),
};

jest.mock('ethers', () => {
  const original = jest.requireActual('ethers');
  
  const mockContractImplementation = jest.fn().mockImplementation(() => ({
    balanceOf: (...args: any[]) => mockContractInstance.balanceOf(...args),
    authorizationState: (...args: any[]) => mockContractInstance.authorizationState(...args),
  }));

  const mockJsonRpcProvider = jest.fn().mockImplementation(() => ({
    getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }),
    getTransactionReceipt: jest.fn(),
  }));

  return {
    ...original,
    verifyTypedData: jest.fn().mockImplementation((...args: any[]) => (original.verifyTypedData || original.utils?.verifyTypedData)(...args)),
    Contract: mockContractImplementation,
    JsonRpcProvider: mockJsonRpcProvider,
    ethers: {
      ...original.ethers,
      Contract: mockContractImplementation,
      JsonRpcProvider: mockJsonRpcProvider,
    }
  };
});

const META_FIXTURES_PATH = process.env.PAYNODE_META_PATH || path.resolve(__dirname, '../../..', 'meta/fixtures');

describe('PayNode v2 Protocol Fixture Conformance', () => {
  beforeAll(() => {
    if (!fs.existsSync(META_FIXTURES_PATH)) {
      throw new Error(`Fixture path not found: ${META_FIXTURES_PATH}. Ensure you are running from within the workspace or set PAYNODE_META_PATH.`);
    }
  });

  describe('Cryptographic Golden Vectors', () => {
    test('OrderId Hashing (keccak256(utf8(orderId)))', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'crypto/order_id_hash.json'), 'utf8'));
      const calculatedHash = ethers.id(fixture.orderId);
      expect(calculatedHash).toBe(fixture.hash);
    });

    test('Market Proxy HMAC-SHA256', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'crypto/market_proxy_hmac.json'), 'utf8'));
      const isValid = verifyMarketSignature({
        signature: fixture.signature,
        orderId: fixture.requestId,
        timestamp: fixture.timestamp,
        sharedSecret: fixture.sharedSecret,
        now: parseInt(fixture.timestamp)
      });
      expect(isValid).toBe(true);
    });

    test('EIP-3009 TransferWithAuthorization Signature Recovery', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'crypto/eip3009_transfer_with_authorization.json'), 'utf8'));
      const recovered = ethers.verifyTypedData(fixture.domain, fixture.types, fixture.message, fixture.signature);
      expect(recovered.toLowerCase()).toBe(fixture.signer.toLowerCase());
    });

    test('EIP-2612 Permit Signature Recovery', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'crypto/eip2612_permit.json'), 'utf8'));
      const recovered = ethers.verifyTypedData(fixture.domain, fixture.types, fixture.message, fixture.signature);
      expect(recovered.toLowerCase()).toBe(fixture.signer.toLowerCase());
    });
  });

  describe('Wire Format Samples (JSON Shape)', () => {
    test('402 Payment Required Response Shape (Base)', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'wire/base/payment_required.json'), 'utf8'));
      expect(fixture.x402Version).toBe(2);
      expect(fixture.accepts).toBeInstanceOf(Array);
      expect(fixture._paynode).toBeUndefined();
    });

    test('Payment Signature Envelope (PayNode Extension)', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'wire/extensions/paynode/payment_signature_onchain.json'), 'utf8'));
      expect(fixture.x402Version).toBe(2);
      expect(fixture._paynode).toBeDefined();
      expect(fixture._paynode.orderId).toBeDefined();
    });
  });

  describe('Verification Logic Exhaustive Tests', () => {
    describe('Direct x402 Verifier Cases', () => {
      const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'verification/direct_x402_cases.json'), 'utf8'));
      
      fixture.cases.forEach((c: any) => {
        test(`${c.id}: ${c.kind || ''}`, async () => {
          // Adjust Mock Date.now for each test case if specified in fixture
          const testNow = c.input.timestamp ? parseInt(c.input.timestamp) * 1000 : 1710001800 * 1000;
          const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => testNow);

          try {
            const verifier = new PayNodeVerifier({
              rpcUrls: ["http://mock-rpc"],
              chainId: c.config.chainId,
              contractAddress: "0xRouter",
              // If it's a wrong_token test, we should NOT whitelist the input token
              acceptedTokens: c.id === 'wrong_token' ? [c.config.tokenAddress] : [c.config.tokenAddress, c.input.tokenAddress].filter(Boolean)
            });

            // Mocking for EIP-3009
            if (c.kind === 'eip3009') {
                (verifyTypedData as jest.Mock).mockReturnValue(c.expected?.expectedSigner || "0x0");
                mockContractInstance.balanceOf.mockResolvedValue(BigInt(c.input.payload.authorization.value));
                mockContractInstance.authorizationState.mockResolvedValue(false);
            }

            const result = await verifier.verify(
              {
                x402Version: 2,
                type: c.kind as any,
                orderId: c.input.orderId || "test-order",
                payload: c.input.payload
              },
              {
                merchantAddress: c.config.merchantAddress,
                tokenAddress: c.id === 'wrong_token' ? (c.input.tokenAddress || c.config.tokenAddress) : c.config.tokenAddress,
                amount: c.config.amount
              },
              // Align with fixtures (USDC v2)
              { name: "USDC", version: "2" }
            );

            if (c.expectedResult === 'pass') {
              if (!result.isValid) {
                  const balanceVal = await mockContractInstance.balanceOf();
                  console.error(`❌ Case ${c.id} failed:`, result.error?.message, "Code:", result.error?.code, "MockBalance:", balanceVal.toString());
              }
              expect(result.isValid).toBe(true);
            } else {
              expect(result.isValid).toBe(false);
              if (c.expectedErrorCode) {
                expect(result.error?.code).toBe(c.expectedErrorCode);
              }
            }
          } finally {
            dateNowSpy.mockRestore();
          }
        });
      });
    });

    describe('Market Proxy signature cases', () => {
        const fixture = JSON.parse(fs.readFileSync(path.join(META_FIXTURES_PATH, 'verification/market_proxy_cases.json'), 'utf8'));
        
        fixture.cases.forEach((c: any) => {
            test(c.id, () => {
                // Ensure no Date.now pollution
                const isValid = verifyMarketSignature({
                    signature: c.input.signature,
                    orderId: c.input.requestId,
                    timestamp: c.input.timestamp,
                    sharedSecret: c.config.sharedSecret,
                    now: c.input.now,
                    driftWindow: 999999999 // Disable drift check for static fixtures
                });

                if (c.expectedResult === 'pass') {
                    expect(isValid).toBe(true);
                } else {
                    expect(isValid).toBe(false);
                }
            });
        });
    });
  });
  
  describe('Compatibility Logic (Legacy Formats)', () => {
    const fixturePath = path.join(META_FIXTURES_PATH, 'compatibility/legacy_formats.json');
    if (fs.existsSync(fixturePath)) {
      const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      fixtures.forEach((f: any) => {
        // Only test cases that have input/normalized fields (normalization tests)
        if (f.input && f.normalized) {
          test(`Normalize ${f.id}: ${f.description}`, () => {
            const encoded = Buffer.from(JSON.stringify(f.input)).toString('base64');
            const normalized = X402PayloadHelper.normalize(encoded);
            
            expect(normalized.x402Version).toBe(f.normalized.x402Version);
            expect(normalized.orderId).toBe(f.normalized.orderId);
            expect(normalized.type).toBe(f.normalized.type);
            
            if (f.normalized._paynode) {
              expect(normalized._paynode?.sdkVersion).toBeDefined();
            }
          });
        }
      });
    }
  });
});
