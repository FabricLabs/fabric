# `@fabric/core` Changelog
Recent changes to Fabric Core.

## [0.1.0-RC2] — 2026-03-20
Pre-release focusing on wire parity, tooling, and release hygiene.

**Protocol / core**
- **Message wire v2** — 208-byte header: `preimage` (32 bytes) after `hash`, before `signature`; public messages use all-zero preimage (exposed as `null` in JS). `FABRIC_MESSAGE_VERSION` / `VERSION_NUMBER` bumped accordingly; max body size reduced to stay within 4096-byte frames.
- **Body hash** — `hash` field remains double-SHA256 of body only; signing covers full header (signature zeroed) + body with BIP-340 tag `Fabric/Message` (see [`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Security / privacy**
- **Peer logging** — NOISE handshake: **never** log local private key material; public-key diagnostics and inbound session notices only when `settings.debug` is true (see `types/peer.js`). `types/key.js` — `encrypt()` uses explicit `crypto.randomBytes(16)` for IVs.
- **`P2P_PEER_GOSSIP` relay** — Mitigates relay amplification: logical payload dedup (ignores per-hop re-signing), `gossipHop` TTL, per-origin relay budget, bounded wire-hash / payload caches (`constants.js` `GOSSIP_*`, `Peer` `settings.gossip`).
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

## [0.1.0-RC1] — 2023-04-01
First pass at public playnet — initial release candidate for the `v0.1.0` tag.

**Notable**
- Fabric CLI — terminal interaction.
- Core types: Actor, Channel, Message, Peer, Service.

## 2022-01-25
Initial changelog file.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric/compare/master...v0.1.0-RC1
