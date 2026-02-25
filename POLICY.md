# Fabric Messaging Protocol Policy

**Version:** 1.0
**Last Updated:** 2025-01-27
**Status:** Active

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

#### Header (176 bytes)
- `magic` — 4 bytes: `0xC0D3F33D` (constant)
- `version` — 4 bytes: `0x00000001` (protocol version)
- `parent` — 32 bytes: Parent state identifier
- `author` — 32 bytes: X-only public key (BIP-340) of message author
- `type` — 4 bytes: Message type code
- `size` — 4 bytes: Payload size in bytes
- `hash` — 32 bytes: SHA256 hash of payload
- `signature` — 64 bytes: BIP-340 Schnorr signature

#### Payload (variable length)
- Optional payload data as specified by `size` field

### Message Signing

1. **Author Field**: Set to x-only public key (32 bytes) BEFORE signing
2. **Hash Computation**:
   - Create buffer: `header (with zeroed signature) + body`
   - Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
3. **Signature**: Sign the tagged hash using BIP-340 Schnorr
4. **Verification**: Verify signature using author's x-only public key

---

## Message Types

### Type Ranges

| Range | Category | Description |
|-------|----------|-------------|
| `0x00-0x7F` | Core Network Protocol | Network management and peer communication |
| `0x80-0xFF` | Application Layer | Application-specific messages |
| `0x1000-0x1FFF` | Bitcoin Integration | Bitcoin protocol messages |
| `0x2000-0x2FFF` | Lightning Network | Lightning protocol messages |
| `0x8000-0xFFFF` | Experimental | Development and testing |

### Core Network Protocol Types (0x00-0x7F)

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x00` | 0 | RESERVED | Reserved for future use | N/A |
| `0x01` | 1 | PING | Network heartbeat | ✅ Yes |
| `0x02` | 2 | PONG | Ping response | ✅ Yes |
| `0x03` | 3 | IDENT_REQUEST | Identity request | ❌ No |
| `0x04` | 4 | IDENT_RESPONSE | Identity response | ❌ No |
| `0x05` | 5 | PEER_ANNOUNCE | Peer announcement | ✅ Yes |
| `0x06` | 6 | STATE_REQUEST | State synchronization request | ⚠️ Conditional |
| `0x07` | 7 | STATE_RESPONSE | State synchronization response | ⚠️ Conditional |
| `0x08` | 8 | TRANSACTION | Transaction data | ✅ Yes |
| `0x09` | 9 | INVENTORY_REQUEST | Inventory request | ⚠️ Conditional |
| `0x0A` | 10 | INVENTORY_RESPONSE | Inventory response | ⚠️ Conditional |
| `0x0B` | 11 | SESSION_START | Start session | ❌ No |
| `0x0C` | 12 | SESSION_ACK | Session acknowledgment | ❌ No |
| `0x0D` | 13 | ERROR | Error message | ✅ Yes |
| `0x0E` | 14 | WARNING | Warning message | ✅ Yes |
| `0x0F` | 15 | HEARTBEAT | Heartbeat (keepalive) | ❌ No |
| `0x10-0x7F` | 16-127 | RESERVED | Reserved for core protocol extensions | N/A |

### Application Layer Types (0x80-0xFF)

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x80` | 128 | GENERIC | Generic application message (UTF-8 JSON) | ✅ Yes |
| `0x81` | 129 | CHAT_MESSAGE | Chat/messaging | ✅ Yes |
| `0x82` | 130 | DOCUMENT_REQUEST | Document request | ⚠️ Conditional |
| `0x83` | 131 | DOCUMENT_RESPONSE | Document response | ⚠️ Conditional |
| `0x84` | 132 | DOCUMENT_PUBLISH | Document publish | ✅ Yes |
| `0x85` | 133 | JSON_CALL | JSON function call | ✅ Yes |
| `0x86` | 134 | JSON_PATCH | JSON patch operation | ✅ Yes |
| `0x87` | 135 | LOG_MESSAGE | Log message (debugging) | ❌ No |
| `0x88` | 136 | STATE_DELTA | State delta (JSON-PATCH) | ✅ Yes |
| `0x89` | 137 | STATE_SNAPSHOT | State snapshot | ✅ Yes |
| `0x8A` | 138 | CONTRACT_PROPOSAL | Contract proposal | ✅ Yes |
| `0x8B` | 139 | CONTRACT_ACCEPT | Contract acceptance | ✅ Yes |
| `0x8C` | 140 | CONTRACT_REJECT | Contract rejection | ✅ Yes |
| `0x8D` | 141 | PAYMENT_REQUEST | Payment request (ASK) | ✅ Yes |
| `0x8E` | 142 | PAYMENT_RESPONSE | Payment response (BID) | ✅ Yes |
| `0x8F` | 143 | LOCK_MESSAGE | Lock message (halt forward movement) | ✅ Yes |
| `0x90-0xFF` | 144-255 | RESERVED | Reserved for application extensions | N/A |

