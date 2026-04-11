# JavaScript implementation plan (reference client)
This tracks **JS-only** work for `@fabric/core` after wire/Message parity and production baselines. Native/C items live in [`BUILD.md`](../BUILD.md) and [`C-JS-PARITY.md`](./C-JS-PARITY.md).

## Shipped (baseline)
- **Message** — double-SHA256 body hash; `fromBuffer` preserves on-wire hash; signing uses tagged `"Fabric/Message"` + BIP340.
- **Peer** — body integrity check matches C; `stop()` tears down connections safely.
- **Hash256** — `doubleDigest` via `functions/fabricNativeAccel` (optional `fabric.node`, else @noble).
- **CLI** — `scripts/fabric.js` harness; default `chat` → Blessed TUI (`types/cli.js`).
- **CI** — `smoke`, `lint:types`, `lint:pkg`, tests; install report via `report:install-ci`.

## Near term (JS)
1. **`types/cli.js`** — Close signing / payment-channel TODOs where they block real P2P flows; keep behavior behind flags if experimental.
2. **Peer hardening** — Rate limits, duplicate message handling, and stricter origin checks (see `types/peer.js` TODOs) without breaking happy path.
3. **`functions/_handleFabricMessage.js`** — Either implement or redirect to `Peer`/`Message` patterns so examples don’t drift from wire format.
4. **Lint surface** — Expand toward `semistandard` on `contracts/`, `scripts/` (beyond harness), or `tests/` in slices; avoid a one-shot full-repo lint cliff.
5. **CHANGELOG** — Document user-visible JS changes per release (wire hash, CLI entry, etc.).

## Stretch
- Browser / ESM story for `types/fabric.mjs` vs `fabricNativeAccel` (Node-only today).
- Formal `types/*.d.ts` beyond minimal `fabric.d.ts`.

Update this file when slices land; release checklist remains in [`PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md).
