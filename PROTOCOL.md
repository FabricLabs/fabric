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
| 8 | 32 | parent (previous `Message.id`; zeros at genesis) |
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

## Forks: hard vs soft

**Status:** Draft guidance for `@fabric/core` 0.1.x (`VERSION_NUMBER = 0x01`).  
**Audience:** Core / Hub / app authors deciding whether a change can roll out gradually or needs a coordinated cut.  
**Related:** [MESSAGE_BODY.md](docs/MESSAGE_BODY.md), [MESSAGES.md](MESSAGES.md), [POLICY.md](POLICY.md), [CHAIN.md](docs/CHAIN.md), [CONTRACTS.md](docs/CONTRACTS.md), [APPLICATION_NAMESPACES.md](docs/APPLICATION_NAMESPACES.md), [C-JS-PARITY.md](docs/C-JS-PARITY.md).

Fabric does **not** ship Bitcoin-style soft-fork activation bits. Use the
Bitcoin vocabulary as an analogy for **compatibility class**, then map every
change onto Fabric’s own planes (below).

---

### Working definitions

| Class | Mesh / network effect | Rollout |
|-------|----------------------|---------|
| **Soft-fork-like** | Old peers stay on the mesh. They **ignore**, **reject**, or **fail closed** on new traffic; upgraded peers enforce stricter rules among themselves. | Gradual; optional validators / apps / policy. |
| **Hard-fork-like** | Upgraded and non-upgraded nodes **diverge permanently** on parse, tip, identity, or digests. Honest old peers cannot validate the new tip (or new peers cannot speak the old one). | Coordinated cut; pin Hub / apps / C addon together. |

**POLICY today:** protocol version is **`0x01`**; **backward compatibility is not guaranteed** for a future version bump. Prefer soft patterns under `0x01` over bumping the wire version.

---

### Three planes (do not conflate)

A change can be soft on one plane and hard on another.

| Plane | What “consensus” means here | Soft-like | Hard-like |
|-------|----------------------------|-----------|-----------|
| **A — AMP mesh** | Peer accepts / relays a 208-byte AMP frame | New opcode old peers ignore; unknown `CONTRACT_MESSAGE` body | Header layout, opcode reuse, body schema for an existing opcode |
| **B — Beacon / federation digests** | k-of-n epoch seal, sidechain / contracts roots | Fail-closed when validators unset; observe-only patches | Changing `signingStringForBeaconEpoch`, sidechain digests, federation tip rules |
| **C — L1 Taproot identity** | P2TR address / vault spend path | Never attaching a new leaf (no address change) | `internalKeyMode`, program hashlock leaf, genesis → Actor id |

Example: a soft mesh opcode that carries a new Taproot policy can still **hard-fork coins** (plane C) even if Peer gossip stays compatible (plane A).

---

### Soft-fork-like patterns (prefer these)

1. **Allocate a new unused opcode** — do **not** renumber or gap-fill (`MESSAGES.md`). Keep Lightning in `0x2000–0x2FFF`.
2. **Inner application types** under `CONTRACT_MESSAGE` — apps ignore unknown namespace / body types ([APPLICATION_NAMESPACES.md](docs/APPLICATION_NAMESPACES.md)).
3. **Fail-closed when unconfigured** — e.g. `SIDECHAIN_STATE_PATCH` / `FederationSign*` require a local validator set; empty set → reject, do not apply ([types/peer.js](types/peer.js)).
4. **Optional policy** — stricter `sidechainPolicy` / Machine opcode allow-lists only bind participants that opted in ([CONTRACTS.md](docs/CONTRACTS.md), [PROGRAM.md](docs/PROGRAM.md)).
5. **Local Peer scoring / ban tunables** — [SECURITY.md](SECURITY.md); not wire consensus.
6. **Manifest v1 reject locally** — peers without that program simply do not run it ([fabricProgramManifest.js](functions/fabricProgramManifest.js)).

---

### Hard-fork-like patterns (coordinate or avoid)

1. **AMP header** — `VERSION_NUMBER`, `HEADER_SIZE` (208), field offsets, `hash` / `preimage` semantics ([constants.js](constants.js), [types/message.js](types/message.js), [MESSAGE_BODY.md](docs/MESSAGE_BODY.md)). Keep C (`src/constants.h`) in lockstep ([C-JS-PARITY.md](docs/C-JS-PARITY.md)).
2. **Opcode remap / reuse** — same numeric type, new meaning; or packing that renumbers existing codes.
3. **Typed body schemas** for an existing first-class opcode ([messageBodyCodec](functions/messageBodyCodec.js) / Message field registries).
4. **Beacon signing string / epoch digests** — [beaconFederationSigning.js](functions/beaconFederationSigning.js); threshold never meets or wrong seals.
5. **Sidechain digest / clock formula** — [sidechainState.js](functions/sidechainState.js); Beacon observers diverge.
6. **Chain tip rules** — `consensus: 'federation'|'gossip'|'pow'` mismatch on merge; federation `parent === tip` ([types/chain.js](types/chain.js), [CHAIN.md](docs/CHAIN.md)).
7. **Taproot address identity** — `internalKeyMode` (`nums` vs `musig2`), program-run hashlock leaves ([policy.js](types/policy.js): `Policy.compile`, `Policy.withRunHashlock`). Overlay Hub Accept; do **not** freeze mode into Beacon genesis.
8. **ARC genesis → `Actor(definition).id`** — republishing a different genesis creates a **new namespace** ([CONTRACTS.md](docs/CONTRACTS.md)).
9. **Operator identity collapse** — changing xprv / seed / mnemonic precedence ([fabricOperatorIdentity.js](functions/fabricOperatorIdentity.js)) changes who can sign as the node.

