# Production March Tracker
This is the single living document for driving `@fabric/core` to production readiness with a tighter surface area:

- fewer classes
- less generated/documentation noise
- examples focused on real product flows
- test coverage concentrated on supported behavior

Related docs:
- `docs/PRODUCTION.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/OUTSTANDING.md` — **security-first queue** (this repo)
- `SECURITY.md` / `AUDIT.md`
- `AGENTS.md`

**Suite security blocker (not a core patch):** Hub / `@fabric/http` login and device-link **redeem** still treat QR `sessionId` as the capability. Advance that in `@fabric/http`, then Hub and other session-capable deploys — see those packages' `docs/OUTSTANDING.md`.

## Working Area
### Bad Classes (work to reduce)
- `DistributedExecution` (reduce to `Execution`)
- `Scribe`

### Dubious Classes (consider integrating/consolidating into existing classes)
- `Reader`

### Annoying Clutter
- All the entries under "Global"

### Class Matrix (First Pass)
This matrix is a production-first baseline to refine over the next PRs.

#### Keep (Core, product-aligned)
- `Actor`
- `Chain`
- `Circuit`
- `Collection`
- `Entity`
- `Federation`
- `Hash256`
- `Key`
- `Machine`
- `Message`
- `Peer`
- `Program`
- `Remote`
- `Resource`
- `Service`
- `State`
- `Store`
- `Wallet`
- `Worker`

Rationale:
- These map directly to Hub-relevant flows (documents/contracts/security/peering) or are required runtime infrastructure.
- They are part of the current `types/fabric.js` static surface, so they are the safest production spine.

#### Consolidate (Reduce surface, keep capability)
- `Scribe` -> fold remaining useful behavior into `Service` and/or logging helpers.
- `Reader` -> fold into `Resource`/`Collection` query helpers or remove if only test/demo value remains.
- `Interface` -> fold into `Resource` schema + route definitions.
- `Renderer` -> fold into app-layer (`@fabric/http` or Hub), not core runtime.
- `Stack` + `Script` -> evaluate unification behind `Program`/`Machine` if no distinct production role.

#### Deprecate/Compatibility-only (for this release cycle)
- `DistributedExecution` (`types/distributedExecution.js`) — thin re-export of canonical JSON / beacon signing / manifest helpers; prefer those modules + `Machine`/`Program` directly. Keep `Fabric.DistributedExecution` alias one release.
- `settings/deprecations.js` aliases that only preserve legacy names.
- Any class only referenced by deprecation mapping + legacy docs, with no product-path usage.

#### Remove Candidate (Pending import graph confirmation)

- Leaf types not in `Fabric` static exports and not imported by Hub-critical services.
- Specialized one-off wrappers with no tests outside narrow fixture coverage.

## Phase 1 Execution Plan (Type Tree)

### Step A: Inventory and tagging

- [x] Generate an authoritative list of all `types/*.js` with tags: `keep`, `consolidate`, `compat`, `remove-candidate`.
- [x] Record direct references from:
  - `types/fabric.js`
  - `services/*.js`
  - `scripts/fabric.js` and `types/cli.js`
  - Hub-facing integration points (`publishedDocumentEnvelope`, security/delegation paths)

**Locked inventory (2026-09-03):**

| Tag | Types |
|-----|--------|
| **keep** | `Actor`, `Beacon`, `Chain`, `Circuit`, `Collection`, `Contract`, `Entity`, `Federation`, `Hash256`, `Key`, `Machine`, `Message`, `Peer`, `Program`, `Remote`, `Resource`, `Service`, `State`, `Store`, `Wallet`, `Worker`, `Block`, `Tree`, `Filesystem`, `Identity`, `Token`, `Environment` |
| **consolidate** | `Scribe` (logging → Service helpers), `Reader` (→ Peer/Message ingest; `@deprecated`), `Interface` (→ Resource schema), `Stack`+`Script` (evaluate behind Program/Machine) |
| **compat** | `DistributedExecution` (thin re-export; prefer leaf helpers + Machine/Program), `Vector`, `Observer`, `Oracle`, `RoundRobin`, `Session`, `Capability` (scaffold), `Channel` |
| **remove-candidate / not shipped** | `authority`, `component`, `renderer`, `typetree` (excluded from `files[]`), plus dormant: `compiler`, `disk`, `datastore`, `transaction`, `history`, `promise`, `queue`, `router`, `setup`, `label`, `ledger`, `logger`, `network`, `node`, `path`, `secret`, `signature`, `validator`, `witness`, `instruction`, `challenge`, `bond`, `bech32` (prefer functions), `codec`, `document`, `ecc*`, `cli` (bin path), `hkdf` |

