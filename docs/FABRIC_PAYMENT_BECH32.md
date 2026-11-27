# Fabric-routed payments (`fa1…`, bech32m)

Fabric uses a dedicated **bech32m** string (same family as BOLT12 **offer** strings and Taproot addresses, [BIP 350](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki)) so **Fabric-routed payment references** for **markets** do not collide with Lightning’s `ln…` encodings.

| Prefix | Meaning |
|--------|---------|
| **`fa1…`** | **F**abric **a**ddress / routed payment handle — **not** a Lightning invoice or BOLT12 offer. |

## Format (v0)

- **HRP:** `fa` (lowercase in canonical encoding).
- **Checksum:** bech32m (BIP 350).
- **Payload (34 bytes before 5-bit conversion):**
  - Byte `0`: format version (**0**).
  - Byte `1`: route type (**0** = 32-byte **document content hash**, aligned with [L1_DOCUMENT_EXCHANGE.md](L1_DOCUMENT_EXCHANGE.md) / `purchaseContentHashHex`).
  - Bytes `2..33`: 32-byte hash (typically SHA256 content hash).

## API

```js
const { encodeFabricRoutedPaymentV0, decodeFabricRoutedPayment, classifyPaymentEncodingString } =
  require('@fabric/core/functions/fabricPaymentBech32');
// or: require('@fabric/core/services/lightning').FabricPayment

const s = encodeFabricRoutedPaymentV0({ hash32: Buffer.alloc(32, 7) });
decodeFabricRoutedPayment(s);
classifyPaymentEncodingString(s); // 'fabric_routed_payment'
classifyPaymentEncodingString('lno1…'); // 'bolt12_offer' (delegates after `fa` check)
```

## UX

- Show **Fabric** branding for `fa1…` QR/copy; use Lightning flows only for `ln…` strings.
- Unified routing: **`classifyPaymentEncodingString`** picks `fabric_routed_payment` vs BOLT11/BOLT12 classes.

## Maintenance

Future route types (byte `1`) can add new semantics without changing the HRP; bump format version (byte `0`) for breaking layout changes.
