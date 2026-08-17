# Fabric Messaging Protocol Policy

**Version:** 1.0
**Last Updated:** 2026-08-11
**Status:** Active

Opcode and relay tables below still need a pass against [`SECURITY.md`](SECURITY.md) / Peer behavior — see [Remaining work](#remaining-work).

---

## Table of Contents

1. [Overview](#overview)
2. [Message Format](#message-format)
3. [Message Types](#message-types)
4. [Relay Rules](#relay-rules)
5. [Cryptographic Requirements](#cryptographic-requirements)
6. [Security Policies](#security-policies)
7. [Network Behavior](#network-behavior)
8. [Compliance](#compliance)

---

## Overview

This document defines the messaging rules and relay policies for the Fabric Protocol. All peers in the Fabric network MUST comply with these policies to ensure network integrity, security, and proper message propagation.

### Core Principles

1. **Cryptographic Integrity**: All messages MUST be signed using BIP-340 Schnorr signatures
2. **Type-Based Routing**: Message relay decisions are based on message type
3. **Privacy Preservation**: Identity and session messages are handled locally
4. **Network Propagation**: Network-critical messages are relayed to all peers
5. **Performance**: High-throughput relay with minimal latency

---

## Message Format

### Fabric Message Structure

All Fabric messages consist of two components:

#### Header (208 bytes)
- `magic` — 4 bytes: `0xC0D3F33D` (`MAGIC_BYTES`)
- `version` — 4 bytes: `0x00000001` (`VERSION_NUMBER`; 0.1.x pre-release)
- `parent` — 32 bytes: Parent state identifier
- `author` — 32 bytes: X-only public key (BIP-340) of message author
- `type` — 4 bytes: Message type code
- `size` — 4 bytes: Payload size in bytes
- `hash` — 32 bytes: double-SHA256(body) — body integrity only
- `preimage` — 32 bytes: payment secret (Lightning-style); all zeros when unused
- `signature` — 64 bytes: BIP-340 Schnorr signature

Constants: `HEADER_SIZE = 208` in [`constants.js`](constants.js). See [`docs/MESSAGE_BODY.md`](docs/MESSAGE_BODY.md).

#### Payload (variable length)
- Optional payload data as specified by `size` field

### Message Signing

1. **Author Field**: Set to x-only public key (32 bytes) BEFORE signing
2. **Body hash**: Set `hash` = double-SHA256(body)
3. **Preimage**: Leave zeroed for ordinary public messages; set an explicit 32-byte secret only for HTLC / circuit payment commitments (`payment_hash = SHA256(preimage)`). Do not default `preimage` to SHA256(body)
4. **Signature hash**:
   - Create buffer: `header (with zeroed signature) + body`
   - Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
5. **Signature**: Sign the tagged hash using BIP-340 Schnorr
6. **Verification**: Drop on body-hash mismatch, then verify signature using author's x-only public key

---

## Message Types

### Type Ranges

Historical range buckets (approximate). Prefer exact opcodes in the tables below / [`MESSAGES.md`](MESSAGES.md).

| Range | Category | Description |
|-------|----------|-------------|
| `0x00-0x7F` | Core Network Protocol | Fabric network management and peer communication (incl. mesh) |
| `0x80-0xFF` | Application Layer | Some application types; others use higher codes |
| `0x1000-0x1FFF` | (legacy sketch) | Not used for Fabric Bitcoin types in `constants.js` |
| `0x2000-0x2FFF` | Lightning AMP | Lightning types on the Fabric Message wire (not BOLT-on-lightningd) |
| `0x8000-0xFFFF` | Experimental | Development and testing |

### Core Network Protocol Types (0x00-0x7F)

Codes from [`constants.js`](constants.js). Full catalog: [`MESSAGES.md`](MESSAGES.md).

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x00` | 0 | RESERVED / `P2P_ROOT` | Reserved / root | N/A |
| `0x01` | 1 | `P2P_IDENT_REQUEST` | Identity request | ❌ No |
| `0x02` | 2 | `SESSION_START` | Legacy session start constant | ❌ No |
| `0x03` | 3 | `BLOCK_CANDIDATE` | Block candidate | ⚠️ Conditional |
| `0x09` | 9 | `PEER_CANDIDATE` | Peer candidate advertisement | ⚠️ Conditional |
| `0x11` | 17 | `P2P_IDENT_RESPONSE` | Identity response | ❌ No |
| `0x12` | 18 | `P2P_PING` | Network heartbeat / keepalive | ❌ No |
| `0x13` | 19 | `P2P_PONG` | Ping response | ❌ No |
| `0x20` | 32 | `P2P_INSTRUCTION` | Peer instruction | ⚠️ Conditional |
| `0x21` | 33 | `P2P_START_CHAIN` | Chain bootstrap announce | ⚠️ Conditional |
| `0x29` | 41 | `P2P_STATE_REQUEST` | State synchronization request | ⚠️ Conditional |
| `0x30` | 48 | `P2P_STATE_ROOT` | State root / snapshot anchor | ⚠️ Conditional |
| `0x31` | 49 | `P2P_BASE_MESSAGE` | Generic/legacy JSON carrier (no first-class escalation) | ⚠️ Conditional |
| `0x32` | 50 | `P2P_STATE_COMMITTMENT` | State commitment | ⚠️ Conditional |
| `0x33` | 51 | `P2P_STATE_CHANGE` | State delta | ✅ Yes |
| `0x39` | 57 | `P2P_TRANSACTION` | Transaction-style P2P frame | ✅ Yes |
| `0x42` | 66 | `P2P_CALL` | Call / RPC-like request | ⚠️ Conditional |
| `0x43` | 67 | `P2P_RELAY` | Mesh flood envelope (body = raw inner AMP bytes) | ✅ Yes |
| `0x44` | 68 | `P2P_MESSAGE_RECEIPT` | Ack / receipt | ❌ No |
| `0x45` | 69 | `P2P_FORWARD` | Directed onion hop (`nextPeer` + `ttl` + `inner`) | ⚠️ Conditional |
| `0x55` | 85 | `P2P_CHAIN_SYNC_REQUEST` | Chain sync request | ⚠️ Conditional |
| `0x56` | 86 | `P2P_FLUSH_CHAIN` | Trusted tip rewind / flush | ⚠️ Conditional |
| `0x57` | 87 | `P2P_INVENTORY_REQUEST` | Inventory request | ⚠️ Conditional |
| `0x58` | 88 | `P2P_INVENTORY_RESPONSE` | Inventory response | ⚠️ Conditional |
| `0x59` | 89 | `P2P_FILE_SEND` | Document / blob transfer | ⚠️ Conditional |
| `0x5a` | 90 | `P2P_DOCUMENT_PUBLISH` | Document pricing / publish path | ✅ Yes |
| `0x5b` | 91 | `P2P_PEER_ALIAS` | Nickname (raw UTF-8 body) | ✅ Yes |
| `0x5c` | 92 | `P2P_PEER_ANNOUNCE` | Peer announcement | ✅ Yes |
| `0x5d` | 93 | `P2P_SESSION_OFFER` | Session handshake offer | ❌ No |
| `0x5e` | 94 | `P2P_SESSION_OPEN` | Session handshake open | ❌ No |
| `0x5f` | 95 | `P2P_CONTRACT_PUBLISH` | Publish contract namespace | ✅ Yes |
| `0x60` | 96 | `P2P_CONTRACT_MESSAGE` | Namespaced contract event | ✅ Yes |
| `0x61` | 97 | `P2P_PEER_GOSSIP` | Peer gossip | ✅ Yes |
| `0x62` | 98 | `P2P_PEERING_OFFER` | Peering capacity offer | ✅ Yes |
| `0x67` | 103 | `CHAT_MESSAGE` | Legacy chat / Hub transitional | ✅ Yes |
| `0x68` | 104 | `P2P_CHAT_MESSAGE` | First-class chat (raw UTF-8 body) | ✅ Yes |
| `0x80` | 128 | `P2P_GENERIC` | Generic application envelope | ✅ Yes |

### Application Layer Types (0x80-0xFF)

Several application types use codes **outside** this range (see [`constants.js`](constants.js) / [`MESSAGES.md`](MESSAGES.md)). Rows marked † match current constants.

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x80` | 128 | `P2P_GENERIC` | Generic application message | ✅ Yes |
| `0x8A` | 138 | `CONTRACT_PROPOSAL` † | Contract proposal | ✅ Yes |
| — | 997 | `SIDECHAIN_STATE_PATCH` † | Sidechain / registry update | ⚠️ Conditional |
| — | 998 | `DOCUMENT_PUBLISH` † | Document publish | ✅ Yes |
| — | 999 | `DOCUMENT_REQUEST` † | Document request | ⚠️ Conditional |
| — | 1024 | `JSON_PATCH` † | JSON patch operation | ✅ Yes |
| — | 16000 | `JSON_CALL` † | JSON function call | ✅ Yes |
| — | 15103 | `GENERIC_MESSAGE` † | Hub/browser transitional carrier | ✅ Yes |
| `0x4220` | 16928 | `P2P_MUSIG_START` † | Directed BIP-327 session open | ❌ No |
| `0x4221` | 16929 | `P2P_MUSIG_ACCEPT` † | Co-signer pubnonce | ❌ No |
| `0x4222` | 16930 | `P2P_MUSIG_RECEIVE_COUNTER` † | Additional pubnonce (n>2) | ❌ No |
| `0x4223` | 16931 | `P2P_MUSIG_SEND_PROPOSAL` † | Coordinator aggnonce | ❌ No |
| `0x4224` | 16932 | `P2P_MUSIG_REPLY_TO_PROPOSAL` † | Partial signature | ❌ No |
| `0x4225` | 16933 | `P2P_MUSIG_ACCEPT_PROPOSAL` † | Aggregated BIP-340 signature | ❌ No |
| `0x81`-`0x8F` (legacy draft) | … | CHAT / ACCEPT / REJECT / PAYMENT_* | Not all registered in `constants.js` — see Remaining work | ⚠️ Varies |

### Bitcoin Integration Types

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x5208` | 21000 | `BITCOIN_BLOCK` | Bitcoin block | ✅ Yes |
| `0x526c` | 21100 | `BITCOIN_BLOCK_HASH` | Bitcoin block hash | ✅ Yes |
| `0x55f0` | 22000 | `BITCOIN_TRANSACTION` | Bitcoin transaction | ✅ Yes |
| `0x5654` | 22100 | `BITCOIN_TRANSACTION_HASH` | Bitcoin transaction hash | ✅ Yes |

### Lightning Network Types (0x2000-0x2FFF)

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x2000` | 8192 | LIGHTNING_INIT | Lightning initialization | ❌ No |
| `0x2001` | 8193 | LIGHTNING_ERROR | Lightning error | ❌ No |
| `0x2002` | 8194 | LIGHTNING_OPEN_CHANNEL | Open channel | ❌ No |
| `0x2003` | 8195 | LIGHTNING_ACCEPT_CHANNEL | Accept channel | ❌ No |
| `0x2004` | 8196 | LIGHTNING_FUNDING_CREATED | Funding created | ❌ No |
| `0x2005` | 8197 | LIGHTNING_FUNDING_SIGNED | Funding signed | ❌ No |
| `0x2006` | 8198 | LIGHTNING_CHANNEL_READY | Channel ready | ❌ No |
| `0x2007` | 8199 | LIGHTNING_SHUTDOWN | Channel shutdown | ❌ No |
| `0x2008` | 8200 | LIGHTNING_CLOSING_SIGNED | Closing signed | ❌ No |
| `0x2009` | 8201 | LIGHTNING_UPDATE_ADD_HTLC | Add HTLC | ❌ No |
| `0x200A` | 8202 | LIGHTNING_UPDATE_FULFILL_HTLC | Fulfill HTLC | ❌ No |
| `0x200B` | 8203 | LIGHTNING_UPDATE_FAIL_HTLC | Fail HTLC | ❌ No |
| `0x200C` | 8204 | LIGHTNING_COMMITMENT_SIGNED | Commitment signed | ❌ No |
| `0x200D` | 8205 | LIGHTNING_REVOKE_AND_ACK | Revoke and acknowledge | ❌ No |
| `0x200E` | 8206 | LIGHTNING_CHANNEL_ANNOUNCEMENT | Channel announcement | ✅ Yes |
| `0x200F` | 8207 | LIGHTNING_NODE_ANNOUNCEMENT | Node announcement | ✅ Yes |
| `0x2010` | 8208 | LIGHTNING_CHANNEL_UPDATE | Channel update | ✅ Yes |
| `0x2011` | 8209 | LIGHTNING_WARNING | Lightning warning | ❌ No |
| `0x2012` | 8210 | LIGHTNING_PING | Lightning keepalive | ❌ No |
| `0x2013` | 8211 | LIGHTNING_PONG | Lightning ping response | ❌ No |
| `0x2014-0x2FFF` | 8212-12287 | RESERVED | Reserved for Lightning protocol extensions | N/A |

### Experimental Types (0x8000-0xFFFF)

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x8000-0xFFFF` | 32768-65535 | EXPERIMENTAL | Development and testing use | ⚠️ Varies |

---

## Relay Rules

### Relay Decision Matrix

Messages are categorized into three relay behaviors:

#### ✅ Always Relay (Network Propagation)

**Purpose**: Messages that need network-wide distribution for consensus, connectivity, or application functionality.

**Types**:
- Network management: PING, PONG, PEER_ANNOUNCE, ERROR, WARNING
- Consensus: TRANSACTION, STATE_DELTA, STATE_SNAPSHOT
- Application: GENERIC, CHAT_MESSAGE, DOCUMENT_PUBLISH, JSON_CALL, JSON_PATCH
- Contracts: CONTRACT_PROPOSAL, CONTRACT_ACCEPT, CONTRACT_REJECT
- Payments: PAYMENT_REQUEST, PAYMENT_RESPONSE, LOCK_MESSAGE
- Bitcoin: All Bitcoin integration types
- Lightning: Channel and node announcements only

**Behavior**:
- Forward to ALL connected peers
- Maintain cryptographic integrity across hops
- No TTL or hop limit (subject to future policy updates)

#### ❌ Handle Locally (No Relay)

**Purpose**: Messages that contain sensitive information or are peer-to-peer only.

**Types**:
- Identity: IDENT_REQUEST, IDENT_RESPONSE
- Session: SESSION_START, SESSION_ACK
- Debugging: LOG_MESSAGE, HEARTBEAT
- Lightning: All channel management messages (except announcements)

**Behavior**:
- Process locally only
- Do NOT forward to other peers
- Respond directly to sender if appropriate

#### ⚠️ Conditional Relay (Content-Based)

**Purpose**: Messages that may or may not need relay based on local state or content.

**Types**:
- STATE_REQUEST: Relay if not cached locally
- STATE_RESPONSE: Relay if not the intended recipient
- INVENTORY_REQUEST: Relay if inventory not available locally
- INVENTORY_RESPONSE: Relay if not the intended recipient
- DOCUMENT_REQUEST: Relay if document not available locally
- DOCUMENT_RESPONSE: Relay if not the intended recipient

**Behavior**:
1. Check local state/cache
2. If available locally: Handle locally, do not relay
3. If not available: Relay to connected peers
4. Update local state upon receipt

### Relay Implementation Rules

1. **Cryptographic Verification**:
   - Verify message signature BEFORE relaying
   - Reject and do not relay invalid messages

2. **Deduplication**:
   - Track message IDs to prevent duplicate relay
   - Use message hash as unique identifier

3. **Origin Tracking**:
   - Track message origin to prevent loops
   - Do not relay back to origin peer

4. **Performance**:
   - Relay should be non-blocking
   - Batch relay operations when possible
   - Prioritize critical message types

5. **Error Handling**:
   - Log relay failures
   - Continue processing other messages
   - Do not crash on relay errors

---

## Cryptographic Requirements

### Signature Algorithm

- **Algorithm**: BIP-340 Schnorr signatures
- **Curve**: secp256k1
- **Hash Function**: SHA256 (for tagged hash); body integrity uses double-SHA256
- **Tag**: "Fabric/Message"
- **Preimage**: 32-byte payment secret in header (zeros if unused)

### Signing Process

1. Extract x-only public key (32 bytes) from signing key
2. Set `author` field to x-only public key
3. Set `hash` = double-SHA256(body); set `preimage` per payment rules
4. Create data buffer: `header (signature zeroed) + body`
5. Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
6. Sign tagged hash using BIP-340 Schnorr
7. Set `signature` field (64 bytes)

### Verification Process

1. Reject if `hash` ≠ double-SHA256(body)
2. Extract x-only public key from `author` field (32 bytes)
3. Create data buffer: `header (signature zeroed) + body`
4. Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
5. Verify signature using x-only public key and tagged hash
6. Reject message if verification fails

### Security Requirements

1. **All messages MUST be signed**: Unsigned messages are rejected
2. **Signature verification is mandatory**: No exceptions
3. **Author field validation**: Must be valid 32-byte x-only public key
4. **Hash integrity**: Header `hash` must equal double-SHA256(body)
5. **Preimage**: Not a second integrity hash; zeros unless carrying a payment secret
6. **No signature replay**: Implement message deduplication

---

## Security Policies

### Message Validation

All messages MUST pass the following validation checks:

1. **Format Validation**:
   - Magic bytes: `0xC0D3F33D`
   - Version: `0x00000001`
   - Header size: 208 bytes
   - Payload size matches `size` field

2. **Cryptographic Validation**:
   - Signature is valid BIP-340 Schnorr signature
   - Author field contains valid x-only public key
   - Header `hash` matches double-SHA256(body)

3. **Type Validation**:
   - Message type is in valid range
   - Message type is not reserved
   - Message type matches payload format

### Rejection Criteria

Messages are REJECTED if:

1. Invalid magic bytes or version
2. Invalid signature (cryptographic verification fails)
3. Invalid author field (not 32 bytes, invalid format)
4. Payload hash mismatch
5. Message type out of range or reserved
6. Payload size exceeds maximum allowed
7. Message is duplicate (already processed)

### Privacy Policies

1. **Identity Messages**: Never relayed, processed locally only
2. **Session Messages**: Peer-to-peer only, not relayed
3. **Log Messages**: Local processing only, never relayed
4. **Channel Management**: Lightning channel messages are peer-to-peer only

### Rate Limiting

Peers SHOULD implement rate limiting to prevent:

1. Message flooding
2. Denial of service attacks
3. Resource exhaustion

Recommended limits:
- Per-peer message rate: 1000 messages/second
- Network-wide message rate: 10,000 messages/second
- Burst allowance: 2x normal rate for 1 second

---

## Network Behavior

### Message Propagation

1. **Origin**: Message created and signed by origin peer
2. **First Hop**: Origin peer sends to directly connected peers
3. **Relay Decision**: Each peer decides whether to relay based on type
4. **Propagation**: Relayed messages forwarded to all connected peers (except origin)
5. **Verification**: Each peer verifies signature before processing/relaying

### Network Topology

- **Mesh Network**: Peers connect in mesh topology
- **No Central Authority**: Fully decentralized
- **Peer Discovery**: Via PEER_ANNOUNCE messages
- **Connection Management**: Via PING/PONG messages

### Performance Targets

- **Relay Throughput**: 20,000+ messages/second
- **Average Latency**: < 1ms per hop
- **Success Rate**: 100% for valid messages
- **Cryptographic Overhead**: < 5% of total processing time

---

## Compliance

### Implementation Requirements

All Fabric Protocol implementations MUST:

1. ✅ Implement BIP-340 Schnorr signature signing and verification
2. ✅ Use tagged hash "Fabric/Message" for message signing
3. ✅ Enforce relay rules based on message type
4. ✅ Validate all messages before processing or relaying
5. ✅ Handle identity and session messages locally
6. ✅ Relay network-critical messages to all peers
7. ✅ Implement message deduplication
8. ✅ Track message origin to prevent loops

### Testing Requirements

Implementations SHOULD:

1. Test message signing and verification
2. Test relay behavior for all message types
3. Test cryptographic integrity across multiple hops
4. Test rejection of invalid messages
5. Test performance under load
6. Test network topology scenarios

### Version Compatibility

- **Protocol Version**: `0x00000001` (0.1.x pre-release; 208-byte header with `preimage`)
- **Header size**: 208 bytes
- **Backward Compatibility**: Not guaranteed for future versions
- **Forward Compatibility**: Unknown message types should be handled as observe-only (`UNKNOWN_MESSAGE`), not aliased to `P2P_BASE_MESSAGE`

---

## Appendix

### Message Type Quick Reference

**Always Relay**: PING, PONG, PEER_ANNOUNCE, TRANSACTION, GENERIC, CHAT_MESSAGE, DOCUMENT_PUBLISH, JSON_CALL, JSON_PATCH, STATE_DELTA, STATE_SNAPSHOT, CONTRACT_*, PAYMENT_*, LOCK_MESSAGE, BITCOIN_*, LIGHTNING_*_ANNOUNCEMENT

**Never Relay**: IDENT_REQUEST, IDENT_RESPONSE, SESSION_START, SESSION_ACK, HEARTBEAT, LOG_MESSAGE, LIGHTNING_INIT, LIGHTNING_ERROR, LIGHTNING_*_CHANNEL, LIGHTNING_*_HTLC, LIGHTNING_COMMITMENT_SIGNED, LIGHTNING_REVOKE_AND_ACK

**Conditional Relay**: STATE_REQUEST, STATE_RESPONSE, INVENTORY_REQUEST, INVENTORY_RESPONSE, DOCUMENT_REQUEST, DOCUMENT_RESPONSE

### Related Documents

- `PROTOCOL.md` → `docs/MESSAGE_BODY.md`: Canonical wire specification
- `MESSAGES.md`: Opcode purpose notes
- `FABRIC_MESSAGE_TYPE_CONSOLIDATION.md`: Generated decode-order freeze (one name per opcode)
- `SECURITY.md`: Amplification, peel/`P2P_RELAY`, scoring (prefer over relay matrix below when they conflict)
- `docs/P2P_FORWARD.md`: Directed onion

Missing historical drafts (do not expect these files): `MESSAGING_PROTOCOL_COMPLETION.md`, `FABRIC_MESSAGE_RELAY_BEHAVIOR.md`.

### Remaining work

Paused after header/preimage, core opcode accuracy, and mesh type rows. Still open:

1. **Relay Rules / Quick Reference** — Align Always/Local/Conditional lists with Peer (`SECURITY.md`); PING/PONG are not mesh flood; hop budgets exist
2. ~~**Lightning table**~~ — `constants.js` AMP types use `0x2000+` (`LIGHTNING_INIT` `0x2000` … `LIGHTNING_PONG` `0x2013`). Fabric keeps the low numbers. Duplicate opcodes fail at `Message` module load.
3. **Application legacy rows** — `CONTRACT_ACCEPT` / `REJECT` / `PAYMENT_*` / dense `0x81+` draft codes not fully registered
4. **Type Ranges** preamble — Still describes old range buckets; Bitcoin types are not in `0x1000-0x1FFF`
5. **Citation pass** — `VISION.md` / `docs/README.md` still treat POLICY as oracle
6. **Legacy path inventory** — Keep handling, mark deprecated in code/docs: 176-byte header sketches; defaulting `preimage` to SHA256(body); smuggling first-class opcodes via `P2P_BASE_MESSAGE` / `GENERIC_MESSAGE`; `@type`/`@data` Message constructor aliases; JSON object bodies where field schemas exist

---

**End of Policy Document**
