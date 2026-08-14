# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite production march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14. Codacy `5e8` + CodeRabbit wallet/CLI quick wins staged; remaining queue below.

## Blockers before shared-host / non-experimental tag
1. **Third-party review** of `types/peer.js`, inventory HTLC, sealed exchange, `publishedDocumentEnvelope` ([AUDIT.md](../AUDIT.md) recommendations).
2. **Do not claim** a hardened contract VM — `Machine.define` still binds host JS ([PUBLIC_API.md](../PUBLIC_API.md)).
3. Downstream **site-login / device-link redeem** is not a core bug; Hub/`@fabric/http` still treat QR `sessionId` as the capability. Tracked in those repos.

## Next slices (this repo)
- [ ] **IdentityCrossSign lift (local, not #183)** — `functions/identityCrossSign.js`, `fabricIdentitySchnorr.js`, `identityCrossSignVerify.js` + tests exist on disk. Held off [#183](https://github.com/FabricLabs/fabric/pull/183) (CodeRabbit ~150-file cap). Do **not** commit working-tree `package.json` / `PUBLIC_API.md` / `AGENTS.md` pointers until that follow-up PR (smoke would require missing leaves). Pin/link core before Hub/http/Passport/GoonCitizen re-exports CI.
- [ ] Type-tree keep/remove lock in [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) (`Scribe` / `Reader` / Global docs clutter).
- [ ] Eager `messageHex` laziness on Peer hot paths (performance, not a correctness claim).
- [ ] Coordinated `contractId` → `contractIdentifier` rename.
- [ ] Hub / Passport callers still hard-coding BIP44 **7778** on mainnet should use `fabricIdentityDerivationPath(…, network)` (**7777** mainnet / **7778** otherwise).
- [ ] Genesis journal cap vs peer-local `meta.maxJournalEntries` (consensus-visible compact).
- [ ] Blinded-execution remains a **scaffold** (not Yao GC) even with signed `at`.
- [ ] Keep `.codacy.yml` Semgrep/Opengrep exclusions for `functions/fabricSetup.js` and `types/environment.js` unless a replacement SAST job covers those path-construction helpers (CodeRabbit asked to drop the excludes; Codacy still ignores `nosemgrep`).

## Closed this pass (do not re-open)
- Blinded-execution `at` bind; Beacon `ready` finalize; peering self-suppress via verified AMP signer; empty `signers: []` spend-key widen; Beacon ARC authority walk.
- Gossip-network `P2P_PEERING_OFFER` candidate expect includes AMP `verifiedPubkey` (`tests/fabric.peer.gossip-network.js`).
- Codacy `no-loss-of-precision` on `functions/contractTaproot.js` `CLTV_TIMESTAMP_THRESHOLD` (`5e8` → BIP65 `500000000`). Do not restore scientific notation; it fails the PR check even though IEEE-754 is exact.
- `setWallet` restores in-memory state and unlinks a placeholder `wallet.json` after a failed first save; CLI `--password` stops at `--`, accepts `-secret`, and does not env-fallback when the flag is present.

## PRs
[#183](https://github.com/FabricLabs/fabric/pull/183) — mocha + codecov green at `ca1fcb691`; remaining GitHub check was Codacy (`5e8`). Cursor review on `ca1fcb691` reports **no remaining High/Medium/Critical**. Still deferred: genesis journal cap vs peer-local `meta.maxJournalEntries`; `sealedBlob`/`identityLock` `.d.ts` stubs (new files); RFC6902 multi-op JSON bridge (http); eager `messageHex`; `withIsolatedHome` test helper; wallet tmp-name random suffix.
