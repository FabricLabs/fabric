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

**Bitcoin / Wallet (service + types):**
- **`tests/bitcoin/service.js`** — getters (`tip`, `supply`, `height`, `balance`, `lib`, `networks`, `UAString`), **`walletName`** (default hash vs explicit), **`headers`**, **`_prepareTransaction`**, **`_prepareBlock`** validation, **`_handleCommittedTransaction`**, **`_registerAddress`**, **`_handlePeerError`**.
- **`tests/fabric.wallet.js`** — **`generateCleanKeyPair`** ↔ **`publicKeyFromString`**, **`publicKeyFromString`** (hex), **`balanceFromState`**, **`_countUnusedAddresses`**, **`_getHighestUsedIndex`**, **`_checkGapLimit`**.
- **`types/wallet.js`** — **`publicKeyFromString`** now handles strings/hex before curve-point `encode` (fixes `ReferenceError: Point is not defined` and wrong branch for derived `Key` public objects). **`tests/fabric.wallet.js`** covers all branches: **`null`/`undefined`**, number coercion, **Buffer** / **Uint8Array**, **`encode()`** points, and fallback.

**Coverage push (types + functions):**
- **`tests/fabric.promise.js`** — **`EncryptedPromise`**: id, resolve, encrypt flag, **`_assignState`**, **`state`** getter.
- **`tests/fabric.scribe.js`** — **`Scribe`**: **`start`/`stop`**, **`log`/`error`/`warn`/`debug`** emissions, **`trust`**, **`sha256`**.
- **`tests/fabric.token.js`** — **`Token`**: **`base64Url*`** helpers, **`verifySigned`** rejection paths, **`toString`** / **`fromString`**.
- **`tests/functions.fabricNativeAccel.js`** — subprocess loads module with **`FABRIC_NATIVE_DOUBLE_SHA256=true`** so **`status().nativeDoubleSha256OptIn`** and addon **`tryLoadAddon`** branches run in isolation (parent process keeps opt-in off).

**Recently added tests (low-line-count / high-risk modules):**
- **`tests/services.local.js`** — `Local` handler + `start`.
- **`tests/fabric.ledger.js`** — genesis `start`, `append`, `consume`, `render` (stack depth via `pages['@data'].length`; `State#size` is buffer length, not frame count).
- **`tests/fabric.worker.js`** — `compute` / `PING`→`pong`, `route` default branch (no return value), `use` stub.
- **`tests/fabric.witness.js`** — digest/hash, sign/verify, pubkey-only error path, `lock`, JSON `data`.
- **`tests/fabric.message.js`** — signed **`toBuffer` / `fromBuffer`** round-trip + **`verifyWithKey`**.

**Next targets toward higher % (largest remaining uncovered, high risk):**
1. **`services/bitcoin.js`** — RPC paths, ZMQ, managed spawn (many branches; extend **`tests/bitcoin/service.js`** and optional `FABRIC_E2E_REGTEST=1`). **`_normalizeChainName`** now covers **`testnet4`** and default passthrough.
2. **`types/service.js`** — **`tests/fabric.service.js`** plus FabricShell paths; **`_listChannels`** `xit` still expects list length 1 but API returns 0 — fix implementation or test before enabling.
3. **`types/wallet.js`** — **`tests/fabric.wallet.js`**; enable skipped `xit` where stable (several reference APIs that no longer exist — review before enabling).
4. **`types/peer.js`** — **`tests/fabric.peer.js`**, **`tests/peer.message.integration.js`**, cross-implementation tests.
5. **`types/message.js`** — extend branch coverage (e.g. additional wire types) in **`tests/fabric.message.js`**.
6. **`types/circuit.js`**, **`types/environment.js`**, **`types/store.js`** — extended in **`tests/fabric.circuit.js`** (real **`fromBristol*`** via stubbed **`dot`**, **`compute`**, **`scramble`**, **`hash`**, **`render`**, **`parse`**, **`toObject`**, **`_registerMethod`**), **`tests/fabric.environment.js`** (bitcoin.conf parsing helpers), **`tests/fabric.store.js`** (**`getRouteInfo`**, **`encodeValue`**, **`getDataInfo`**, **`encryptedSettings`**, **`openEncrypted`**).

**Goal:** raise toward **100%** on **included** paths; treat CLI as a separate integration surface.
Regenerate: `npm run report:coverage-baseline` (full suite + `c8`, ~5 minutes).

Raw JSON: `reports/coverage/coverage-summary.json` (produced beside this report when you run the command above).
