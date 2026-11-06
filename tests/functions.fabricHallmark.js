'use strict';

const assert = require('assert');
const fh = require('../functions/fabricHallmark');

describe('@fabric/core/functions/fabricHallmark', function () {
  const tip = 'ab'.repeat(32);
  const contractId = 'cd'.repeat(32);
  const sidechain = { clock: 3, stateDigest: '11'.repeat(32) };
  const contracts = { clock: 1, stateDigest: '22'.repeat(32) };

  it('derives a stable 32-byte commitment over tip + contract + state digests', function () {
    const a = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const b = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 3, stateDigest: '11'.repeat(32) },
      contracts: { clock: 1, stateDigest: '22'.repeat(32) }
    });
    assert.strictEqual(a.length, 64);
    assert.strictEqual(a, b);
  });

  it('changes commitment when sidechain stateDigest changes', function () {
    const base = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const next = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 3, stateDigest: '33'.repeat(32) },
      contracts
    });
    assert.notStrictEqual(base, next);
  });

  it('ignores balance-like fields not in the commitment schema', function () {
    const a = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const b = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: Object.assign({ balanceSats: 999 }, sidechain),
      contracts: Object.assign({ height: 42 }, contracts)
    });
    assert.strictEqual(a, b);
  });

  it('encodes a 40-byte payload with magic + tip suffix + commitment', function () {
    const { payload, commitmentHex, tipHashSuffixHex } = fh.encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    assert.strictEqual(payload.length, fh.HALLMARK_PAYLOAD_LENGTH);
    assert.strictEqual(payload.subarray(0, 4).toString('hex'), fh.HALLMARK_MAGIC_HEX);
    assert.strictEqual(tipHashSuffixHex, tip.slice(-8));
    assert.strictEqual(payload.subarray(4, 8).toString('hex'), tipHashSuffixHex);
    assert.strictEqual(payload.subarray(8, 40).toString('hex'), commitmentHex);
  });

  it('round-trips decode and verify', function () {
    const { payload, commitmentHex } = fh.encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const decoded = fh.decodeFabricHallmark(payload);
    assert.ok(decoded);
    assert.strictEqual(decoded.commitmentHex, commitmentHex);
    assert.strictEqual(fh.verifyFabricHallmark(payload, { tipBlockHashHex: tip, commitmentHex }), true);
    assert.strictEqual(fh.verifyFabricHallmark(payload.toString('hex'), { tipBlockHashHex: tip }), true);
  });

  it('rejects wrong magic, length, or tip suffix', function () {
    const { payload, commitmentHex } = fh.encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const badMagic = Buffer.from(payload);
    badMagic[0] = 0xff;
    assert.strictEqual(fh.decodeFabricHallmark(badMagic), null);
    assert.strictEqual(fh.decodeFabricHallmark(payload.subarray(0, 20)), null);

    const otherTip = 'ef'.repeat(32);
    assert.strictEqual(
      fh.verifyFabricHallmark(payload, { tipBlockHashHex: otherTip, commitmentHex }),
      false
    );
  });

  it('tipHashSuffixFromBlockHash takes the last four bytes', function () {
    const hash = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    assert.strictEqual(fh.tipHashSuffixFromBlockHash(hash).toString('hex'), 'ccddeeff');
  });

  it('omits malformed stateDigest from the commitment (same as absent)', function () {
    const withValid = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain,
      contracts
    });
    const withBad = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 3, stateDigest: 'not-a-digest' },
      contracts
    });
    const without = fh.deriveFabricHallmarkCommitmentHex({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 3 },
      contracts
    });
    assert.notStrictEqual(withValid, withBad);
    assert.strictEqual(withBad, without);
  });

  it('rejects non-hex and wrong-length tip hashes without a dynamic RegExp', function () {
    assert.throws(() => fh.tipHashBytesFromBlockHash('zz'.repeat(32)), /expected 64 hex chars/);
    assert.throws(() => fh.tipHashBytesFromBlockHash('ab'.repeat(31)), /expected 64 hex chars/);
    assert.throws(() => fh.tipHashBytesFromBlockHash(''), /expected 64 hex chars/);
  });

  it('exports a copy of HALLMARK_MAGIC (mutation-safe)', function () {
    const a = fh.HALLMARK_MAGIC;
    a[0] = 0xff;
    assert.strictEqual(fh.HALLMARK_MAGIC.toString('hex'), fh.HALLMARK_MAGIC_HEX);
  });
});
