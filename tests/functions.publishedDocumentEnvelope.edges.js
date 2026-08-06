'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { describe, it } = require('mocha');

const Message = require('../types/message');
const Key = require('../types/key');
const {
  whitelistedDocumentFields,
  assertUnsignedDocumentPublishEnvelope,
  documentPublishEnvelopeBuffer,
  inventoryHtlcPreimage32FromEnvelopeBuffer,
  purchaseContentHashHex,
  inventoryHtlcPreimage32
} = require('../functions/publishedDocumentEnvelope');

describe('functions/publishedDocumentEnvelope edge cases', function () {
  const docId = 'edge-doc-1';
  const body = Buffer.from('edge-body', 'utf8');
  const parsed = {
    id: docId,
    contentBase64: body.toString('base64'),
    size: body.length,
    mime: 'text/plain',
    name: 'edge.txt',
    revision: 1,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    created: 111,
    edited: 222,
    lineage: 'should-drop',
    parent: 'also-drop'
  };

  it('whitelist drops created/edited/lineage/parent', function () {
    const w = whitelistedDocumentFields(docId, parsed);
    assert.strictEqual(w.created, undefined);
    assert.strictEqual(w.edited, undefined);
    assert.strictEqual(w.lineage, undefined);
    assert.strictEqual(w.parent, undefined);
    assert.strictEqual(w.id, docId);
    assert.strictEqual(w.contentBase64, parsed.contentBase64);
  });

  it('payment hash is stable when only timestamps drift', function () {
    const a = purchaseContentHashHex(docId, parsed);
    const b = purchaseContentHashHex(docId, { ...parsed, created: 999, edited: 1000 });
    assert.strictEqual(a, b);
  });

  it('assertUnsigned rejects short buffers and signed frames', function () {
    assert.throws(() => assertUnsignedDocumentPublishEnvelope(Buffer.alloc(10)), /≥ 208/);
    const unsigned = documentPublishEnvelopeBuffer(docId, parsed);
    const key = new Key();
    const signed = Message.fromBuffer(unsigned).signWithKey(key).toBuffer();
    assert.throws(() => assertUnsignedDocumentPublishEnvelope(signed), /unsigned/);
    assert.throws(() => inventoryHtlcPreimage32FromEnvelopeBuffer(signed), /unsigned/);
  });

  it('documentPublishEnvelopeBuffer requires id and contentBase64', function () {
    assert.throws(() => documentPublishEnvelopeBuffer('', parsed), /required/);
    assert.throws(() => documentPublishEnvelopeBuffer(docId, {}), /required/);
    assert.throws(() => documentPublishEnvelopeBuffer(docId, { contentBase64: null }), /required/);
  });

  it('inventoryHtlcPreimage32FromEnvelopeBuffer matches inventoryHtlcPreimage32', function () {
    const env = documentPublishEnvelopeBuffer(docId, parsed);
    const fromBuf = inventoryHtlcPreimage32FromEnvelopeBuffer(env);
    const fromParsed = inventoryHtlcPreimage32(docId, parsed);
    assert.strictEqual(fromBuf.toString('hex'), fromParsed.toString('hex'));
  });

  it('defaults mime/name/revision when omitted', function () {
    const w = whitelistedDocumentFields('id2', { contentBase64: 'YQ==' });
    assert.strictEqual(w.mime, 'application/octet-stream');
    assert.strictEqual(w.name, 'document');
    assert.strictEqual(w.revision, 1);
    assert.strictEqual(w.size, 0);
    assert.strictEqual(w.sha256, 'id2');
  });
});
