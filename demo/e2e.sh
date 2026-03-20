#!/bin/bash
export PAYNODE_CONTRACT=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
export TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
export MERCHANT_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

echo "--- [1] Starting Demo Server in background ---"
node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

echo "--- [2] Running AI Agent Client ---"
node client.js

echo "--- [3] Cleaning up ---"
kill $SERVER_PID
echo "Done."
