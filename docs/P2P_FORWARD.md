# P2P_FORWARD — directed onion hops

Protect peer IPs by nesting application Messages inside signed
`P2P_FORWARD` layers and sending only to the next hop.

## Why not `P2P_RELAY`?

| Type | Opcode | Behavior |
|------|--------|----------|
| `P2P_RELAY` | `0x43` | Mesh **flood**: unwrap inner; forward **bit-identical** outer (no hop re-wrap); nest depth capped |
| `P2P_FORWARD` | `0x45` | **Directed**: peel if `nextPeer` is local, else write bit-identical frame to that peer only |

Flood relays expose every hop’s neighbors to the same frame. Directed
forwarding means the destination’s TCP peer is the last relay, not the
originator.

## Body schema (V1)

| Field | Type | Meaning |
|-------|------|---------|
| `nextPeer` | `bytes32` | X-only secp256k1 pubkey (same encoding as AMP `author`) |
| `ttl` | `u8` | Remaining hops; drop when `0` |
| `inner` | `message` | Nested AMP frame |

Max path length: `P2P_FORWARD_MAX_HOPS` (8) in `constants.js`.

## App pathway

```js
const Peer = require('@fabric/core/types/peer');
const Message = require('@fabric/core/types/message');
const { wrapOnionPath, xOnlyFromKey } = require('@fabric/core/functions/fabricOnion');

const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello']);
payload.signWithKey(peer.key);

// path[0] = immediate TCP peer, path[last] = final deliverer
peer.sendOnion(
  [xOnlyFromKey(relayKey), xOnlyFromKey(destKey)],
  payload
);
```

Or build offline and send yourself:

```js
const outer = wrapOnionPath({
  path: [relayXOnly, destXOnly],
  payload,
  key: peer.key
});
// write outer.toBuffer() to the first hop’s socket
```

Events: `onion:sent`, `onion:peel`, `onion:forward`, `onion:undeliverable`.

## Threat model (this release)

- **Provides:** destination does not learn the originator’s IP; intermediate
  peers do not mesh-flood the payload.
- **Does not provide:** Sphinx/BOLT4 encryption. Each hop can read
  `nextPeer` for its layer and the cleartext `inner` unless the app seals
  the payload. Confidentiality is an application concern (e.g. sealed
  documents).

## Example

```bash
node examples/onion-forward.js
```

## Tests

- `tests/functions.fabricOnion.js`
- `tests/peer.onion.forward.js`

## Downstream

- Hub JSON-RPC **`SendOnion`** — TCP Peer on the hub agent; Bridge drops WS `P2P_FORWARD`.
- `@fabric/http` does not terminate onions (see `docs/MESSAGE_SPEC.md`).
