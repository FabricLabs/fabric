# The Fabric Protocol
Fabric implements a TCP-based networking protocol for establishing and executing
peer-to-peer agreements. **JavaScript (`types/message.js`, `types/peer.js`) is the
canonical protocol definition for `@fabric/core` 0.1.x.**

## Canonical wire documentation (read these)

| Doc | Purpose |
|-----|---------|
| [docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md) | **Current** 208-byte header, body integrity (`hash` = double-SHA256), Lightning-style `preimage`, typed body fields |
| [docs/C-JS-PARITY.md](docs/C-JS-PARITY.md) | C addon vs JS oracle; signing tag `Fabric/Message` |
| [MESSAGES.md](MESSAGES.md) | Message semantics and opcodes |
| [SECURITY.md](SECURITY.md) | Gossip / peering-offer amplification bounds |
| [PUBLIC_API.md](PUBLIC_API.md) | Frozen leaf imports for 0.1 consumers |

Do **not** treat older header sketches in this file’s git history as normative.
Historical drafts and analysis notes are listed in [docs/NON_CANONICAL.md](docs/NON_CANONICAL.md).

## Wire frame (summary)

**Header (208 bytes)** ‖ **body** (`size` bytes):

| Offset | Size | Field |
|--------|------|--------|
| 0 | 4 | magic |
| 4 | 4 | version (`0x01`) |
| 8 | 32 | parent |
| 40 | 32 | author |
| 72 | 4 | type (opcode) |
| 76 | 4 | size |
| 80 | 32 | hash = double-SHA256(body) |
| 112 | 32 | preimage (payment secret; zeros if none) |
| 144 | 64 | BIP-340 signature |
| 208 | … | body |

Inbound peers **drop** frames whose body hash does not match the header, then
verify the BIP-340 author signature before dispatch. See `types/peer.js`.

## Peering (session)

Peers are identified by Fabric identity (compressed secp256k1 public key /
related encodings). Session open:

```
INITIATOR                     COUNTERPARTY
00: CONNECT
01: SESSION_OFFER ->
02:                               VALIDATE
03:                        <- SESSION_OPEN
04: READY
```

Gossip discovery uses first-class opcodes `P2P_PEER_GOSSIP` / `P2P_PEERING_OFFER`
with hop TTL and per-origin relay budgets ([SECURITY.md](SECURITY.md)).
Which AMP types are public flood vs directed/session is
[`functions/gossipNetwork.js`](functions/gossipNetwork.js)
(`node scripts/gossip-relay.js --list-types`).

## Compute & contracts

Local execution uses `Program` + `Machine` ([docs/PROGRAM.md](docs/PROGRAM.md)).
Distributed Beacon / federation sealing is composed by Hub on top of core helpers
([docs/DISTRIBUTED_EXECUTION.md](docs/DISTRIBUTED_EXECUTION.md)) — not a standalone
sandboxed dapp runtime in this package alone.

## CLI

```
$ fabric
/connect <pubkey>@hub.fabric.pub:7777
```

See [QUICKSTART.md](QUICKSTART.md) and [docs/CLI.md](docs/CLI.md).

[fabric-identity]: IDENTITY.md
