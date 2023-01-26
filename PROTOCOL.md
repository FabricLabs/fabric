# Fabric Protocol

## Messages
- `magic` — 4 bytes `C0DEF33D`
- `version` — 4 bytes `00000001`
- `parent` — 32 bytes
- `type` — 4 bytes
- `size` — 4 bytes
- `checksum` — 32 bytes
- `signature` — 64 bytes
- (optional) `payload` — `size` bytes

### Types
- `GENERIC` — decimal `128` (`0000080`)

### Generic Messages
Generic messages use the `GENERIC` type and are currently implemented with UTF8 payloads.

## Compute
### Fabric Compute Space
#### Actor
#### ActorSet
An `ActorSet` is a hashmap of `Actor` instances, address by their ID.
#### Collection
A `Collection` is a list of `Actor` instances.
