# Security
Fabric aims to maximize the security of a sensible default configuration while keeping dependencies understandable and reviewable.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md). Production march: [docs/PRODUCTION_MARCH.md](docs/PRODUCTION_MARCH.md).

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack, logical front-running)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody or contract acceptance

Bitcoin L1 finality and operator key hygiene remain outside this document’s guarantees. Suite apps SHOULD document the same adversarial assumption and keep fail-closed defaults for auth, allowlists, and spend paths.

**Basics coverage:** [`tests/fabric.circuit.js`](tests/fabric.circuit.js) (blinded-execution role minimum + phishing hub rejection via allowlist helpers when present). Broader Peer adversarial contracts live in [`tests/fabric.peer.adversarial.js`](tests/fabric.peer.adversarial.js).

## Blinded execution (composition scaffold)
[`functions/blindedExecutionCircuit.js`](functions/blindedExecutionCircuit.js) commits garbler publish → ContractProposal accept/reject → content-addressed circuit digests → optional hashlock Taproot. It is **not** Yao gate garbling / OT. Do not treat `Circuit#scramble` as cryptographic evaluation. Real GC remains a future backend behind the same digests ([docs/PROGRAM.md](docs/PROGRAM.md)).

## Objectives
- Secure defaults for the reference client (`@fabric/core`)
- Minimal attack surface where practical
- Clear separation between **experimental** APIs and **release** commitments (see [CHANGELOG.md](CHANGELOG.md))

## P2P gossip (`P2P_PEER_GOSSIP`)
Relay of gossip is bounded to reduce amplification DoS: **logical payload** deduplication (stable hash over `type` + `object` sans `gossipHop`), **advisory `gossipHop`** (default max 5; frames are forwarded **bit-identical**, so hop is **not** rewritten/decremented on each hop — diameter control is wire-hash + logical dedup + per-origin budget), **per-origin relay budget** per rolling minute (default 60), and **FIFO-capped** wire-hash and payload caches. See `constants.js` (`GOSSIP_*`, `PEER_MAX_WIRE_HASH_CACHE`) and `Peer` `settings.gossip`.

## P2P peering offers (`P2P_PEERING_OFFER`)
Relay uses the same class of controls as gossip, with separate state: logical dedup (hash over `type` + `object` sans `peeringHop`), **advisory `peeringHop`** (bit-identical forward; not decremented), **per-origin relay budget** per rolling minute (default 60), **FIFO-capped** payload cache, and a **bounded, deduped** candidate queue for offered addresses (`PEER_MAX_CANDIDATES_QUEUE`, default 128). See `constants.js` (`PEERING_OFFER_*`, `PEER_MAX_CANDIDATES_QUEUE`) and `Peer` `settings.peering`.

When gossip or peering arrives inside a foreign-signed `P2P_RELAY` (or onion peel), the **outer** envelope is what mesh-floods; the unwrapped inner is local-observe only (no last-hop budget burn, no candidate enqueue, no second inner `relayFrom`) — same trust boundary as peeled chat/alias.

## P2P_RELAY mesh flood
Inbound `P2P_RELAY` unwraps the inner AMP body for local handling, then forwards the **original outer envelope bit-identical** (never hop-re-wraps a new signed `P2P_RELAY`). Nested `P2P_RELAY` unwrap depth is capped (`PEER_MAX_RELAY_NEST_DEPTH` / `settings.peerScore.maxRelayNestDepth`). Prefer `P2P_FORWARD` for directed/onion paths ([docs/P2P_FORWARD.md](docs/P2P_FORWARD.md)).

`P2P_RELAY` is **relay-as-is** for TCP peer pin checks (same class as `P2P_FORWARD`): the AMP author is the flood originator, not the immediate forwarder. Without that exemption, bit-identical flood would hard-ban honest neighbors on `signer-pin-mismatch`. When the outer AMP signer ≠ the TCP peer pin, unwrapped inners also use `relayedAsIs` so pin/integrity/nest failures do not cut that forwarder (direct senders who sign their own `P2P_RELAY` remain punishable).

