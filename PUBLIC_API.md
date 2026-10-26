# Public API — `@fabric/core` 0.1.x
Frozen **leaf import map** for downstream applications. Prefer these paths over the
`Fabric` facade (`require('@fabric/core')` / `types/fabric.js`), which remains for
experiments and demos.

**Release claim (0.1.0):** reference **NOISE P2P** with bounded gossip/discovery,
**Bitcoin-settled document market helpers**, and **local** `Program` / `Machine`
execution. Distributed Beacon / federation orchestration is Hub-composed and
**experimental**. This package is **not** a sandboxed remote contract VM —
`Machine.define` still binds host JavaScript; blinded-execution helpers are a
**composition scaffold** (digests + BIP340 decisions), not Yao GC/OT.

## Canonical imports

| Concern | Import | Notes |
|---------|--------|-------|
| Identity / keys | `@fabric/core/types/key` | BIP32/39 + Schnorr |
| Wire message | `@fabric/core/types/message` | JS protocol oracle |
| P2P node | `@fabric/core/types/peer` | TCP/NOISE; `Peer.Swarm` |
| Opcodes / constants | `@fabric/core/constants` | Shared with Hub |
| Document exchange | `@fabric/core/functions/cliDocumentExchange` | Headless + CLI packs |
| HTLC | `@fabric/core/types/htlc` | P2TR claim / refund HTLC (`Htlc`) |
| Spend policy | `@fabric/core/types/policy` | Contract failover ladder → P2TR, leaves, PSBTs (`Policy`) |
| Sealed delivery | `@fabric/core/functions/documentSealedExchange` | AES-GCM + content key (convergent by default, or random) |
| Sealed document | `@fabric/core/types/document` | Per-chunk sealed Tree (`Document.seal`, `fromRecord`) |
| Publish envelope | `@fabric/core/functions/publishedDocumentEnvelope` | DocumentPublish binding |
| Payment hash | `@fabric/core/functions/documentPaymentHash` | `contentHashHex` |
| Onion forward | `@fabric/core/functions/fabricOnion` | `P2P_FORWARD` wrap / decode; `Peer#sendOnion` |
| Gossip catalog | `@fabric/core/functions/gossipNetwork` | Public flood vs directed/session; `gossipRelayPeerSettings` (ambient stub `functions/gossipNetwork.d.ts`) |
| AMP parent | `@fabric/core/types/message` | `Message.ZERO_PARENT`, `normalizeParent`, `setMessageParent`, … for header `parent` (previous `Message.id` or genesis zeros) |
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

### Experimental (not frozen)

L1/L2 liquidity swap market, regtest-only prototype
([docs/LIQUIDITY_MARKET.md](docs/LIQUIDITY_MARKET.md)):
`@fabric/core/types/swap` (settlement state machine; statics for bodies, quotes,
escrow / invoice checks),
`@fabric/core/types/liquidityBook` (local order book). Paths and body
shapes may change in any 0.1.x release.

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

`Document.seal` is **convergent** by default: the same bytes seal to the same
chunks and root for every seller who uses no `convergenceSecret` (or the same
one), and `Peer#publishSealedDocument` lists such a document under its
`merkleRootHex` (a custom `documentId` is a local label). Different secrets
give different chunks and roots. Pass `{ private: true }` for random keys. Sellers may also sell convergent
chunks on credit (`creditRateSats`, `settings.sealedBlobCredit`), paid by a
channel balance transfer after the buyer opens the chunk (`Channel.Session#transfer`,
`ChannelBook#transfer` / `extendCredit`); buyers may sell a received tree again
with `Peer#seedDocument`. These market surfaces are experimental.

## TypeScript

`package.json` `"types"` points at `types/fabric.d.ts` (facade). Leaf modules ship
ambient stubs under `types/*.d.ts` and `functions/*.d.ts` for the canonical set
above; **runtime `.js` files remain authoritative**.

## Packaging

`package.json` `"files"` whitelists runtime + docs needed by consumers. Excluded
by design: `tests/`, `reports/`, coverage trees, `_book/`, local `stores/`, and
operator `settings/local.js` (use `settings/local.example.js`).

## Wire and runtime limits (`constants.js`)

| Constant | Value | Notes |
|----------|-------|-------|
| `HEADER_SIZE` | 208 bytes | AMP header |
| `MAX_MESSAGE_SIZE` | 32768 bytes | AMP body cap (32 KiB; was 3888 = `4096 − HEADER_SIZE` before 2026-10-14) |
| `MAX_FRAME_BYTES` | 32976 bytes | `HEADER_SIZE + MAX_MESSAGE_SIZE`; fits one Noise transport message (65535 − 16 MAC) |
| `MACHINE_MAX_MEMORY` | ≈3.8 MiB | `MAX_MEMORY_ALLOC × MACHINE_MEMORY_PAGE_SIZE` (3888, independent of the wire cap); allocated on first access by `Machine` |

Peers drop frames shorter than `HEADER_SIZE` or longer than `HEADER_SIZE +
MAX_MESSAGE_SIZE` before parse/crypto. Per-origin relay budgets (chat, gossip,
inventory) are peer settings — not global throughput caps. `Machine` enforces
`MACHINE_MAX_MEMORY` as a heap budget only — it does **not** provide VM
isolation or gas metering (see [PUBLIC_API](#out-of-scope-for-stable-api) /
AUDIT known gap #1).

## Deprecated facade aliases

Prefer direct `require('@fabric/core/types/…')` imports. The `Fabric` static
facade still exposes:

| Alias | Prefer |
|-------|--------|
| `Fabric.Scribe` | `State` |
| `Fabric.DistributedExecution` | `Machine` / `Program` / beacon + canonical-JSON helpers |
| `Reader` (`types/reader.js`) | Peer / Message ingest (not on `Fabric.*`) |

## Out of scope for “stable API”

- C / `fabric.node` (optional accel only)
- WebGPU / garbled-circuit research examples
- Hardened Program/Machine sandbox (host JS binds today)
- One-off root analysis Markdown ([docs/NON_CANONICAL.md](docs/NON_CANONICAL.md))
- Unlisted deep paths may move without a major bump during 0.1 RC — pin a git tag
