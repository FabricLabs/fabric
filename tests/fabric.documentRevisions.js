'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('../types/key');
const Message = require('../types/message');
const { CONTRACT_BODY_TYPES } = require('../functions/applicationNamespaces');
const revisions = require('../functions/documentRevisions');

function sha (text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function version (text, name = 'notes.txt') {
  return { id: sha(text), sha256: sha(text), name, mime: 'text/plain', size: Buffer.byteLength(text) };
}

describe('@fabric/core functions/documentRevisions', function () {
  const editor = new Key();
  const other = new Key();
  const outsider = new Key();

  function makeContract (opts = {}) {
    const definition = revisions.buildDocumentContractGenesis(Object.assign({
      name: 'notes.txt',
      mime: 'text/plain',
      publisher: editor.pubkey,
      editors: [other.pubkey],
      created: '2026-11-08T00:00:00.000Z'
    }, opts));
    const publish = revisions.buildDocumentContractPublishMessage({ definition, key: editor });
    const contract = revisions.documentContractId(definition);
    return { definition, publish, contract };
  }

  function revise (contract, previous, revision, text, previousText, key = editor) {
    return revisions.buildDocumentRevisionMessage({
      contract,
      previous,
      document: version(text),
      revision,
      previousDocumentIdentifier: previousText == null ? null : sha(previousText),
      editedAt: '2026-11-08T00:00:0' + revision + '.000Z',
      key
    });
  }

  function chain () {
    const c = makeContract();
    const r1 = revise(c.contract, c.publish, 1, 'one');
    const r2 = revise(c.contract, r1, 2, 'two', 'one', other);
    const r3 = revise(c.contract, r2, 3, 'three', 'two');
    return Object.assign(c, { r1, r2, r3 });
  }

  it('registers DocumentRevision as a shared contract body type', function () {
    assert.strictEqual(CONTRACT_BODY_TYPES.DocumentRevision, 'DocumentRevision');
    assert.strictEqual(revisions.DOCUMENT_REVISION_TYPE, 'DocumentRevision');
  });

  it('builds a genesis with the publisher as an editor', function () {
    const { definition, contract } = makeContract({ nonce: 'ab'.repeat(16) });
    assert.strictEqual(definition.type, 'DocumentContract');
    assert.ok(definition.members.signers.includes(editor.pubkey.slice(2)));
    assert.ok(definition.members.signers.includes(other.pubkey.slice(2)));
    assert.deepStrictEqual(definition.primitives.messageTypes, ['DocumentRevision']);
    assert.match(contract, /^[0-9a-f]{64}$/);
    const again = makeContract({ nonce: 'ab'.repeat(16) });
    assert.strictEqual(again.contract, contract, 'same genesis, same id');
    assert.notStrictEqual(makeContract().contract, makeContract().contract, 'random nonce separates contracts');
  });

  it('refuses a publish signed by a non-editor', function () {
    const definition = revisions.buildDocumentContractGenesis({ name: 'x', publisher: editor.pubkey });
    assert.throws(() => revisions.buildDocumentContractPublishMessage({ definition, key: outsider }), /editors/);
  });

  it('chains revisions with header parents and folds them in any order', function () {
    const c = chain();
    assert.strictEqual(c.r1.parent, c.publish.id);
    assert.strictEqual(c.r2.parent, c.r1.id);
    const frames = [c.r3, c.publish, c.r2, c.r1].map((m) => m.toBuffer().toString('hex'));
    const fold = revisions.foldDocumentRevisions(frames);
    assert.strictEqual(fold.ok, true);
    assert.strictEqual(fold.contractId, c.contract);
    assert.deepStrictEqual(fold.revisions.map((r) => r.revision), [1, 2, 3]);
    assert.strictEqual(fold.head.documentIdentifier, sha('three'));
    assert.strictEqual(fold.revisions[1].author, other.pubkey.slice(2));
    assert.strictEqual(fold.forks.length, 0);
    assert.strictEqual(fold.invalid.length, 0);
    assert.strictEqual(fold.frames.length, 4);
    assert.strictEqual(fold.frames[0].id, c.publish.id);
  });

  it('rejects a revision signed by a non-editor', function () {
    const c = chain();
    const forged = revise(c.contract, c.r3, 4, 'four', 'three', outsider);
    const fold = revisions.foldDocumentRevisions([c.publish, c.r1, c.r2, c.r3, forged].map((m) => m.toBuffer()));
    assert.strictEqual(fold.head.revision, 3);
    assert.ok(fold.invalid.some((row) => row.id === forged.id && /editor/.test(row.reason)));
  });

  it('rejects a revision gap and a wrong previous identifier', function () {
    const c = chain();
    const gap = revise(c.contract, c.r3, 5, 'five', 'three');
    const wrongPrevious = revise(c.contract, c.r3, 4, 'four', 'one');
    const fold = revisions.foldDocumentRevisions([c.publish, c.r1, c.r2, c.r3, gap, wrongPrevious].map((m) => m.toBuffer()));
    assert.strictEqual(fold.head.revision, 3);
    assert.ok(fold.invalid.some((row) => row.id === gap.id && /follow/.test(row.reason)));
    assert.ok(fold.invalid.some((row) => row.id === wrongPrevious.id && /previousDocumentIdentifier/.test(row.reason)));
  });

  it('keeps both edits of a forked parent and picks a deterministic head', function () {
    const c = chain();
    const a = revise(c.contract, c.r2, 3, 'three-b', 'two', other);
    const fold = revisions.foldDocumentRevisions([c.publish, c.r1, c.r2, c.r3, a].map((m) => m.toBuffer()));
    const expectedHead = c.r3.id < a.id ? c.r3 : a;
    assert.strictEqual(fold.head.frameId, expectedHead.id);
    assert.strictEqual(fold.forks.length, 1);
    assert.strictEqual(fold.forks[0].revision, 3);
    const reversed = revisions.foldDocumentRevisions([a, c.r3, c.r2, c.r1, c.publish].map((m) => m.toBuffer()));
    assert.strictEqual(reversed.head.frameId, fold.head.frameId);
  });

  it('reports a revision whose parent is missing', function () {
    const c = chain();
    const fold = revisions.foldDocumentRevisions([c.publish, c.r1, c.r3].map((m) => m.toBuffer()));
    assert.strictEqual(fold.head.revision, 1);
    assert.ok(fold.invalid.some((row) => row.id === c.r3.id && /missing/.test(row.reason)));
  });

  it('builds provenance for an older version without later edits, and verifies it offline', function () {
    const c = chain();
    const frames = [c.publish, c.r1, c.r2, c.r3].map((m) => m.toBuffer().toString('hex'));
    const provenance = revisions.documentProvenance(frames, sha('two'));
    assert.strictEqual(provenance.type, 'DocumentProvenance');
    assert.strictEqual(provenance.revision, 2);
    assert.strictEqual(provenance.collection.type, 'FabricMessageCollection');
    assert.strictEqual(provenance.collection.count, 3);
    const roundTrip = JSON.parse(JSON.stringify(provenance));
    const checked = revisions.verifyDocumentProvenance(roundTrip, { documentIdentifier: sha('two'), sha256: sha('two') });
    assert.strictEqual(checked.ok, true, checked.reason);
    assert.strictEqual(checked.contractId, c.contract);
    assert.strictEqual(checked.revision, 2);
    assert.deepStrictEqual(checked.revisions.map((r) => r.documentIdentifier), [sha('one'), sha('two')]);
    assert.strictEqual(revisions.documentProvenance(frames, sha('missing')), null);
  });

  it('gives a renamed version (same content id) the provenance of its latest revision', function () {
    const c = makeContract();
    const r1 = revise(c.contract, c.publish, 1, 'same');
    const r2 = revisions.buildDocumentRevisionMessage({
      contract: c.contract,
      previous: r1,
      document: version('same', 'renamed.txt'),
      revision: 2,
      previousDocumentIdentifier: sha('same'),
      key: editor
    });
    const provenance = revisions.documentProvenance([c.publish, r1, r2].map((m) => m.toBuffer()), sha('same'));
    assert.strictEqual(provenance.revision, 2);
    assert.strictEqual(revisions.verifyDocumentProvenance(provenance).ok, true);
  });

  it('refuses a tampered provenance', function () {
    const c = chain();
    const provenance = revisions.documentProvenance([c.publish, c.r1, c.r2].map((m) => m.toBuffer()), sha('two'));
    const tampered = JSON.parse(JSON.stringify(provenance));
    const last = tampered.collection.messages[2];
    const buf = Buffer.from(last.hex, 'hex');
    buf[buf.length - 3] ^= 0x01;
    last.hex = buf.toString('hex');
    delete last.hash;
    const checked = revisions.verifyDocumentProvenance(tampered);
    assert.strictEqual(checked.ok, false);
    const claimed = revisions.verifyDocumentProvenance(provenance, { documentIdentifier: sha('one') });
    assert.strictEqual(claimed.ok, false);
    assert.match(claimed.reason, /another document/);
    const wrongRevision = Object.assign({}, provenance, { revision: 3 });
    assert.strictEqual(revisions.verifyDocumentProvenance(wrongRevision).ok, false);
  });

  it('passes a content-hash check only when the last revision commits to that hash', function () {
    const c = makeContract();
    const named = revisions.buildDocumentRevisionMessage({
      contract: c.contract,
      previous: c.publish,
      document: { id: 'release-notes', name: 'notes.txt', mime: 'text/plain' },
      revision: 1,
      key: editor
    });
    const unbound = revisions.documentProvenance([c.publish, named].map((m) => m.toBuffer()), 'release-notes');
    assert.strictEqual(revisions.verifyDocumentProvenance(unbound, { documentIdentifier: 'release-notes' }).ok, true);
    const noHash = revisions.verifyDocumentProvenance(unbound, { documentIdentifier: 'release-notes', sha256: sha('anything') });
    assert.strictEqual(noHash.ok, false);
    assert.match(noHash.reason, /does not commit/);

    const byIdentifier = revisions.buildDocumentRevisionMessage({
      contract: c.contract,
      previous: c.publish,
      document: { id: sha('body'), name: 'notes.txt', mime: 'text/plain' },
      revision: 1,
      key: editor
    });
    const idOnly = revisions.documentProvenance([c.publish, byIdentifier].map((m) => m.toBuffer()), sha('body'));
    assert.strictEqual(revisions.verifyDocumentProvenance(idOnly, { sha256: sha('body') }).ok, true);
    assert.match(revisions.verifyDocumentProvenance(idOnly, { sha256: sha('other') }).reason, /does not match/);

    const full = chain();
    const provenance = revisions.documentProvenance([full.publish, full.r1, full.r2].map((m) => m.toBuffer()), sha('two'));
    assert.strictEqual(revisions.verifyDocumentProvenance(provenance, { sha256: sha('two').toUpperCase() }).ok, true);
    assert.match(revisions.verifyDocumentProvenance(provenance, { sha256: sha('one') }).reason, /does not match/);
    const malformed = revisions.verifyDocumentProvenance(provenance, { sha256: 'not-a-digest' });
    assert.strictEqual(malformed.ok, false);
    assert.match(malformed.reason, /64-hex/);
    const empty = revisions.verifyDocumentProvenance(provenance, { sha256: '' });
    assert.strictEqual(empty.ok, false);
    assert.match(empty.reason, /expected sha256/);
  });

  it('checks a content hash against the signed sha256 before the identifier, in any case', function () {
    const c = makeContract();
    function signed (sha256) {
      const body = revisions.buildDocumentRevisionBody({
        contract: c.contract,
        document: { id: sha('identifier'), name: 'notes.txt', mime: 'text/plain' },
        revision: 1
      });
      body.sha256 = sha256;
      const message = Message.fromLegacyBody('CONTRACT_MESSAGE', body);
      message.parent = c.publish.id;
      message.signWithKey(editor);
      return revisions.documentProvenance([c.publish, message].map((m) => m.toBuffer()), sha('identifier'));
    }

    const distinct = signed(sha('content'));
    assert.strictEqual(revisions.verifyDocumentProvenance(distinct, { sha256: sha('content') }).ok, true);
    assert.match(revisions.verifyDocumentProvenance(distinct, { sha256: sha('identifier') }).reason, /does not match/);

    const upper = signed(sha('content').toUpperCase());
    assert.strictEqual(revisions.verifyDocumentProvenance(upper, { sha256: sha('content') }).ok, true);

    const malformed = revisions.verifyDocumentProvenance(signed('not-a-digest'), { sha256: sha('identifier') });
    assert.strictEqual(malformed.ok, false);
    assert.match(malformed.reason, /revision sha256/);

    const empty = revisions.verifyDocumentProvenance(signed(''), { sha256: sha('identifier') });
    assert.strictEqual(empty.ok, false, 'an empty signed sha256 does not fall back to the identifier');
    assert.match(empty.reason, /revision sha256/);
  });

  it('parses frames into publish and revision views', function () {
    const c = chain();
    const pub = revisions.parseDocumentContractFrame(c.publish.toBuffer());
    assert.strictEqual(pub.kind, 'publish');
    assert.strictEqual(pub.contractId, c.contract);
    assert.ok(Message.isZeroParent(pub.parent));
    const rev = revisions.parseDocumentContractFrame('fabric:' + c.r1.toBuffer().toString('hex'));
    assert.strictEqual(rev.ok, true);
    assert.strictEqual(rev.kind, 'revision');
    assert.strictEqual(rev.body.documentIdentifier, sha('one'));
    const unrelated = Message.fromLegacyBody('CONTRACT_MESSAGE', { contract: c.contract, type: 'GroupChat', text: 'hi' });
    unrelated.signWithKey(editor);
    assert.strictEqual(revisions.parseDocumentContractFrame(unrelated.toBuffer()).ok, false);
  });
});
