# Sidechain document helpers (moved)

There is **no** Fabric `Statechain` type.

Sealed JSON document APIs live under distributed-execution helpers:

**[`functions/sidechainState`](../functions/sidechainState.js)** — see
**[DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md)**.

```js
const sidechainState = require('@fabric/core/functions/sidechainState');
```

Hub operator surface (RPC / HTTP) still says “sidechain”; that is not a core type.

## OP_RETURN hallmarks (short format)

**[`functions/fabricHallmark`](../functions/fabricHallmark.js)** encodes a **40-byte** on-chain mark (not a 208-byte AMP Message):

| Bytes | Content |
|------:|---------|
| 0–3 | `c0d3f33d` (`MAGIC_BYTES`) |
| 4–7 | last 4 bytes of tip Bitcoin block hash |
| 8–39 | SHA-256 of canonical `{ tipBlockHash, contractId, state: { sidechain, contracts } }` |

Hallmarks are **on-chain only** (Hub opt-in publish/scan). They are not Fabric P2P broadcast frames.

