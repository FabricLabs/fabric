# Outstanding (security-first)
Living queue for this repo. Detail and closed items live in [SECURITY.md](../SECURITY.md) and [AUDIT.md](../AUDIT.md). Suite production march: [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-25 — Wave 1 core audit honesty pass (`Session.encrypt`
throws; Capability scaffold opt-in; Service sensitive-path / `requirePatchCapability`
gates; Identity `_verifyKeyIsChild`; Actor.sign Key path; CONTRACT_* body schemas;
adversarial UNKNOWN + generic-carrier cases). `npm run ci` was green on the prior tip;
re-run after this cut. The P0 below is unchanged: handshake-bus cleanup exists in this
tree but **not** on the live Hub pin.

**[#186](https://github.com/FabricLabs/fabric/pull/186) review surface is
clear** (`npm run ci` green at **2483 passing / 6 pending**; +21 tests, no
production code changed). Both unresolved bot threads (`functions/bip371.js`
BIP-341 control-block checks; `carol` missing `disablePlugins: ['cln-grpc']`)
were already fixed in **`aab3c983d`**, which landed after the reviewed commit
`f63a33f` — no patch needed, and each has a test. The real item was **Codecov
patch coverage**
(94.45%, 32 lines): `types/tree.js` is now **100%** lines/functions (was 91.85%,
branch 41→78%) and the `types/message.js` `parent` genesis fallback is covered.
Those uncovered lines were the adversarial half of the non-inclusion proof API,
so `tests/fabric.tree.js` now pins every `verifyNonInclusion` rejection (tampered
root, mismatched `leafCount`, wrong-size leaf set, neighbours widened to skip an
in-range leaf, target outside the claimed gap, stray/missing neighbours) plus
fail-closed behaviour when a verifier or proof builder throws. Detail:
[PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) progress log.

`functions/fabricMessageParent.js` landed in **`8e756f2`**, exporting
`ZERO_PARENT` / `isZeroParent` / `normalizeParentHex` / `parentHexOf` /
`frameIdOf` / `setMessageParent`. Remaining work is the HTTP Bridge originate
path and lockfile bumps in consuming packages — not another core helper.
`npm run smoke` already requires this leaf so a broken export fails CI.

**Prior review:** 2026-08-20 (production Hub host scan **10:39Z**). [#186](https://github.com/FabricLabs/fabric/pull/186) on `feature/rsi` (tip **`88f766c28`**, includes review follow-ups after **`aab3c98`** / **`9c6ade0`**). Live Hub **`6bf825d`** / core pin **`f63a33f`**: named retainers flat; RSS **~1.7 GiB** driven by **`external`/`arrayBuffers` (~984 MiB in ~61 m)**; **NOISE MaxListeners 65>64** on **4** consecutive Hub PIDs. `Peer#countNoiseHandshakeListeners` is **not** on `f63a33f` (this tip / #186 only — suite lockfiles already resolve here).

## Blockers before shared-host / non-experimental tag
1. **Third-party review** of `types/peer.js`, inventory HTLC, sealed exchange, `publishedDocumentEnvelope` ([AUDIT.md](../AUDIT.md) recommendations).
2. **Do not claim** a hardened contract VM — `Machine.define` still binds host JS ([PUBLIC_API.md](../PUBLIC_API.md)).
3. Downstream **site-login / device-link redeem** is not a core bug; Hub/`@fabric/http` still treat QR `sessionId` as the capability. Tracked in those repos.

## Next slices (this repo)
- [ ] Production Hub **RSS / NOISE handshake bus (P0)** (production Hub host scan **10:39Z**: Hub **`6bf825d`**, restarts **542** / FATAL **317 +0**, PID **~61 m**). Named retainers stay flat. RSS tracks **`external`/`arrayBuffers` (38→984 MiB)** not V8 heap (~82 MiB). MaxListeners 65>64 on this life; `noiseHandshakeListeners: null` because live pin **`f63a33f`** still `require('noise-protocol-stream')`. This tip **`88f766c28`**: `functions/noiseProtocolStream.js` + `Peer#countNoiseHandshakeListeners` — Hub redeploy before claiming the leak is fixed. Do **not** raise `--max-old-space-size`. Oversized AMP frames on shared hosts remain P1.
- [ ] Keep documenting that `sensitive` ≠ encrypted ([PRIVACY.md](../PRIVACY.md),
  [MESSAGE_BODY.md](MESSAGE_BODY.md)). Mesh chat model:
  [MESSAGES.md](../MESSAGES.md#mesh-chat-model-gossip-first) + `functions/fabricChatKind.js`. Privacy follow-ups live in HTTP Hub and application consumers' own `docs/OUTSTANDING.md`.
- [ ] Type-tree keep/remove lock in [PRODUCTION_MARCH.md](PRODUCTION_MARCH.md) (inventory remaining classes; `Scribe`/`Reader` deprecation notes are in).
- [ ] **Undeclared (phantom) dependencies.** `functions/noiseProtocolStream.js`
  requires `duplexify`, `end-of-stream`, `length-prefixed-stream`, `stream-each`,
  and `through2`; `types/remote.js` requires `ws`. All resolve today only because
  they hoist out of `noise-protocol-stream` / other transitive trees — a dep bump
  that drops one silently breaks the **NOISE transport path**. `types/typetree.js`
  requires `dependency-tree`, which does **not** resolve at all right now, so
  `require('@fabric/core/types/typetree')` throws. Decide per package: declare it
  or drop the require (AGENTS.md: no new runtime deps without a strong reason).
- [ ] Coordinated `contractId` → `contractIdentifier` rename.
- [ ] Blinded-execution remains a **scaffold** (not Yao GC) even with signed `at`.
- [ ] Keep `.codacy.yml` Semgrep/Opengrep exclusions for `functions/fabricSetup.js`, `functions/fabricHomeEnv.js`, `functions/fabricWalletIdentity.js`, `functions/fabricMessageCollection.js`, `types/environment.js`, and `types/filesystem.js` unless a replacement SAST job covers those path-construction helpers (CodeRabbit asked to drop the excludes; Codacy still ignores `nosemgrep`). The nine PR #185 criticals were all Filesystem `path.resolve` / `fs.*` on a contained name.

## Closed this pass (do not re-open)
- **[#186](https://github.com/FabricLabs/fabric/pull/186) review threads
  (2026-08-25).** All ten still-open bot threads are resolved; `npm test` is
  **2499 passing / 6 pending** (+4 tests). Thirteen others already carried
  "Addressed in commit" markers, and two of the ten were **stale**:
  `functions/bip371.js` already enforces the BIP-341 `33 + 32*m` control-block
  length, an even leaf version, and the `controlBlock[0] & 0xfe` match, and
  `carol` already sets `disablePlugins: ['cln-grpc']` — both fixed in
  **`aab3c983d`**, so the cursor[bot] thread is just unresolved, not open work.
  Two were security-relevant. `Tree#verifyInclusion` fell back to `doc.root`,
  which let the **prover choose the commitment** it was checked against: any
  party could build its own tree, call `proveInclusion`, and pass
  `verifyInclusion(doc)` on an unrelated tree. It now prefers the instance root
  and rejects a document naming a different one (an explicit `rootHex` stays an
  intentional override), matching the rule `verifyNonInclusion` already applied.
  `onverify` in `functions/noiseProtocolStream.js` restored a **freed WASM heap
  pointer** when `options.verify` resolved after both duplexes were destroyed —
  reproduced as a non-null `_streamPtr` plus two spurious `handshake` events
  after teardown — and now returns early on `sessionTornDown() || ptr !== streamPtr`.
  The rest: `Tree` `between` adjacency used `indexOf` so a **duplicated** left
  neighbour rejected a correct proof (`lastIndexOf`); `inclusionProof` /
  `nonInclusionProof` fed `frameId` straight to `Buffer.from(str, 'hex')`, which
  truncates instead of throwing and so proved a **different or empty leaf**
  (now 64-hex validated); `Store#flush` skipped the wipe during `abstract-level`
  deferred `opening`; `tests/fabric.token.js` asserted `+`/`/` substitution with
  a fixture that base64-encodes to `KysrKy8vLy8=` and exercised **neither**
  branch (now `௿௿` → `4K+/4K+/` → `4K-_4K-_`); the managed-regtest hook in
  `tests/bitcoin/service.js` set its cleanup flag only **after** `start()`
  resolved, leaking a live `bitcoind` when a later startup step rejected; and the
  `PROTOCOL.md` wire-frame `parent` row had four cells in a three-column table.
  Each behavioural fix was verified to fail on the unpatched code first.
  `functions/gossipNetwork.d.ts` stays **wontfix** (see the #186 note above).
- **Wave 1 follow-ups (2026-08-25).** Two regressions the Wave 1 cut introduced are
  fixed and `npm test` is back to green at **2495 passing / 6 pending**.
  (1) `Service._applyChanges` emitted `error` unguarded from its catch, and Node's
  EventEmitter **throws** when nothing is listening — so an invalid JSON Patch
  escaped the function instead of returning `{ ok: false }`. Now gated on
  `listenerCount('error')`, matching the two guards added above it.
  (2) `MESSAGES.md` was stale after `CONTRACT_PUBLISH` / `CONTRACT_MESSAGE` gained
  body schemas (13 → 15 with a registered schema); regenerated via
  `npm run docs:message-types`. Do not hand-edit that table.
  Also swept dead code out of shipped source so `types/` + `functions/` lint clean:
  dropped unused requires (`bitcoinjs-lib` in `types/federation.js` — a full
  heavy-dep load for nothing, `./key` in `types/chain.js`, `crypto` in
  `types/store.js`, `fs` in `types/cli.js`, `withdrawalWitnessSigningMessage` in
  `functions/contractMessageAccumulate.js`), removed a stale
  `eslint-disable no-labels` in `functions/noiseProtocolStream.js`, and normalized
  eight unused catch bindings to the repo's `catch (_)` form.
- **Wave 1 Fabric Core Audit honesty (2026-08-25).** `Session.encrypt`/`decrypt`
  throw (use Peer NOISE / `Key.encrypt`). `Capability._generateToken` requires
  `allowScaffoldCapability: true` and stamps `scaffold: true`. `Service._applyChanges`
  refuses `/mnemonic|/seed|/xprv|…` and honors `requirePatchCapability`.
  `Identity._verifyKeyIsChild` derives and compares pubkeys. `Actor.sign` uses
  `this.key` or points at `Message.signWithKey`. Transitional
  `SCHEMA_CONTRACT_PUBLISH` / `SCHEMA_CONTRACT_MESSAGE` registered (JSON still
  accepted). Adversarial: unknown opcode score-stable; GenericMessage cannot
  escalate to CONTRACT_MESSAGE. Token `fromString` / `base64UrlEncode` /
  `Fabric.random`→`randomUnit` already closed on tip. Tests:
  `tests/fabric.wave1.audit.js`, capability/session/adversarial updates.
- Identity coin-type dual path (7777 mainnet / 7778 otherwise) is closed at the helper layer: `resolveFabricIdentityCoinType`, `fabricIdentityAccountPath`, `fabricIdentityDerivationPath`. HTTP Hub and application callers no longer hard-code `m/44'/7778'/…`. See [IDENTITY.md](IDENTITY.md) (BIP44 / SLIP-44; 7777 remains Bitvote on SLIP-44 — integers unchanged). Do not silently re-derive existing Hub identities.
- Undersize AMP frames (`< HEADER_SIZE`) and unparseable buffers drop before parse/crypto (no score / ban). Oversized already did. Locked in `tests/fabric.peer.adversarial.js` with the other first-tier RC1 invariants (hop=0 does not poison gossip **or peering** cache; BASE_MESSAGE cannot inject gossip, chat, alias, or announce; budget is TCP-origin keyed; score-0 still disconnects; sealed wallet public object omits seed/xprv).
- JSON `type: 98` on a **P2P_PEERING_OFFER** AMP frame (or GenericMessage) still dispatches as a peering offer via `_handleGenericMessage` / `canonicalTypeName`. First-class **other** opcodes keep the AMP wire name (`INVENTORY_RESPONSE`, gossip, …) so JSON `type: 98` cannot smuggle a candidate. Locked in `tests/fabric.peer.adversarial.js` with beat/isolate/NOISE-handler and `_fillPeerSlots` retry-map coverage from [#185](https://github.com/FabricLabs/fabric/pull/185) Codecov + review threads. `resolveFabricIdentityCoinType` / `fabricIdentityAccountPath` are exported from `constants.js`. `Message.fromRaw` copies TypedArray/DataView bounds. Service ChatMessage relays are signed when `node.key` is present. `Key` classifies a legacy `xprv` or mnemonic in `seed` rather than PBKDF2-hashing the string.
- Fabric TUI shoutbox uses UTF-8 `P2P_CHAT_MESSAGE` + `peerAlias` (same mesh contract as HTTP Hub UI and application relays). Helper `functions/fabricChatText`.
- IdentityCrossSign / identity Schnorr / verify lifted into `functions/` after [#183](https://github.com/FabricLabs/fabric/pull/183) merge (was held for the CodeRabbit file cap).
- `isolatePeerContent` copies `collections.documents` without aliasing the caller Hub map (inventory published / price / L1 metadata). Other collection names stay dropped.
- `Token.toString()` is documented as not auth (`ffff` MAC). `Capability#_generateToken` and `Session.encrypt`/`decrypt` are scaffolds / no-ops. `verifySigned` rejects the unsigned string.
- `signCrossSign` localPubkey is the Fabric signing pubkey (not Bech32 `id` / HD master). Canonical cross-sign pubkeys are compressed or x-only hex; unknown `kind` is rejected. `fabricIdentityIdFromPubkeyHex` requires compressed 66-hex (no truncated `Buffer.from(..., 'hex')`). `createdAt` is unsigned display metadata. JSDoc on the `.js` helpers covers arities / `ok` unions.
- **NOISE-after-TCP-connect** (playnet `:7778` ECONNREFUSED): `_fillPeerSlots` candidate retry cooldown; `_connect` skips in-flight `_outboundDialTargets`. Dial keys are canonical `host:port` so `pubkey@host:port` cannot duplicate `host:port`. Node URL IPv6 hostnames keep brackets — strip one pair before `createConnection` so `[::1]:port` does not become `[[::1]]:port`. `_candidateRetryAt` is pruned and capped to `maxCandidates`; `_disconnect` and inbound encrypt-end / banned-static paths tear down NOISE; outbound connect setup is try/caught. **Handshake-bus listener cleanup** (`functions/noiseProtocolStream.js`, tip **`88f766c28`**) is **not** on live pin `f63a33f` — keep it in Next slices until Hub redeploy.
- Wallet tmp files use `pid` + random suffix; Environment tests isolate `$HOME` inline (same helper in `tests/fabric.environment.js` / `tests/fabric.peer.adversarial.js`).
- `FABRIC_XPRV` / raw-hex `FABRIC_SEED` / `FABRIC_MNEMONIC` plus `~/.fabric/env` and `~/.fabric/hub-admin-token` (`functions/fabricHomeEnv`, `fabricKeyMaterial`, `fabricWalletIdentity`). `Key` `FROM_SEED` accepts 16–64 byte hex and sets `status = 'seeded'` (same as mnemonic). JSDoc on those helpers and `fabricChatText.chatActorIdOf` avoids TypeScript `?:` (`jsdoc2md`). `NODE_ENV=test` still prefers the fixture seed over a developer `FABRIC_XPRV` for Environment CLI/mocha. `loadIdentityFromWalletFile` uses `loadWallet({ fromFile: true })` so leftover `FABRIC_SEED` **and** `FABRIC_XPRV` cannot replace `wallet.json` (`tests/fabric.environment.js`). Sidechain path policy: allow-prefix `'/'` is a wildcard (`functions/sidechainState.js` `_pathMatchesPrefix`); never ship it. Codacy Semgrep/Opengrep excludes those home-env path helpers (same class as `types/environment.js`).
- Chaos fuzz prefers a still-connected peer, lands a dozen signed frames before hostile AMP, and fails the playnet storm on unexpected `hardErrors` (`writes.ok` remains invocation count — `_writeFabric` can skip a closed stream without throwing).
- `contract:message` `messageHex` is lazy (getter). `Reader` is `@deprecated` (fold into Peer/Message ingest).
- Blinded-execution `at` bind; Beacon `ready` finalize; peering self-suppress via verified AMP signer; empty `signers: []` spend-key widen; Beacon ARC authority walk.
- Gossip-network `P2P_PEERING_OFFER` candidate expect includes AMP `verifiedPubkey` (`tests/fabric.peer.gossip-network.js`).
- Codacy `no-loss-of-precision` on `functions/contractTaproot.js` `CLTV_TIMESTAMP_THRESHOLD` — use `Number('500000000')` (decimal and `5e8` both trip the PR check).
- `setWallet` restores in-memory state and unlinks a placeholder `wallet.json` after a failed first save; CLI `--password` stops at `--`, accepts `-secret`, and does not env-fallback when the flag is present.
- Genesis `primitives.maxJournalEntries` wins over peer-local `meta.maxJournalEntries`; `CONTRACT_PUBLISH` rejects a non-64-hex author.
- `printGeneratedWallet` never prints the master xprv (`FABRIC_DEBUG` included). Plaintext restore validates encryption password before `setWallet`.
- Fabric Message collections (`functions/fabricMessageCollection`, [MESSAGES.md](../MESSAGES.md#fabric-message-collections)) — collect / store / replay bit-identical AMP frames for journals, Discord packs, and catch-up. Not Hub `messages/*.json`. Relative CLI paths stay under cwd (`resolveCollectionFilePath`).
- Interactive MuSig2 defaults to `musig2.autoAccept: false` so a connected peer cannot use this node's identity key as a signing oracle. BIP-21 parse rejects unsupported `req-*`. Static server and `report-credits` lockfile reads are path-hardened. After `stat`, `realpath` must stay under the document root (symlink escape is 403). Example onion smoke verifies the decoded inner payload with the origin key. File-level JSDoc on examples + `scripts/report-credits.js` uses `@fileoverview`.
- `Filesystem.writeFile` / `readFile` / `delete` reject names that resolve outside the store root (`../`, absolute). Nested paths under the root still work. Final-component symlinks are refused on read/write (`O_NOFOLLOW`); `delete` unlinks the link without following. Intermediate directory symlinks that `realpath` outside the store are refused. Codacy Semgrep/Opengrep exclude `types/filesystem.js` for the same reason as other path-hardened helpers (nine PR-check criticals were `path.resolve` / `fs.*` on already-contained names).

## PRs
[#186](https://github.com/FabricLabs/fabric/pull/186) — WIP on `feature/rsi` after [#185](https://github.com/FabricLabs/fabric/pull/185) merged (`4db3be3`). Tip **`88f766c28`** (review follow-ups after **`aab3c98`** / **`9c6ade0`** + entropy harden): `resolveSpend` reports effective NUMS vs MuSig2; gossip `RELAY_AS_IS_NUMERIC` includes contract/Bitcoin opcodes; relay settings keep extra constraint groups; gossip-relay prints frame counts and exits 1 on a failed stop; NOISE `freeNative` clears encrypt/decrypt pointers and `onready` does not allocate after teardown. Handshake-bus (`functions/noiseProtocolStream.js`) is **not** on live Hub pin **`f63a33f`**. File count vs **`master`** stays under 150. Do not add playnet-chaos, protocol-v1, MQTT, or sidecar `functions/*.d.ts` (CodeRabbit `gossipNetwork.d.ts` is **wontfix**). Still deferred: unique Service commit ids; Blessed TUI chat markup; collection JSON `v` → `schemaVersion`; collection CLI symlink follow; RFC6902 multi-op JSON bridge (http); docstring-coverage gate; Filesystem intermediate-symlink TOCTOU (no Node `openat`). Dropping Codacy Semgrep excludes for home-env / collection / Filesystem path helpers is **wontfix**. Keep `report:install` lockfile wipe (`rm -f`; core has no git deps). Do not exclude all of `types/message.js` from Codacy. Do **not** coerce first-class opcodes through `canonicalTypeName(parsed.type)` (inventory `type: 98` must not become a peering offer). `Token.toString()` is not auth.
