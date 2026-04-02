# PayNode SDK JS — Compatibility Policy

This document describes canonical vs legacy (deprecated) behavior in `@paynodelabs/sdk-js` v2.3.0.

All new SDK ports (Python, Java, Go) MUST implement the canonical headers and fields below. Legacy support is optional and MAY be added separately for migration compatibility.

---

## Canonical Headers (x402 v2)

These headers define the main protocol. All SDKs MUST implement them:

| Header | Direction | Description |
|--------|-----------|-------------|
| `PAYMENT-REQUIRED` | Merchant → Agent | Base64-encoded JSON payment requirements |
| `PAYMENT-SIGNATURE` | Agent → Merchant | Base64-encoded JSON payment proof |
| `PAYMENT-RESPONSE` | Merchant → Agent | Base64-encoded JSON settlement confirmation |
| `X-402-Order-Id` | Both | Merchant-generated request identifier |

---

## Legacy Header Aliases (Deprecated)

These aliases are accepted/emitted by `sdk-js` for backward compatibility. New SDKs SHOULD NOT implement them unless explicitly supporting migration from paynode-js ≤ 2.2.x.

| Legacy Alias | Canonical Replacement | Notes |
|-------------|----------------------|-------|
| `X-402-Required` | `PAYMENT-REQUIRED` | Legacy challenge header, paynode-js ≤ 2.1 |
| `X-402-Payload` | `PAYMENT-SIGNATURE` | Legacy payment proof header, paynode-js ≤ 2.1 |
| `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` | Legacy settlement header, paynode-js ≤ 2.2 |

Deprecation window: these will remain supported through SDK v2.x. They may be removed in v3.0.

---

## Legacy Body Fields (Deprecated)

These fields exist in type definitions but MUST NOT be used by new implementations:

| Field | Location | Canonical Replacement | Notes |
|-------|----------|----------------------|-------|
| `orderId` | `PaymentRequirements` (challenge body) | `X-402-Order-Id` header | Request ID must be transmitted exclusively via header. Field retained only for paynode-js ≤ 2.2.x compatibility. |

---

## Legacy Payload Wrapper (Deprecated)

The legacy PayNode payload format (`version` as string, `order_id` snake_case) is still recognized internally:

```json
// Legacy (paynode-js ≤ 2.1) — do NOT emit this
{
  "version": "2.0.0",
  "order_id": "order-123",
  "type": "eip3009",
  "payload": { "signature": "0x...", "authorization": { ... } }
}
```

The canonical x402 v2 unified payload:

```json
// Canonical — use this
{
  "x402Version": 2,
  "accepted": { "type": "eip3009", ... },
  "payload": { "signature": "0x...", "authorization": { ... } },
  "_paynode": { "type": "eip3009", "orderId": "order-123" }
}
```

Legacy payloads are silently converted internally. New SDKs should never emit legacy format.

---

## Compatibility Behavior in sdk-js

| Behavior | Canonical? | Notes |
|----------|-----------|-------|
| Accept `X-402-Payload` as `PAYMENT-SIGNATURE` | No (legacy) | Line in `x402.ts` middleware |
| Emit `X-PAYMENT-RESPONSE` alongside `PAYMENT-RESPONSE` | No (legacy) | Success and error paths in `x402.ts` |
| Emit `X-402-Required` alongside `PAYMENT-REQUIRED` | No (legacy) | 402 challenge response in `x402.ts` |
| Accept snake_case `order_id` | No (legacy) | Internal unified payload parser |
| Accept `version` string instead of `x402Version` number | No (legacy) | Internal unified payload parser |
| Market Proxy HMAC constant-time comparison | Yes | `timingSafeEqual()` in `verifyMarketSignature` |

---

## Deprecation Timeline

| Version | Status |
|---------|--------|
| 2.3.0 (current) | Canonical + legacy support |
| 2.x (next) | Canonical primary, legacy warnings in console |
| 3.0 | Legacy aliases removed, canonical only |

---

## Migration Guide For Other SDKs

When porting to a new language:

1. Implement canonical wire format only (4 headers from section above).
2. Use canonical unified payload (x402Version as number, `_paynode` metadata field).
3. Do NOT emit legacy headers or legacy body fields.
4. Optionally add legacy ACCEPT support (input side only) if your SDK needs to talk to older paynode-js servers.
