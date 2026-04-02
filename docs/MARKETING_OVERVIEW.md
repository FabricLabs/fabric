# Marketing overview — `@fabric/core`

## One-line pitch

**`@fabric/core`** is the **Fabric reference implementation**: a JavaScript **peer-to-peer** stack with **Bitcoin-aware** contracts, **`Message`** / **actor** patterns, and services (Bitcoin, Lightning) for apps that want **programmable agreements** without a central coordinator.

## Three bullets
1. **Protocol-shaped** — `Message`, `Peer`, `Key`, merkle collections, and typed constants mirror the Fabric protocol narrative.
2. **Bitcoin-grounded** — Bonding and verification patterns align with on-chain reality; suitable for serious prototypes and Hub-class products.
3. **Trilogy anchor** — **`@fabric/core`** (this) + **`@fabric/http`** + **hub.fabric.pub** form the default Fabric Labs stack.

## Audiences
| Audience | Message |
|----------|---------|
| **Protocol / research** | “Reference client for experimenting with Fabric agreements and P2P message flow.” |
| **Application teams** | “Embed Peer + Message; add HTTP via @fabric/http or ship Hub as the operator appliance.” |
| **Infrastructure** | “Node 22, native deps, mocha `npm run ci` before you pin a release.” |

## Release status
**0.1.0-RC1** — experimental; run **`npm run ci`** and native build checks before tagging releases consumed by Hub.

## Links

- [README.md](../README.md)
- [PRODUCTION.md](PRODUCTION.md)
- [CHANGELOG.md](../CHANGELOG.md)