**Outermost-only flood:** after peel or `P2P_RELAY` unwrap (`skipRelayFlood`), inners are local-observe only. That includes chat, alias, gossip, peering, `CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` / `CONTRACT_PROPOSAL`, `BitcoinBlock` / `BITCOIN_BLOCK`, `DocumentRequest`, and inventory request/response — never a second `relayFrom` under the TCP last hop. Implementation uses a single `meshDeliveryContext` (`allowMeshRelay` / `allowTcpOriginSideEffects`) so new types cannot drift.

## Logical first-writer-wins registration
Exact wire duplicates are already dropped via the FIFO-capped wire-hash cache (`PEER_MAX_WIRE_HASH_CACHE`). Separately, **registration-style** frames also no-op when the *logical* payload was already claimed — including **re-signed** copies of the same body (different AMP signature → different wire hash). Types include:

- `CONTRACT_PUBLISH` (Actor id — no allow-list merge / emit / relay on republish; wire signer must already appear in body `parties`/`validators`/`owners`/`members`/`authorities` when those arrays are present; patch allow-list is built **only** from those arrays — never from AMP signer alone, so a content-identical front-run cannot elevate an attacker)
- `DOCUMENT_PUBLISH` / `DocumentPublish` (`documentId` + purchase content hash)
- `P2P_DOCUMENT_PUBLISH` pricing (`hash` + `rate` + `contentHash`)
- `CONTRACT_PROPOSAL` (`contractId` + merkle root)
- `P2P_PEER_ANNOUNCE` / `P2P_STATE_ANNOUNCE` (Actor id of announce / state)
- `BitcoinBlock` / `BITCOIN_BLOCK` (tip / hash)
- `P2P_FLUSH_CHAIN` / `FlushChain` (`snapshotBlockHash`)
- `P2P_PEER_ALIAS` (signer + nickname)
- `DocumentContentKeyReveal` (`documentId` + `SHA256(keyHex)` — only well-formed preimages; claim runs **after** successful open so junk public-hash frames cannot burn the slot)

Cache size: `PEER_MAX_LOGICAL_REGISTER_CACHE` (default 10000), overridable via `settings.logicalRegister.maxCache`. **Not** in this list: chat (intentional repeats), session handshake, inventory request/response (ephemeral), `P2P_FILE_SEND` (blob ingest has its own rules), `CONTRACT_MESSAGE` (mutations — unauthorized ops are hard-punished separately). Gossip / peering offers keep their dedicated payload caches.

## Directed onion (`P2P_FORWARD`)
Source-routed nesting for IP-hiding delivery (see [docs/P2P_FORWARD.md](docs/P2P_FORWARD.md), [PRIVACY.md](PRIVACY.md)):

