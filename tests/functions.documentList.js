'use strict';

const assert = require('assert');
const { MAX_MESSAGE_SIZE } = require('../constants');
const Key = require('../types/key');
const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  DOCUMENT_LIST_TYPE,
  compactDocumentRow,
  buildDocumentList,
  chunkDocumentList,
  documentListFits,
  foldDocumentList,
  contractMessageEnvelopeReserve,
  ampObjectBudget
} = require('../functions/documentList');
const {
  createCollection,
  collectionTipId,
  ingest
} = require('../functions/fabricMessageCollection');
const {
  COMPACTABLE_TYPES,
  compactJournalEntries
} = require('../functions/contractMessageAccumulate');

const DOC = 'ab'.repeat(32);
const CONTRACT = 'cd'.repeat(32);

describe('functions/documentList', function () {
  it('drops bytes and blob indexes from a catalog row', function () {
    const row = compactDocumentRow({
      id: DOC,
      sha256: DOC,
      name: 'notes.txt',
      mime: 'text/plain',
      size: 12,
      content: 'secret bytes',
      contentBase64: 'AAAA',
      blobs: [{ content: 'nope' }],
      documentBlobIndex: { blobs: [{ content: 'nope' }] },
      merkleRootHex: 'ef'.repeat(32),
      purchasePriceSats: 4
    });
    assert.ok(row);
    const json = JSON.stringify(row);
    assert.strictEqual(json.includes('secret'), false);
    assert.strictEqual(json.includes('contentBase64'), false);
    assert.strictEqual(json.includes('documentBlobIndex'), false);
    assert.strictEqual(row.id, DOC);
    assert.strictEqual(row.sha256, DOC);
    assert.strictEqual(row.name, 'notes.txt');
    assert.strictEqual(row.merkleRootHex, 'ef'.repeat(32));
    assert.strictEqual(row.purchasePriceSats, 4);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'blobs'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'content'), false);
  });

  it('chunks an oversize catalog under the AMP body cap', function () {
    const documents = [];
    for (let i = 0; i < 400; i++) {
      documents.push({
        id: i.toString(16).padStart(64, 'a'),
        sha256: i.toString(16).padStart(64, 'b'),
        name: 'document-' + i + '-' + 'n'.repeat(80),
        mime: 'application/octet-stream',
        size: i
      });
    }
    const chunks = chunkDocumentList({
      libraryId: CONTRACT,
      contract: CONTRACT,
      publisher: '02' + '11'.repeat(32),
      recipient: '02' + '22'.repeat(32),
      observedAt: '2026-10-30T00:00:00.000Z',
      documents
    });
    assert.ok(chunks.length > 1, 'expected multiple frames, got ' + chunks.length);
    let counted = 0;
    for (const list of chunks) {
      assert.strictEqual(list.type, DOCUMENT_LIST_TYPE);
      assert.strictEqual(documentListFits(list, CONTRACT), true);
      const msg = Message.fromLegacyBody('CONTRACT_MESSAGE', Object.assign({ contract: CONTRACT }, list));
      assert.ok(msg.raw.data.length <= MAX_MESSAGE_SIZE);
      assert.strictEqual(JSON.stringify(list).includes('documentBlobIndex'), false);
      counted += list.documents.length;
    }
    assert.strictEqual(counted, documents.length);
  });

  it('folds the same catalog in either order, and a later removal sticks', function () {
    const id = 'aa'.repeat(32);
    const addEarly = {
      type: DOCUMENT_LIST_TYPE,
      observedAt: '2026-01-01T00:00:00.000Z',
      hash: '11'.repeat(32),
      documents: [{ id, name: 'early', mime: 'text/plain', size: 1 }]
    };
    const addLate = {
      type: DOCUMENT_LIST_TYPE,
      observedAt: '2026-06-01T00:00:00.000Z',
      hash: '22'.repeat(32),
      documents: [{ id, name: 'late', mime: 'text/plain', size: 2 }]
    };
    const remove = {
      type: DOCUMENT_LIST_TYPE,
      observedAt: '2026-06-01T00:00:00.000Z',
      hash: 'ff'.repeat(32),
      documents: [{ id, removed: true }]
    };
    const forward = foldDocumentList([addEarly, addLate]);
    const reverse = foldDocumentList([addLate, addEarly]);
    assert.deepStrictEqual(forward, reverse);
    assert.strictEqual(forward.documents.length, 1);
    assert.strictEqual(forward.documents[0].name, 'late');

    const removedForward = foldDocumentList([addEarly, addLate, remove]);
    const removedReverse = foldDocumentList([remove, addLate, addEarly]);
    assert.deepStrictEqual(removedForward.documents, []);
    assert.deepStrictEqual(removedReverse.documents, []);
  });

  it('does not treat DocumentList as a compactable journal row', function () {
    assert.strictEqual(COMPACTABLE_TYPES.includes('DocumentList'), false);
    const kept = compactJournalEntries([
      { type: 'DocumentList', hash: 'ff' },
      { type: 'GroupChat', hash: '01' },
      { type: 'GroupChat', hash: '02' }
    ], 2);
    assert.ok(kept.some((row) => row.type === 'DocumentList'));
  });

  it('chains the next frame parent to the collection tip', function () {
    const key = new Key();
    const collection = createCollection();
    assert.strictEqual(collectionTipId(collection), Message.ZERO_PARENT);
    const list = buildDocumentList({
      libraryId: CONTRACT,
      publisher: key.pubkey,
      observedAt: '2026-10-30T00:00:00.000Z',
      documents: [{ id: DOC, name: 'a', mime: 'text/plain', size: 1 }]
    });
    const msg = Message.fromLegacyBody('CONTRACT_MESSAGE', Object.assign({ contract: CONTRACT }, list));
    Message.setMessageParent(msg, collectionTipId(collection));
    msg.signWithKey(key);
    const saved = ingest(collection, msg);
    assert.strictEqual(saved.accepted, true, saved.error);
    assert.strictEqual(collectionTipId(collection), msg.id);
  });

  it('measures an envelope reserve inside the body cap', function () {
    const reserve = contractMessageEnvelopeReserve();
    assert.ok(reserve > 0);
    assert.ok(reserve < MAX_MESSAGE_SIZE);
    assert.strictEqual(ampObjectBudget(), Math.max(1024, MAX_MESSAGE_SIZE - reserve));
  });

  it('keeps a retained document out of inventory and sends it when a request is approved', function () {
    const peer = new Peer({ listen: false, peersDb: null });
    const id = 'retained-doc';
    const body = Buffer.from('hello library');
    assert.strictEqual(peer.retainLocalDocument(id, body), true);
    const listed = peer._collectDocumentCatalogInventoryItems();
    assert.strictEqual(listed.some((item) => item.id === id), false);
    assert.ok(peer.getDocumentBuffer(id).equals(body));

    const sent = [];
    peer.connections.peer = {
      _writeFabric (buf) {
        sent.push(buf);
        return true;
      }
    };
    peer.pendingDocumentRequests.k = {
      key: 'k',
      documentId: id,
      peerAddress: 'peer',
      parsed: {}
    };
    const approved = peer.approveDocumentRequest('k');
    assert.strictEqual(approved.ok, true, approved.error);
    assert.ok(sent.length >= 1);
    assert.strictEqual(peer._collectDocumentCatalogInventoryItems().some((item) => item.id === id), false);
  });
});