---

### Hotspot map (code)

#### Plane A — AMP mesh

| Module | Soft hotspot | Hard hotspot |
|--------|--------------|--------------|
| `types/peer.js` | Unknown generic type ignored; fail-closed federation ingest; observe-only patches | Body-hash / Schnorr drop rules; first-class opcode cases; required witness |
| `types/message.js` | New opcode + decode alias | Header codec; signing over zeroed-signature header+body |
| `constants.js` / `src/constants.h` | New named opcode constant | `VERSION_NUMBER`, `HEADER_SIZE`, remapped type ints |
| `MESSAGES.md` / `WIRE_TYPE_DECODE_ORDER` | Append-only catalog | Gapless renumber |

#### Plane B — Beacon / sidechain

| Module | Soft hotspot | Hard hotspot |
|--------|--------------|--------------|
| `types/beacon.js` | Empty validators never ready | Epoch append / threshold / witness fail-closed semantics once validators set |
| `functions/beaconFederationSigning.js` | — | `canonicalEpochForFederation` / `signingStringForBeaconEpoch` |
| `functions/sidechainState.js` | Stricter path policy (reject patches) | `stateDigest` / `patchCommitmentDigestHex` / clock |
| `functions/fabricProgramManifest.js` | Unknown program not run | Changing what feeds Beacon contracts / sidechain roots |
| `types/chain.js` | Gossip union by id (local) | Federation tip parent rule; consensus mode mismatch |

#### Plane C — Contracts / L1 / identity

| Module | Soft hotspot | Hard hotspot |
|--------|--------------|--------------|
| Inner `CONTRACT_MESSAGE` types | Ignore-unknown apps | Freezing genesis `messageTypes` that exclude prior traffic |
| `CONTRACT_PUBLISH` authority | Empty authority = open publish | Non-empty list + missing signer fail-closed (stricter; coordinate apps) |
| `types/policy.js` (`Policy.compile`) | — | Internal key / leaf set → address |
| `types/policy.js` (`Policy.withRunHashlock`) | Not composing a hashlock | Composing hashlock → new P2TR |
| `functions/fabricOperatorIdentity.js` | — | Key bag precedence / derivation |

---

### Decision checklist

Before merging a protocol-touching change:

1. **Which plane(s)?** A / B / C — list all that move.
2. **Can an old Hub / Peer stay peered?** If no → hard (plane A).
3. **Can an old Beacon validator still sign the same epoch string?** If no → hard (plane B).
4. **Does any P2TR / Actor id / operator pubkey change?** If yes → hard (plane C); plan migration / Accept overlay.
5. **Is the change an unused opcode or inner type?** Prefer that over header or opcode reuse.
6. **C addon / Hub / Passport pins?** Hard wire changes need a suite cut (`@fabric/core` tag before Hub / http bumps — see [PRODUCTION.md](docs/PRODUCTION.md)).
7. **Playnet / production seeds** — opcode remaps break long-lived playnet; treat as intentional network reset.

#### Quick answers

| Change | Class |
|--------|--------|
| New unused AMP opcode + Peer case that old nodes never emit | Soft (A) |
| New `CONTRACT_MESSAGE` body `type` string | Soft (A) if apps ignore-unknown |
| Fail-closed federation when validators unset | Soft (A/B) for unconfigured nodes |
| Reuse opcode `0x….` for a new meaning | Hard (A) |
| Bump `VERSION_NUMBER` or change header size | Hard (A) — declare new protocol |
| Edit Beacon epoch signing string | Hard (B) |
| Switch vault `internalKeyMode` without sweep | Hard (C) |
| Stricter sidechain path policy on one Hub | Soft for that Hub; content may diverge from looser hubs (document operationally) |

---

### Out of scope (for this draft)

- Bitcoin soft-fork activation (version bits, buried deployments).
- Inventing a Fabric soft-fork signaling opcode — not present on `0x01`; propose separately if needed.
- Hub-only HTTP / SPA routes — local API, not AMP consensus (still coordinate if they assume new digests).

When in doubt: **new opcode or inner type**, fail closed for unconfigured peers, and treat digests / Taproot / genesis as **hard** until a migration note exists.

See [QUICKSTART.md](QUICKSTART.md) and [docs/CLI.md](docs/CLI.md).

[fabric-identity]: IDENTITY.md
