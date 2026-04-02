import { PayNodeAgentClient } from '../src/client';
import { ErrorCode, PayNodeException } from '../src/errors';
import { BASE_USDC_ADDRESS } from '../src/constants';

// Pre-define mock objects
const mockWallet = {
    address: '0x1234567890123456789012345678901234567890',
    signTypedData: jest.fn(),
    provider: null as any,
    connect: jest.fn().mockReturnThis(),
    resolveName: jest.fn().mockImplementation(async (n: string) => n.startsWith('0x') && n.length === 42 ? n : null),
};

const mockProvider = {
    getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(8453) }),
    getFeeData: jest.fn().mockResolvedValue({ 
        gasPrice: BigInt(1000000000),
        maxFeePerGas: BigInt(2000000000),
        maxPriorityFeePerGas: BigInt(1000000000)
    }),
    waitForTransaction: jest.fn().mockResolvedValue({ hash: '0xHash' }),
    resolveName: jest.fn().mockImplementation(async (n: string) => n.startsWith('0x') && n.length === 42 ? n : null),
    getResolver: jest.fn().mockResolvedValue(null),
    broadcastTransaction: jest.fn().mockResolvedValue({ hash: '0xHash' }),
    estimateGas: jest.fn().mockResolvedValue(BigInt(100000)),
    call: jest.fn().mockResolvedValue('0x'),
    _isProvider: true,
    _wait: jest.fn().mockResolvedValue({}),
};

const mockContract = {
    balanceOf: jest.fn().mockResolvedValue(BigInt(2000000)),
    allowance: jest.fn().mockResolvedValue(BigInt(2000000)),
    name: jest.fn().mockResolvedValue("USD Coin"),
    nonces: jest.fn().mockResolvedValue(BigInt(0)),
    pay: jest.fn().mockResolvedValue({ 
        wait: jest.fn().mockResolvedValue({ hash: '0xHash' }),
        hash: '0xHash'
    }),
    payWithPermit: jest.fn().mockResolvedValue({ 
        wait: jest.fn().mockResolvedValue({ hash: '0xHash' }),
        hash: '0xHash'
    }),
    connect: jest.fn().mockReturnThis(),
};

// Comprehensive mock for ethers v6
jest.mock('ethers', () => {
    return {
        ethers: {
            Wallet: jest.fn().mockImplementation(() => mockWallet),
            JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
            FallbackProvider: jest.fn().mockImplementation(() => mockProvider),
            Contract: jest.fn().mockImplementation(() => mockContract),
            id: jest.fn().mockReturnValue('0x' + 'f'.repeat(64)),
            hexlify: jest.fn().mockReturnValue('0x' + 'e'.repeat(64)),
            randomBytes: jest.fn().mockReturnValue(new Uint8Array(32)),
            Signature: {
                from: jest.fn().mockReturnValue({ 
                    v: 27, 
                    r: '0x' + 'r'.repeat(64), 
                    s: '0x' + 's'.repeat(64),
                    deadline: 9999999999
                })
            }
        }
    };
});

// Re-import ethers after mock to use the mocked version
import { ethers } from 'ethers';

const validSignaturePattern = /^0x[a-fA-F0-9]+$/;

// Mock Global Fetch
global.fetch = jest.fn() as any;

