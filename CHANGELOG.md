# `@fabric/core` Changelog
Recent changes to Fabric Core.

## [0.1.0-RC2] — 2026-03-20
Pre-release focusing on wire parity, tooling, and release hygiene.

**Protocol / core**
- **Message wire v2** — 208-byte header: `preimage` (32 bytes) after `hash`, before `signature`; public messages use all-zero preimage (exposed as `null` in JS). `FABRIC_MESSAGE_VERSION` / `VERSION_NUMBER` bumped accordingly; max body size reduced to stay within 4096-byte frames.
- **Body hash** — `hash` field remains double-SHA256 of body only; signing covers full header (signature zeroed) + body with BIP-340 tag `Fabric/Message` (see [`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Security / privacy**
- **Peer logging** — NOISE handshake material (local private key, derived NOISE key) and encrypt/decrypt `debug` lines are emitted only when `settings.debug` is true, so default listeners do not see long-lived secrets on the `debug` channel.

**Tooling & docs**
- **Quality reports** — `npm run report:quality` writes [`reports/WARNINGS.md`](reports/WARNINGS.md), [`reports/DEPRECATIONS.md`](reports/DEPRECATIONS.md), [`reports/SECURITY-AUDIT.md`](reports/SECURITY-AUDIT.md) + `npm-audit.json` (see [`reports/README.md`](reports/README.md)).
- **Production checklist** — [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) aligned with CI gates and audit posture.
- **CI** — Tests + coverage (`npm run report:coverage`) run right after `bitcoind` install, before Core Lightning setup, for faster failure feedback.
- **Handbook** — `SUMMARY.md` guide links, `check:book-links`, [`docs/DOCUMENTATION-AUDIT.md`](docs/DOCUMENTATION-AUDIT.md); README **Production** blurb points to the checklist.

**Known / accepted**
- **npm audit** — No *critical* findings; remaining **high** / **low** issues are transitive under **honkit** (docs/book toolchain). Tracked in `reports/SECURITY-AUDIT.md`; clearing them likely requires `honkit` upgrades or `npm audit fix --force` (out of runtime dependency paths for `@fabric/core` consumers).

---

## [0.1.0-RC1] — 2023-04-01
First pass at public playnet — initial release candidate for the `v0.1.0` tag.

**Notable**
- Fabric CLI — terminal interaction.
- Core types: Actor, Channel, Message, Peer, Service.

## 2023-04-01
### `v0.1.0-RC1` pre-release
First pass at public playnet!  Initial release candidate for the `v0.1.0` tag.

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