- Outer frames are **relay-as-is** (path-builder signature; TCP peer pin not required).
- Peel when `nextPeer` matches local x-only pubkey; otherwise forward **bit-identical** to that peer only (no mesh flood).
- Drop `ttl === 0`; refuse bounce to the inbound origin; inbound credit cost default 4 (`settings.wireTraffic.forwardCreditCost`).
- Peeled `inner` delivery uses `peeledForward` so body-hash / bad-sig / pin / forbidden `CONTRACT_MESSAGE` ops / session-key violations / nested-`P2P_RELAY` depth exceed **do not** hard-disconnect or derank the TCP last hop (attackers must not cut honest relay↔destination links by laundering a bad inner).
- Peeled (and relay-as-is) `P2P_SESSION_OFFER` / `P2P_SESSION_OPEN` are **ignored** before peer-registry / `_addressToId` mutation or `SESSION_OPEN` replies — a valid attacker-signed handshake must not rebind the last hop’s pin.
- Peeled `P2P_CHAT_MESSAGE`, `P2P_PEERING_OFFER`, `P2P_PEER_GOSSIP`, and `P2P_PEER_ANNOUNCE` deliver/observe locally only (no mesh `relayFrom`, no chat/peering/gossip budget burn, no candidate enqueue under the TCP last hop).
- Peeled / relay-as-is `P2P_PEER_ALIAS` observes/emits only — does not set `connections[]._alias`, bind registry `address` to the last hop, or mesh-relay under that hop.
- Peeled / relay-as-is `DocumentRequest` observes/emits only — does **not** auto-fulfill or queue pending delivery to the TCP last hop, and does not mesh-relay or private-rewrite under that hop.
- Peeled / relay-as-is inventory requests do not reply `INVENTORY_RESPONSE` to the last hop or second-flood the request.
- Peeled / relay-as-is inners do **not** re-debit the TCP hop’s inbound wire-traffic credits (outer envelope already paid).
- Peeled / relay-as-is logical-register duplicates (including `CONTRACT_PUBLISH` hijack) do not soft/hijack-penalize the TCP last hop.
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
| Nested `P2P_RELAY` beyond nest cap | 60 | yes |

Exact wire duplicates remain a silent drop (no score change). Wire-hash dedup remembers a frame only **after** body-hash + BIP-340 verify succeed (junk cannot fill the cache). Hard disconnects also install a temporary **ban** (`settings.peerScore.banTtlMs`, default 15m) on connection address and known pubkey — dial and inbound are refused until expiry. Tunables: `settings.peerScore.*` and `settings.wireTraffic.*` (defaults in `constants.js` as `PEER_SCORE_*` / `PEER_BAN_TTL_MS`). Set `peerScore.disconnectOnHardMisbehavior: false` to derank without destroy; `banOnHardMisbehavior: false` to skip bans.

**Document delivery default:** `autoFulfillDocumentRequests` is **false** (consent / approve queue). Opt in for trusted meshes.

## Chat mesh amplify
`P2P_CHAT_MESSAGE` still emits locally, but mesh `relayFrom` is **per-origin rate-limited** (`CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE` / `settings.chat.maxRelaysPerOriginPerMinute`, default 30/min).

## Inbound frame size
Wire frames larger than `HEADER_SIZE + MAX_MESSAGE_SIZE` (override body via `settings.maxMessageSize`) **or shorter than `HEADER_SIZE`** are dropped **before** parse / body-hash / signature work. Unparseable buffers are dropped the same way (no score / ban). Truncated frames are not treated as body-hash mismatches — that would hard-ban a TCP peer for a partial NOISE chunk.

## Strict Protocol V1 (test contract)
Adversarial Peer coverage under the assumption that **NOISE payloads are raw, well-formed Fabric Messages** (not random bytes) lives in [`tests/fabric.peer.adversarial.js`](tests/fabric.peer.adversarial.js): unknown-opcode policy (`UNKNOWN_MESSAGE` — must not alias to `P2P_BASE_MESSAGE`), hop/budget bounds, and first-class opcode isolation from generic JSON carriers. Parser crash fuzz remains in `tests/fuzz/` and is **not** counted as semantic adversarial coverage.

**Generic carrier:** `P2P_BASE_MESSAGE` / `GENERIC_MESSAGE` JSON bodies must not escalate first-class mesh/session opcodes (`P2P_PEERING_OFFER`, `P2P_PEER_GOSSIP`, `CONTRACT_MESSAGE`, …). Legacy inventory continues to use inner type `INVENTORY_REQUEST` (not the `P2P_` wire name).

**Typed bodies:** registered field schemas (`Message.fromFields` / `tryParseMessageBody`) cover
`P2P_PING` / `P2P_PONG` / `P2P_FORWARD` / `P2P_PEER_GOSSIP` / `P2P_PEERING_OFFER` /
`P2P_PEER_ANNOUNCE`. Peer typed handlers accept **JSON or field-layout forms**. Chat/alias remain
raw UTF-8. Coverage: `tests/fabric.peer.adversarial.js` plus `tests/fabric.message.js`.