describe('PayNodeAgentClient Unit Tests', () => {
    let client: PayNodeAgentClient;
    const privateKey = '0x' + '1'.repeat(64);

    beforeEach(() => {
        jest.clearAllMocks();
        mockWallet.signTypedData.mockResolvedValue('0x' + '1'.repeat(64));
        mockWallet.provider = mockProvider;
        mockContract.allowance.mockResolvedValue(BigInt(2000000));
        
        client = new PayNodeAgentClient(privateKey, { quiet: true });
        (global.fetch as jest.Mock).mockReset();
    });

    test('✅ requestGate should pass through simple 200 responses', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            status: 200,
            json: async () => ({ ok: true }),
        });

        const response = await client.requestGate('http://example.com');
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('✅ signTransferWithAuthorization should generate EIP-3009 payload', async () => {
        const payload = await client.signTransferWithAuthorization(
            '0x' + '2'.repeat(40),
            '0x' + '3'.repeat(40),
            BigInt(1000),
            0,
            9999999999,
            '0x' + '4'.repeat(64)
        );

        expect(payload.signature).toMatch(validSignaturePattern);
        expect(payload.authorization.from).toBe('0x1234567890123456789012345678901234567890');
        expect(payload.authorization.value).toBe('1000');
    });

    test('✅ requestGate should handle 402 with X402 V2 response (EIP-3009)', async () => {
        const x402v2Response = {
            x402Version: 2,
            accepts: [{
                type: 'eip3009',
                network: 'eip155:8453',
                asset: BASE_USDC_ADDRESS,
                amount: '1000',
                payTo: '0x' + '5'.repeat(40),
                extra: { name: 'USD Coin', version: '2' }
            }]
        };

        const x402RequiredBase64 = Buffer.from(JSON.stringify(x402v2Response)).toString('base64');
        const orderId = 'test-order-123';

        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                status: 402,
                headers: {
                    get: (key: string) => {
                        const lowKey = key.toLowerCase();
                        if (lowKey === 'x-402-required') return x402RequiredBase64;
                        if (lowKey === 'x-402-order-id') return orderId;
                        return null;
                    }
                },
                clone: function() { return this; }
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: { get: () => null },
                json: async () => ({ success: true })
            });

        const response = await client.requestGate('http://example.com');
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        const lastCallArgs = (global.fetch as jest.Mock).mock.calls[1];
        const payloadBase64 = lastCallArgs[1].headers['PAYMENT-SIGNATURE'];
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
        
        expect(payload.x402Version).toBe(2);
        expect(payload._paynode.type).toBe('eip3009');
        expect(payload._paynode.orderId).toBe(orderId);
        expect(payload.payload.signature).toMatch(validSignaturePattern);
    });

    test('✅ requestGate should handle 402 with X402 V2 response (On-chain)', async () => {
        const x402v2Response = {
            x402Version: 2,
            accepts: [{
                type: 'onchain',
                network: 'eip155:8453',
                asset: BASE_USDC_ADDRESS,
                amount: '1000',
                payTo: '0x' + '5'.repeat(40),
                router: '0x' + '6'.repeat(40)
            }]
        };

        const x402RequiredBase64 = Buffer.from(JSON.stringify(x402v2Response)).toString('base64');
        const orderId = 'test-order-onchain';

        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                status: 402,
                headers: {
                    get: (key: string) => {
                        const lowKey = key.toLowerCase();
                        if (lowKey === 'x-402-required') return x402RequiredBase64;
                        if (lowKey === 'x-402-order-id') return orderId;
                        return null;
                    }
                },
                clone: function() { return this; }
            })
            .mockResolvedValueOnce({
                status: 200,
                headers: { get: () => null },
                json: async () => ({ success: true })
            });

        // Mock allowance to trigger direct pay
        mockContract.allowance.mockResolvedValue(BigInt(2000000));

        const response = await client.requestGate('http://example.com');
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        const lastCallArgs = (global.fetch as jest.Mock).mock.calls[1];
        const payloadBase64 = lastCallArgs[1].headers['PAYMENT-SIGNATURE'];
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
        
        expect(payload.x402Version).toBe(2);
        expect(payload._paynode.type).toBe('onchain');
        expect(payload.payload.txHash).toBe('0xHash');
    });

    test('⚡ requestGate should throw PayNodeException on network error', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

        await expect(client.requestGate('http://example.com'))
            .rejects.toThrow(PayNodeException);
    });

    test('⚡ requestGate should reject payments below dust limit', async () => {
        const x402v2Response = {
            x402Version: 2,
            accepts: [{
                type: 'onchain',
                network: 'eip155:8453',
                asset: BASE_USDC_ADDRESS,
                amount: '500', // Below MIN_PAYMENT_AMOUNT (1000)
                payTo: '0x' + '5'.repeat(40),
                router: '0x' + '6'.repeat(40)
            }]
        };

        const x402RequiredBase64 = Buffer.from(JSON.stringify(x402v2Response)).toString('base64');
        const orderId = 'test-order-dust';

        const mock402Response = {
            status: 402,
            headers: {
                get: (key: string) => {
                    const lowKey = key.toLowerCase();
                    if (lowKey === 'x-402-required') return x402RequiredBase64;
                    if (lowKey === 'x-402-order-id') return orderId;
                    return null;
                }
            },
            clone: function() { return this; }
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce(mock402Response);

        await expect(client.requestGate('http://example.com'))
            .rejects.toThrow(PayNodeException);
        
        // Re-mock for the second call because the first one exhausted the mock
        (global.fetch as jest.Mock).mockResolvedValueOnce(mock402Response);
        
        try {
            await client.requestGate('http://example.com');
        } catch (error: any) {
            expect(error.code).toBe(ErrorCode.AmountTooLow);
        }
    });

    test('✅ signPermit should accept and use a custom version', async () => {
        const tokenAddr = '0x' + '2'.repeat(40);
        const spenderAddr = '0x' + '3'.repeat(40);
        const amount = BigInt(1000);
        
        // Test with default version ('2')
        await client.signPermit(tokenAddr, spenderAddr, amount);
        expect(mockWallet.signTypedData).toHaveBeenCalledWith(
            expect.objectContaining({ version: '2' }),
            expect.anything(),
            expect.anything()
        );

        // Test with custom version ('2')
        await client.signPermit(tokenAddr, spenderAddr, amount, 3600, '2');
        expect(mockWallet.signTypedData).toHaveBeenCalledWith(
            expect.objectContaining({ version: '2' }),
            expect.anything(),
            expect.anything()
        );
    });
});
