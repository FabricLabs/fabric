# Test coverage baseline
_Generated: 2026-03-21 — from `c8` text-summary after `npm run coverage` (see `npm run report:coverage-baseline` for json-summary)._

| Metric | % |
| --- | ---: |
| Lines | 70.36 |
| Statements | 70.36 |
| Functions | 54.28 |
| Branches | 67.12 |

**Measured scope (`package.json` → `c8.exclude`):**
- **`types/cli.js` is excluded** — Blessed TUI (~3.2k lines); meaningful coverage needs UI/integration tests. Partial unit coverage remains in **`tests/cli.nonrender.js`**.
- **`functions/*`** except **`fabricNativeAccel.js`**, **`taggedHash.js`**, **`truncateMiddle.js`** — the three exceptions are **included** in coverage; **`fabricNativeAccel`** is exercised by **`tests/functions.fabricNativeAccel.js`** (double-SHA256 vs Node crypto). Remaining `functions/*` stay excluded.

**Recently added tests (low-line-count / high-risk modules):**
- **`tests/services.local.js`** — `Local` handler + `start`.
- **`tests/fabric.ledger.js`** — genesis `start`, `append`, `consume`, `render` (stack depth via `pages['@data'].length`; `State#size` is buffer length, not frame count).
- **`tests/fabric.worker.js`** — `compute` / `PING`→`pong`, `route` default branch (no return value), `use` stub.
- **`tests/fabric.witness.js`** — digest/hash, sign/verify, pubkey-only error path, `lock`, JSON `data`.
- **`tests/fabric.message.js`** — signed **`toBuffer` / `fromBuffer`** round-trip + **`verifyWithKey`**.

**Next targets toward higher % (largest remaining uncovered, high risk):**
1. **`services/bitcoin.js`** — RPC paths, ZMQ, managed spawn (many branches; extend **`tests/bitcoin/service.js`** and optional `FABRIC_E2E_REGTEST=1`).
2. **`types/service.js`** — **`tests/fabric.service.js`** plus FabricShell paths.
3. **`types/wallet.js`** — **`tests/fabric.wallet.js`**; enable skipped `xit` where stable (several reference APIs that no longer exist — review before enabling).
4. **`types/peer.js`** — **`tests/fabric.peer.js`**, **`tests/peer.message.integration.js`**, cross-implementation tests.
5. **`types/message.js`** — extend branch coverage (e.g. additional wire types) in **`tests/fabric.message.js`**.
6. **`types/circuit.js`**, **`types/environment.js`**, **`types/store.js`** — large surface area, mid–low line % in c8 summary.

**Goal:** raise toward **100%** on **included** paths; treat CLI as a separate integration surface.
Regenerate: `npm run report:coverage-baseline` (full suite + `c8`, ~5 minutes).

Raw JSON: `reports/coverage/coverage-summary.json` (produced beside this report when you run the command above).
