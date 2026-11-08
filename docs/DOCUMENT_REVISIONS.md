# Editable documents (`DocumentContract`)

A document's identifier is its content (sha256, or the tree root of a sealed
document), so an edit is always a new document. A `DocumentContract` ties those
versions together: it says who may edit, records every version in order, and
gives each version a **provenance** anyone can check offline. Older versions
stay ordinary documents: still listed, shared, and sold at their own price.

Code: `functions/documentRevisions.js`. Tests: `tests/fabric.documentRevisions.js`.

## Genesis

A `CONTRACT_PUBLISH` signed by one of the editors, with this body:

```js
{
  type: 'DocumentContract',
  v: 1,
  name, mime,
  publisher,                                   // x-only pubkey, always an editor
  members: { signers: [x-only…], threshold },  // signers are the editors (sorted)
  primitives: { messageTypes: ['DocumentRevision'] },
  created,                                     // ISO time
  nonce                                        // 16 bytes hex, keeps contracts distinct
}
```

The contract id is the usual namespace id, `new Actor(definition).id`, so every
Peer that sees the publish computes the same id. Build it with
`buildDocumentContractGenesis` and sign it with
`buildDocumentContractPublishMessage({ definition, key })`. The publish frame is
a genesis frame (zero `parent`).

## Revisions

Each version is a `CONTRACT_MESSAGE` signed by an editor:

```js
{
  contract, type: 'DocumentRevision', v: 1,
  documentIdentifier,            // the version's document id
  revision,                      // 1, 2, 3, …
  previousDocumentIdentifier,    // null for revision 1
  name, mime, editedAt,
  sha256?, merkleRootHex?, size?, note?
}
```

The header `parent` is the frame id (`Message#id`, SHA-256 of the whole signed
frame) of the revision it replaces; revision 1 points at the publish frame.
Since the parent is signed, a revision cannot be moved to another place in the
history. `buildDocumentRevisionMessage({ contract, previous, document,
revision, previousDocumentIdentifier, key })` sets it before signing.

`revision` is the number to use in `DOCUMENT_PUBLISH.revision` (the payment
binding), so a sale names the version it is for. Lineage is not in the binding.

## Folding

`foldDocumentRevisions(frames, { contractId? })` takes the frames in any order
and returns `{ contractId, definition, editors, head, revisions, forks, invalid,
frames }`. A revision is accepted when:

- its signature is valid and the signer is an editor;
- its parent is the publish frame or an accepted revision;
- `revision` is the parent's revision plus one;
- `previousDocumentIdentifier` is the parent's `documentIdentifier`.

Anything else is listed in `invalid` with a reason. Two editors may revise the
same parent: both are kept. The head is the highest revision (lowest frame id on
a tie); `revisions` is the chain from 1 to the head and `forks` the rest. Every
v1 revision needs one editor's signature; `threshold` is recorded for later
k-of-n approval.

## Provenance

`documentProvenance(frames, documentIdentifier)` returns

```js
{ type: 'DocumentProvenance', v: 1, contractId, documentIdentifier, revision,
  collection }   // FabricMessageCollection: publish, revision 1 … this revision
```

It never includes edits made after that version, so selling an old version does
not reveal later ones. `verifyDocumentProvenance(provenance, { documentIdentifier?,
contractId?, sha256? })` checks it with no other data: one unbroken chain of
editor-signed frames, ending at the claimed version. Holding a provenance grants
no edit rights; editors come only from the signed genesis.
