# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite production march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (core `a85a372a8` on `feature/rsi`; follow-up slice staged).

## Blockers before shared-host / non-experimental tag
1. **Third-party review** of `types/peer.js`, inventory HTLC, sealed exchange, `publishedDocumentEnvelope` ([AUDIT.md](../AUDIT.md) recommendations).
2. **Do not claim** a hardened contract VM — `Machine.define` still binds host JS ([PUBLIC_API.md](../PUBLIC_API.md)).
3. Downstream **site-login / device-link redeem** is not a core bug; Hub/`@fabric/http` still treat QR `sessionId` as the capability. Tracked in those repos.

## Next slices (this repo)
- [ ] Type-tree keep/remove lock in [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) (`Scribe` / `Reader` / Global docs clutter).
- [ ] Eager `messageHex` laziness on Peer hot paths (performance, not a correctness claim).
- [ ] Coordinated `contractId` → `contractIdentifier` rename.
- [ ] Hub / Passport callers still hard-coding BIP44 **7778** on mainnet should use `fabricIdentityDerivationPath(…, network)` (**7777** mainnet / **7778** otherwise).
- [ ] Genesis journal cap vs peer-local `meta.maxJournalEntries` (consensus-visible compact).
- [ ] Blinded-execution remains a **scaffold** (not Yao GC) even with signed `at`.

## Closed this pass (do not re-open)
- Blinded-execution `at` bind; Beacon `ready` finalize; peering self-suppress via verified AMP signer; empty `signers: []` spend-key widen; Beacon ARC authority walk.

## PRs
[#183](https://github.com/FabricLabs/fabric/pull/183) — Cursor review on `a85a372a8` reports **no remaining High/Medium/Critical**. CodeRabbit leftovers not in this slice: genesis journal cap vs peer-local `meta.maxJournalEntries`; RFC6902 multi-op JSON bridge; eager `messageHex`.
