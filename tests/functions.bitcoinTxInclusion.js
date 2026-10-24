'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { merkleRootFromTxids, buildBranch, verifyInclusion, buildInclusion, parseHeader, targetFromBits, headerMeetsTarget } = require('../functions/bitcoinTxInclusion');
const Message = require('../types/message');

/** Header over `txids`, mined at regtest difficulty (`bits` 0x207fffff). */
function headerFor (txids, bits = 0x207fffff) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(2, 0);
  Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
  header.writeUInt32LE(bits, 72);
  while (!headerMeetsTarget(header.toString('hex'))) header.writeUInt32LE(header.readUInt32LE(76) + 1, 76);
  return header.toString('hex');
}

describe('functions/bitcoinTxInclusion', function () {
  it('matches the Bitcoin genesis block (single tx: root == txid)', () => {
    const genesisTx = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
    assert.strictEqual(merkleRootFromTxids([genesisTx]), genesisTx);
    const genesisHeader = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
    const parsed = parseHeader(genesisHeader);
    assert.strictEqual(parsed.blockHash, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
    assert.strictEqual(parsed.merkleRootHex, genesisTx);
    assert.strictEqual(verifyInclusion({ blockHeaderHex: genesisHeader, txid: genesisTx, index: 0, branch: [] }).ok, true);
  });

  it('builds and verifies branches for odd and even tx counts; rejects forgeries', () => {
    for (const n of [2, 3, 5, 8]) {
      const txids = Array.from({ length: n }, () => crypto.randomBytes(32).toString('hex'));
      const headerHex = headerFor(txids);
      for (let i = 0; i < n; i++) {
        const proof = buildInclusion({ blockHeaderHex: headerHex, txids, txid: txids[i] });
        assert.strictEqual(proof.index, i);
        assert.strictEqual(verifyInclusion(proof).ok, true, `n=${n} i=${i}`);
        const other = Object.assign({}, proof, { txid: crypto.randomBytes(32).toString('hex') });
        assert.strictEqual(verifyInclusion(other).ok, false);
        const wrongIndex = Object.assign({}, proof, { index: (i + 1) % n });
        if (n > 1) assert.strictEqual(verifyInclusion(wrongIndex).ok, false);
      }
      assert.throws(() => buildBranch(txids, crypto.randomBytes(32).toString('hex')), /not in block/);
    }
  });

  it('decodes compact bits and rejects headers without proof-of-work', () => {
    assert.strictEqual(targetFromBits(0x1d00ffff), 0xffffn << 208n);
    assert.strictEqual(targetFromBits(0x00000000), null);
    assert.strictEqual(targetFromBits(0x04800000), null, 'negative');
    // A blank header whose Merkle root is the txid itself — trivially forgeable.
    const txid = crypto.randomBytes(32).toString('hex');
    const blank = Buffer.alloc(80);
    Buffer.from(txid, 'hex').reverse().copy(blank, 36);
    const verdict = verifyInclusion({ blockHeaderHex: blank.toString('hex'), txid, index: 0, branch: [] });
    assert.strictEqual(verdict.ok, false);
    assert.match(verdict.reason, /proof-of-work/);
    // Mainnet-difficulty bits on an unmined header fail too.
    const hard = Buffer.from(headerFor([txid]), 'hex');
    hard.writeUInt32LE(0x1d00ffff, 72);
    assert.strictEqual(verifyInclusion({ blockHeaderHex: hard.toString('hex'), txid, index: 0, branch: [] }).ok, false);
  });

  it('pins branch depth with txCount and rejects duplicated nodes (CVE-2012-2459)', () => {
    const txids = Array.from({ length: 3 }, () => crypto.randomBytes(32).toString('hex'));
    const headerHex = headerFor(txids);
    const proof = buildInclusion({ blockHeaderHex: headerHex, txids, txid: txids[2] });
    assert.strictEqual(proof.txCount, 3);
    assert.strictEqual(verifyInclusion(proof).ok, true);
    assert.strictEqual(verifyInclusion(Object.assign({}, proof, { txCount: 9 })).ok, false, 'depth mismatch');
    assert.strictEqual(verifyInclusion(Object.assign({}, proof, { txCount: 2 })).ok, false, 'index beyond count');
    // Mutated tree [a, b, c, c]: same root, but the duplicate (index 3) pairs with an equal left sibling.
    const dup = buildBranch([...txids, txids[2]], txids[2]);
    const mutated = { blockHeaderHex: headerHex, txid: txids[2], index: 3, branch: dup.branch };
    const verdict = verifyInclusion(mutated);
    assert.strictEqual(verdict.ok, false);
    assert.match(verdict.reason, /CVE-2012-2459/);
  });
});

describe('Message.verifyFrameAuthor', function () {
  it('recovers the x-only author of a signed AMP frame and rejects tampering', () => {
    const Key = require('../types/key');
    const key = new Key();
    const frame = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({ name: 'd', body: 'AA==' })]).signWithKey(key).toBuffer();
    const ok = Message.verifyFrameAuthor(frame);
    assert.strictEqual(ok.ok, true, ok.reason);
    assert.strictEqual(ok.author, key.pubkey.slice(2));
    assert.strictEqual(ok.type, 0x59);
    assert.strictEqual(ok.body.toString('utf8'), JSON.stringify({ name: 'd', body: 'AA==' }));
    const tampered = Buffer.from(frame); tampered[tampered.length - 1] ^= 1;
    assert.strictEqual(Message.verifyFrameAuthor(tampered).ok, false);
    assert.strictEqual(Message.verifyFrameAuthor(frame.subarray(0, 100)).ok, false);
    assert.strictEqual(Message.verifyFrameAuthor(Message.fromVector(['P2P_FILE_SEND', 'x']).toBuffer()).ok, false, 'unsigned');
  });
});
