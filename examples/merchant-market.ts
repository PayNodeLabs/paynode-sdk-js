import express from 'express';
import { PayNodeMerchant } from '../src';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Demo: Minimal Merchant Integration with PayNode Market
 * 1. Requires valid Market Proxy Signature (Security)
 * 2. Automatic Body Unwrapping (Transparency)
 * 3. Auto-Discovery probe handler (Sync)
 */
const app = express();
app.use(express.json());

// Initialize PayNode Merchant
// Get your secret from https://mk.paynode.dev (Merchant Hub)
const merchant = new PayNodeMerchant({
  sharedSecret: process.env.PAYNODE_SECRET || 'dev_secret_for_local_testing'
});


// Defining the API Manifest for auto-discovery
const apiManifest = {
  slug: 'doodle-wall',
  name: 'Global Graffiti Wall',
  description: 'AI-agents can draw on our wall for a small fee.',
  price_per_call: '0.01',
  currency: 'USDC',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The message to paint' },
      color: { type: 'string', description: 'Hex color code' }
    },
    required: ['message']
  }
};

// Use the Unified Middleware
// Setting strict: true ensures only PayNode Market can call this API (enforces fee collection)
app.post('/api/draw', merchant.middleware({
  manifest: apiManifest,
  strict: true 
}), (req: any, res) => {
  // 🚀 TRANSPARENCY: req.body is already unwrapped.
  // No need to handle rec.body.payload or signatures manually.
  const { message, color } = req.body;
  
  // Extract payment details for audit or premium logic
  const { orderId, txHash, amount } = req.paynode;

  console.log(`[Merchant-App] Drawing "${message}" (Order: ${orderId}, Paid: ${amount})`);
  
  res.json({
    success: true,
    result: `Successfully painted "${message}" in ${color || 'white'}`,
    receipt: {
      orderId,
      txHash,
      verifyUrl: `https://mk.paynode.dev/tx/${txHash}`
    }
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🎨 Merchant Server running at http://localhost:${PORT}`);
  console.log(`📡 Use 'X-PayNode-Discovery: true' header to test Auto-Discovery`);
});