### Bitcoin Integration Types (0x1000-0x1FFF)

| Type | Code | Name | Description | Relay |
|------|------|------|-------------|-------|
| `0x1000` | 4096 | BITCOIN_BLOCK | Bitcoin block | ✅ Yes |
| `0x1001` | 4097 | BITCOIN_BLOCK_HASH | Bitcoin block hash | ✅ Yes |
| `0x1002` | 4098 | BITCOIN_TRANSACTION | Bitcoin transaction | ✅ Yes |
| `0x1003` | 4099 | BITCOIN_TX_HASH | Bitcoin transaction hash | ✅ Yes |
| `0x1004` | 4100 | BITCOIN_UTXO | Bitcoin UTXO | ✅ Yes |
| `0x1005` | 4101 | BITCOIN_HEADER | Bitcoin block header | ✅ Yes |
| `0x1006-0x1FFF` | 4102-8191 | RESERVED | Reserved for Bitcoin protocol extensions | N/A |

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
| `0x2011-0x2FFF` | 8209-12287 | RESERVED | Reserved for Lightning protocol extensions | N/A |

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
- **Hash Function**: SHA256 (for tagged hash)
- **Tag**: "Fabric/Message"

### Signing Process

1. Extract x-only public key (32 bytes) from signing key
2. Set `author` field to x-only public key
3. Create data buffer: `header (signature zeroed) + body`
4. Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
5. Sign tagged hash using BIP-340 Schnorr
6. Set `signature` field (64 bytes)

### Verification Process

1. Extract x-only public key from `author` field (32 bytes)
2. Create data buffer: `header (signature zeroed) + body`
3. Compute tagged hash: `SHA256(SHA256("Fabric/Message") || SHA256("Fabric/Message") || data)`
4. Verify signature using x-only public key and tagged hash
5. Reject message if verification fails

### Security Requirements

1. **All messages MUST be signed**: Unsigned messages are rejected
2. **Signature verification is mandatory**: No exceptions
3. **Author field validation**: Must be valid 32-byte x-only public key
4. **Hash integrity**: Payload hash must match computed hash
5. **No signature replay**: Implement message deduplication

---

## Security Policies

### Message Validation

All messages MUST pass the following validation checks:

1. **Format Validation**:
   - Magic bytes: `0xC0D3F33D`
   - Version: `0x00000001`
   - Header size: 176 bytes
   - Payload size matches `size` field

2. **Cryptographic Validation**:
   - Signature is valid BIP-340 Schnorr signature
   - Author field contains valid x-only public key
   - Payload hash matches computed hash

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

- **Protocol Version**: `0x00000001`
- **Backward Compatibility**: Not guaranteed for future versions
- **Forward Compatibility**: Unknown message types should be rejected

---

## Appendix

### Message Type Quick Reference

**Always Relay**: PING, PONG, PEER_ANNOUNCE, TRANSACTION, GENERIC, CHAT_MESSAGE, DOCUMENT_PUBLISH, JSON_CALL, JSON_PATCH, STATE_DELTA, STATE_SNAPSHOT, CONTRACT_*, PAYMENT_*, LOCK_MESSAGE, BITCOIN_*, LIGHTNING_*_ANNOUNCEMENT

**Never Relay**: IDENT_REQUEST, IDENT_RESPONSE, SESSION_START, SESSION_ACK, HEARTBEAT, LOG_MESSAGE, LIGHTNING_INIT, LIGHTNING_ERROR, LIGHTNING_*_CHANNEL, LIGHTNING_*_HTLC, LIGHTNING_COMMITMENT_SIGNED, LIGHTNING_REVOKE_AND_ACK

**Conditional Relay**: STATE_REQUEST, STATE_RESPONSE, INVENTORY_REQUEST, INVENTORY_RESPONSE, DOCUMENT_REQUEST, DOCUMENT_RESPONSE

### Related Documents

- `PROTOCOL.md`: Core protocol specification
- `MESSAGING_PROTOCOL_COMPLETION.md`: Implementation details
- `FABRIC_MESSAGE_TYPE_CONSOLIDATION.md`: Type system design
- `FABRIC_MESSAGE_RELAY_BEHAVIOR.md`: Relay behavior analysis

---

**End of Policy Document**
