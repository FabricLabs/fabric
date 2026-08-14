# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite production march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14. [#185](https://github.com/FabricLabs/fabric/pull/185) + RC1 first-tier contract (`tests/rc1.first-tier.contract.js`; undersize-frame drop).

## Blockers before shared-host / non-experimental tag
1. **Third-party review** of `types/peer.js`, inventory HTLC, sealed exchange, `publishedDocumentEnvelope` ([AUDIT.md](../AUDIT.md) recommendations).
2. **Do not claim** a hardened contract VM — `Machine.define` still binds host JS ([PUBLIC_API.md](../PUBLIC_API.md)).
3. Downstream **site-login / device-link redeem** is not a core bug; Hub/`@fabric/http` still treat QR `sessionId` as the capability. Tracked in those repos.

## Next slices (this repo)
- [ ] Type-tree keep/remove lock in [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) (inventory remaining classes; `Scribe`/`Reader` deprecation notes are in).
- [ ] Coordinated `contractId` → `contractIdentifier` rename.
- [ ] Hub / Passport callers still hard-coding BIP44 **7778** on mainnet should use `fabricIdentityDerivationPath(…, network)` (**7777** mainnet / **7778** otherwise). Do not silently re-derive existing Hub identities.
- [ ] Blinded-execution remains a **scaffold** (not Yao GC) even with signed `at`.
- [ ] Keep `.codacy.yml` Semgrep/Opengrep exclusions for `functions/fabricSetup.js` and `types/environment.js` unless a replacement SAST job covers those path-construction helpers (CodeRabbit asked to drop the excludes; Codacy still ignores `nosemgrep`).

## Closed this pass (do not re-open)
- Undersize AMP frames (`< HEADER_SIZE`) and unparseable buffers drop before parse/crypto (no score / ban). Oversized already did. Locked in `tests/rc1.first-tier.contract.js` with the other first-tier RC1 invariants (hop=0 does not poison gossip cache; BASE_MESSAGE cannot inject gossip; budget is TCP-origin keyed; score-0 still disconnects; sealed wallet public object omits seed/xprv).
- IdentityCrossSign / identity Schnorr / verify lifted into `functions/` after [#183](https://github.com/FabricLabs/fabric/pull/183) merge (was held for the CodeRabbit file cap).
- `signCrossSign` localPubkey is the Fabric signing pubkey (not Bech32 `id` / HD master). Canonical cross-sign pubkeys are compressed or x-only hex; unknown `kind` is rejected. `fabricIdentityIdFromPubkeyHex` requires compressed 66-hex (no truncated `Buffer.from(..., 'hex')`). `createdAt` is unsigned display metadata. `.d.ts` files declare real arities / `ok` unions.
- `_fillPeerSlots` candidate retry cooldown + NOISE-after-TCP-connect (playnet `:7778` ECONNREFUSED / MaxListeners storm). `_connect` also skips in-flight `_outboundDialTargets`. Dial keys are canonical `host:port` so `pubkey@host:port` cannot duplicate `host:port`. `_candidateRetryAt` is pruned; `_disconnect` and inbound encrypt-end / banned-static paths tear down NOISE; outbound connect setup is try/caught.
- Wallet tmp files use `pid` + random suffix; Environment tests share `tests/helpers/isolatedHome.js`.
- `contract:message` `messageHex` is lazy (getter). `Reader` is `@deprecated` (fold into Peer/Message ingest).
- Blinded-execution `at` bind; Beacon `ready` finalize; peering self-suppress via verified AMP signer; empty `signers: []` spend-key widen; Beacon ARC authority walk.
- Gossip-network `P2P_PEERING_OFFER` candidate expect includes AMP `verifiedPubkey` (`tests/fabric.peer.gossip-network.js`).
- Codacy `no-loss-of-precision` on `functions/contractTaproot.js` `CLTV_TIMESTAMP_THRESHOLD` — use `Number('500000000')` (decimal and `5e8` both trip the PR check).
- `setWallet` restores in-memory state and unlinks a placeholder `wallet.json` after a failed first save; CLI `--password` stops at `--`, accepts `-secret`, and does not env-fallback when the flag is present.
- Genesis `primitives.maxJournalEntries` wins over peer-local `meta.maxJournalEntries`; `CONTRACT_PUBLISH` rejects a non-64-hex author.
- `printGeneratedWallet` never prints the master xprv (`FABRIC_DEBUG` included). Plaintext restore validates encryption password before `setWallet`.

## PRs
[#185](https://github.com/FabricLabs/fabric/pull/185) — WIP ARC polish on `feature/rsi` after [#183](https://github.com/FabricLabs/fabric/pull/183) merge. CI green on `488a87da1`. Bugbot Highs (wrong cross-sign pubkey; duplicate outbound dials) addressed; `pubkey@host:port` now canonicalizes onto the same dial slot. Still deferred: RFC6902 multi-op JSON bridge (http); `.codacy.yml` Semgrep excludes stay until a replacement SAST job exists; docstring-coverage gate; PR title.
