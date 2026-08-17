# Fabric Message collections
Canonical **share / store / replay** unit for signed AMP frames (`Message.toBuffer()`
hex). Use this for contract journals, Discord / `GroupDataShare` packs,
`IdentityCrossSign` catch-up, and any other deterministic event stream that
must round-trip through peers.

Application JSON (chat objects, Hub `messages/*.json`, Discord pack payloads)
is **not** the collection format. JSON is what a replay *handler* folds after
`Message.fromBuffer`.

## Why

Downstream apps already treat wire hex as identity:

| App path | What is stored |
|----------|----------------|
| GoonCitizen `groupStatechain` journal | `fabricMessage: { hash, hex, type }` so peers can `GroupJournalBatch` and replay **bit-identical** frames |
| GoonCitizen `GroupDataShare` | `CONTRACT_MESSAGE` body; packs (`chat.catalog`, `chat.messages`, …) fold after ingest |
| ARC `contractMessageAccumulate` | Identity = AMP body hash; `ingestMessageBuffer` accepts mesh / queue / paste bytes |
| Hub `_appendFabricMessage` | Sequential `messages/*.json` — **activity log**, not a portable AMP collection |

This helper is the shared collect → persist → restore → replay loop those
paths were each inventing.

## Document shape

```json
{
  "type": "FabricMessageCollection",
  "v": 1,
  "count": 2,
  "root": "<sha256 of concatenated ordered body hashes>",
  "messages": [
    { "hash": "<64-hex body hash>", "hex": "<AMP frame>", "type": "P2P_CHAT_MESSAGE" },
    { "hash": "…", "hex": "…", "type": "CONTRACT_MESSAGE", "appType": "GroupDataShare", "contract": "…" }
  ]
}
```

- **`hash`** — header field = double-SHA256(body). Frames whose header does not
  match are dropped (`body-hash-mismatch`), same as Peer.
- **`root`** — SHA-256 of the **ordered** hashes. Arrival order is committed.
  ARC fold may still sort by hash; a different `root` can still fold to the
  same tip digest.
- **JSONL** — one `{ hash, hex, … }` (or raw hex) per line for append-only logs.

## API

```js
const col = require('@fabric/core/functions/fabricMessageCollection');
const collection = col.createCollection();
col.ingest(collection, message);           // Message | Buffer | hex | { hex }
col.ingest(collection, journalRow.fabricMessage);
const doc = col.toJSON(collection);
const restored = col.fromJSON(doc);
col.replay(restored, ({ message, inner }) => {
  // inner is { contract, type, object } for CONTRACT_MESSAGE
});
```

CLI: `npm run messages -- collect stream.jsonl` · `replay` · `verify`
(`node scripts/replay-messages.js`).

Fixture-backed application story (publish + every `GroupChange` action +
GroupChat / proposal+vote / journal request, gossiped on a 3-node loopback mesh):
`tests/application.contract.chain.replay.js` locks
`tests/fixtures/application-contract-chain.json`. Replay must match the
bound `collection.root` and folded `tip.stateDigest`. Regenerate with
`UPDATE_FIXTURE=1`.

## Related

- [`MESSAGE_BODY.md`](MESSAGE_BODY.md) — AMP header / typed bodies
- [`APPLICATION_NAMESPACES.md`](APPLICATION_NAMESPACES.md) — `CONTRACT_MESSAGE` inner types
- [`MESSAGES.md`](../MESSAGES.md#mesh-chat-model-gossip-first) — shoutbox vs GroupChat
- `functions/contractMessageAccumulate.js` — ARC journal fold from the same bytes
