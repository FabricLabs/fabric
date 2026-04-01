# Consolidation plan (@fabric/core)

Tracked opportunities to reduce duplication, fix seams, and align repos. Update status as work lands.

| # | Item | Status | Notes |
|---|------|--------|--------|
| 1 | **Authority / HTTP** — `types/authority.js` extends missing `./http` | Planned | Add real `HTTP` base, reparent to `Service`, or move to `@fabric/http`; remove synthetic `HTTP` node from classtree when resolved |
| 2 | **npm `@noble/hashes@2`** — one deduped tree | Done | Root `^2.0.1` + `overrides["@noble/hashes"]` pins the whole tree. `patch-package` patches `bs58check`, `bip32`, `bip39`, `bitcoinjs-lib` to v2 entrypoints (`sha2.js`, `legacy.js`, `pbkdf2.js`, …). Postinstall runs `scripts/fix-wif-bs58check-noble.js` because nested `wif` → `bs58check@4` does not always flatten under overrides. Inspect: `npm run report:noble-hashes`. |
| 3 | **Build / assets** — unify `make:app`, `make:lib`, `make:service`, `make:viewer` | Planned | Replace stubs with one bundle pipeline; refresh stale `assets/*.js` |
| 4 | **Block / Transaction vs Bitcoin*** | Planned | Either document two domains or share a thin Actor base for tx/block shapes |
| 5 | **Stack / Vector / Document / Script / Collection** | Planned | Clarify roles in DEVELOPERS or merge with `@type`/settings if overlap is accidental |
| 6 | **Entity vs Actor / State** | Planned | Keep two models; consolidate *documentation* and migration guidance (`Transition`) |
| 7 | **Hub ↔ `@fabric/http` ↔ core** | Planned | One framing/receipt implementation; Hub consumes it instead of duplicating handlers |
| 8 | **Dead / legacy surface** — `typetree.js`, `Fabric.Scribe` alias | Planned | Wire or remove `typetree`; drop `Scribe` alias after deprecation window |
| 9 | **`types/peer.js` size** | Planned | Split into internal modules (wire, gossip, peering, documents) behind same export |
| 10 | **`Datastore` vs `Store`** | Planned | Fold `types/datastore.js` into a single `Store` story (ledger / routes as optional facets or plugins); keep `Datastore` until API migration is designed |
| 11 | **`Disk` / virtual FS** | Planned | Replace naive `root`+`fs` sync I/O with virtual-node overlay filesystem work when that branch is ready; `Disk` stays frozen until then |
| 12 | **`Fabric` static facade parity** | In progress | `Bond`, `Text`, `RoundRobin` now exposed; still commented-out: `Contract`, `Disk`, `Swarm`, `Transaction` — enable as types stabilize or document intentional omission |

## Regeneration

- Class inheritance graph: `npm run make:classes-dot` → `contracts/classes.dot`
- Hub npm trees: `npm run report:dependency-trees` (in `hub.fabric.pub`)
- `@noble/hashes` versions: `npm run report:noble-hashes`
