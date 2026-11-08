# V1 wire audit: legacy and carrier types

**Status: proposal for owner sign-off. Nothing listed here has been removed.**

Scope: the legacy and carrier opcodes still registered in `types/message.js`.
For each, this report gives where it is still used and a recommendation. Usage
counts source files outside `node_modules`, `tests/`, `docs/`, built assets,
and the vendored registry tables (Hub and GoonCitizen
`functions/fabricMessageRegistry.js`, which only list names). Fourteen of these
are already in `Message.DEPRECATED_WIRE_TYPES`: decode only, and Peer counts and
warns.

Recommendations:
- **Keep (edge)**: stays registered, but only on the Hub / `@fabric/http`
  WebSocket and loopback paths. Peer never floods it, and it never carries
  mesh protocol.
- **Remove**: unregister the name and keep the opcode reserved, the same way as
  `0x56` below.
- **Decide**: needs an owner call before V1.

## Precedent: `0x56` (`P2P_FLUSH_CHAIN`)

`P2P_FLUSH_CHAIN` was removed in this change, together with core
`flushChainToSnapshot`, the CLI command, the Peer trust plumbing, and the Hub
playnet flush and reset scripts. Here is what happens to `0x56` now:
- It decodes as `UNKNOWN_MESSAGE` and costs no score, under the existing
  forward-compatibility policy (test "unknown AMP opcode decodes as
  UNKNOWN_MESSAGE without score change").
- It is never emitted, relayed, or acted on (test "retired opcode 0x56
  (FLUSH_CHAIN) is unknown").
- The opcode is reserved and never reassigned (`constants.js`, `MESSAGES.md`,
  `POLICY.md`).

**Owner question:** should a reserved opcode cost score, instead of being
treated like any unknown opcode? Today it does not, so a newer peer is never
penalized by an older one.

## Table

| Type | Opcode | Deprecated today | Still used | Recommendation |
|------|--------|------------------|------------|----------------|
| `GENERIC_MESSAGE` | `0x3aff` | no | Hub (Bridge, services), `@fabric/http` WS, Sensemaker, Passport | **Keep (edge).** It is the app carrier. Peer already refuses first-class types inside it (`isFirstClassOpcodeOnlyType`), and a `message` delegation grant now refuses protocol bodies (`GENERIC_PROTOCOL_BODY_TYPES`). |
| `JSON_CALL` | `0x3e80` | no | `@fabric/http` RPC, Hub Bridge, Passport | **Keep (edge).** WebSocket JSON-RPC only; never on the Peer mesh. |
| `JSON_PATCH` | `0x400` | no | Hub state sync, Sensemaker | **Keep (edge).** Hub ↔ browser state only. |
| `CHAT_MESSAGE` | `0x67` | no | Hub and Sensemaker WebSocket chat; core CLI (`types/cli.js` `relayFrom` of every service message) | **Keep (edge).** Mesh chat is `P2P_CHAT_MESSAGE`. The core CLI is the one TCP sender: switch its relay to `P2P_CHAT_MESSAGE` so the type stays WebSocket-only. |
| `P2P_MESSAGE_RECEIPT` | `0x44` | no | `@fabric/http` WS receipts, Hub Bridge, GoonCitizen message log | **Keep (edge).** Point to point only; never relayed. |
| `P2P_BASE_MESSAGE` | `0x31` | no | `@fabric/http` `types/server.js` (`StateUpdate`; fallback for unregistered names) | **Decide.** It is a second generic carrier next to `GENERIC_MESSAGE`. Proposal: move http's `StateUpdate` and its fallback to `GENERIC_MESSAGE`, then deprecate it in V1 and remove it after. |
| `P2P_INSTRUCTION` | `0x20` | no | none (registry only) | **Remove.** It has no originator or schema (MESSAGE_BODY_MIGRATION "Control" row). |
| `P2P_STATE_COMMITTMENT` | `0x32` | no | none (registry only) | **Remove.** Same as above; Beacon and sidechain seals carry commitments now. |
| `PASSPORT_SIGN_REQUEST` | `0x4242` | gossip row `retired` | none (Passport v2/v3 replaced it) | **Remove.** Unregister the name and reserve `0x4242`. |
| `P2P_GENERIC` | `0x80` | yes | none | **Remove.** |
| `P2P_STATE_REQUEST` | `0x29` | yes | none | **Remove.** |
| `P2P_STATE_ROOT` | `0x30` | yes | none | **Remove.** |
| `P2P_STATE_CHANGE` | `0x33` | yes | none | **Remove.** |
| `P2P_TRANSACTION` | `0x39` | yes | none (http only has a comment saying it no longer broadcasts it) | **Remove.** |
| `P2P_CALL` | `0x42` | yes | `@fabric/http` `types/remote.js` imports the constant | **Remove** once that import is dropped (it sends nothing). |
| `PEER_CANDIDATE` | `0x9` | yes | none | **Remove.** |
| `SESSION_START` | `0x2` | yes | none (sessions use `P2P_SESSION_*`) | **Remove.** |
| `P2P_START_CHAIN` | `0x21` | yes | none | **Remove.** |
| `BLOCK_CANDIDATE` | `0x3` | yes | none (`BITCOIN_BLOCK` is the tip gossip) | **Remove.** |
| `LOG_MESSAGE` | `0xc0d49070` | yes | none | **Remove.** |
| `GENERIC_LIST` | `0xc0d4c76e` | yes | none | **Remove.** |

`P2P_IDENT_REQUEST` and `P2P_IDENT_RESPONSE` are also in
`DEPRECATED_WIRE_TYPES`. They follow the same rule: remove them once the
session handshake no longer reads them.

## What "remove" means for each type

1. Drop the name, aliases, schema, and gossip row in `types/message.js`,
   `functions/gossipNetwork.js`, and `constants.js`.
2. Keep a comment in `constants.js` reserving the opcode.
3. Add the opcode to the retired-opcode test so that it decodes as unknown and
   no name or alias claims it.
4. Delete the name from the vendored Hub and GoonCitizen registries.

This is a breaking wire change. Under the release posture it lands on core
first, then `@fabric/http`, Hub, and the apps, in dependency order.
