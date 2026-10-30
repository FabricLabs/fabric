'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  sealPlaintext,
  openCiphertext,
  paymentHashHexFromKey
} = require('../functions/documentSealedExchange');
const {
  documentPublishEnvelopeBuffer,
  inventoryHtlcPreimage32,
  purchaseContentHashHex
} = require('../functions/publishedDocumentEnvelope');
const Htlc = require('../types/htlc');
const VECTORS = require('./vectors/bip-fabric-file-exchange.json');
const Document = require('../types/document');

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function taggedHash (tag, msg) {
  const t = sha256(Buffer.from(tag, 'utf8'));
  return sha256(Buffer.concat([t, t, msg]));
}

describe('BIP: content-addressed file exchange (test vectors)', function () {
  describe('convergent sealing', function () {
    for (const v of VECTORS.convergent) {
      it(`matches the spec for ${v.plaintextHex.length / 2}-byte plaintext${v.secret ? ' (scoped)' : ''}`, function () {
        const plain = Buffer.from(v.plaintextHex, 'hex');
        const head = v.secret
          ? Buffer.concat([Buffer.from([1]), sha256(Buffer.from(v.secret, 'utf8'))])
          : Buffer.from([0]);
        const key = taggedHash('Fabric/DocumentConvergentKey', Buffer.concat([head, plain]));
        const iv = taggedHash('Fabric/DocumentConvergentIv', key).subarray(0, 12);
        assert.strictEqual(key.toString('hex'), v.keyHex);
        assert.strictEqual(iv.toString('hex'), v.ivHex);
        assert.strictEqual(sha256(key).toString('hex'), v.paymentHashHex);
        assert.strictEqual(sha256(Buffer.from(v.ciphertextHex, 'hex')).toString('hex'), v.chunkIdHex);

        const sealed = sealPlaintext(plain, { convergent: true, secret: v.secret || undefined });
        assert.strictEqual(sealed.key.toString('hex'), v.keyHex);
        assert.strictEqual(sealed.ciphertext.toString('hex'), v.ciphertextHex);
        assert.strictEqual(sealed.contentSha256, v.chunkIdHex);
        assert.strictEqual(paymentHashHexFromKey(sealed.key), v.paymentHashHex);
        assert.ok(openCiphertext(sealed.ciphertext, key, iv).equals(plain));
      });
    }
  });

  describe('document tree', function () {
    for (const v of VECTORS.tree) {
      it(`root over ${v.blobs.length} blob(s) matches the spec`, function () {
        const leaves = v.blobs.map((b) => sha256(Buffer.concat([
          Buffer.from([0x00]),
          Buffer.from(b.blobHashHex, 'hex'),
          Buffer.from(b.paymentHashHex, 'hex'),
          Buffer.from(b.ivHex, 'hex')
        ])));
        assert.deepStrictEqual(leaves.map((l) => l.toString('hex')), v.leavesHex);
        let nodes = leaves;
        while (nodes.length > 1) {
          const next = [];
          for (let i = 0; i < nodes.length; i += 2) {
            next.push(i + 1 < nodes.length
              ? sha256(Buffer.concat([Buffer.from([0x01]), nodes[i], nodes[i + 1]]))
              : nodes[i]);
          }
          nodes = next;
        }
        const count = Buffer.alloc(4);
        count.writeUInt32BE(v.blobs.length, 0);
        const root = sha256(Buffer.concat([Buffer.from([0x02]), count, nodes[0]]));
        assert.strictEqual(root.toString('hex'), v.rootHex);

        const blobs = v.blobs.map((b) => ({
          blobHashHex: b.blobHashHex,
          paymentHashHex: b.paymentHashHex,
          iv: Buffer.from(b.ivHex, 'hex').toString('base64')
        }));
        assert.deepStrictEqual(blobs.map((b) => Document.leafHex(b)), v.leavesHex);
        assert.strictEqual(Document.rootHex(blobs), v.rootHex);
      });
    }

    it('a blob list without payment hashes or IVs uses zero fields', function () {
      const v = VECTORS.tree[2];
      const hashes = v.blobs.map((b) => b.blobHashHex);
      assert.strictEqual(Document.rootHexFromBlobHashes(hashes), Document.rootHex(hashes.map((blobHashHex) => ({ blobHashHex }))));
      assert.notStrictEqual(Document.rootHexFromBlobHashes(hashes), v.rootHex);
    });
  });

  describe('envelope commitment', function () {
    for (const v of VECTORS.envelope) {
      it('preimage = SHA256(envelope), commitment = SHA256(preimage)', function () {
        const buf = documentPublishEnvelopeBuffer(v.documentId, v.document);
        assert.strictEqual(buf.toString('hex'), v.envelopeHex);
        assert.strictEqual(sha256(buf).toString('hex'), v.preimageHex);
        assert.strictEqual(inventoryHtlcPreimage32(v.documentId, v.document).toString('hex'), v.preimageHex);
        assert.strictEqual(sha256(Buffer.from(v.preimageHex, 'hex')).toString('hex'), v.contentHashHex);
        assert.strictEqual(purchaseContentHashHex(v.documentId, v.document), v.contentHashHex);
      });

      it('envelope bytes match the spec layout', function () {
        const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
        const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
        const bytes = (b) => Buffer.concat([u32(b.length), b]);
        const str = (s) => bytes(Buffer.from(s, 'utf8'));
        const d = v.document;
        const body = Buffer.concat([
          u32(0x7f),
          bytes(Buffer.from(d.contentBase64, 'base64')),
          str(v.documentId),
          str(d.mime),
          str(d.name),
          u32(d.revision),
          str(d.sha256),
          u64(d.size),
          str('')
        ]);
        const envelope = Buffer.concat([
          Buffer.from('c0d3f33d', 'hex'),
          u32(1),
          Buffer.alloc(32),
          Buffer.alloc(32),
          u32(0x3e6),
          u32(body.length),
          sha256(sha256(body)),
          Buffer.alloc(32),
          Buffer.alloc(64),
          body
        ]);
        assert.strictEqual(envelope.toString('hex'), v.envelopeHex);
      });
    }
  });

  describe('unsealed per-blob binding', function () {
    for (const v of VECTORS.blobPayment) {
      it(`blob ${v.blobIndex} matches the spec`, function () {
        const payload = Buffer.concat([
          Buffer.from('Fabric/DocumentBlob', 'utf8'),
          Buffer.from(v.documentId, 'utf8'),
          Buffer.from([0]),
          Buffer.from(String(v.blobIndex), 'utf8'),
          Buffer.from([0]),
          Buffer.from(v.blobHashHex, 'utf8')
        ]);
        assert.strictEqual(sha256(payload).toString('hex'), v.contentHashHex);
        assert.strictEqual(Document.blobPaymentHash(v), v.contentHashHex);
      });
    }
  });

  describe('P2TR HTLC template', function () {
    for (const v of VECTORS.htlc) {
      it(`${v.network} output from fixed keys`, function () {
        const xClaim = v.claimPubkeyHex.slice(2);
        const xRefund = v.refundPubkeyHex.slice(2);
        assert.strictEqual(v.claimScriptHex, `a820${v.paymentHashHex}8820${xClaim}ac`);
        assert.ok(v.refundScriptHex.endsWith(`b17520${xRefund}ac`));

        const htlc = new Htlc({
          network: v.network,
          claimPubkey: v.claimPubkeyHex,
          refundPubkey: v.refundPubkeyHex,
          paymentHash: v.paymentHashHex,
          refundLocktime: v.refundLocktime
        });
        assert.strictEqual(htlc.claimScript.toString('hex'), v.claimScriptHex);
        assert.strictEqual(htlc.refundScript.toString('hex'), v.refundScriptHex);
        assert.strictEqual(htlc.merkleRootHex, v.merkleRootHex);
        assert.strictEqual(htlc.controlBlock('claim').toString('hex'), v.claimControlBlockHex);
        assert.strictEqual(htlc.controlBlock('refund').toString('hex'), v.refundControlBlockHex);
        assert.strictEqual(htlc.output.toString('hex'), v.outputHex);
        assert.strictEqual(htlc.address, v.address);
      });
    }
  });
});