### Step B: Fast reductions

- [x] Mark `Scribe` and `Reader` with explicit deprecation notes in code comments/docs.
- [x] Stop advertising non-core classes in onboarding docs/examples.
- [x] Keep runtime compatibility for one release cycle through aliasing only where needed.

### Step C: Facade hardening

- [x] Make `types/fabric.js` the curated public class surface for RC.
- [ ] Remove stale commented exports once target decisions are finalized.
- [ ] Ensure docs generation follows the curated surface and avoids promoting internal-only classes.

## Documentation Clutter Plan ("Global" cleanup)

- [x] Configure docs generation to avoid exposing broad "Global" buckets as first-class API.
- [x] Prefer `@fileoverview` / `@private` / `//` settings comments so helpers (`crypto`, `merge`, body schemas, Block digests, etc.) stay off `docs/global.html`.
- [ ] Prefer module/class entry pages over generated global index noise.
- [ ] Keep only operator/developer-relevant pages linked from `docs/README.md` and this tracker.

## Product Anchor (Hub First-Glance)
Current first-glance product signals from `hub.fabric.pub`:

- Top-level user flows are `Home`, `Documents`, `Contracts`, and `Security`.
- The app depends on network connectivity and hub/peer status.
- Core visible behaviors are:
  - publish documents
  - contract-centric workflows
  - delegation/signing session management

Production scope should prioritize library functionality that directly powers those flows.

## Scope Rules (What We Keep)
A feature/class stays in production scope only if it is:

1. used by Hub or `@fabric/http`,
2. needed by core message/peer/security/runtime infrastructure, or
3. required for compatibility during this release cycle.

Everything else is either:

- folded into another type,
- deprecated with migration notes, or
- removed from docs/examples and excluded from onboarding paths.

## North-Star Outcomes
- Reduce class count by consolidating low-value standalone types.
- Treat `Fabric` as a stable facade over fewer, clearer leaf modules.
- Shrink docs/examples to a curated set reflecting real user journeys.
- Reach and maintain near-100% meaningful JS coverage for in-scope modules.

## Workstreams
### 1) Type Tree Consolidation

- [x] Build an authoritative inventory of currently exported/used classes.
- [x] Mark each class as `keep`, `consolidate`, `deprecate`, or `remove`.
- [ ] Collapse legacy/overlapping classes into canonical homes.
- [ ] Ensure all removed/re-homed APIs have compatibility notes.
- [x] Keep `types/fabric.js` static exports aligned with final decisions.

Definition of done:
- Reduced public class surface with no unresolved runtime imports in tests.

### 2) Documentation Reduction

- [ ] Define canonical docs only (production/operator/developer essentials).
- [ ] Remove or stop generating non-essential pages.
- [ ] Keep one clear onboarding flow for new contributors.
- [ ] Ensure docs mirror current exports, not historical artifacts.

Definition of done:
- Docs index points to a compact, production-relevant set and can be regenerated cleanly.

### 3) Example Reduction
- [ ] Keep only examples tied to product-critical flows.
- [ ] Make `examples/agents.js` a clear reference for orchestration, not a kitchen sink.
- [ ] Remove/archive examples that do not map to current production usage.
- [ ] Add “why this example exists” note to each remaining example.

Definition of done:
- Examples directory functions as a focused learning and verification suite.

### 4) Coverage + Test Reliability
- [ ] Keep JS coverage focused on in-scope modules.
- [ ] Remove coverage inflation via broad exclusions of active code.
- [ ] Convert “known broken but asserted” tests into either fixed behavior or explicit deprecation tests.
- [ ] Separate environment/sandbox failures from true regressions in CI reporting.

Definition of done:
- Coverage reflects shipped behavior, and failures clearly indicate product risk.

