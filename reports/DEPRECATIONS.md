# Deprecations

_Generated: 2026-04-01T19:09:24.239Z_

## Registry (package-lock)

Packages marked deprecated on the npm registry (as recorded in `package-lock.json`).

| Lockfile path | Version | Registry message |
| --- | --- | --- |
| `node_modules/glob` | 7.1.3 | Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me |
| `node_modules/html-encoding-sniffer/node_modules/whatwg-encoding` | 2.0.0 | Use @exodus/bytes instead for a more spec-conformant and faster implementation |
| `node_modules/inflight` | 1.0.6 | This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful. |
| `node_modules/js-beautify/node_modules/glob` | 10.5.0 | Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me |
| `node_modules/q` | 1.5.1 | You or someone you depend on is using Q, the JavaScript Promise library that gave JavaScript developers strong feelings about promises. They can almost certainly migrate to the native JavaScript promise now. Thank you literally everyone for joining me in this bet against the odds. Be excellent to each other.  (For a CapTP with native promises, see @endo/eventual-send and @endo/captp) |
| `node_modules/raw-body` | 1.1.7 | No longer maintained. Please upgrade to a stable version. |
| `node_modules/rimraf` | 2.7.1 | Rimraf versions prior to v4 are no longer supported |
| `node_modules/whatwg-encoding` | 3.1.1 | Use @exodus/bytes instead for a more spec-conformant and faster implementation |

## `settings/deprecations.js`

Curated façade deprecations (re-exports):

```javascript
'use strict';

const FabricState = require('../types/state');

/**
 * Deprecated 2021-11-06 — use {@link FabricState} (<code>types/state</code>). <code>Scribe</code> was merged into <code>State</code>.
 * @deprecated
 */
class Scribe extends FabricState {}

module.exports = {
  Scribe
};

```

## First-party `@deprecated` JSDoc

Scan: repo root `.js` files excluding `node_modules`, `assets`, `coverage`, `build`, etc.

| File | Line | Line |
| --- | ---: | --- |
| `contracts/chat.js` | 3 | /** @deprecated Use `contracts/shell.js`; kept for CLI compatibility. */ |
| `scripts/cli.js` | 4 | /** @deprecated Use `scripts/fabric.js` — kept for backwards compatibility. */ |
| `scripts/gen-quality-reports.js` | 140 | if (!/@deprecated/i.test(text)) continue; |
| `scripts/gen-quality-reports.js` | 143 | if (!/@deprecated/i.test(line)) return; |
| `scripts/gen-quality-reports.js` | 151 | if (!items.length) return '_No `@deprecated` JSDoc lines found in scanned tree._'; |
| `scripts/gen-quality-reports.js` | 257 | '## First-party `@deprecated` JSDoc', |
| `scripts/gen-quality-reports.js` | 6 | * - DEPRECATIONS.md — registry deprecations (package-lock), settings/deprecations.js, @deprecated in first-party JS |
| `settings/deprecations.js` | 7 | * @deprecated |
| `types/collection.js` | 308 | * @deprecated |
| `types/fabric.js` | 121 | /** @deprecated Use {@link State}. Alias for backward compatibility. */ |
| `types/key.js` | 373 | * @deprecated Per-message IVs are generated in {@link Key#encrypt}. Do not rely on this getter. |
| `types/peer.js` | 457 | * @deprecated |

---

Regenerate: `npm run report:deprecations` (or `npm run report:quality`).