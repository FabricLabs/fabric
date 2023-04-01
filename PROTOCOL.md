# The Fabric Protocol
Fabric implements a TCP-based networking protocol for establishing and executing peer-to-peer agreements.

## Messages
Fabric Messages are hex-encoded bytestreams with a fixed-length header and an optional payload.

### Fabric Message Format
The **Fabric Message Format** consists of two (2) components; the message header (the "Header") and the message body (the "Payload").

#### Fabric Message Header
- `magic` — 4 bytes `C0DEF33D` (constant)
- `version` — 4 bytes `00000001` (variable)
- `parent` — 32 bytes (parent state identifier)
- `type` — 4 bytes (message type)
- `size` — 4 bytes (payload size)
- `checksum` — 32 bytes (sha256sum of payload)
- `signature` — 64 bytes (composable signature by message author of the `checksum`)

#### Fabric Message Payload
- (optional) `payload` — `size` bytes

### Types
The base list of Fabric Message Types is as follows:

- `GENERIC` — decimal `128` (`0000080`)
- `STATE` — decimal `192` (`00000C0`)
- `DELTA` — decimal `193` (`00000C1`)
- `ACK` — decimal `200` (`00000C8`) (may change)
- `LOCK` — decimal `232` (`00000E8`)
- `ANNOUNCE` — decimal `256` (`0000100`)
- `BID` — decimal `300` (`0000012C`)
- `ASK` — decimal `402` (`0000192`)
- `CLOSE` — decimal `512` (`0000200`)

#### The `GENERIC` Message Type
UTF8-encoded JSON payload.

#### The `ANNOUNCE` Message Type
Used for Peer announcements.

#### The `STATE` Message Type
Pure State snapshots.

#### The `DELTA` Message Type
State delta in JSON-PATCH format.

#### The `LOCK` Message Type
Halt forward movement.

#### The `ACK` Message Type
Confirm receipt of a message.

#### The `ASK` Message Type
Ask for payment to unlock a specific document.

#### The `BID` Message Type
Offers a payment to unlock of specific document.

#### The `CLOSE` Message Type
Cancel a previous message.

### Generic Messages
Generic messages use the `GENERIC` type and are currently implemented with UTF8 payloads.

## Compute
Fabric provides a reference REPL (Read, Evaluate, Print, Loop) interface via the `fabric` command.

### Fabric Compute Space
Certain generic types are provided within any Fabric Compute Space.

#### Actor
The `Actor` type maps an object to its unique identifier.

#### ActorSet
An `ActorSet` is a hashmap of `Actor` instances, address by their ID.

#### Collection
A `Collection` is a list of `Actor` instances.

#### Contract
The `Contract` class provides a simple method for creating agreements between a known set of peers.

## Peering
Peers are identified in the Fabric network by their [**Fabric Identity**][fabric-identity], a `bech32m` encoding of the prefix `id` and public key body.

Connecting to other peers in Fabric requires knowledge of the peer's **public key**.

```
$ fabric
C^i
/connect 0375f7cfc3fa3bc9ed621019018fca678da404a29c8dfec4350855b5ad2f0a42d7@hub.fabric.pub:7777
```

### Peer Protocol
Initiator sends a `P2P_SESSION_OFFER` message, counterparty responds with `P2P_SESSION_OPEN` message.

#### Negotiation
```
incorrect state            correct state
  |                                    |
  v                                    |
  prior state                          |
  |                                    |
  v                                    |
  timeout                              |
  |                                    |
  |                                    |
  |                                    v
   \---------------------------------> sign -> broadcast
```

### Layers
```
sha256(input) -> sha256(hash) -> (100% signing set signature)
```




[fabric-identity]: IDENTITY.md
