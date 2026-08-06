# Sidechain document helpers (moved)

There is **no** Fabric `Statechain` type.

Sealed JSON document APIs live under distributed-execution helpers:

**[`functions/sidechainState`](../functions/sidechainState.js)** — see
**[DISTRIBUTED_EXECUTION.md](./DISTRIBUTED_EXECUTION.md)**.

```js
const sidechainState = require('@fabric/core/functions/sidechainState');
```

Hub operator surface (RPC / HTTP) still says “sidechain”; that is not a core type.
