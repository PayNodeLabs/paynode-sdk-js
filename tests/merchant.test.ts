import { PayNodeMerchant } from '../src/merchant';
import * as signatureUtils from '../src/utils/signature';

jest.mock('../src/utils/signature');

describe('PayNodeMerchant Unit Tests', () => {
    let merchant: PayNodeMerchant;
    const sharedSecret = 'test-secret';
    const marketUrl = 'https://mk.test.dev';

    beforeEach(() => {
        jest.clearAllMocks();
        merchant = new PayNodeMerchant({ sharedSecret, marketUrl });
    });

    describe('middleware()', () => {
        let req: any;
        let res: any;
        let next: jest.Mock;

        beforeEach(() => {
            req = {
                header: jest.fn(),
                body: {},
                get: jest.fn(),
            };
            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
            };
            next = jest.fn();
        });

        test('❌ should reject requests without signature', async () => {
            const middleware = merchant.middleware();
            await middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'forbidden' }));
            expect(next).not.toHaveBeenCalled();
        });

        test('✅ should handle discovery probes', async () => {
            const manifest = { slug: 'test-api', price_per_call: '0.01' };
            const middleware = merchant.middleware({ manifest });

            req.header.mockImplementation((name: string) => {
                if (name === 'X-PayNode-Signature') return 'valid-sig';
                if (name === 'X-PayNode-Timestamp') return Date.now().toString();
                if (name === 'X-PayNode-Request-Id') return 'req-123';
                if (name === 'X-PayNode-Discovery') return 'true';
                return null;
            });

            (signatureUtils.verifyMarketSignature as jest.Mock).mockReturnValue(true);

            await middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: 'DISCOVERED',
                manifest: expect.objectContaining({ slug: 'test-api' })
            }));
        });

        test('✅ should unwrap body for valid proxy requests', async () => {
            const middleware = merchant.middleware({ strict: true });

            req.header.mockImplementation((name: string) => {
                if (name === 'X-PayNode-Signature') return 'valid-sig';
                if (name === 'X-PayNode-Timestamp') return Date.now().toString();
                if (name === 'X-PayNode-Request-Id') return 'req-123';
                if (name === 'X-PayNode-Transaction-Hash') return 'tx-hash-001';
                return null;
            });

            req.body = {
                payload: { city: 'Berlin' },
                tx_hash: 'tx-hash-001',
                amount: '1000'
            };

            (signatureUtils.verifyMarketSignature as jest.Mock).mockReturnValue(true);

            await middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(req.body).toEqual({ city: 'Berlin' });
            expect(req.paynode.txHash).toBe('tx-hash-001');
            expect(req.paynode.orderId).toBe('req-123');
        });

        test('❌ should reject invalid signatures', async () => {
            const middleware = merchant.middleware();

            req.header.mockImplementation((name: string) => {
                if (name === 'X-PayNode-Signature') return 'invalid-sig';
                if (name === 'X-PayNode-Timestamp') return Date.now().toString();
                if (name === 'X-PayNode-Request-Id') return 'req-123';
                return null;
            });

            (signatureUtils.verifyMarketSignature as jest.Mock).mockReturnValue(false);

            await middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('verify()', () => {
        test('✅ should manually verify requests', async () => {
            const req = {
                headers: {
                    'X-PayNode-Signature': 'valid-sig',
                    'X-PayNode-Timestamp': Date.now().toString(),
                    'X-PayNode-Request-Id': 'req-456'
                },
                body: {
                    payload: { foo: 'bar' },
                    tx_hash: 'tx-hash-manual'
                }
            };

            (signatureUtils.verifyMarketSignature as jest.Mock).mockReturnValue(true);

            const result = await merchant.verify(req);

            expect(result.isValid).toBe(true);
            expect(result.body).toEqual({ foo: 'bar' });
            expect(result.paynodeContext.txHash).toBe('tx-hash-manual');
        });
    });
});
