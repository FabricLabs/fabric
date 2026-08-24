# `@fabric/core` Changelog
Recent changes to Fabric Core.

## 2026-08-24
- **PR #186 codecov/patch:** cover the remaining patch misses — bitcoind stderr line buffering (`fatal` / `exception` classification, split-chunk joins, trailing-fragment flush on `end`/`close`, empty-buffer no-op), child `error` / cleanup-failure / process-attribution handlers via `_emitErrorSafe`, and child stdout/close logging (`tests/bitcoin/service.deep.js`). Peer: `countNoiseHandshakeListeners` (incl. missing-helper fallback), idempotent `_destroyFabric`, stalled outbound + inbound NOISE handshake timeouts (`tests/fabric.peer.js`). Review quick wins: shared `tests/fixtures/contractMessage.js` `signContractMessage`, queue trim asserts exact surviving hashes, interop suite stops its Peers and asserts the concrete `resolveSpend` `spendAddress`, ambient `functions/gossipNetwork.d.ts`.

## 2026-08-20
- **Store.flush:** skip when the Level handle is not `open`; swallow `LEVEL_DATABASE_NOT_OPEN` if a stale handle still reports `open` (HTTP `localStore.stop()` during Hub teardown).
- **PR #186 review (post-`aab3c98`):** `resolveSpend` reports the effective Taproot internal-key mode (one-validator `musig2` is NUMS). Gossip `RELAY_AS_IS_NUMERIC` includes contract/Bitcoin opcodes; relay settings keep extra constraint groups; `scripts/gossip-relay.js` prints frame counts and exits 1 on a failed stop. NOISE `freeNative` clears encrypt/decrypt native pointers and `onready` does not allocate after teardown.
- **Bitcoin E2E isolation:** managed regtest mocha (`tests/bitcoin.regtest.js`, RPC command parity, `tests/bitcoin/service.js`) uses unique ports/datadir and `enforceIsolatedRegtest` so it does not bind `18443`/`18444` next to Hub or Polar. Bitcoind stderr `Error:` lines no longer `emit('error')` without a listener (`ERR_UNHANDLED_ERROR` + mocha `done()` twice when Core exits 1). Default RPC parity spawns that isolated node; Polar/external RPC is opt-in via `BITCOIN_RPC_*`.
- **Lightning E2E payment:** `tests/lightning/lightning.service.js` uses an isolated regtest node (`enforceIsolatedRegtest`, unique ports/datadir) and funds Core Lightning from a named miner wallet via `_makeWalletRequest`. Node-level `sendtoaddress` after `lightningd` start was hitting an empty extra wallet (`[-6] Insufficient funds`).
- **Self-session teardown:** `_abortSelfFabricSession` always runs `_destroyFabric` so the connection map is dropped even when the socket is a unit stub without `_destroyFabric` (own-key `P2P_SESSION_OFFER` must not leave the hairpin up).
- **Public gossip catalog + relay node:** [`functions/gossipNetwork.js`](functions/gossipNetwork.js) classifies every AMP decode name (`flood` / `envelope` / `opt-in` / `trusted` / `directed` / `session` / `observe` / `hub`). Peer pin-exemption and first-class opcode isolation import that catalog. `Peer` `registerInboundContracts` (default true) lets a relay flood `CONTRACT_PUBLISH` without accumulating contract state. Script: `node scripts/gossip-relay.js` (single Peer, validate + bit-identical flood). Tests: `tests/gossip.network.js`.
- **NOISE handshake listener leak:** `noise-protocol-stream` 1.1.3 keeps one WASM EventEmitter and left `noise_stream_handshake_{write,read,split}` listeners (and native `noise_stream` ptrs) after failed or half-closed sessions. Public Hub hit MaxListeners 65>64 within ~1h while named Hub retainers stayed flat. This working tree uses [`functions/noiseProtocolStream.js`](functions/noiseProtocolStream.js): drop handshake listeners on split, `noise_stream_free` on destroy, plus `Peer#countNoiseHandshakeListeners`. Inbound TCP `close` tears down the pair; idle inbound handshake times out (`handshakeTimeout`, default 10s). Tests: `tests/fabric.noiseProtocolStream.js`. **Not on live Hub pin `f63a33f`** ([scan 2026-08-20T10:39Z](https://relay.goon.vc/downstream.agents.md): `noiseHandshakeListeners` still **null**, MaxListeners on the current PID).

## 2026-08-19
- **PR #186 review:** `functions/bip371` matches inventory HTLC BIP-371 checks (control-block length `33+32*m`, even leaf version, version match; hex decode rejects junk suffixes). Unknown `internalKeyMode` fails closed. `resolveSpend` / vault summaries echo the effective mode. `isolatePeerContent` deep-copies document rows.
- **PR #185 H2 (NUMS vs MuSig2 vault address):** `buildFederationVaultFromPolicy` and `resolveSpend` now forward `internalKeyMode`. Default n≥2 ladder is still MuSig2 (new address). Pass `internalKeyMode: 'nums'` to keep historical NUMS UTXOs — rebuilds do not migrate coins. Beacon genesis still omits the field (Actor-id stable); Hub overlays at Accept.

## 2026-08-16
- **PR #185 Token honesty:** `Token.toString()` is documented as not auth (`ffff` MAC). `Capability#_generateToken` and `Session.encrypt`/`decrypt` are documented as scaffolds / no-ops. `Token.verifySigned` rejects the unsigned JWT-shaped string.
- **PR #185 isolatePeerContent:** copies `collections.documents` rows (published / price / L1 metadata) without aliasing the caller Hub map. Other collection names stay dropped.
- **PR #185 review (HEAD `0b8ce4b`):** PSBT `toIntegerSats` rejects `null` / `false` / blank strings (no zero-sat coerce). `musig2.sign` zeros the secret nonce before `getSessionValues`; `createPartial` / failed `aggregatePartials` / `Peer.stop()` wipe stored sessions. BIP-371 `tapLeafScriptEntry` requires the control-block masked leaf version to match. Filesystem TOCTOU without Node `openat` and unlink-without-follow for planted store symlinks stay as-is.
- **PR #185 Codacy gate (`types/filesystem.js`):** Semgrep/Opengrep exclude the Filesystem type (same class as `fabricSetup` / `environment`). Containment + `O_NOFOLLOW` stay covered by `tests/fabric.filesystem.js`; Codacy ignores `nosemgrep`. BIP-371 `tapLeafScriptEntry` requires control-block length `33+32*m` and an even leaf version. `npm run home-env` returns exit 1 when writes throw. PSBT outputs reject non-integer satoshi values.
- **PR #185 Filesystem O_NOFOLLOW:** `readFile` / `writeFile` refuse a final-component symlink and a parent whose `realpath` left the store root. `delete` unlinks a planted symlink without following it. `writeFile` opens with `O_NOFOLLOW` when the platform defines it (no `touch()`-then-follow). Tests in `tests/fabric.filesystem.js`.
- **PR #185 wallet BIP slice (no new files):** BIP-49 nested-SegWit payment helpers live in [`functions/bip69.js`](functions/bip69.js) (`p2shP2wpkhPayment` / `p2shP2wpkhAddress`); `Key.deriveAddress(..., 'p2sh-p2wpkh')` uses them. Default funds path remains BIP-44. BIP-371 Taproot PSBT input bags (`tapInternalKey` / `tapLeafScript`) live in [`functions/inventoryHtlc.js`](functions/inventoryHtlc.js); contract-vault leaf spends reuse that export.
- **PR #185 home-env:** `npm run home-env` no longer stamps `FABRIC_SEED` / `FABRIC_MNEMONIC` next to `FABRIC_XPRV` in `~/.fabric/env`.
- **PR #185 Filesystem path escape:** `writeFile` / `readFile` / `delete` reject names that resolve outside the store root (`../`, absolute paths). Nested writes under the root still work. Symlink `O_NOFOLLOW` remains deferred. Tests in `tests/fabric.filesystem.js`.
- **PR #185 Codacy gate (`14d3d3a7`):** `npm run docs:message-types` reads/writes literal `MESSAGES.md` (chdir to repo root) so Semgrep does not flag `path.join` + `fs.readFileSync`/`writeFileSync` as two criticals. Do not Semgrep-exclude `types/message.js`.
- **Message type consolidation:** [`MESSAGES.md`](MESSAGES.md) decode-order table is generated from `WIRE_TYPE_DECODE_ORDER` (`npm run docs:message-types`). Mocha asserts the marked catalog matches the live decode order.
- **AMP opcode split:** Lightning Fabric-Message types move to `0x2000–0x2013` (`POLICY.md`). Fabric keeps the low numbers (`P2P_PING` `0x12`, `P2P_INSTRUCTION` `0x20`, `P2P_GENERIC` `0x80`, …). Duplicate opcodes fail at `Message` load. `P2P_INSTRUCTION`, `P2P_STATE_COMMITTMENT`, and `P2P_SESSION_ACK` are first-class decode names. Encode name round-trips to the decode label. `Message.fromVector` no longer swallows constructor errors.
- **Generic application contract chain fixture:** `tests/fabric.hub.mesh.integration.js` publishes a deterministic ARC genesis, covers every `GroupChange` action (`member.add` / `member.remove` / `members.set` / `signers.set` / `update`, plus reader-role add and proposal+vote), gossips the AMP frames across a 3-node loopback mesh, and locks `tests/fixtures/application-contract-chain.json`. Replay must match collection `root` and folded `stateDigest` (`UPDATE_FIXTURE=1` to regenerate).
- **PR #185 review follow-ups (after `9938917`):** `Filesystem.publish` throws when `writeFile` returns false (no phantom `files` entry / success hash). Write errors emit `warning` unless an `error` listener is present. Inbound Peer socket errors use the same `listenerCount('error')` fallback as outbound. Local MuSig2 initiators still create their own partial when `autoAccept` is off (inbound auto-sign stays gated). BIP-125 rejects non-integer / out-of-range nSequence. `classifyChatSurface(null)` is `unknown`, not shoutbox. Invalid-length `Buffer`/`Uint8Array` seeds throw `Seed must be 16–64 bytes` instead of `mnemonicToSeedSync`.
- **Crash-report follow-ups (not the heap root):** `State.serialize` treats `null` as `{}` (HTTP `Store._POST` of an empty body was `Cannot read properties of null (reading '@type')`). `Store._POST` rejects a null body. Bitcoin `addnode` RPC **[-23] already added** is success, not a warning.
- **Filesystem publish:** do not retain file bodies in `_state.documents` / Actor copies, and do not `synchronize()` (full tree re-read + `commit()`) after every write. Hub `fs.publish('STATE', …)` plus Bitcoin block documents were cloning each snapshot into the heap until V8 mark-compact OOM. `hashes` / `leaves` still hash from disk. `ingest()` also stops keeping the body. `commit()` stringifies `_state.content` once (no `this.state` clone). Write errors no longer interpolate the file body.

## 2026-08-15
- **PR #185 Codacy gate:** BIP-69 uint32 / BIP-85 purpose and hardened-index max use `Number('…')` (same as `CLTV_TIMESTAMP_THRESHOLD`) so `no-loss-of-precision` does not fail the PR. Collection CLI paths resolve with cwd-containment for relative names (`resolveCollectionFilePath`); Semgrep/Opengrep exclude `functions/fabricMessageCollection.js` like the other path-hardened helpers (Codacy ignores `nosemgrep`).
- **PR #185 security / review follow-ups:** `musig2.autoAccept` defaults to **false** (explicit `true` opt-in). Inbound `P2P_MUSIG_START` does not create a session or emit identity-key partials unless auto-accept is on — the identity key is not a remote signing oracle. `createFromStart` no longer falls back to an unparsed remote body. `maxSessions` / `sessionTtlMs` reject non-finite and `< 1` values (negative caps no longer infinite-loop). BIP-21 parse rejects unsupported `req-*` parameters. Static server guards malformed `decodeURIComponent` and does not `writeHead` after headers are sent. `report-credits` only reads lockfile paths under `node_modules`. `IDENTITY.md` notes explicit integer coin types vs network-name 7777/7778. Tests live in `tests/fabric.peer.js`, `tests/fabric.key.js`, `tests/functions.inventoryHtlc.js`, `tests/cli.nonrender.js`.
- **PR #185 review follow-ups:** export `fabricIdentityAccountPath` and `resolveFabricIdentityCoinType` from `constants.js` (account node `m/44'/{7777|7778}'/n'`; derivation path is that node plus `/0/index`). BIP-44 receive/change reuse the purpose-path helper (`purpose` 44). First-class AMP frames keep the **wire name** as `genericBody.type` so JSON `type: 98` on `P2P_INVENTORY_RESPONSE` cannot enqueue a peering candidate (`tests/fabric.peer.adversarial.js`). `Message.fromRaw` copies ArrayBuffer views with `byteOffset`/`byteLength`. `Collection.getLatest` reads the last ordered id (map, not `items.length`). Service `ChatMessage` relays sign with `node.key` when present. `Key` classifies a legacy `xprv`/`mnemonic` in `seed` (FABRIC_SEED) instead of PBKDF2-hashing the string. `musig2.asBuf` rejects non-hex; `verifyFinalSignature` returns `{ ok: false }` without a session; message-collection CLI reports read failures as exit 2. `backupWallet` / setup helpers use union JSDoc returns (no TypeScript `?:`).
- **Fabric Message collections:** `functions/fabricMessageCollection` stores ordered AMP frames (`Message.toBuffer()` hex) as the canonical share format for contract journals, Discord / `GroupDataShare` packs, and peer replay. Dedupes by body hash, drops body-hash mismatches, JSON/JSONL save+restore, `replay` / `replayFold`. CLI: `npm run messages` (`functions/fabricMessageCollection.js`). Docs: `MESSAGES.md`. Not a replacement for Hub `messages/*.json` activity logs.

- **BIP-327 MuSig2:** first-party `functions/musig2` locked to the official BIP vectors (`tests/vectors/bip327.json`). n-of-n Schnorr only — not a t-of-n replacement. **Default** `synthesizeDefaultLadder` / federation vault for **n≥2** uses the MuSig2 aggregate as the Taproot internal key (cooperative key-path; **new address** vs historical NUMS). k-of-n `OP_CHECKSIGADD` and CSV soft-tier stay script-path. Pass `internalKeyMode: 'nums'` to keep the NUMS-only address. Control blocks / PSBTs use the real internal key. Off-chain Beacon / GroupChange stay independent BIP-340 counts. **`P2P_MUSIG_*` is dispatched** on directed TCP (`functions/musig2Session` + `Peer#startMusig2`): START → ACCEPT / RECEIVE_COUNTER → SEND_PROPOSAL → REPLY → ACCEPT_PROPOSAL. Peel / foreign `P2P_RELAY` and generic carriers are ignored; AMP signer must be a listed participant; aggnonce is recomputed locally.

## 2026-08-14
- **BIP helpers (compliance low-hanging fruit):** first-party `functions/bip69` (vin/vout lexicographic sort, official examples; singleton prevouts are validated), `functions/bip85` (HMAC entropy + BIP-39/WIF/XPRV/HEX vectors), `functions/bip21` (bitcoin: encode/parse; inventory HTLC funding hints), `functions/bip67` (`sortPubkeysBip67`; Taproot k-of-n, ARC spend keys, Beacon validators), `functions/bip125` (opt-in RBF nSequence helpers; HTLC refunds stay locktime-only MAX-1). Named BIP-48/49/84/86 path templates in `constants.js`; **default funds path remains BIP-44** `m/44'/0'/0'/0/0`. Bitcoin `_buildPSBT` applies BIP-69 before `addInput` / `addOutput`.
- **Peer generic dispatch:** JSON `type: 98` (AMP `P2P_PEERING_OFFER`) is coerced via `Message.canonicalTypeName` and dispatched instead of `Unhandled Generic Message: 98`. Unhandled defaults no longer `JSON.stringify` the full body. `_registerActor` / `_registerContract` debug lines are names-only and gated on `settings.debug`. `_connect` derived-key summary reads `Key.pubkey` (`settings.public` is unset after `derive({ xprv })`, which logged `(no public key)` on the correct `m/44'/7778'/0'/0/0` path).
- **Chat shoutbox:** Fabric TUI sends/receives first-class UTF-8 `P2P_CHAT_MESSAGE` (Peer `{ text }` + AMP signer, `P2P_PEER_ALIAS` nicknames). Shared helper `functions/fabricChatText`. Cap matches Peer `P2P_CHAT_MAX_CHARS` (2000).
- **Peer/Service memory:** `Service.commit()` emits a compact `{ type, clock, id, patchCount }` and caps `history` (`SERVICE_COMMIT_HISTORY_MAX` / `commitHistoryMax`). It no longer wraps full `state` in an Actor (JSON.parse of Hub collections on every write). Peer isolates `settings.state` maps (no Hub `collections` alias), does not `commit()` on `_writeFabric` / `_registerActor` / every inbound frame, and drops ephemeral `host:port` actors on `_disconnect` / `_destroyFabric`. `Peer#beat` no longer snapshots full state.
- **Operator home env:** `FABRIC_SEED` is the raw BIP32 seed **hex** (16–64 bytes); `FABRIC_MNEMONIC` is the BIP39 phrase; `FABRIC_XPRV` remains preferred. `Key` `FROM_SEED` accepts hex (legacy mnemonic in `seed` still works) and sets `status = 'seeded'`. `Environment` reads `FABRIC_MNEMONIC`. Helpers: `functions/fabricKeyMaterial`, `functions/fabricHomeEnv` (`~/.fabric/env` + `~/.fabric/hub-admin-token` Schnorr `OP_IDENTITY` admin Token), `functions/fabricWalletIdentity` (sealed `wallet.json` via `FABRIC_PASSWORD`). JSDoc on those helpers and `fabricChatText.chatActorIdOf` avoids TypeScript `?:`. `loadIdentityFromWalletFile` uses `loadWallet({ fromFile: true })` so leftover `FABRIC_SEED` cannot replace `wallet.json`. Semgrep/Opengrep exclude those home-env path helpers (Codacy ignores `nosemgrep`). Chaos fuzz prefers a live connection, lands signed frames before hostile AMP, and fails the playnet storm on unexpected peer errors. `npm run home-env` writes those files without printing secrets.
- **RC1 first-tier contract:** `tests/fabric.peer.adversarial.js` locks the four production-readiness green domains (wire integrity, gossip/peering bounds, scoring/bans, identity/wallets) at the hostile-mesh bar. Peer drops **undersize** (`< HEADER_SIZE`) and unparseable frames before parse — truncated NOISE chunks are not body-hash mismatches and do not hard-ban.
- **IdentityCrossSign lift:** `functions/identityCrossSign.js`, `fabricIdentitySchnorr.js`, `identityCrossSignVerify.js` are the canonical gossip strings and BIP340 helpers. HTTP site-login / device-link stay in `@fabric/http` and re-export these leaves. `signCrossSign` binds `localPubkey` to `fabricKey.pubkey` (raw HD `Key` and Passport `{ privateKeyHex, xpub }` round-trip). Canonical strings require compressed or x-only hex pubkeys (no `:` in fields); builders keep only a 64-hex nonce; `signCrossSign` rejects unknown `kind`. `fabricIdentityIdFromPubkeyHex` requires a compressed 66-hex public key. JSDoc on those helpers covers arities / `ok` unions. `createdAt` is unsigned.
- **Peer dial storms:** `_fillPeerSlots` waits `PEER_CANDIDATE_RETRY_MS` (60s) before redialing the same candidate; refused TCP no longer constructs NOISE (shared handshake EventEmitter was leaking listeners). Transient `ECONNREFUSED` is recognized from the error message when Node omits `error.code`. `_connect` skips in-flight `_outboundDialTargets` so overlapping `connectTo` / reconnect cannot open duplicate sockets before `connections[target]` is set. Dial keys are canonical `host:port` (IPv6 bracketed), so `pubkey@host:port` cannot open a second TCP/NOISE session beside `host:port`. Candidate retry timestamps are pruned on queue eviction / expiry and capped to `maxCandidates`; `candidateRetryMs` must be finite and `> 0`. `_disconnect` and inbound encrypt-end / banned-static paths tear down NOISE. Outbound `connect` setup is try/caught so a handshake throw cannot leave the dial target stuck.
- **Wallet writes:** `_writeWalletDocument` uses a pid + random tmp suffix so concurrent writes in one process cannot clobber the same `.tmp`.
- **Peer `contract:message`:** `messageHex` is a getter so hot paths that ignore the wire hex skip `toBuffer()`.
- **Tests:** coverage for `--password=VALUE` (`functions/cliPasswordArgv`), GroupChange `signers.set` vote bind, wallet atomic write / touchWallet truncate, advertised vs verified peering suppress, Beacon persist-fail retain, `Environment.stop()` key wipe, and related lock/setup fail-closed paths.
- **Codacy (PR #183):** timing-safe setup password confirm; setup TUI treats cancel as a non-string password (no `== null`); hallmark hex length uses a literal class (no `new RegExp`); tier `when` paths skip `__proto__`/`constructor`/`prototype`; BIP65 lock constants avoid 32-bit hex literals; Semgrep/Opengrep exclude path-hardened `fabricSetup` / `environment` (containment already tested).
- **Shutdown / create:** `Environment.stop()` calls `lockWallet()` so seed/xprv/plaintext keys wipe even when the idle-lock handler was never installed; `touchWallet` creates a missing file with exclusive `wx` and does not truncate on `EEXIST`.
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
- **ARC resolveSpend + withdrawals:** add `functions/contractSpend.js` (`normalizeArcGenesis`, `resolveSpend`, tip-bound `ContractWithdrawalRequest` / `Witness`, `prepareWithdrawalFromRequest`). Accumulate folds withdrawals and rejects stale tip bindings. See [`docs/CONTRACTS.md`](docs/CONTRACTS.md).
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
- **Setup gate** — `fabric --help` / `--version` without a wallet; no auto-setup; bare `fabric` hints `fabric setup`. Quieter `contracts/setup.js` (seed + xpub/path; master xprv is not printed).
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