## Immediate Priority Queue
1. **Security leftovers** in [OUTSTANDING.md](OUTSTANDING.md) — Blockers remain (third-party review, login/link Origin-GET, `contractId` rename); Next slices cleared on 2026-09-03 cut series.
2. ~~Finalize keep/remove matrix for classes~~ — locked above (Step A inventory).
3. **Trim docs generation target set** to production-relevant modules.
4. **Trim example set** to Hub-facing workflows (documents, contracts, signing/delegation, network).
5. **Resolve unfinished behavior in active APIs** before adding more coverage-only tests.

## Pending Test Triage (First Logical Pass)
Observed baseline after hardening (historical March pass):
- `784 passing`
- `50 pending`
- `0 failing`

Current `@fabric/core` baseline (see Progress Log **2026-08-12**): `1831 passing`, `1 pending`, `0 failing`. Suite-wide packages (http / hub / application / browser extension) also green on that run.

Working buckets for pending tests:

### Activate Now (high-value, low external dependency)
- `tests/fabric.wallet.js`
  - `can load a key into the wallet`
- `tests/fabric.store.js`
  - `can recover string data after a restart`
- `tests/fabric.message.js`
  - `should generate a restorable buffer`
- `tests/fabric.state.js`
  - `@id` accuracy + serialize/deserialize basics
- `tests/fabric.stack.js`
  - serialized restore + push semantics
- `tests/fabric.chain.js`
  - merkle proof inclusion assertion
- `tests/fabric.collection.js`
  - selected conversion-path tests (`toMap`/`toList`) where behavior is already in use

### Keep Pending With Explicit Rationale (environment/integration-heavy)
- `tests/lightning/fabric.lightning.js` local node lifecycle tests (requires heavy local services)
- `tests/bitcoin/signet.js` (network/e2e gated by environment)
- `tests/bitcoin/service.js` real block generation path (regtest/e2e gate)
- `tests/fabric.wallet.js`
  - `can trust an existing chain service` (cross-service integration)
- `tests/fabric.swarm.js`
  - clean start/stop full swarm integration

### Deprecate or Remove Candidate (class-surface reduction alignment)
- `tests/fabric.compiler.js` entire skipped set (compiler path currently outside production core)
- `tests/fabric.transaction.js` constructor availability skip (class marked as low-priority surface)
- `tests/fabric.application.js`
  - constructor/oracle loading tests if app-shell is not part of curated core exports
- `tests/fabric.oracle.js`
  - string-store behavior if Oracle remains non-core
- `tests/fabric.keystore.js` legacy encrypted-keystore skips once `Store.openEncrypted` is canonical

Execution order:
1. Activate "now" bucket tests in smallest PR slices.
2. Add inline `TODO(production-march): reason` notes on pending tests we keep.
3. Remove/deprecate tests only after class-surface decision is locked in this document.

## Progress Log
Use this section as an append-only log (newest first).

### 2026-09-03 — OUTSTANDING Next slices emptied (staged cut series)
Staged (no agent commits): #187 tip tests + c8 whitelist for authority/operator/MuSig2-stub;
NOISE stream deps declared; unloadable modules out of `files[]`; type-tree inventory
locked; `sensitive` ≠ encrypted + scaffold/VM doc honesty; `contractIdentifier` dual-field
helper; Codacy path excludes marked wontfix. Core Next slices empty; Blockers keep
third-party review, VM non-claim, login/link Origin-GET, and the rename. Hub owns NOISE
redeploy verify (`npm run verify:noise-handshake`).

