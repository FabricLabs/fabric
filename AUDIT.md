# Audit notes — `@fabric/core`
Living list of **known issues, accepted risks, and recommendations** for the
0.1.x reference client. This is an internal posture document, not a third-party
audit report.

## Status

| Area | Posture |
|------|---------|
| Wire integrity (body hash + BIP-340) | Implemented; covered by unit/integration tests |
| Gossip / peering-offer amplification | Bounded (TTL, per-origin budget, caches) — see [SECURITY.md](SECURITY.md) |
| Logical registration republish (re-sign) | First-writer-wins no-op for publish / tip / alias / flush / key-reveal — see [SECURITY.md](SECURITY.md) |
| Peer misbehavior / scoring | Implemented (integrity, pin, session, contract ops, logical-register, nest cap, temp ban) — see [SECURITY.md](SECURITY.md) |
| P2P_RELAY amplification | Mitigated: bit-identical outer forward + nest depth cap + relay-as-is pin; gossip hop remains advisory |
| Chat mesh amplify | Mitigated: per-origin relay budget (`CHAT_MAX_RELAYS_*`) |
| Oversize wire frames | Mitigated: drop before parse/crypto (`HEADER_SIZE + MAX_MESSAGE_SIZE`) |
| Inventory HTLC address spoof | Mitigated: rebuild+match (`validateInventoryHtlcOffer`); AMP signer binding when present |
| Blob/sealed memory growth | Mitigated: pending transfer / sealed / relay-route caps |
| Directed onion (`P2P_FORWARD`) | Implemented (peel/forward, TTL, bounce guard; peel skips last-hop hard disconnect; no session rebind / mesh side-effects on peel) — **no hop encryption**; see [docs/P2P_FORWARD.md](docs/P2P_FORWARD.md) |
| L1 document HTLC helpers | Implemented in core; treat as RC reference, not mainnet-hardened market |
| Application contract sandbox | **Not** claimed — `Machine.define` binds host JS; see [PUBLIC_API.md](PUBLIC_API.md) |
| External security review | **Outstanding** before dropping “experimental” language |
| npm audit (runtime) | Track `npm run report:security` → `reports/SECURITY-AUDIT.md`; remaining highs historically under honkit (docs toolchain) |

## Known gaps (do not paper over)

1. **No isolate/vm for Programs** — `javascript` Programs register functions into the host `Machine`. Resource limit is primarily `MACHINE_MAX_MEMORY`, not step/gas isolation.
2. **Distributed execution composition** — Beacon epochs, federation sign rounds, and HTTP binders live in Hub / `@fabric/http`. Core provides helpers only.
3. **PROTOCOL history** — Older root protocol sketches were stale; [PROTOCOL.md](PROTOCOL.md) now redirects to [docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md).
4. **CLI `settings/local.js`** — Gitignored operator overlay. Packaged installs should ship/copy [settings/local.example.js](settings/local.example.js); shell loads example when local is absent.
5. **Exact Node pin** — `engines.node` is `24.15.0`. Documented for CI parity; broad consumers may need a range in a later release.

## Recommendations before a non-experimental tag

- [ ] Third-party review of `types/peer.js`, `functions/inventoryHtlc.js`, `functions/documentSealedExchange.js`, `functions/publishedDocumentEnvelope.js`
- [ ] Run `npm run ci` + `npm run test:fuzz` on a clean tree
- [ ] Freeze [PUBLIC_API.md](PUBLIC_API.md) import map; keep `package.json` `files` whitelist green
- [ ] Coordinate Hub / `@fabric/http` pins to the tagged core ([docs/PRODUCTION.md](docs/PRODUCTION.md))
- [ ] Keep release claim scoped: Peer + document helpers + local Program/Machine — not “hardened dapp sandbox”

## Disclosure

Report vulnerabilities per [SECURITY.md](SECURITY.md) / project README contacts
(`security@fabric.pub` where listed in operator docs).
