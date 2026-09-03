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

  describe('Message#parent', function () {
    it('reads as genesis zeros when no parent is set', function () {
      const fresh = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello']);
      assert.strictEqual(fresh.parent, Message.ZERO_PARENT);
      assert.ok(isZeroParent(fresh.parent));
    });

    it('reads as genesis zeros when raw.parent is malformed', function () {
      // A short or non-Buffer field must not leak out as a truncated pointer.
      const message = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello']);
      message.raw.parent = Buffer.alloc(31);
      assert.strictEqual(message.parent, Message.ZERO_PARENT);
      message.raw.parent = 'not-a-buffer';
      assert.strictEqual(message.parent, Message.ZERO_PARENT);
      delete message.raw.parent;
      assert.strictEqual(message.parent, Message.ZERO_PARENT);
    });

    it('accepts a parent from the constructor and from fromVector', function () {
      const genesis = Message.fromVector(['P2P_CHAT_MESSAGE', 'first']).signWithKey(new Key());
      assert.strictEqual(Message.fromVector(['P2P_CHAT_MESSAGE', 'second', genesis.id]).parent, genesis.id);
      assert.strictEqual(Message.fromVector(['P2P_CHAT_MESSAGE', 'second', null]).parent, Message.ZERO_PARENT);
      assert.strictEqual(Message.fromVector(['P2P_CHAT_MESSAGE', 'second']).parent, Message.ZERO_PARENT);
      const built = new Message({ type: 'P2P_CHAT_MESSAGE', data: 'second', parent: genesis.id });
      assert.strictEqual(built.parent, genesis.id);
    });

    it('re-exports the parent helpers as statics', function () {
      assert.strictEqual(Message.ZERO_PARENT, ZERO_PARENT);
      assert.strictEqual(Message.isZeroParent, isZeroParent);
      assert.strictEqual(Message.normalizeParent, normalizeParentHex);
      assert.strictEqual(Message.parentHexOf, parentHexOf);
      assert.strictEqual(Message.frameIdOf, frameIdOf);
      assert.strictEqual(Message.setMessageParent, setMessageParent);
    });
  });
});
