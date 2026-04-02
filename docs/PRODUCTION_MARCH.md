# Production March Tracker
This is the single living document for driving `@fabric/core` to production readiness with a tighter surface area:

- fewer classes
- less generated/documentation noise
- examples focused on real product flows
- test coverage concentrated on supported behavior

Related docs:
- `docs/PRODUCTION.md`
- `docs/RELEASE_CHECKLIST.md`
- `AGENTS.md`

## Working Area
### Bad Classes (work to reduce)
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
- `DistributedExecution`
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
- `settings/deprecations.js` aliases that only preserve legacy names.
- Any class only referenced by deprecation mapping + legacy docs, with no product-path usage.

#### Remove Candidate (Pending import graph confirmation)

- Leaf types not in `Fabric` static exports and not imported by Hub-critical services.
- Specialized one-off wrappers with no tests outside narrow fixture coverage.

## Phase 1 Execution Plan (Type Tree)

### Step A: Inventory and tagging

- [ ] Generate an authoritative list of all `types/*.js` with tags: `keep`, `consolidate`, `compat`, `remove-candidate`.
- [ ] Record direct references from:
  - `types/fabric.js`
  - `services/*.js`
  - `scripts/fabric.js` and `types/cli.js`
  - Hub-facing integration points (`publishedDocumentEnvelope`, security/delegation paths)

### Step B: Fast reductions

- [ ] Mark `Scribe` and `Reader` with explicit deprecation notes in code comments/docs.
- [ ] Stop advertising non-core classes in onboarding docs/examples.
- [ ] Keep runtime compatibility for one release cycle through aliasing only where needed.

### Step C: Facade hardening

- [ ] Make `types/fabric.js` the curated public class surface for RC.
- [ ] Remove stale commented exports once target decisions are finalized.
- [ ] Ensure docs generation follows the curated surface and avoids promoting internal-only classes.

## Documentation Clutter Plan ("Global" cleanup)

- [ ] Configure docs generation to avoid exposing broad "Global" buckets as first-class API.
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

- [ ] Build an authoritative inventory of currently exported/used classes.
- [ ] Mark each class as `keep`, `consolidate`, `deprecate`, or `remove`.
- [ ] Collapse legacy/overlapping classes into canonical homes.
- [ ] Ensure all removed/re-homed APIs have compatibility notes.
- [ ] Keep `types/fabric.js` static exports aligned with final decisions.

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
1. **Finalize keep/remove matrix for classes** and lock the target type tree.
2. **Trim docs generation target set** to production-relevant modules.
3. **Trim example set** to Hub-facing workflows (documents, contracts, signing/delegation, network).
4. **Resolve unfinished behavior in active APIs** before adding more coverage-only tests.

## Pending Test Triage (First Logical Pass)
Observed baseline after hardening:
- `784 passing`
- `50 pending`
- `0 failing`

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

