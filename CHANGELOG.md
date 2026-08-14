# `@fabric/core` Changelog
Recent changes to Fabric Core.

## 2026-08-14
- **Review follow-ups (PR #183):** sealed restore reports `ok: false` on a rejected password; `--password=VALUE` is honoured; idle `--timeout` rejects non-integers; wallet writes are rename-atomic and `touchWallet` no longer truncates an existing file; idle-lock handlers no longer `removeAllListeners`; sealed documents keep `walletVersion`; `CONTRACT_PUBLISH` meta cannot replace the signed genesis; `_fillPeerSlots` does not suppress dials from an advertised own pubkey; Beacon `createRound` is `ready` when the threshold is already met; recovered ready rounds must still meet the federation threshold; pending rounds are kept if epoch-chain persist fails.

## 2026-08-13
- **GroupChangeProposal vote string v2** — BIP340 votes bind canonical `members` / `signers` so a colliding proposal `id` cannot reuse honest signatures on a swapped roster. Quorum remains genesis/tip k-of-n.
- **Wallet lock follow-ups** — `setWallet` throws instead of `process.exit`; `fabric setup` fails closed on an invalid `--wallet` path; auto-unlock reads only `FABRIC_PASSWORD` (not generic `PASSWORD`); `/unlock` passwords are redacted from CLI history; idle-lock timers `unref()`.
- **`fabric setup` TUI** — lightweight Blessed screen (`types/setup.js`) over headless `functions/fabricSetup.js`: public environment snapshot (paths, identity, XPUB), backup, restore from file or seed, generate / regenerate, unlock / lock / idle timeout, encrypt plaintext. One-shot flags `--json`, `--backup [FILE]`, `--restore <FILE>`, `--unlock`, `--lock`, `--timeout <MINUTES>`, `--no-tui`, `--force` skip the TUI. Snapshot never includes seed/xprv.
- **Encrypted wallets by default** — new `~/.fabric/wallet.json` files are password-sealed JSON (`seal` blob: AES-256-GCM + PBKDF2-SHA256, same scheme as Hub identity backup v2). Public fields stay outside the blob. `--password` / `FABRIC_PASSWORD` is the encryption password (min 8); `--passphrase` remains BIP39. Generic APIs: `functions/sealedBlob.js`, `functions/identityLock.js` (default 30-minute idle auto-lock; `0` disables). Shell: `/unlock`, `/lock`, `/lock timeout`, `/wallet status|unlock|lock|timeout`. Legacy plaintext wallets still load.

## 2026-08-11
- **Full Machine runner for Hub execution contracts:** `language: 'fabric-execution'` + `functions/executionProgramRunner.js`; Hub `fabricExecutionMachine` is a thin registry-aware wrapper. `programDigest` = `Program.programHash`; run digests via `Program.runCommitmentHex` / `executionRunBridge`.
- **Contract L1 payment observation:** `functions/contractPaymentObserve.js` + `Contract#_handleBitcoinTransaction` — match outputs to spend address, UNDERPAID / NO_MATCH failure codes, fold balances into tip on success.
- **ExecutionRun → FabricProgramRun digests:** `functions/executionRunBridge.js` — Hub `RunExecutionContract` returns `programHash`, forward `runCommitmentHex` (FabricProgramRun), and legacy `executionRunCommitmentHex`.
- **Composable Taproot trees + optional hashlock:** `composeTaprootTree`, `buildSpendLeaf` / `buildHashlockLeaf` / `buildScriptLeaf`, `scriptTreeFromLeaves` (exported), `prepareHashlockWithdrawalPsbt` + `finalizeHashlockPsbt`. Policy may carry `hashlock` / `extraLeaves` (changes address when present). Pure hashlock = `OP_SHA256 <commitment> EQUAL`; optional pubkey = inventory-style preimage+sig. Authority ladder remains default without hashlock.
- **ARC governance bodies:** `GroupChangeProposal` / `GroupChangeVote` are first-class shared `CONTRACT_MESSAGE` types (k-of-n adopt before `GroupChange`). Catalog + APPLICATION_NAMESPACES. `canonicalSpendPolicy` / `tipSpendKeys` / `nestBitcoinAnchor` unify Beacon ARC, vault, and `resolveSpend` overlays (`spendPolicy.{publisher,validators,threshold,csvBlocks,softMode}`, nested `bitcoinAnchor`, `spendAddress` alias). `depositMaturityBlocks` is UX-only for CSV. Hub vault publisher matches Beacon (hub root key). Manifest/vault summaries expose the same `spendPolicy` bag. Accumulate / Group folds emit tip `content.signers` (authority) separate from `content.members` (participants); Hub asserts vault ≡ Beacon ARC `spendAddress` (`authorityUnity`).
- **Machine ↔ redeemable outputs:** `functions/contractProgramBind.js` seals `FabricProgramRun` digests onto `tip.content.program`; withdrawals must match when tip/genesis requires a Program (`fabric.program` / opcodes / `requireProgramRun`). Authority P2TR address unchanged — Machine is compute+commitment, ARC Taproot is spend.
- **Opcode allow-list:** `functions/opcodeAllowList.js` + `Machine.setAllowedOpcodes` / `applyGenesisOpcodes` / `loadProgram({ genesis })` enforce ARC `primitives.opcodes` on `define`, load steps, and `compute` (fail closed when set; unrestricted machines keep legacy soft-coerce of unknown ops).
- **Beacon as native ARC:** `functions/beaconContractDefinition.js` builds network-agnostic `fabric-beacon` CONTRACT_PUBLISH genesis (validators / threshold / CSV soft tier; no `network` or tip `bitcoinAnchor`). Actor id is stable across regtest → signet → mainnet; Hub overlays spend at Accept / re-enrich. Redeploy checklist via `beaconRedeploySteps()`.
- **Authority Taproot ladder (dual P2TR fix):** default Hub vault + ARC `resolveSpend` share `taproot-authority-ladder-v1` — k-of-n validators/signers immediately; softer tier after ~144 CSV (`t1-soft`, default 1-of-publisher; optional `softMode: 'reduced'`). Legacy single-leaf vault is opt-in (`legacySingleLeaf: true`).
- **Beacon network guard:** `functions/beaconNetworkGuard.js` binds `beacon/NETWORK` to the live Bitcoin network; Hub `startBeacon` fails closed on mismatch / unbound legacy stores unless `FABRIC_BEACON_RESET_NETWORK=1` (or `beacon.resetNetworkStores`) clears L1-tied Beacon/sidechain artifacts and rebinds.
- **ARC resolveSpend network:** no silent `regtest` default — `resolveSpend` requires `overrides.network` or genesis `spendPolicy.network` (fail closed).
- **ARC delivery sync filter:** `isSyncTrackedType` / `primitives.deliverySync` — MessageReceived/MessageReceipt 2PC applies to any sync-tracked CONTRACT_MESSAGE body type (not GroupChat-only). ACKs never open a new pending row; default excludes `GroupJournalRequest`.
- **ARC delivery ACKs:** `MessageReceived` / `MessageReceipt` are first-class `CONTRACT_MESSAGE` entries (stored + relayable AMP bytes) but excluded from tip clock / `stateDigest`. Ingest folds them into the `contractmessagecommits` 2PC sidecar (`applyDeliveryAckEntry`).
- **ARC resolveSpend + withdrawals:** add `functions/contractSpend.js` (`normalizeArcGenesis`, `resolveSpend`, tip-bound `ContractWithdrawalRequest` / `Witness`, `prepareWithdrawalFromRequest`). Accumulate folds withdrawals and rejects stale tip bindings. See [`docs/ARC.md`](docs/ARC.md).
- **ARC accumulate authz (F1):** `contractMessageAccumulate.ingestMessageBuffer` rejects `GroupChange` and other signer mutations unless the AMP author is in genesis/tip signers or presents a verified `OP_CONTRACT_SIGN` Token. Unknown body types fail closed; genesis `primitives.messageTypes` is enforced; tip carries optional `bitcoinBlockHash` / height.
- **Wire version:** keep **`VERSION_NUMBER = 0x01`** for the 0.1.x pre-release (aligned with C `FABRIC_MESSAGE_VERSION`). The 208-byte header + Lightning-style `preimage` is the V1 frame under `0x01` — not a protocol bump to `0x02`. Legacy paths (176-byte sketches, `preimage = SHA256(body)`, first-class types via `P2P_BASE_MESSAGE`) remain handled where needed and are **deprecated**.
- **Supply-chain:** remove **`allow-git=all`** from core **`.npmrc`** and **`report:install`**. `@fabric/core` has no git deps; keep npm 12+ default `allow-git=none`. Hub / `@fabric/http` / apps that install Fabric from GitHub keep `allow-git=all` in *their* `.npmrc`.
- **CLTV locks:** `normalizeLock` rejects height/unix values that cross BIP65’s `500000000` type threshold (height must be `<`, unix must be `≥`).
- **Registry sidechain:** `applyRegistryUpdateFields` accepts patch-only updates (`patchesCanonical` without `catalogCanonical`) and always constrains patches to the `/registry` subtree (no fail-open when `policy` is null).
- **Token capability:** `verifyContractCapability` requires `issuerKey` or explicit `allowUnverified` (parse-only, `verified: false`).

## 2026-08-06
- **npm git deps:** (superseded 2026-08-11) briefly added **`allow-git=all`** for monorepo parity; reverted for core — scope the opt-in to Hub/http/app consumers only.

## 2026-07-29
JS-canonical protocol for 0.1.0; Lightning-style wire preimage; unsigned document binding; public-readiness cuts; Peer scoring; directed onion forward.

**P2P_FORWARD (onion / IP privacy)**
- New opcode **`P2P_FORWARD` (0x45)** with V1 field body `{ nextPeer, ttl, inner }`.
- Helpers: `@fabric/core/functions/fabricOnion` (`wrapOnionPath`, `wrapForwardLayer`, `tryDecodeForward`).
- `Peer#sendOnion(path, payload)` writes only to the first hop; peers peel when `nextPeer` matches local x-only pubkey, else forward bit-identical to that peer (no mesh flood).
- `P2P_RELAY` remains the flood envelope — use `P2P_FORWARD` when protecting peer IPs.

**Install / C**
- **npm install skips `fabric.node`** by default (`scripts/install-native.js`). Opt in with `FABRIC_BUILD_NATIVE=1` or `npm run build:c`. C sources remain in-tree; JS Message/Peer is the protocol oracle ([`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Wire preimage (Lightning-style)**
- Public frames keep **all-zero** `preimage`; body integrity is only header `hash` (double-SHA256). Explicit 32-byte secrets are for HTLC / Fabric Circuit hops (`payment_hash = SHA256(preimage)`). No longer default `preimage = SHA256(body)`.

**Document exchange**
- Payment binding hashes **unsigned** `documentPublishEnvelopeBuffer` only; `assertUnsignedDocumentPublishEnvelope` rejects signed gossip frames. Whitelist drops `created`/`edited` to stop Hub/Peer hash drift.

**Peer scoring / misbehavior**
- Unified `_applyPeerMisbehavior`: body-hash / bad-sig / pin mismatch / forbidden `CONTRACT_MESSAGE` ops derank and disconnect; logical-register duplicates soft-derank (hijack on `CONTRACT_PUBLISH` re-sign by another key). Wire-hash cache fills only after verify. See [SECURITY.md](SECURITY.md); tests in `tests/fabric.peer.scoring.js`.

**Adversarial Peer hardening**
- **`P2P_RELAY`:** inbound flood forwards the original outer bit-identical (no hop re-wrap); nested RELAY depth capped; higher inbound credit cost.
- **Temp ban** after hard misbehavior (address + pubkey, default 15m); refuse dial/inbound while banned.
- **`autoFulfillDocumentRequests` default `false`** (consent queue); `P2P_PEER_ANNOUNCE` uses capped candidate enqueue.
- **Chat:** per-origin mesh relay budget (`CHAT_MAX_RELAYS_PER_ORIGIN_PER_MINUTE`).
- **Frame size:** drop oversize wire buffers before crypto (`HEADER_SIZE + MAX_MESSAGE_SIZE`).
- **HTLC offers:** `validateInventoryHtlcOffer` + AMP signer / seller pubkey binding; inventory emits `signerPubkeyHex`.
- **Memory caps:** pending blob transfers, sealed ciphertext rows, private document relay routes.
- **`P2P_FORWARD` peel:** inner integrity / authz / session-key / nest-cap failures do not hard-disconnect or derank the TCP last hop.
- **`P2P_FORWARD` peel:** valid `P2P_SESSION_*` inners do not rebind last-hop identity; peeled chat / peering offers / gossip are local-only (no mesh relay / candidate enqueue under the TCP hop); peeled `P2P_PEER_ALIAS` does not overlay last-hop nickname or registry address.
- **`P2P_RELAY`:** included in relay-as-is pin exemption so bit-identical flood cannot ban honest forwarders.
- Docs: gossip/peering hop is advisory (bit-identical; not decremented). Tests: `tests/fabric.peer.adversarial.js`, `tests/peer.onion.forward.js`.
- **Coverage:** c8 includes PR-critical helpers (`fabricOnion`, `inventoryHtlc`, `documentSealedExchange`, `documentBlobManifest`, `loadLocalSettings`, `messageBodyCodec`, `sidechainState`); expanded onion/adversarial tests for TTL=0, bounce refuse, undeliverable, `sendOnion` failures, nest soft-punish, relayedAsIs session reject, ban expiry, chat window rollover, document-route caps.
- **Coverage:** production gossip/peering wire-mesh suite (`tests/fabric.peer.gossip-network.js`) — bit-identical fan-out, hop=0, budgets/window rollover, FIFO caches, RELAY-as-is (no double amplify), three-node loop-free path, chat/alias budget isolation; peering offers also local-only under `relayedAsIs`.
- **Coverage:** Codecov project `threshold: 1%` (expanding c8 allowlist); more `DocumentBlobTransferBook` ingest edges + sidechain journal/snapshot summarize coverage.
- **`P2P_FORWARD` peel:** skip inbound wire-credit debit for peeled/relayed-as-is inners; `P2P_PEER_ANNOUNCE` local-only (no candidate enqueue); logical-register punish origin null on peel (incl. `CONTRACT_PUBLISH` hijack).
- **Outermost-only flood:** peeled / `skipRelayFlood` inners no longer `relayFrom` under the TCP last hop — unified `meshDeliveryContext` (`allowMeshRelay` / `allowTcpOriginSideEffects`) for chat, alias, gossip, peering, contracts, `BitcoinBlock`, `DocumentRequest`, and inventory (no fulfill/queue/reply to TCP last hop on peel / foreign RELAY).
- **CONTRACT_PUBLISH front-run:** patch allow-list is authority-arrays only (never AMP wire signer alone); non-party first publishers are rejected **before** logical registration so they cannot burn the content-addressed slot.
- **DocumentContentKeyReveal:** require `SHA256(keyHex) === paymentHashHex` before reverse-relay; logical key binds to derived payment hash; claim only after successful sealed open (junk public-hash frames cannot burn cooperative delivery).
- **Review follow-ups:** `loadStateAt` parses Buffer STATE docs; `jsonSafe(undefined)` → `null`; federation witness counts distinct validator pubkeys; PBKDF2 salt length check is overflow-safe; MESSAGES.md Lightning alias labels.
- **Coverage / Codacy:** claimWatch hub-reveal + claim-witness, mature refund broadcast, AMP-signer refuse, sealed content-key store helpers; Semgrep/Opengrep exclude for path-hardened `cliDocumentExchange` / `contractSidechainLocal` (containment already tested).

**Public readiness**
- **[PUBLIC_API.md](PUBLIC_API.md)** — frozen 0.1 leaf import map + scoped RC claim (Peer + document helpers + local Program/Machine; not a sandboxed dapp VM).
- **[PROTOCOL.md](PROTOCOL.md)** redirects to **[docs/MESSAGE_BODY.md](docs/MESSAGE_BODY.md)**; restore **[PRIVACY.md](PRIVACY.md)** / **[AUDIT.md](AUDIT.md)**.
- **`package.json` `files`** whitelist for npm publish; leaf `.d.ts` stubs for canonical imports; `settings/local.example.js` + `loadLocalSettings` fallback when gitignored `local.js` is absent.

## 2026-07-24
CLI first-run setup, L1 document settle in core, ranked offers, multi-blob exchange, private paid relay.

**CLI**
- **Setup gate** — `fabric --help` / `--version` without a wallet; no auto-setup; bare `fabric` hints `fabric setup`. Quieter `contracts/setup.js` (seed + xpub/path; `FABRIC_DEBUG=1` for xprv).
- **Document exchange** — `/publish` + rate; `/inventory [peer] [btc]`; `/offers`; `/buy` / `/confirm`; `/request` with `maxSats`; `/pending` / `/approve` / `/deny`; `/relayfees`; `/send <doc> <peer>`.

**Peer / functions**
- Upstream Hub P2TR HTLC + content-key: `functions/inventoryHtlc.js` (includes `buildDocumentOfferEscrow`), `documentSealedExchange.js` (sign via `types/ecc`, no `ecpair`).
- Removed shim modules `fabricDocumentOfferEnvelope`, `documentOfferEscrow`, and `documentExchange` (use `publishedDocumentEnvelope`, `inventoryHtlc`, and `cliDocumentExchange`).
- Consolidated document helpers: content-key → `documentSealedExchange`; blob transfer → `documentBlobManifest`; offer book + purchase sessions + request relay → `documentMarket`.
- Docs: document-offer naming folded into `L1_DOCUMENT_EXCHANGE.md`; release checklists into `PRODUCTION.md`.
- Simulator: action packs moved from `usecases/` to `scenarios/packs/`.
- `attachInventoryHtlc`, blob inventory rows, private `DOCUMENT_REQUEST` rewrite with fee skim.

**Hub**
- Thin re-exports of envelope / HTLC / content-key / escrow from `@fabric/core`.

**Simulator**
- Scenarios `document-swarm`, `document-relay-private`; adversarial document actions.
- `DocumentRequest` / inventory opcodes are relay-as-is (star/line forward no longer signer-mismatch drops); document-market pack slimmed to peer wiring (ranking/blobs/fees stay in unit tests); `run.js --all`.
- **`beacon-registry`** (gated `FABRIC_E2E_REGTEST=1`): managed regtest + `types/Beacon` seals document registry digests on `sidechain/STATE`; end-of-run **audit report** links each epoch to a real L1 block/coinbase txid (`reports/simulator-beacon-audit-latest.{json,md}`).

**Beacon / registry**
- `types/beacon.js` — L1 epoch chain (Hub `contracts/beacon.js` re-exports).
- `functions/documentRegistrySidechain.js` — typed-field `SIDECHAIN_STATE_PATCH` catalog apply; RFC6902 only at `@fabric/http` `messageBodyJsonBridge`.

**Docs**
- [`docs/L1_DOCUMENT_EXCHANGE.md`](docs/L1_DOCUMENT_EXCHANGE.md), BIP draft, payments binding.

## 2026-03-20
Pre-release focusing on wire parity, tooling, and release hygiene.

**Protocol / core**
- **Message wire (V1 / `0x01`)** — 208-byte header: `preimage` (32 bytes) after `hash`, before `signature`; public messages use all-zero preimage (exposed as `null` in JS). `VERSION_NUMBER` / `FABRIC_MESSAGE_VERSION` remain **`0x01`** for the 0.1.x pre-release (header layout is not a version bump to `0x02`). Max body size reduced to stay within 4096-byte frames.
- **Body hash** — `hash` field remains double-SHA256 of body only; signing covers full header (signature zeroed) + body with BIP-340 tag `Fabric/Message` (see [`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md)).

**Security / privacy**
- **Peer logging** — NOISE handshake: **never** log local private key material; public-key diagnostics and inbound session notices only when `settings.debug` is true (see `types/peer.js`). `types/key.js` — `encrypt()` uses explicit `crypto.randomBytes(16)` for IVs.
- **`P2P_PEER_GOSSIP` / `P2P_PEERING_OFFER` opcodes** — First-class AMP types `0x61` / `0x62` (were string labels that silently encoded as `P2P_BASE_MESSAGE`). Registered in `types/message.js`; Peer handlers match wire string names.
- **`P2P_PEER_GOSSIP` relay** — Mitigates relay amplification: logical payload dedup, advisory `gossipHop` TTL (origin-set; hops forward bit-identical), per-origin relay budget, bounded wire-hash / payload caches (`constants.js` `GOSSIP_*`, `Peer` `settings.gossip`).
- **`P2P_PEERING_OFFER` relay** — Same mitigations for peering offers: logical payload dedup, `peeringHop` TTL, per-origin relay budget, bounded payload cache, FIFO-capped deduped candidate queue (`constants.js` `PEERING_OFFER_*`, `PEER_MAX_CANDIDATES_QUEUE`, `Peer` `settings.peering`).
- **Operations / security docs** — [PRIVACY.md](PRIVACY.md), [AUDIT.md](AUDIT.md), [SECURITY.md](SECURITY.md); [docs/README.md](docs/README.md) index.
- **Docs** — [DEVELOPERS.md](DEVELOPERS.md) production & release, core types table; [README.md](README.md) seed warning + doc table; [QUICKSTART.md](QUICKSTART.md) links to PRODUCTION/DEVELOPERS.
- **Types** — [types/fabric.d.ts](types/fabric.d.ts) minimal entry typings for `package.json` `"types"`.

**Tooling & docs**
- **Quality reports** — `npm run report:quality` writes [`reports/WARNINGS.md`](reports/WARNINGS.md), [`reports/DEPRECATIONS.md`](reports/DEPRECATIONS.md), [`reports/SECURITY-AUDIT.md`](reports/SECURITY-AUDIT.md) + `npm-audit.json` (see [`reports/README.md`](reports/README.md)).
- **Production checklist** — [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) aligned with CI gates and audit posture; [docs/PRODUCTION.md](docs/PRODUCTION.md); **`npm run ci`**; GitHub Actions (install + `npm run ci`).
- **CI** — Tests + coverage (`npm run report:coverage`) run right after `bitcoind` install, before Core Lightning setup, for faster failure feedback.
- **Handbook** — `SUMMARY.md` guide links, `check:book-links`, [`docs/DOCUMENTATION-AUDIT.md`](docs/DOCUMENTATION-AUDIT.md); README **Production** blurb points to the checklist.
- **Package** — `package.json` description clarified; `review:todo` disclosure email typo fixed.

**Payments / documents**
- [`functions/publishedDocumentEnvelope.js`](functions/publishedDocumentEnvelope.js) — canonical `DocumentPublish` envelope, HTLC preimage, purchase `contentHash`; tests `tests/publishedDocumentEnvelope.core.js`.

**Known / accepted**
- **npm audit** — No *critical* findings; remaining **high** / **low** issues are transitive under **honkit** (docs/book toolchain). Tracked in `reports/SECURITY-AUDIT.md`; clearing them likely requires `honkit` upgrades or `npm audit fix --force` (out of runtime dependency paths for `@fabric/core` consumers).

---

## 2023-04-01
First pass at public playnet — initial release candidate for the `v0.1.0` tag.

**Notable**
- Fabric CLI — terminal interaction.
- Core types: Actor, Channel, Message, Peer, Service.

## 2022-01-25
Initial changelog file.

[0.1.0-RC1]: https://github.com/FabricLabs/fabric/compare/master...v0.1.0-RC1
