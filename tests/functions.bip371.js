'use strict';

const assert = require('assert');
const { LEAF_VERSION_TAPSCRIPT, tapLeafScriptEntry, taprootPsbtInputFields } = require('../functions/bip371');
const inventoryHtlc = require('../functions/inventoryHtlc');

describe('@fabric/core/functions/bip371', function () {
  const internal = Buffer.from(
    '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
    'hex'
  );
  const script = Buffer.from('51', 'hex');
  const controlBlock = Buffer.concat([Buffer.from([0xc0]), internal]);

  it('builds PSBT_IN_TAP_INTERNAL_KEY and PSBT_IN_TAP_LEAF_SCRIPT bags', function () {
    const fields = taprootPsbtInputFields({
      tapInternalKey: internal,
      script,
      controlBlock,
      leafVersion: LEAF_VERSION_TAPSCRIPT
    });
    assert.strictEqual(fields.tapInternalKey.length, 32);
    assert.ok(fields.tapInternalKey.equals(internal));
    assert.strictEqual(fields.tapLeafScript.length, 1);
    assert.strictEqual(fields.tapLeafScript[0].leafVersion, 0xc0);
    assert.ok(fields.tapLeafScript[0].script.equals(script));
    assert.ok(fields.tapLeafScript[0].controlBlock.equals(controlBlock));
    assert.ok(!Object.prototype.hasOwnProperty.call(fields, 'tapMerkleRoot'));
  });

  it('includes optional tapMerkleRoot', function () {
    const root = Buffer.alloc(32, 7);
    const fields = taprootPsbtInputFields({
      tapInternalKey: internal.toString('hex'),
      script,
      controlBlock,
      tapMerkleRoot: root
    });
    assert.ok(fields.tapMerkleRoot.equals(root));
  });

  it('rejects a short control block and a non-x-only internal key', function () {
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock: Buffer.alloc(32) }),
      /controlBlock/
    );
    assert.throws(
      () => taprootPsbtInputFields({
        tapInternalKey: Buffer.alloc(33, 2),
        script,
        controlBlock
      }),
      /tapInternalKey/
    );
  });

  it('rejects a 34-byte control block, odd leaf version, and version mismatch', function () {
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock: Buffer.concat([controlBlock, Buffer.from([0])]) }),
      /controlBlock/
    );
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock, leafVersion: 0xc1 }),
      /even/
    );
    const mismatched = Buffer.concat([Buffer.from([0xc2]), internal]);
    assert.throws(
      () => tapLeafScriptEntry({ script, controlBlock: mismatched, leafVersion: 0xc0 }),
      /match/
    );
  });

  it('rejects hex with a junk suffix (no silent truncation)', function () {
    const junk = internal.toString('hex') + 'zz';
    assert.throws(
      () => taprootPsbtInputFields({
        tapInternalKey: junk,
        script,
        controlBlock
      }),
      /tapInternalKey/
    );
  });

  it('is the bag shape used by inventory HTLC NUMS internal key', function () {
    assert.ok(inventoryHtlc.TAPROOT_INTERNAL_NUMS.equals(internal));
  });
});
