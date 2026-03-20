# PayNode Node.js/TypeScript SDK

PayNode SDK 为 Node.js 应用提供轻量级、无感集成的支付网关。基于 **x402 (Payment Required)** 协议，使您的 API 能够直接对 AI Agent 收取 USDC 微支付。

## 📦 安装

```bash
npm install @paynode/sdk
```

## 🚀 Express 集成示例

只需几行代码，即可为现有 API 路由开启支付门禁。

```typescript
import express from 'express';
import { x402_gate } from '@paynode/sdk';

const app = express();

// 为指定路由挂载 PayNode 支付网关
app.use('/api/premium-service', x402_gate({
  rpcUrl: "https://mainnet.base.org",
  contractAddress: "0x...",               // PayNodeRouter 部署地址
  merchantAddress: "0x...",               // 商家收款地址
  chainId: 8453,                          // Base Mainnet
  currency: "USDC",
  price: "0.01",                          // 单次调用价格 (USDC)
  tokenAddress: "0x8335..."               // USDC 代币合约地址
}));

app.get('/api/premium-service', (req, res) => {
  res.json({ data: "This content is paid and verified on-chain." });
});

app.listen(3000);
```

## 🏗️ 核心验证逻辑

PayNode SDK 核心职责是对 Agent 提供的 `x-paynode-receipt` (Transaction Hash) 进行链上状态校验：

1. **402 握手阶段:** 
   - 当请求头中缺失 `x-paynode-receipt` 时，SDK 自动返回 `402 Payment Required`。
   - 响应头中包含支付所需的全部元数据 (价格、收款地址、合约、ChainId、OrderId)。
2. **链上验证阶段:**
   - 接收到交易哈希后，SDK 通过 RPC 实时查询交易状态。
   - 解析 Event Log，比对 `orderId`、`merchant`、`token` 和 `amount` 是否完全一致。
   - **防重放 (Anti-Replay):** 建议结合本地缓存或数据库记录已核销的 Receipt。

## 🧪 开发与测试

```bash
# 进入 SDK 目录
cd packages/sdk-js

# 安装依赖
npm install

# 运行单元测试
npm test
```

## 🔗 资源

- **目录位置:** `packages/sdk-js`
- **主页:** [paynode.dev](https://paynode.dev)
- **协议文档:** `/agentpay-docs/`
