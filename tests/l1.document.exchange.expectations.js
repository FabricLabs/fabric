'use strict';

/**
 * Expectations for L1 document exchange (see docs/L1_DOCUMENT_EXCHANGE.md).
 * These tests encode invariants for canonical publish and pricing gossip.
 */

const assert = require('assert');
const crypto = require('crypto');

const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  purchaseContentHashHex,
  documentPublishEnvelopeBuffer,
  inventoryHtlcPreimage32
} = require('../functions/publishedDocumentEnvelope');

describe('L1 document exchange expectations', function () {
  describe('publishedDocumentEnvelope (hub / L1 binding)', function () {
    it('purchaseContentHashHex is deterministic and 64 hex chars', function () {
      const docId = 'doc-expectations-1';
      const buf = Buffer.from('canonical body', 'utf8');
      const parsed = {
        id: docId,
        name: 'x.txt',
        mime: 'text/plain',
        revision: 1,
        contentBase64: buf.toString('base64'),
        size: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex')
      };
      const a = purchaseContentHashHex(docId, parsed);
      const b = purchaseContentHashHex(docId, parsed);
      assert.strictEqual(a, b);
      assert.ok(/^[0-9a-f]{64}$/.test(a));
    });

    it('preimage is SHA256 of canonical envelope buffer', function () {
      const docId = 'doc-expectations-2';
      const buf = Buffer.from('envelope bytes', 'utf8');
      const parsed = {
        id: docId,
        contentBase64: buf.toString('base64'),
        size: buf.length,
        mime: 'application/octet-stream',
        name: 'b',
        revision: 1,
        sha256: crypto.createHash('sha256').update(buf).digest('hex')
      };
      const env = documentPublishEnvelopeBuffer(docId, parsed);
      const p32 = inventoryHtlcPreimage32(docId, parsed);
      const expected = crypto.createHash('sha256').update(env).digest();
      assert.ok(Buffer.isBuffer(p32));
      assert.strictEqual(p32.toString('hex'), expected.toString('hex'));
    });

    it('purchaseContentHashHex equals SHA256(preimage)', function () {
      const docId = 'doc-expectations-3';
      const parsed = {
        id: docId,
        contentBase64: Buffer.from('z', 'utf8').toString('base64'),
        size: 1,
        mime: 'text/plain',
        name: 'z',
        revision: 1,
        sha256: crypto.createHash('sha256').update(Buffer.from('z')).digest('hex')
      };
      const preimage = inventoryHtlcPreimage32(docId, parsed);
      const hex = purchaseContentHashHex(docId, parsed);
      const fromPreimage = crypto.createHash('sha256').update(preimage).digest('hex');
      assert.strictEqual(hex, fromPreimage);
    });
  });

  describe('Peer wire events', function () {
    it('emits documentPublish (camelCase) for P2P_DOCUMENT_PUBLISH generic body', function (done) {
      const peer = new Peer({ listen: false, peersDb: null });
      peer.once('documentPublish', (ev) => {
        try {
          assert.strictEqual(ev.documentId, 'my-doc');
          assert.strictEqual(ev.rateSats, 999);
          assert.ok(ev.message && ev.message.object);
          done();
        } catch (e) {
          done(e);
        }
      });
      peer._handleGenericMessage({
        type: 'P2P_DOCUMENT_PUBLISH',
        object: { hash: 'my-doc', rate: 999 }
      }, { name: 'origin' });
    });

    it('emits inventory for INVENTORY_REQUEST', function (done) {
      const peer = new Peer({ listen: false, peersDb: null });
      peer.once('inventory', (ev) => {
        try {
          assert.strictEqual(ev.message.type, 'INVENTORY_REQUEST');
          assert.strictEqual(ev.origin.name, 'o');
          done();
        } catch (e) {
          done(e);
        }
      });
      peer._handleGenericMessage(
        { type: 'INVENTORY_REQUEST', object: { offerBtc: true, maxSats: 1000 } },
        { name: 'o' }
      );
    });

    it('emits inventoryResponse for INVENTORY_RESPONSE', function (done) {
      const peer = new Peer({ listen: false, peersDb: null });
      peer.once('inventoryResponse', (ev) => {
        try {
          assert.strictEqual(ev.message.type, 'INVENTORY_RESPONSE');
          assert.deepStrictEqual(ev.message.object.items, [{ id: 'a', rateSats: 1 }]);
          done();
        } catch (e) {
          done(e);
        }
      });
      peer._handleGenericMessage({
        type: 'INVENTORY_RESPONSE',
        object: { items: [{ id: 'a', rateSats: 1 }] }
      }, { name: 'o' });
    });
  });

  describe('Canonical publish alignment', function () {
    it('_publishDocument (rate 0) broadcasts payload matching documentPublishEnvelopeBuffer data', function () {
      const peer = new Peer({ listen: false, peersDb: null });
      const docId = 'align-doc';
      const body = 'same logical content';
      const parsed = peer._buildDocumentParsedForPublish(docId, body);
      const envBuf = documentPublishEnvelopeBuffer(docId, parsed);

      const captured = [];
      peer.broadcast = (buf) => captured.push(buf);

      peer._publishDocument(docId, body, 0);

      assert.strictEqual(captured.length, 1);
      const wire = Message.fromBuffer(captured[0]);
      const envMsg = Message.fromBuffer(Buffer.from(envBuf));
      assert.strictEqual(wire.data.toString('utf8'), envMsg.data.toString('utf8'));
    });

    it('pricing gossip is distinct from canonical envelope bytes', function () {
      const peer = new Peer({ listen: false, peersDb: null });
      const docId = 'align-doc-2';
      const body = 'x';
      const parsed = peer._buildDocumentParsedForPublish(docId, body);
      const envBuf = documentPublishEnvelopeBuffer(docId, parsed);

      const captured = [];
      peer.broadcast = (buf) => captured.push(buf);

      peer._publishDocument(docId, body, 99);

      assert.strictEqual(captured.length, 2);
      const firstData = Message.fromBuffer(captured[0]).data.toString('utf8');
      assert.strictEqual(firstData, Message.fromBuffer(Buffer.from(envBuf)).data.toString('utf8'));
      const second = Message.fromBuffer(captured[1]);
      assert.strictEqual(second.type, 'P2P_DOCUMENT_PUBLISH');
    });
  });

  describe('CLI integration expectation (documented)', function () {
    it('types/cli listens for DocumentPublish and DocumentRequest; Peer emits publish and request events', function () {
      const fs = require('fs');
      const path = require('path');
      const cliPath = path.join(__dirname, '../types/cli.js');
      const src = fs.readFileSync(cliPath, 'utf8');
      assert.ok(/on\('DocumentPublish'/.test(src), 'CLI should register DocumentPublish listener');
      assert.ok(/on\('DocumentRequest'/.test(src), 'CLI should register DocumentRequest listener');

      const peerPath = path.join(__dirname, '../types/peer.js');
      const peerSrc = fs.readFileSync(peerPath, 'utf8');
      assert.ok(
        /emit\('documentPublish'/.test(peerSrc),
        'Peer should emit documentPublish for subscribers'
      );
      assert.ok(
        /emit\('DocumentPublish'/.test(peerSrc),
        'Peer should emit DocumentPublish for CLI compatibility'
      );
      assert.ok(
        /emit\('documentRequest'/.test(peerSrc),
        'Peer should emit documentRequest for DOCUMENT_REQUEST'
      );
      assert.ok(
        /emit\('DocumentRequest'/.test(peerSrc),
        'Peer should emit DocumentRequest for CLI compatibility'
      );
    });
  });
});
