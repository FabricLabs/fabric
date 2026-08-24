'use strict';

const assert = require('assert');
const Hash256 = require('../types/hash256');
const Message = require('../types/message');
const Key = require('../types/key');
const {
  ZERO_PARENT,
  isZeroParent,
  normalizeParentHex,
  parentHexOf,
  frameIdOf,
  setMessageParent
} = require('../functions/fabricMessageParent');

describe('@fabric/core/functions/fabricMessageParent', function () {
  it('treats null / empty / missing as genesis zeros', function () {
    assert.strictEqual(ZERO_PARENT, '00'.repeat(32));
    assert.strictEqual(ZERO_PARENT.length, 64);
    assert.ok(isZeroParent(null));
    assert.ok(isZeroParent(undefined));
    assert.ok(isZeroParent(''));
    assert.ok(isZeroParent(ZERO_PARENT));
    assert.ok(isZeroParent(Buffer.alloc(32)));
    assert.ok(isZeroParent({ id: ZERO_PARENT }));
    assert.strictEqual(normalizeParentHex(null), ZERO_PARENT);
    assert.strictEqual(parentHexOf(null), ZERO_PARENT);
    assert.strictEqual(parentHexOf({}), ZERO_PARENT);
  });

  it('normalizes hex, 0x prefix, Buffer, and signed Message.id', function () {
    const id = 'ab'.repeat(32);
    assert.strictEqual(normalizeParentHex(id.toUpperCase()), id);
    assert.strictEqual(normalizeParentHex('0x' + id), id);
    assert.strictEqual(normalizeParentHex(Buffer.from(id, 'hex')), id);
    assert.strictEqual(normalizeParentHex({ id }), id);
    const signed = Message.fromVector(['P2P_CHAT_MESSAGE', 'parent-id']).signWithKey(new Key());
    assert.strictEqual(normalizeParentHex(signed), signed.id);
    assert.strictEqual(parentHexOf({ parent: id }), id);
  });

  it('rejects malformed parent pointers', function () {
    assert.throws(() => normalizeParentHex('zz'), /32-byte hex/);
    assert.throws(() => normalizeParentHex('aa'), /32-byte hex/);
    assert.throws(() => normalizeParentHex(Buffer.alloc(31)), /32 bytes/);
    assert.strictEqual(isZeroParent('not-hex'), false);
  });

  it('writes parent onto message.raw.parent', function () {
    const genesis = Message.fromVector(['P2P_CHAT_MESSAGE', 'first']).signWithKey(new Key());
    const child = Message.fromVector(['P2P_CHAT_MESSAGE', 'second']);
    setMessageParent(child, genesis);
    assert.strictEqual(child.parent, genesis.id);
    assert.ok(!isZeroParent(child.parent));
    setMessageParent(child, null);
    assert.ok(isZeroParent(child.parent));
    assert.throws(() => setMessageParent(null, genesis), /Message required/);
  });

  it('frameIdOf matches SHA-256 of the AMP frame', function () {
    const msg = Message.fromVector(['P2P_CHAT_MESSAGE', 'frame']).signWithKey(new Key());
    const buf = msg.toBuffer();
    assert.strictEqual(frameIdOf(buf), Hash256.digest(buf));
    assert.strictEqual(frameIdOf(msg), msg.id);
    assert.strictEqual(frameIdOf(null), null);
  });
});