## Application Resource Contract accumulate
`functions/contractMessageAccumulate.ingestMessageBuffer` folds signed `CONTRACT_MESSAGE` frames into a tip. **Signer mutations** (`GroupChange`, `GroupChangeProposal` / `GroupChangeVote`, federation invite (+ response), capability grants, withdrawal request/witness, journal request/batch/state) require the AMP author to be in **genesis.signers** (when tip members are empty) or the **current tip member set**, or to present a **verified** `OP_CONTRACT_SIGN` Token (`meta.capabilityToken`) issued by a current signer. **`GroupChat`** and other non-mutation body types (including custom genesis `primitives.messageTypes`) require author ∈ tip/genesis **reader ∪ signer** set (or verified `OP_CONTRACT_READ` / `OP_CONTRACT_SIGN`). **`ContractWithdrawalWitness`** must bind `signer` to the AMP author, carry BIP340 `signature` over `fabric:contract-withdrawal-witness:1:…`, and match the pending request’s tip fields. AMP signature alone is not sufficient. Body `type` must appear in genesis `primitives.messageTypes` when declared (**empty declared list = deny-all**); otherwise only known core `CONTRACT_BODY_TYPES` are accepted. **Withdrawals** must bind `stateDigest` + `bitcoinBlockHash` to the tip at request time (`functions/contractSpend`). See [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

**Outstanding (seals / accumulate):** tip-bound and participant AES-GCM seals bind scheme (+ tip / contract / ephemeral) as AAD. Journal / re-fold caps drop compactable rows by hex-hash order (`maxJournalEntries`, hard cap 20000). Genesis `bitcoinAnchor.blockHash` is only folded when it is 64-hex (same gate as `meta.bitcoinBlockHash`). Explicit tip `signers: []` no longer widens `tipSpendKeys` / `resolveSpend` to participant `members`.

~~**Withdrawal `requestId` bind**~~ — `validateWithdrawalRequest` requires 64-hex `requestId` equal to `computeWithdrawalRequestId` over destination/fee/vault/… so co-signer witnesses cannot divert funds under a borrowed id.

**Blinded-execution decisions:** `recordProposalDecision` verifies BIP340 over `decisionSigningMessage` v2 (`at` bound). Same actor/proposal/decision/`at` is idempotent; a different `at` conflicts. Still not Yao GC.

**GroupChangeProposal votes:** BIP340 over `signingStringForGroupChangeProposal` v2 (`members` / `signers` bound as canonical x-only lists). Quorum is genesis/tip k-of-n; a proposer-chosen `threshold` cannot lower the bar. Colliding proposal `id` values cannot reuse honest votes on a swapped roster.

**Identity coin types:** Fabric protocol derivation uses **7777** on Bitcoin mainnet and **7778** otherwise ([IDENTITY.md](IDENTITY.md)). Do not mix Fabric coin-type keys with BIP44 coin-type-0 Bitcoin funds. Downstream Hub/Passport hard-codes of `7778` should pass `network` into `fabricIdentityDerivationPath` when promoting to mainnet.

**Still open (non-blocking for this PR pass):** eager `messageHex` on Peer hot paths; `contractId` → `contractIdentifier` rename; Hub/Passport callers still on hard-coded `7778` until they adopt `fabricIdentityDerivationPath`; `API.md` index sync via `make:api` for gossip / parse / `resolveSpend` option docs. Blinded-execution remains a scaffold (not Yao GC) even with signed decisions + hashlock+pubkey leaves — `decisionSigningMessage` v2 binds `at` (PR #183 Medium closed). GroupChangeProposal votes bind canonical `members` / `signers` (v2; PR #183 High closed). Beacon federation rounds stop collecting at `ready`; core `Beacon#submitFederationEpochSignature` idempotently finalizes already-`ready` rounds if epoch-chain persist fails ([docs/CONTRACTS.md](docs/CONTRACTS.md) §8 item 25). Peering self-dial suppress uses verified AMP signer (`verifiedPubkey`) only — advertised `obj.pubkey` is informational (FIFO-capped). OP_RETURN hallmarks ([docs/STATECHAIN.md](docs/STATECHAIN.md) / `functions/fabricHallmark`) are encode/verify in core; Hub opt-in publish+scan is separate — no P2P hallmark broadcast. Evaluator acceptance for blinded-execution finalization excludes the garbler key.

~~**Beacon/ARC publish authority fail-open**~~ — `Peer.collectContractAuthorityPubkeys` includes nested `members.signers` / `spendPolicy.validators` so Beacon genesis front-runs by non-validators are rejected.

## Inventory HTLC binding
Buyers must rebuild the buyer-bound P2TR (`validateInventoryHtlcOffer`) and must not fund a seller-advertised `paymentAddress` that does not match. When an AMP signer is known (`inventoryResponse.signerPubkeyHex` / offer `ampSignerPubkey` / HTLC `sellerPublicKeyHex`), it must match the resolved seller x-only key before funding.

Paid CLI `/confirm` fails closed without Hub confirmation or successful local L1 amount verify. `authorizeDocumentKeyReveal` requires a `settlementId` or `txid`. Private DocumentRequest rewrite is directed (never mesh-broadcast). Sealed multi-blob purchase plans stay on a single seller.

## Memory caps (document path)
- `DocumentBlobTransferBook`: max incomplete transfers (`MAX_PENDING_BLOB_TRANSFERS`, default 64) + TTL eviction
- Pending sealed ciphertext: `PEER_MAX_PENDING_SEALED_DELIVERIES` (default 32)
- Private DocumentRequest reverse routes: `PEER_MAX_DOCUMENT_RELAY_ROUTES` (default 256)

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

## MuSig2 (BIP-327)
`functions/musig2` is **n-of-n** Schnorr aggregation. It does not replace t-of-n Beacon / GroupChange quorums (those stay independent BIP-340 counts) and it is not FROST. New Taproot authority ladders with two or more keys use the MuSig2 aggregate as the internal key so all-n can spend the key-path; threshold and CSV failover remain script-path. Session secret nonces are zeroed after `sign` (including when `getSessionValues` fails), after a failed `aggregatePartials`, and when `Peer.stop()` clears stored sessions — reuse leaks keys. TTL expiry and capacity eviction already call `wipeSession()`. Invalid inbound partials stay retryable. Do not trust a caller-supplied aggregate; recompute `keyAgg` from the participant list.

Interactive mesh signing uses the existing `P2P_MUSIG_*` opcodes (`0x4220`–`0x4225`) as **directed TCP** frames only — they are not mesh-flooded (`RELAY_AS_IS`) and must not arrive via peel, foreign `P2P_RELAY`, or a generic JSON carrier. The AMP author must be the contributing pubkey. Peers recompute `aggnonce` locally and reject a mismatched `SEND_PROPOSAL`. Enforced: 16 signers, 4KiB message. Defaults (overridable via `config.musig2`): **`autoAccept: false`** (inbound START does not auto-create a session or produce identity-key partials), 32 sessions (`maxSessions`), 10-minute TTL (`sessionTtlMs`). Set `musig2.autoAccept: true` only for operator-supervised cooperative signing.

## Disclosure
Report vulnerabilities to **`security@fabric.pub`**. Do not file public GitHub issues for undisclosed flaws. See also [AUDIT.md](AUDIT.md).

## Tokens and scaffolds (not auth)
`Token.toString()` is a JWT-shaped MAC with a hardcoded secret (`ffff`). Do not use it for sessions or admin. Hub and Sensemaker issue Schnorr-signed strings (`toSignedString` / node-signed session). `Capability#_generateToken` uses macaroon `rootKey: 'secret'`. `Session.encrypt` / `decrypt` are no-ops.
