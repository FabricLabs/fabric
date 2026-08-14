# Audit notes — `@fabric/core`
Living list of **known issues, accepted risks, and recommendations** for the
0.1.x reference client. This is an internal posture document, not a third-party
audit report.

## Status

| Area | Posture |
|------|---------|
| Wire integrity (body hash + BIP-340) | Implemented; covered by unit/integration tests |
| Gossip / peering-offer amplification | Bounded (advisory hop, per-origin budget, caches); wire-mesh + RELAY-as-is covered in `tests/fabric.peer.gossip-network.js` — see [SECURITY.md](SECURITY.md) |
| Logical registration republish (re-sign) | First-writer-wins no-op for publish / tip / alias / flush / key-reveal; `CONTRACT_PUBLISH` patch rights from body authority arrays only (front-run non-party rejected before claim) — see [SECURITY.md](SECURITY.md) |
| Peer misbehavior / scoring | Implemented (integrity, pin, session, contract ops, logical-register, nest cap, temp ban) — see [SECURITY.md](SECURITY.md) |
| P2P_RELAY amplification | Mitigated: bit-identical outer forward + nest depth cap + relay-as-is pin; gossip hop remains advisory |
| Chat mesh amplify | Mitigated: per-origin relay budget (`CHAT_MAX_RELAYS_*`) |
| Oversize wire frames | Mitigated: drop before parse/crypto (`HEADER_SIZE + MAX_MESSAGE_SIZE`) |
| Inventory HTLC address spoof | Mitigated: rebuild+match (`validateInventoryHtlcOffer`); AMP signer binding when present |
| Paid `/confirm` without L1 proof | Mitigated: fail-closed local verify or Hub `ConfirmInventoryHtlcPayment` (`cliDocumentExchange`) |
| Key reveal from hash echo | Mitigated: `authorizeDocumentKeyReveal` requires `settlementId`/`txid`; `forceReveal` opt-in only; inbound reveal requires key preimage + claim-after-open |
| Private DocumentRequest mesh broadcast | Mitigated: directed relay (`relayPath` / `nextPeer` / fan-out excluding origin) |
| Sealed multi-seller blob plans | Mitigated: `pickBlobPlan` locks sealed docs to one seller |
| Blob/sealed memory growth | Mitigated: pending transfer / sealed / relay-route caps |
| Directed onion (`P2P_FORWARD`) | Implemented (peel/forward, TTL, bounce guard; peel skips last-hop hard disconnect; unified `meshDeliveryContext` — no session/alias rebind / mesh side-effects / DocumentRequest fulfill on peel) — **no hop encryption**; see [docs/P2P_FORWARD.md](docs/P2P_FORWARD.md) |
| Unknown AMP opcodes | Mitigated: decode as `UNKNOWN_MESSAGE` (not `P2P_BASE_MESSAGE`); observe-only. First-class mesh/session types ignored when smuggled via generic JSON carrier — see [tests/protocol-v1/](tests/protocol-v1/README.md) |
| L1 document HTLC helpers | Implemented in core; treat as RC reference, not mainnet-hardened market |
| Application contract sandbox | **Not** claimed — `Machine.define` binds host JS; see [PUBLIC_API.md](PUBLIC_API.md) |
| External security review | **Outstanding** before dropping “experimental” language |
| npm audit (runtime) | Clean after `uuid@11.1.1` override (jayson); track `npm run report:security` → `reports/SECURITY-AUDIT.md` for docs-toolchain noise |
| Strict Protocol V1 adversarial suite | Landed — [`tests/protocol-v1/`](tests/protocol-v1/README.md) matrix + typed NOISE storm; expand if new mesh opcodes appear |

## Known gaps (do not paper over)

