# Deprecations

_Generated: 2026-05-17T06:15:29.741Z_

## Registry (package-lock)

Packages marked deprecated on the npm registry (as recorded in `package-lock.json`).

_No `deprecated` fields in package-lock.json._

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
| `functions/base58.js` | 128 | /** @deprecated Use {@link module:functions/bytes.toUint8Strict} — alias kept for compatibility */ |
| `functions/bolt12Semantics.js` | 66 | /** @deprecated Use {@link CLN_BOLT12_TLV} — name kept for existing imports. */ |
| `scripts/cli.js` | 4 | /** @deprecated Use `scripts/fabric.js` — kept for backwards compatibility. */ |
| `scripts/gen-quality-reports.js` | 140 | if (!/@deprecated/i.test(text)) continue; |
| `scripts/gen-quality-reports.js` | 143 | if (!/@deprecated/i.test(line)) return; |
| `scripts/gen-quality-reports.js` | 151 | if (!items.length) return '_No `@deprecated` JSDoc lines found in scanned tree._'; |
| `scripts/gen-quality-reports.js` | 257 | '## First-party `@deprecated` JSDoc', |
| `scripts/gen-quality-reports.js` | 6 | * - DEPRECATIONS.md — registry deprecations (package-lock), settings/deprecations.js, @deprecated in first-party JS |
| `services/bitcoin.js` | 368 | * @deprecated Use {@link #buildLocalCookieProbePaths} with `network: 'regtest'`. |
| `services/txt.js` | 4 | * @deprecated Require {@link module:services/text~Text} from <code>services/text.js</code> instead. |
| `settings/deprecations.js` | 7 | * @deprecated |
| `types/collection.js` | 308 | * @deprecated |
| `types/distributedExecution.js` | 18 | * @deprecated Use {@link module:functions/fabricCanonicalJson} — alias kept for API stability. |
| `types/fabric.js` | 127 | /** @deprecated Use {@link State}. Alias for backward compatibility. */ |
| `types/key.js` | 426 | * @deprecated Per-message IVs are generated in {@link Key#encrypt}. Do not rely on this getter. |
| `types/peer.js` | 473 | * @deprecated |

---

Regenerate: `npm run report:deprecations` (or `npm run report:quality`).