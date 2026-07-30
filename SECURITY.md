# Security
Fabric aims to maximize the security of a sensible default configuration while keeping dependencies understandable and reviewable.

## Objectives
- Secure defaults for the reference client (`@fabric/core`)
- Minimal attack surface where practical
- Clear separation between **experimental** APIs and **release** commitments (see [CHANGELOG.md](CHANGELOG.md))

## P2P gossip (`P2P_PEER_GOSSIP`)
Relay of gossip is bounded to reduce amplification DoS: **logical payload** deduplication (stable hash over `type` + `object` sans `gossipHop`), **`gossipHop` TTL** (default 5, decremented on each relay), **per-origin relay budget** per rolling minute (default 60), and **FIFO-capped** wire-hash and payload caches. See `constants.js` (`GOSSIP_*`, `PEER_MAX_WIRE_HASH_CACHE`) and `Peer` `settings.gossip`.

## P2P peering offers (`P2P_PEERING_OFFER`)
Relay uses the same class of controls as gossip, with separate state: logical dedup (hash over `type` + `object` sans `peeringHop`), **`peeringHop` TTL** (default 5), **per-origin relay budget** per rolling minute (default 60), **FIFO-capped** payload cache, and a **bounded, deduped** candidate queue for offered addresses (`PEER_MAX_CANDIDATES_QUEUE`, default 128). See `constants.js` (`PEERING_OFFER_*`, `PEER_MAX_CANDIDATES_QUEUE`) and `Peer` `settings.peering`.

## Logical first-writer-wins registration
Exact wire duplicates are already dropped via the FIFO-capped wire-hash cache (`PEER_MAX_WIRE_HASH_CACHE`). Separately, **registration-style** frames also no-op when the *logical* payload was already claimed — including **re-signed** copies of the same body (different AMP signature → different wire hash). Types include:

- `CONTRACT_PUBLISH` (Actor id — no allow-list merge / emit / relay on republish)
- `DOCUMENT_PUBLISH` / `DocumentPublish` (`documentId` + purchase content hash)
- `P2P_DOCUMENT_PUBLISH` pricing (`hash` + `rate` + `contentHash`)
- `CONTRACT_PROPOSAL` (`contractId` + merkle root)
- `P2P_PEER_ANNOUNCE` / `P2P_STATE_ANNOUNCE` (Actor id of announce / state)
- `BitcoinBlock` / `BITCOIN_BLOCK` (tip / hash)
- `P2P_FLUSH_CHAIN` / `FlushChain` (`snapshotBlockHash`)
- `P2P_PEER_ALIAS` (signer + nickname)
- `DocumentContentKeyReveal` (`documentId` + payment/key hex)

Cache size: `PEER_MAX_LOGICAL_REGISTER_CACHE` (default 10000), overridable via `settings.logicalRegister.maxCache`. **Not** in this list: chat (intentional repeats), session handshake, inventory request/response (ephemeral), `P2P_FILE_SEND` (blob ingest has its own rules), `CONTRACT_MESSAGE` (mutations — unauthorized ops are hard-punished separately). Gossip / peering offers keep their dedicated payload caches.

## Directed onion (`P2P_FORWARD`)
Source-routed nesting for IP-hiding delivery (see [docs/P2P_FORWARD.md](docs/P2P_FORWARD.md), [PRIVACY.md](PRIVACY.md)):

- Outer frames are **relay-as-is** (path-builder signature; TCP peer pin not required).
- Peel when `nextPeer` matches local x-only pubkey; otherwise forward **bit-identical** to that peer only (no mesh flood).
- Drop `ttl === 0`; refuse bounce to the inbound origin; inbound credit cost default 4 (`settings.wireTraffic.forwardCreditCost`).
- **Accepted risk:** hop IDs and inner payload are cleartext at each layer unless the app seals content. Not Sphinx.

## Peer scoring / misbehavior
Registry score (Bitcoin Core–style) is earned on ping-gated `P2P_PONG` and spent for trust (`flushChainMinTrustedScore`, `relayFromTrustedPeers`). Misbehavior lowers score via `_applyPeerMisbehavior` / `_derankPeerForWireTraffic`. New peers start at **0**, so hard offenses also **disconnect** the socket (de-rank alone is ineffective at the floor).

| Offense | Default penalty | Disconnect? |
|---------|-----------------|-------------|
| Body hash mismatch | 100 | yes |
| Invalid signature | 100 | yes |
| Signer ≠ pinned peer (non-relay-as-is) | 100 | yes |
| Session key violation | 240 | yes |
| `CONTRACT_MESSAGE` ops not on allow-list | 80 | yes |
| `CONTRACT_PUBLISH` logical dup, **different** prior signer | 40 | no |
| Other logical-register duplicates | 8, once per origin per window | no |
| Inbound wire credit overflow | 22, once per window | no |

Exact wire duplicates remain a silent drop (no score change). Wire-hash dedup remembers a frame only **after** body-hash + BIP-340 verify succeed (junk cannot fill the cache). Tunables: `settings.peerScore.*` and `settings.wireTraffic.*` (defaults in `constants.js` as `PEER_SCORE_*`). Set `peerScore.disconnectOnHardMisbehavior: false` to derank without destroy.

## Operator-facing docs
| Doc | Use |
|-----|-----|
| [PUBLIC_API.md](PUBLIC_API.md) | Frozen leaf imports + what 0.1 does / does not claim |
| [DEVELOPERS.md](DEVELOPERS.md) | Contributor workflow, core types, tests |
| [PRIVACY.md](PRIVACY.md) | What is / is not hidden from peers and observers |
| [AUDIT.md](AUDIT.md) | Known issues and recommendations |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Node version, native addons, downstream alignment |
| [docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md) | Canonical wire header (via [PROTOCOL.md](PROTOCOL.md)) |

## Process
1. Before large changes, run **`npm run ci`** (full test suite).
2. For dependency and coverage reports: **`npm run reports`** (install log, coverage, TODO grep — may be slow).
3. Review **`npm audit`** results before release tags; record exceptions in the release notes if needed.
4. **Never** commit seeds, `stores/` production data, or RPC passwords (see [docs/PRODUCTION.md](docs/PRODUCTION.md)).

## Disclosure
Report security issues through the contact in [TODO.md](TODO.md) / project README as applicable.