1. **No isolate/vm for Programs** — `javascript` Programs register functions into the host `Machine`. Resource limit is primarily `MACHINE_MAX_MEMORY`, not step/gas isolation.
2. **Distributed execution composition** — Beacon epochs, federation sign rounds, and HTTP binders live in Hub / `@fabric/http`. Core provides helpers only.
3. **PROTOCOL history** — Older root protocol sketches were stale; [PROTOCOL.md](PROTOCOL.md) now redirects to [docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md).
4. **CLI `settings/local.js`** — Gitignored operator overlay. Packaged installs should ship/copy [settings/local.example.js](settings/local.example.js); shell loads example when local is absent.
5. **Exact Node pin** — `engines.node` is `24.15.0`. Documented for CI parity; broad consumers may need a range in a later release.
6. **Adversarial completeness** — Historical fuzz (`randomAmpFrame`, `P2P_BASE_MESSAGE` chaos) proves crash resilience more than semantic malice. Prefer expanding [`tests/protocol-v1/`](tests/protocol-v1/README.md) (well-formed signed frames × delivery modes) before claiming mesh-wide adversarial hardness. Unregistered AMP opcodes must remain `UNKNOWN_MESSAGE` (not aliased to `P2P_BASE_MESSAGE`).
7. ~~**Peer `_selfDialSuppressUntil`**~~ — FIFO-capped (default 256; `settings.selfDialSuppressMax`); expired entries still drop on read. Self-dial suppress from peering offers/announces uses **verified AMP signer** only (`meta.verifiedPubkey`), not attacker-controlled `obj.pubkey`.
8. **Eager `messageHex`** — hot paths still materialize hex wire forms eagerly; laziness / cache invalidation is outstanding performance work, not a correctness claim.
9. ~~**Chat / onion seal AAD**~~ — tip + participant AES-GCM AAD lands in `groupChatSeal` / `onionChatSeal` (see [docs/ARC.md](docs/ARC.md) §8).
10. **Public API short names** — `contractId` and similar remain until a coordinated rename to `contractIdentifier`-style identifiers (Author Style in `AGENTS.md`).
11. **Blinded-execution decisions** — accept/reject require BIP340 over `decisionSigningMessage` v2 (`sessionId` / `proposalMerkleRoot` / `decision` / `at`). Same actor/proposal/decision/`at` replays are idempotent; a different `at` conflicts. Composition remains a scaffold (not Yao GC).
12. **Fabric coin-type dual path** — protocol identity is **7777** on Bitcoin mainnet and **7778** on all other networks (`fabricCoinTypeForNetwork` / `Identity#network`). Default Peer / Identity (regtest) stays on **7778**. Hub / Passport / extension callers that hard-code `m/44'/7778'/…` should switch to `fabricIdentityDerivationPath(…, network)` when targeting mainnet; re-derive any keys previously treated as “mainnet” under 7778.
13. ~~**Withdrawal `requestId` bind**~~ — `validateWithdrawalRequest` rejects unless `requestId === computeWithdrawalRequestId(…)` (destination/fee/vault commitment).
14. **Outstanding ARC / Peer follow-ups** — coordinated `contractId` → `contractIdentifier` rename; eager `messageHex` laziness; regenerate `API.md` field docs for `SCHEMA_P2P_PEER_GOSSIP` / `tryParseMessageBody` / `resolveSpend` opts when next running `npm run make:api`. Journal / re-fold caps and blinded-execution `at` bind are landed (see ARC §8).
15. ~~**Beacon/ARC `CONTRACT_PUBLISH` authority collector**~~ — `collectContractAuthorityPubkeys` walks nested `members.signers` / `spendPolicy.validators` (not only top-level arrays), so Beacon genesis no longer fail-opens first-claim to any AMP signer.
16. ~~**Peering self-suppress trust**~~ — candidate host/port validation + default-port normalize on self-key refuse + NOISE self-check fail-closed; offer/announce enqueue suppresses only when `verifiedPubkey` (AMP signer) is our key. Advertised `obj.pubkey` is informational.
17. **OP_RETURN hallmarks** — core short-format encode/verify (`functions/fabricHallmark`); Hub publish/scan is operator opt-in. Hallmarks are not a BIP; `npm run report:bip-compliance` last run **2026-08-13** (mean stack **2.47**, 37 BIPs, no grade movement vs 2026-08-12). Remaining: Hub mainnet hallmark policy gates; BIP suite gaps (49/69/85/322/48/370/352/388) in `reports/bip-compliance.md`.
18. ~~**Blinded-execution `at` bind**~~ — `decisionSigningMessage` v2 includes `at`; `recordProposalDecision` requires it and rejects timestamp swaps under a valid signature.

