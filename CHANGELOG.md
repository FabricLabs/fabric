# `@fabric/core` Changelog
Recent changes to Fabric Core.

## 2026-03-21
- **Operations / security docs:** [PRIVACY.md](PRIVACY.md) — consolidated completion, privacy, and security tracking; [AUDIT.md](AUDIT.md) and [SECURITY.md](SECURITY.md) refreshed; [docs/README.md](docs/README.md) index.
- **Security:** `types/peer.js` — NOISE debug logs no longer emit private keys; public-key diagnostics gated on `settings.debug`. `types/key.js` — `encrypt()` uses explicit `crypto.randomBytes(16)` for IVs.
- **Docs:** [DEVELOPERS.md](DEVELOPERS.md) — production & release, core types table; [README.md](README.md) — seed warning + doc table; [QUICKSTART.md](QUICKSTART.md) — links to PRODUCTION/DEVELOPERS.
- **Types:** [types/fabric.d.ts](types/fabric.d.ts) — minimal entry typings so `package.json` `"types"` resolves.
- **Tooling:** [package.json](package.json) — description clarified; `review:todo` disclosure email typo fixed.

## 2026-03-20
- **Release engineering:** Added **`npm run ci`**, [docs/PRODUCTION.md](docs/PRODUCTION.md) and GitHub Actions CI (install + `npm run ci`).
- **Payments / documents:** [`functions/publishedDocumentEnvelope.js`](functions/publishedDocumentEnvelope.js) — canonical `DocumentPublish` envelope, HTLC preimage, purchase `contentHash`; tests `tests/publishedDocumentEnvelope.core.js`.

## 2023-04-01
### `v0.1.0-RC1` pre-release
First pass at public playnet!  Initial release candidate for the `v0.1.0` tag.

Notable changes to **`@fabric/core`**; RC milestones are coordinated with **hub.fabric.pub** and **`@fabric/http`**.
**Notable Changes:**
- **New Feature:** Fabric CLI — interact with Fabric using your terminal!
- **New Classes:**
  - Actor
  - Channel
  - Message
  - Peer
  - Service

## 2022-01-25
Initial changelog file.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric/compare/master...v0.1.0-RC1
