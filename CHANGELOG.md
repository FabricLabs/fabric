# `@fabric/core` Changelog
Recent changes to Fabric Core.

## 2026-03-21
Documentation and release hygiene: vision map, **FabricShell** naming, safer defaults for native code, and type/API cleanup aligned with **RC2** below.

- **Breaking:** Removed **`types/snapshot.js`** / **`types/stash.js`**; **`Service.App`** → **`FabricShell`** (**`CLI`** extends it); collection imports emit **`CollectionSnapshot`**. Regenerate **`API.md`**; downstream replaces **`App`** / **`Service.App`** with **`FabricShell`**.
- **Native:** **`fabric.node`** loads only when **`FABRIC_NATIVE_DOUBLE_SHA256=1`**; body double-SHA256 defaults to **@noble/hashes** (avoids bad-addon crashes on **`require()`**).
- **Docs:** **[VISION.md](VISION.md)**, **[docs/NON_CANONICAL.md](docs/NON_CANONICAL.md)**, **`docs/README` / `SUMMARY` / `DEVELOPERS`** updates; **`npm run make:docs`** clears stale **`docs/*.html`** via **`scripts/clean-jsdoc-html.js`**.
- **Security & ops:** Quieter NOISE / key handling (`types/peer.js`, `types/key.js`); **[PRIVACY.md](PRIVACY.md)**, **[AUDIT.md](AUDIT.md)**, **[SECURITY.md](SECURITY.md)** refresh.
- **Tooling:** **`package.json`** — **`exchange`** / **`fabric:start`** on **`scripts/fabric.js`**; **`ci`** = smoke + lint + tests; **`types/fabric.d.ts`** entry typings; misc description / **`review:todo`** fixes.

## 2026-03-20
Wire **v2** message format, gossip relay limits, production/audit tooling, and document publish flows—see **[docs/C-JS-PARITY.md](docs/C-JS-PARITY.md)** for C ↔ JS message hashing.

- **Protocol:** 208-byte header with **`preimage`** slot; body **`hash`** = double-SHA256 of body; signing uses BIP-340 **`Fabric/Message`** over header (zero sig) + body (version bump + frame size cap).
- **Security:** Safer NOISE / key logging (`types/peer.js`, `types/key.js`); **`P2P_PEER_GOSSIP`** dedup, TTL, and relay budgets (**`constants.js`**).
- **Docs & ops:** **[PRIVACY.md](PRIVACY.md)**, **[AUDIT.md](AUDIT.md)**, **[SECURITY.md](SECURITY.md)**; **[DEVELOPERS.md](DEVELOPERS.md)** / **[README.md](README.md)** / **[QUICKSTART.md](QUICKSTART.md)** and production checklist; **[types/fabric.d.ts](types/fabric.d.ts)** entry typings.
- **Tooling:** **`npm run report:quality`**, **`npm run ci`**, GitHub Actions; **`docs/PRODUCTION-CHECKLIST.md`**, **`docs/DOCUMENTATION-AUDIT.md`**, **`check:book-links`**; **`package.json`** description.
- **Payments:** **[functions/publishedDocumentEnvelope.js](functions/publishedDocumentEnvelope.js)** — **`DocumentPublish`** envelope + tests (**`tests/publishedDocumentEnvelope.core.js`**).
- **Known:** No critical **npm audit**; **honkit**-related highs/lows documented in **`reports/SECURITY-AUDIT.md`**.

---

## [0.1.0-RC1] — 2023-04-01
First pass at public playnet — initial release candidate for the `v0.1.0` tag.

**Notable**
- Fabric CLI — terminal interaction.
- Core types: Actor, Channel, Message, Peer, Service.

## 2022-01-25
Initial changelog file.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric/compare/master...v0.1.0-RC1
