# Production consolidation checklist
Use this after merging core JS/native work (e.g. message parity, peer fixes) and before tagging a release.

**CI:** GitHub Actions runs `npm run report:coverage` (full test suite + `reports/coverage.lcov` for Codecov) **immediately after** installing `bitcoind`, *before* building Core Lightning — so test failures surface without waiting on Lightning.

## Package & API
- [x] **Version** — `package.json` at **`0.1.0-RC2`**; **`engines.node`** matches **`.nvmrc`** / CI (`22.14.0`). For the next tag, bump semver and keep tag = published version.
- [x] **Exports** — `package.json` `exports` cover `.`, `./constants`, `./types/*`, `./services/*`, `./functions/*` (review when adding new surfaces).
- [x] **Types entry** — `types/fabric.d.ts` present (minimal); grow alongside real typings.
- [x] **Smoke** — `npm run smoke` loads `fabric`, `message`, `peer` (runs in CI).

## Build & artifacts
- [x] **Git** — `build/` ignored (full tree under `.gitignore`).
- [x] **Native addon** — See [`BUILD.md`](../BUILD.md) for `npm run build:c` and libwally / secp256k1 / noise notes (CI does not require the addon to pass tests).
- [x] **Lockfile** — CI uses `npm ci` (requires committed `package-lock.json`).

## Quality gates
- [x] **`npm test`** — Full suite green in CI and locally (`500+` passing); flaky tests skipped or marked pending.
- [x] **`npm run lint:types`** — Semistandard on `types/**/*.js` (runs in CI via `npm run ci`).
- [x] **`npm run lint:pkg`** — CLI harness, quality-report script, native accel shim (CI + `npm run ci`).
- [ ] **`npm run lint`** — **Optional / stretch:** full-tree semistandard is not clean (legacy `types/` surface). **Release bar** is `lint:types` + `lint:pkg` until a dedicated lint cleanup lands.
- [x] **Security** — **`npm audit` triaged:** no **critical** issues at last run; **high** / **low** transitive issues under dev-time **honkit** documented in [`reports/SECURITY-AUDIT.md`](../reports/SECURITY-AUDIT.md). Reconcile before major release if policy requires zero highs.

## Runtime & ops
- [x] **Logging** — High-sensitivity peer NOISE material (private / derived keys, raw encrypt-decrypt traces) gated on `settings.debug`; RPC/bitcoind password redaction paths preserved in Bitcoin service (see `redactSensitiveCommandArg` / debug string scrubbers).
- [x] **Docs** — [`BUILD.md`](../BUILD.md); [`C-JS-PARITY.md`](./C-JS-PARITY.md); README links BUILD.md under Contributing.

## Release

- [x] **Changelog** — [`CHANGELOG.md`](../CHANGELOG.md) updated for **0.1.0-RC2** (wire v2, preimage, reports, logging).
- [ ] **Tag & publish** — **Maintainer step:** after merge to the release branch, `git tag v0.1.0-RC2` (or semver you shipped), then `npm publish` / GitHub Release per org workflow. Tag must match `package.json` `version`.

### Commands before tag
```bash
npm ci
npm run ci
npm run report:quality   # optional: refresh reports/WARNINGS.md, DEPRECATIONS.md, SECURITY-AUDIT.md
npm run make:dev && npm run check:book-links   # optional: dev handbook + relative link check
npm run report:coverage-baseline   # optional: refresh reports/COVERAGE-BASELINE.md (~5 min)
```
