'use strict';

const assert = require('assert');
const Message = require('../types/message');
const Key = require('../types/key');
const { HEADER_SIZE } = require('../constants');

describe('@fabric/core/types/message statics', function () {
  it('fromLegacyBody round-trips through tryParseLegacyBody', function () {
    const body = { host: 'hub.fabric.pub', port: 7777, gossipHop: 3, pubkey: 'ab'.repeat(33) };
    const message = Message.fromLegacyBody('P2P_PEER_GOSSIP', body).signWithKey(new Key());
    const parsed = Message.tryParseLegacyBody(Message.fromBuffer(message.toBuffer()));
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.encoding, 'fields');
    assert.deepStrictEqual(parsed.value, body);
    assert.throws(() => Message.fromLegacyBody('GenericMessage', {}), /fromLegacyBody: no field mapping/);
  });

  it('padDigits left-pads with zeros and never truncates', function () {
    assert.strictEqual(Message.padDigits('1', 8), '00000001');
    assert.strictEqual(Message.padDigits(255, 3), '255');
    assert.strictEqual(Message.padDigits('123456789', 8), '123456789');
  });

  it('HEADER_OFFSETS tile the header and match parseRawMessage', function () {
    const ranges = Object.values(Message.HEADER_OFFSETS);
    assert.strictEqual(ranges[0][0], 0);
    for (let i = 1; i < ranges.length; i++) assert.strictEqual(ranges[i][0], ranges[i - 1][1]);
    assert.strictEqual(ranges[ranges.length - 1][1], HEADER_SIZE);

    const key = new Key();
    const message = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello']);
    message.parent = 'ab'.repeat(32);
    message.signWithKey(key);
    const buffer = message.toBuffer();
    const raw = Message.parseRawMessage(buffer);
    for (const [name, [start, end]] of Object.entries(Message.HEADER_OFFSETS)) {
      assert.ok(raw[name].equals(buffer.subarray(start, end)), name);
    }
    assert.ok(raw.data.equals(buffer.subarray(HEADER_SIZE)));
    assert.strictEqual(Message.fromBuffer(buffer).parent, 'ab'.repeat(32));
  });

  it('verifyFrameAuthor reports the signer of a frame', function () {
    const key = new Key();
    const message = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello']).signWithKey(key);
    const frame = message.toBuffer();
    const result = Message.verifyFrameAuthor(frame.toString('hex'));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.author, Buffer.from(key.pubkey, 'hex').subarray(1).toString('hex'));
    assert.strictEqual(result.parent, Message.ZERO_PARENT);

    const tampered = Buffer.from(frame);
    tampered[tampered.length - 1] ^= 1;
    assert.strictEqual(Message.verifyFrameAuthor(tampered).ok, false);
    assert.strictEqual(Message.verifyFrameAuthor('zz').ok, false);
  });
});
