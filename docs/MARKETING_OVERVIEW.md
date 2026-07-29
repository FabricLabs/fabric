# Marketing overview — `@fabric/core`

## One-line pitch

**`@fabric/core`** is the **0.1 RC Fabric reference client**: NOISE **P2P** with bounded gossip/discovery, **Bitcoin document-exchange helpers**, and **local** `Program` / `Machine` execution — not a sandboxed remote dapp VM.

## Three bullets
1. **Protocol-shaped** — `Message`, `Peer`, `Key`, and typed constants; JS is the wire oracle ([MESSAGE_BODY.md](MESSAGE_BODY.md)).
2. **Bitcoin-grounded** — Inventory HTLC / sealed document helpers for prototypes and Hub-class products.
3. **Trilogy anchor** — **`@fabric/core`** (this) + **`@fabric/http`** + **hub.fabric.pub**; Beacon/federation composition lives in Hub.

## Audiences
| Audience | Message |
|----------|---------|
| **Protocol / research** | “Reference client for Fabric P2P and document-settlement experiments.” |
| **Application teams** | “Import leaf APIs from PUBLIC_API.md; add HTTP via @fabric/http or Hub as the operator appliance.” |
| **Infrastructure** | “Node 24.15, `npm run ci` before you pin a release.” |

## Release status
**0.1.0-RC1** — **experimental reference**; scoped claim in [PUBLIC_API.md](../PUBLIC_API.md). Run **`npm run ci`** before tagging releases consumed by Hub. Do not market as production-hardened sandbox execution.

## Links

- [README.md](../README.md)
- [PUBLIC_API.md](../PUBLIC_API.md)
- [PRODUCTION.md](PRODUCTION.md)
- [AUDIT.md](../AUDIT.md)
- [CHANGELOG.md](../CHANGELOG.md)
