# `@fabric/core` Changelog
Recent changes to Fabric Core.

## 2026-07-29
JS-canonical protocol for 0.1.0; Lightning-style wire preimage; unsigned document binding.

**Install / C**
- **npm install skips `fabric.node`** by default (`scripts/install-native.js`). Opt in with `FABRIC_BUILD_NATIVE=1` or `npm run build:c`. C sources remain in-tree; JS Message/Peer is the protocol oracle ([`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Wire preimage (Lightning-style)**
- Public frames keep **all-zero** `preimage`; body integrity is only header `hash` (double-SHA256). Explicit 32-byte secrets are for HTLC / Fabric Circuit hops (`payment_hash = SHA256(preimage)`). No longer default `preimage = SHA256(body)`.

**Document exchange**
- Payment binding hashes **unsigned** `documentPublishEnvelopeBuffer` only; `assertUnsignedDocumentPublishEnvelope` rejects signed gossip frames. Whitelist drops `created`/`edited` to stop Hub/Peer hash drift.

## 2026-07-24
CLI first-run setup, L1 document settle in core, ranked offers, multi-blob exchange, private paid relay.

**CLI**
- **Setup gate** — `fabric --help` / `--version` without a wallet; no auto-setup; bare `fabric` hints `fabric setup`. Quieter `contracts/setup.js` (seed + xpub/path; `FABRIC_DEBUG=1` for xprv).
- **Document exchange** — `/publish` + rate; `/inventory [peer] [btc]`; `/offers`; `/buy` / `/confirm`; `/request` with `maxSats`; `/pending` / `/approve` / `/deny`; `/relayfees`; `/send <doc> <peer>`.

**Peer / functions**
- Upstream Hub P2TR HTLC + content-key: `functions/inventoryHtlc.js`, `documentContentKey.js`, `documentOfferEscrow.js` (sign via `types/ecc`, no `ecpair`).
- `documentOfferBook`, `documentBlobManifest`, `documentRequestRelay`, `documentPurchaseSession`.
- `attachInventoryHtlc`, blob inventory rows, private `DOCUMENT_REQUEST` rewrite with fee skim.

**Hub**
- Thin re-exports of envelope / HTLC / content-key / escrow from `@fabric/core`.

**Simulator**
- Scenarios `document-swarm`, `document-relay-private`; adversarial document actions.
- `DocumentRequest` / inventory opcodes are relay-as-is (star/line forward no longer signer-mismatch drops); document-market pack slimmed to peer wiring (ranking/blobs/fees stay in unit tests); `run.js --all`.
- **`beacon-registry`** (gated `FABRIC_E2E_REGTEST=1`): managed regtest + `types/Beacon` seals document registry digests on `sidechain/STATE`; end-of-run **audit report** links each epoch to a real L1 block/coinbase txid (`reports/simulator-beacon-audit-latest.{json,md}`).

**Beacon / registry**
- `types/beacon.js` — L1 epoch chain (Hub `contracts/beacon.js` re-exports).
- `functions/documentRegistrySidechain.js` — typed-field `SIDECHAIN_STATE_PATCH` catalog apply; RFC6902 only at `@fabric/http` `messageBodyJsonBridge`.

**Docs**
- [`docs/L1_DOCUMENT_EXCHANGE.md`](docs/L1_DOCUMENT_EXCHANGE.md), BIP draft, payments binding.

## 2026-03-20
Pre-release focusing on wire parity, tooling, and release hygiene.

**Protocol / core**
- **Message wire v2** — 208-byte header: `preimage` (32 bytes) after `hash`, before `signature`; public messages use all-zero preimage (exposed as `null` in JS). `FABRIC_MESSAGE_VERSION` / `VERSION_NUMBER` bumped accordingly; max body size reduced to stay within 4096-byte frames.
- **Body hash** — `hash` field remains double-SHA256 of body only; signing covers full header (signature zeroed) + body with BIP-340 tag `Fabric/Message` (see [`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Security / privacy**
- **Peer logging** — NOISE handshake: **never** log local private key material; public-key diagnostics and inbound session notices only when `settings.debug` is true (see `types/peer.js`). `types/key.js` — `encrypt()` uses explicit `crypto.randomBytes(16)` for IVs.
- **`P2P_PEER_GOSSIP` / `P2P_PEERING_OFFER` opcodes** — First-class AMP types `0x61` / `0x62` (were string labels that silently encoded as `P2P_BASE_MESSAGE`). Registered in `types/message.js`; Peer handlers match wire string names.
- **`P2P_PEER_GOSSIP` relay** — Mitigates relay amplification: logical payload dedup, advisory `gossipHop` TTL (origin-set; hops forward bit-identical), per-origin relay budget, bounded wire-hash / payload caches (`constants.js` `GOSSIP_*`, `Peer` `settings.gossip`).
- **`P2P_PEERING_OFFER` relay** — Same mitigations for peering offers: logical payload dedup, `peeringHop` TTL, per-origin relay budget, bounded payload cache, FIFO-capped deduped candidate queue (`constants.js` `PEERING_OFFER_*`, `PEER_MAX_CANDIDATES_QUEUE`, `Peer` `settings.peering`).
- **Operations / security docs** — [PRIVACY.md](PRIVACY.md), [AUDIT.md](AUDIT.md), [SECURITY.md](SECURITY.md); [docs/README.md](docs/README.md) index.
- **Docs** — [DEVELOPERS.md](DEVELOPERS.md) production & release, core types table; [README.md](README.md) seed warning + doc table; [QUICKSTART.md](QUICKSTART.md) links to PRODUCTION/DEVELOPERS.
- **Types** — [types/fabric.d.ts](types/fabric.d.ts) minimal entry typings for `package.json` `"types"`.

**Tooling & docs**
- **Quality reports** — `npm run report:quality` writes [`reports/WARNINGS.md`](reports/WARNINGS.md), [`reports/DEPRECATIONS.md`](reports/DEPRECATIONS.md), [`reports/SECURITY-AUDIT.md`](reports/SECURITY-AUDIT.md) + `npm-audit.json` (see [`reports/README.md`](reports/README.md)).
- **Production checklist** — [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) aligned with CI gates and audit posture; [docs/PRODUCTION.md](docs/PRODUCTION.md); **`npm run ci`**; GitHub Actions (install + `npm run ci`).
- **CI** — Tests + coverage (`npm run report:coverage`) run right after `bitcoind` install, before Core Lightning setup, for faster failure feedback.
- **Handbook** — `SUMMARY.md` guide links, `check:book-links`, [`docs/DOCUMENTATION-AUDIT.md`](docs/DOCUMENTATION-AUDIT.md); README **Production** blurb points to the checklist.
- **Package** — `package.json` description clarified; `review:todo` disclosure email typo fixed.

**Payments / documents**
- [`functions/publishedDocumentEnvelope.js`](functions/publishedDocumentEnvelope.js) — canonical `DocumentPublish` envelope, HTLC preimage, purchase `contentHash`; tests `tests/publishedDocumentEnvelope.core.js`.

**Known / accepted**
- **npm audit** — No *critical* findings; remaining **high** / **low** issues are transitive under **honkit** (docs/book toolchain). Tracked in `reports/SECURITY-AUDIT.md`; clearing them likely requires `honkit` upgrades or `npm audit fix --force` (out of runtime dependency paths for `@fabric/core` consumers).

---

## 2023-04-01
First pass at public playnet — initial release candidate for the `v0.1.0` tag.

**Notable**
- Fabric CLI — terminal interaction.
- Core types: Actor, Channel, Message, Peer, Service.

## 2022-01-25
Initial changelog file.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric/compare/master...v0.1.0-RC1