### 2026-08-24 — PR #186 open review comments
Cleared the open review surface on
[#186](https://github.com/FabricLabs/fabric/pull/186). `npm run ci` **green** on
Node 24.15.0 after the change: **2483 passing / 6 pending** (+21 tests, no
production code touched). Both unresolved bot threads were **already fixed** in
`aab3c983d`, which landed after the reviewed commit `f63a33f`; neither needed a
patch:

- **Bugbot, `functions/bip371.js` (Medium) — "BIP-371 helper skips required
  checks."** At `f63a33f` `tapLeafScriptEntry` only asserted
  `controlBlock.length >= 33`. It now enforces the BIP-341 `33 + 32*m` length,
  an even leaf version, and that the control block's masked leaf version matches
  — with a regression test per rule in `tests/functions.bip371.js`.
- **CodeRabbit, `tests/lightning/lightning.service.js` (Minor) — "Disable
  `cln-grpc` for Carol."** `disablePlugins: ['cln-grpc']` is on the `carol`
  constructor.

The one genuinely open item was **Codecov's patch report**, which is measured
against current HEAD `8e756f2` rather than a stale commit: 94.45% patch coverage
with **32 lines missing**, all in the two files this PR grew most. Closed by
adding tests, not by adjusting thresholds:

| File | Before | After |
|------|--------|-------|
| `types/tree.js` | 91.85% lines · 41.23% branch · 94.44% funcs | **100% lines · 78.16% branch · 100% funcs** |
| `types/message.js` (patch lines) | 2 uncovered | **0 uncovered** |

The `tree.js` gap mattered more than a coverage number suggests. The 30
uncovered lines were concentrated in `proveNonInclusion` / `verifyNonInclusion`
— the *adversarial* half of the new proof API — so the untested paths were
precisely the ones a malicious prover would attack: the `sortLeaves` guard, the
empty-tree case, a target that is actually present, and every rejection branch
in the verifier. `tests/fabric.tree.js` now asserts each defence holds: tampered
root, tampered or mismatched `leafCount`, a leaf set whose size disagrees with
the commitment, neighbours widened to skip an in-range leaf, a target outside
the claimed gap, stray/missing neighbours per side, and a document claiming
inclusion. Two `catch` blocks are covered as **fail-closed** behaviour — a
throwing verifier or proof builder yields an unproven leaf, not an exception.

**Lesson worth keeping:** the coverage report was the only reviewer that flagged
anything real here, and it pointed at security-relevant code. A patch-coverage
miss on a *verifier* should be read as an untested trust boundary, not as
housekeeping. Both bot findings, by contrast, were already stale — worth
re-checking findings against HEAD before spending a change on them, since review
bots pin to the commit they saw.

### 2026-08-24 — suite release-readiness audit
Ran sibling suite packages' release gates on Node 24.15.0. **Suite is green.**

| Package | Gate | Result |
|---------|------|--------|
| `@fabric/core` | `npm run ci` | smoke + `lint:types` + `lint:pkg` + **2460 passing / 3 pending** + benchmark |
| `@fabric/http` | `npm test` | **253 passing / 0 failing** (21 pending) |
| `@fabric/hub` | `npm run test:unit` | **821 passing / 0 failing** (6 pending; see flake note) |
| Browser wallet extension | `npm run test:unit` + `npm run build` | **93 passing**, webpack clean |
| Application relay | `npm test` | **1244 passing / 0 failing** (was 1240/4) |

The application relay gate is five separate summaries (mocha, unit+fabric, relay,
integration, UI). Reading only one block can look green while another is red —
worth knowing before trusting a headline number.

Defects found and fixed in consuming packages; no core patch needed.

1. **Federation invite re-export drift.** A consumer asserted reference equality
   between a local `federationContractInvite` shim and `@fabric/http`, but the
   shim only existed for pins predating `resolveFederationInviteExpiresAt`. That
   API is now upstream in `@fabric/http`; the shim can return the http module
   unchanged on the next lockfile bump. **Action for this repo: none.** Land the
   http exports and refresh pins so shims collapse.
2. **Browser extension manifest validation.** Invalid `host_permissions` /
   `content_scripts` match patterns with explicit ports (`localhost:<port>/*`) —
   Chrome match patterns cannot express a port. Latent Web Store submission
   blocker; fixed with a regression guard in the extension test suite.
3. **Session-gated relay tests.** Several relay tests read hosted endpoints
   without a session after privacy hardening correctly returned **401**; fixed by
   authenticating (signed login envelope → Bearer) and asserting both anon-401 and
   authenticated reads.
4. **P2P chat timestamp normalization.** A helper scan across suite `functions/`
   trees found most pairs already `require` upstream. The gap was
   `normalizeP2pChatMessage`: `Number(null)` / `Number('')` are finite `0`, so
   an `isFinite` gate accepted epoch 0 and blocked the ISO `object.ts` fallback.
   Fixed in `@fabric/http` with tests; Hub compatibility wrappers can collapse on
   pin bump.

Also traced, and needing **no patch anywhere**: Hub teardown noise
`Could not wipe database: ModuleError: Database is not open`. `Store#flush`
already has a `status !== 'open'` pre-check plus a `LEVEL_DATABASE_NOT_OPEN`
guard here in `088dd9aff` (with tests in `tests/fabric.store.js`); Hub's vendored
copy is the pre-guard version. RSS/NOISE P0 and this log spam both clear on the
same core dep refresh.

Documentation: the browser wallet extension was the only suite package without an
`AUDIT.md`; one was added in the same shape as core / http / Hub. Two findings
worth suite attention:

- **`https://*/*` host breadth** — content script at `document_start` in
  `all_frames` of every HTTPS origin while signing trusts only listed Fabric
  origins. Normal for a wallet extension and load-bearing for site login, but it
  drives a harsh install prompt. Owner decision, not silently narrowed.
- **Extension background datastore key is not password-bound** — random AES-GCM
  master key in extension storage beside ciphertext. Wallet seed is not in that
  store; post-unlock binding plus migration is the fix. Same family as Hub
  at-rest identity KDF — solve once in core/http, not per product.

Unchanged suite blockers (still coordination, not code): device-link `sessionId`
bind into attest messages, always-fresh device-link nonce, and the
`X-Fabric-Poll-Secret` client rollout. Hub **RSS / NOISE P0** is still a
pin-and-redeploy problem — handshake-bus cleanup is in this tree but not on live
pin `f63a33f`.

Hub `npm run test:unit` also emits repeated `Could not wipe database` teardown
noise for the same `Store#flush` reason above — clears on core pin bump.

### 2026-08-20
- [#186](https://github.com/FabricLabs/fabric/pull/186) is the open `feature/rsi` wave after [#185](https://github.com/FabricLabs/fabric/pull/185) merged (`4db3be3`). HEAD **`9c6ade0`** (review follow-ups after **`aab3c98`**): effective Taproot `internalKeyMode` on `resolveSpend`, gossip numeric relay-as-is + constraint merge, NOISE native-pointer teardown, gossip-relay shutdown counts. Handshake-bus is **not** on live Hub pin **`f63a33f`** — Hub pin/redeploy before claiming RSS/NOISE is fixed.
- Production Hub scan **10:39Z**: RSS tracks `external`/`arrayBuffers`, not named retainers. Do not raise `--max-old-space-size`.

### 2026-08-13
- Core `3745041e` (wallet lock / Environment) is on GitHub `feature/rsi`; http `e167d8e` and Hub `5441f838` follow.
- Added [OUTSTANDING.md](OUTSTANDING.md) as the security-first queue; sibling suite packages have matching files.
- Immediate queue now leads with security leftovers. **Suite blocker** remains http possession proof for `/sessions` and `/device-links` redeem (not a core patch).
- Class-surface work (`Scribe` / `Reader` / Global) stays the in-repo march after that coordination.

### 2026-08-12
- Re-ran the Fabric package suite end-to-end (unrestricted host; extension Playwright needs Crashpad/xattr outside agent sandboxes). Log: `/tmp/fabric-suite-tests-1786512851.log`.
- **`@fabric/core`** (`npm test`): `1831 passing`, `1 pending`, `0 failing`.
- **`@fabric/http`** (`npm test`): `157 passing`, `21 pending`, `0 failing`.
- **`@fabric/hub`** (`npm run test:unit`): `539 passing`, `4 pending`, `0 failing`.
- **Application relay** (`npm test`): mocha fabric `43 passing`; fabric expectations `45 pass`; relay `322 pass` / `2 skipped` / `0 fail`.
- **Browser wallet extension** (`npm test`): unit `55 passing` + extension Playwright `5 passing`, `0 failing`.
- Suite hardening carried in from recent failure triage (not all in this repo):
  - identity Schnorr resolution / leaf-key site-login paths (`@fabric/http` + extension verify coverage);
  - application relay chat receipts when Fabric peer is off under `NODE_ENV=test`, mission Accept → apply, device-link verify via `Identity#fabricKey`;
  - extension webpack CSS includes for npm-linked `@fabric/http` assets; extension launcher defaults to bundled Chromium and ignores `--disable-extensions`.
- Core baseline vs earlier march entries: JS suite grew well past the March `834` mark; still `0 failing`. Remaining core pending is a single skip (triage under Coverage + Test Reliability).

### 2026-03-24
- Closed the pending-test loop for JS unit/integration slices in this repo branch:
  - activated and stabilized remaining pending tests in:
    - `tests/fabric.block.js`
    - `tests/fabric.keystore.js`
    - `tests/fabric.compiler.js`
    - `tests/fabric.oracle.js`
    - `tests/fabric.swarm.js`
    - `tests/fabric.application.js`
    - `tests/fabric.wallet.js`
    - `tests/bitcoin/service.js`
    - `tests/lightning/fabric.lightning.js`
    - `tests/lightning/lightning.service.js`
  - added missing compiler runtime dependencies used by existing `types/compiler.js`:
    - `@webassemblyjs/ast`
    - `ts-morph`
- Latest full suite baseline:
  - `834 passing`
  - `0 pending`
  - `0 failing`

### 2026-03-24
- Implemented first failure-driven fixes:
  - `Wallet.loadKey()` added with normalized key input handling.
  - wallet key-loading expected-behavior test now active and passing.
  - chain merkle test aligned to ledger ID shape and `_tree` accessor.
- Re-ran full suite after fixes:
  - `795 passing`
  - `35 pending`
  - `4 failing`
- Remaining failures to resolve:
  1. `tests/fabric.chain.js` merkle proof verification still false (`verify(...) !== true`).
  2. `tests/fabric.stack.js` size/`pop` semantics mismatch with JS-like expectations.
  3. `tests/fabric.state.js` serialization contract mismatch (`serialize()` not returning Buffer in this path).

### 2026-03-24
- Activated expected-behavior tests across core modules (`wallet`, `message`, `state`, `stack`, `chain`, `store`, `collection`) and ran once:
  - `794 passing`
  - `35 pending`
  - `5 failing`
- Failure snapshot (used to drive implementation order):
  1. `tests/fabric.chain.js` merkle proof test assumes block objects where ledger stores block IDs.
  2. `tests/fabric.stack.js` stack size/semantics diverge from JavaScript-like expectations.
  3. `tests/fabric.state.js` `serialize()` return contract differs from Buffer expectation.
  4. `tests/fabric.wallet.js` key loading path rejects point-object input shape used by test.
- Next implementation plan (failure-driven):
  1. **Chain test contract fix**: align test with current ledger shape (ID strings) and validate merkle proofs over IDs.
  2. **Wallet key ingestion hardening**: add/normalize `Wallet.loadKey()` input handling (Key instance, compressed pubkey hex, point-like object).
  3. **State serialization contract decision**: either (a) make `State.serialize()` consistently return `Buffer`, or (b) codify object/string return and update all callers/tests.
  4. **Stack semantic decision**: either enforce JS-like `push/pop/size`, or explicitly document current state-vector semantics and adapt tests to that contract.
  5. Re-run full suite after each item; keep this list updated until `0 failing`.

### 2026-03-24
- Hardened seed and logging boundaries:
  - strict BIP39 validation in `Wallet.fromSeed`, `_importSeed`, `_loadSeed`
  - reduced remaining unconditional wallet audit logging in chain/block scan paths
- Re-ran full CI after hardening:
  - `784 passing`
  - `50 pending`
  - `0 failing`
- Completed first-pass pending test triage into: activate-now, keep-pending, deprecate/remove-candidate.

### 2026-03-24
- Ran full JS tests:
  - `770 passing`
  - `50 pending`
  - `3 failing` (Lightning socket tests failed under environment permission constraints, not JS assertion failures)
- Regenerated docs successfully after JSDoc compatibility fixes.
- Captured first-glance hub usage signals from `hub.fabric.pub` and anchored production priorities to those flows.

## Risks to Watch
- Surface-area drift (new classes/examples/docs added without scope justification).
- Coverage optics diverging from real reliability.
- Large PRs mixing refactors + behavior changes + generated docs, reducing review quality.

## Operating Cadence
For each PR in this march:

- include one-line statement of which workstream it advances,
- update this file’s progress log,
- keep changeset focused (type tree, docs, examples, or tests—not all at once unless required).

