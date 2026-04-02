import { x402Gate } from '../src/middleware/x402';
import { PROTOCOL_VERSION } from '../src/constants';

describe('x402Gate Middleware Unit Tests', () => {
    let req: any;
    let res: any;
    let next: jest.Mock;
    const options = {
        merchantAddress: '0xMerchant',
        price: '0.1',
        chainId: 8453,
    };

    beforeEach(() => {
        req = {
            protocol: 'http',
            get: jest.fn().mockReturnValue('localhost:3000'),
            header: jest.fn(),
            headers: {},
            url: '/test',
            originalUrl: '/test',
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
        };
        next = jest.fn();
    });

    test('✅ should return 402 with correct headers when no payment is present', async () => {
        const middleware = x402Gate(options);
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.set).toHaveBeenCalledWith('PAYMENT-REQUIRED', expect.any(String));
        expect(res.set).toHaveBeenCalledWith('X-402-Order-Id', expect.any(String));
        
        const jsonResponse = res.json.mock.calls[0][0];
        expect(jsonResponse.x402Version).toBe(PROTOCOL_VERSION);
        expect(jsonResponse.error).toBe('Payment Required by PayNode');
        expect(jsonResponse.orderId).toBeDefined();
        expect(jsonResponse.accepts).toHaveLength(2);
    });

    test('✅ should use custom order ID generator if provided', async () => {
        const customId = 'my-custom-order-123';
        const middleware = x402Gate({
            ...options,
            generateOrderId: () => customId
        });
        await middleware(req, res, next);

        expect(res.set).toHaveBeenCalledWith('X-402-Order-Id', customId);
        const jsonResponse = res.json.mock.calls[0][0];
        expect(jsonResponse.orderId).toBe(customId);
    });

    test('✅ should reuse order ID from request header if present', async () => {
        const existingOrderId = 'existing-order-456';
        req.header.mockImplementation((name: string) => {
            if (name === 'X-402-Order-Id') return existingOrderId;
            return null;
        });

        const middleware = x402Gate(options);
        await middleware(req, res, next);

        expect(res.set).toHaveBeenCalledWith('X-402-Order-Id', existingOrderId);
    });
});
