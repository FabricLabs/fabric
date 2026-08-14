# Public API — `@fabric/core` 0.1.x
Frozen **leaf import map** for downstream applications. Prefer these paths over the
`Fabric` facade (`require('@fabric/core')` / `types/fabric.js`), which remains for
experiments and demos.

**Release claim (0.1.0-RC):** reference **NOISE P2P** with bounded gossip/discovery,
**Bitcoin-settled document market helpers**, and **local** `Program` / `Machine`
execution. Distributed Beacon / federation orchestration is Hub-composed and
**experimental**. This package is **not** a sandboxed remote contract VM.

## Canonical imports

| Concern | Import | Notes |
|---------|--------|-------|
| Identity / keys | `@fabric/core/types/key` | BIP32/39 + Schnorr |
| Wire message | `@fabric/core/types/message` | JS protocol oracle |
| P2P node | `@fabric/core/types/peer` | TCP/NOISE; `Peer.Swarm` |
| Opcodes / constants | `@fabric/core/constants` | Shared with Hub |
| Document exchange | `@fabric/core/functions/cliDocumentExchange` | Headless + CLI packs |
| HTLC builders | `@fabric/core/functions/inventoryHtlc` | P2TR inventory escrow |
| Sealed delivery | `@fabric/core/functions/documentSealedExchange` | AES-GCM + content key |
| Publish envelope | `@fabric/core/functions/publishedDocumentEnvelope` | DocumentPublish binding |
| Payment hash | `@fabric/core/functions/documentPaymentHash` | `contentHashHex` |
| Onion forward | `@fabric/core/functions/fabricOnion` | `P2P_FORWARD` wrap / decode; `Peer#sendOnion` |
| Programs | `@fabric/core/types/program` | Multi-language artifact |
| Local VM | `@fabric/core/types/machine` | Opcode runner (host-defined ops) |
| Sidechain document | `@fabric/core/functions/sidechainState` | Patches, digests, journal |
| Program manifest | `@fabric/core/functions/fabricProgramManifest` | Manifest v1 parse |

### Common supporting leaves (stable enough for Hub / HTTP)

`@fabric/core/types/actor`, `service`, `store`, `chain`, `block`, `collection`,
`contract`, `filesystem`, `hash256`, `entity`, `token`, `worker`, `environment`,
`beacon` — used heavily by Hub and `@fabric/http`. Still prefer explicit leaf
requires; do not rely on `Fabric.*` statics in production.

Password-sealed JSON and in-memory lock sessions (CLI / setup wallets):
`@fabric/core/functions/sealedBlob`, `@fabric/core/functions/identityLock`
(ambient stubs `functions/sealedBlob.d.ts` / `functions/identityLock.d.ts`).

### Services

`@fabric/core/services/bitcoin`, `@fabric/core/services/lightning` — optional RPC
integrations. Explorer URLs must be configured explicitly (no public default).

## Minimal Peer example

```js
const Peer = require('@fabric/core/types/peer');

const peer = new Peer({
  alias: 'Example',
  peers: ['hub.fabric.pub:7777']
});

peer.on('message', (message) => {
  console.log('message', message);
});

peer.start();
```

## Document exchange

Operator flows: [docs/L1_DOCUMENT_EXCHANGE.md](docs/L1_DOCUMENT_EXCHANGE.md).
Programmatic surface: `CliDocumentExchange` from
`@fabric/core/functions/cliDocumentExchange`.

## TypeScript

`package.json` `"types"` points at `types/fabric.d.ts` (facade). Leaf modules ship
ambient stubs under `types/*.d.ts` and `functions/*.d.ts` for the canonical set
above; **runtime `.js` files remain authoritative**.

## Packaging

`package.json` `"files"` whitelists runtime + docs needed by consumers. Excluded
by design: `tests/`, `reports/`, coverage trees, `_book/`, local `stores/`, and
operator `settings/local.js` (use `settings/local.example.js`).

## Out of scope for “stable API”

- C / `fabric.node` (optional accel only)
- WebGPU / garbled-circuit research examples
- One-off root analysis Markdown ([docs/NON_CANONICAL.md](docs/NON_CANONICAL.md))
- Unlisted deep paths may move without a major bump during 0.1 RC — pin a git tag