### PR #183 review triage (feature/rsi)

Most CodeRabbit / automation actionable items on [#183](https://github.com/FabricLabs/fabric/pull/183) are addressed on tip (`3c963834…` plus this pass). Latest security review on that SHA reported **2 Mediums**; the peering self-suppress path is now fixed in core. **0 Mediums** remain from that review (blinded-execution `at` bind is landed).

| Item | Status |
|------|--------|
| Blinded-execution evaluator ≠ garbler | Fixed in `composeGarblerPublish` / `finalizeBlindedExecution` |
| Hub / Federation `proposedPolicy` genesis | Fixed — `normalizeGenesis` + Peer `collectContractAuthorityPubkeys` read `proposedPolicy.validators` and top-level `messageTypes` |
| `engines.npm: >=12` vs Node 24.15.0 bundled npm | Intentional — keep; DEVELOPERS.md documents upgrade |
| Empty tip `signers: []` widening spend keys to `members` | Fixed — `tipSpendKeys` treats explicit empty `signers` as authoritative; `resolveSpend` keeps genesis validators |
| Reader-role fold vs `members.set` test flake | Fixed — commutative `member.add` seed (hash-ordered fold) |
| Hallmark malformed digest / mutable magic export | Fixed — omit bad digests; export fresh `HALLMARK_MAGIC` Buffer |
| `createRound` omitted `policy` TypeError | Fixed — default `policy = {}` |
| Bind `at` into `decisionSigningMessage` | Fixed — v2 protocol string includes `at`; first-delivery timestamp swap rejected |
| Verified-pubkey peering self-suppress | Fixed — `_enqueuePeeringCandidate` uses `verifiedPubkey` (AMP signer) only |
| Eager `messageHex` / `contractIdentifier` rename | Deferred — ARC §8 (performance / breaking rename) |
| Beacon federation `ready` before durable persist | Fixed in core `Beacon#submitFederationEpochSignature` — idempotent finalize of `ready`/`sealed` rounds; `addSignature` still rejects new sigs. Hub `contracts/beacon.js` still duplicates this override (safe to drop after pinning this core). |
| `uuid` via `jayson` (GHSA-w5hq-g745-h8pq) | Mitigated — override `uuid@11.1.1` (avoid `npm audit fix --force` → jayson 2.x) |

## Recommendations before a non-experimental tag

- [ ] Third-party review of `types/peer.js`, `functions/inventoryHtlc.js`, `functions/documentSealedExchange.js`, `functions/publishedDocumentEnvelope.js`
- [ ] Run `npm run ci` + `npm run test:fuzz` on a clean tree
- [ ] Freeze [PUBLIC_API.md](PUBLIC_API.md) import map; keep `package.json` `files` whitelist green
- [ ] Coordinate Hub / `@fabric/http` pins to the tagged core ([docs/PRODUCTION.md](docs/PRODUCTION.md))
- [ ] Keep release claim scoped: Peer + document helpers + local Program/Machine — not “hardened dapp sandbox”
- [ ] Align Hub `fabricAccountDerivedIdentity` / Passport with network-aware Fabric coin types (7777/7778)

## Disclosure

Report vulnerabilities per [SECURITY.md](SECURITY.md) / project README contacts
(`security@fabric.pub` where listed in operator docs).
