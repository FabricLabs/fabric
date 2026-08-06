'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Message = require('../types/message');
const {
  P2P_FORWARD,
  P2P_FORWARD_MAX_HOPS,
  SCHEMA_P2P_FORWARD,
  toXOnlyPeerId,
  xOnlyFromKey,
  xOnlyEquals,
  wrapForwardLayer,
  wrapOnionPath,
  tryDecodeForward
} = require('../functions/fabricOnion');

describe('@fabric/core/functions/fabricOnion', function () {
  it('registers P2P_FORWARD body schema on Message', function () {
    assert.ok(Message.getBodySchema('P2P_FORWARD'));
    assert.deepStrictEqual(
      Message.getBodySchema(P2P_FORWARD).map((f) => f.name),
      ['nextPeer', 'ttl', 'inner']
    );
    assert.deepStrictEqual(SCHEMA_P2P_FORWARD.map((f) => f.name), ['nextPeer', 'ttl', 'inner']);
  });

  it('normalizes compressed and x-only pubkeys', function () {
    const k = new Key();
    const compressed = Buffer.from(k.public.encodeCompressed('hex'), 'hex');
    const xOnly = toXOnlyPeerId(compressed);
    assert.strictEqual(xOnly.length, 32);
    assert.ok(xOnlyEquals(xOnly, toXOnlyPeerId(xOnly.toString('hex'))));
    assert.ok(xOnlyEquals(xOnly, xOnlyFromKey(k)));
  });

  it('wrapForwardLayer nests a signed inner Message', function () {
    const origin = new Key();
    const hop = new Key();
    const inner = Message.fromVector(['P2P_CHAT_MESSAGE', 'hello-onion']);
    inner.signWithKey(origin);

    const layer = wrapForwardLayer({
      nextPeer: xOnlyFromKey(hop),
      inner,
      ttl: 2,
      key: origin
    });
    assert.strictEqual(layer.type, 'P2P_FORWARD');
    assert.ok(layer.verifyWithKey(origin));

    const fields = tryDecodeForward(layer);
    assert.ok(fields);
    assert.strictEqual(fields.ttl, 2);
    assert.ok(xOnlyEquals(fields.nextPeer, xOnlyFromKey(hop)));
    const peeled = Message.fromBuffer(fields.inner);
    assert.strictEqual(peeled.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(peeled.data.toString('utf8'), 'hello-onion');
  });

  it('wrapOnionPath builds destination-last nesting', function () {
    const origin = new Key();
    const r1 = new Key();
    const r2 = new Key();
    const dest = new Key();
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'via-path']);
    payload.signWithKey(origin);

    const outer = wrapOnionPath({
      path: [xOnlyFromKey(r1), xOnlyFromKey(r2), xOnlyFromKey(dest)],
      payload,
      key: origin
    });
    assert.strictEqual(outer.type, 'P2P_FORWARD');

    const l1 = tryDecodeForward(outer);
    assert.ok(xOnlyEquals(l1.nextPeer, xOnlyFromKey(r1)));
    assert.strictEqual(l1.ttl, 3);

    const l2 = tryDecodeForward(Message.fromBuffer(l1.inner));
    assert.ok(xOnlyEquals(l2.nextPeer, xOnlyFromKey(r2)));
    assert.strictEqual(l2.ttl, 2);

    const l3 = tryDecodeForward(Message.fromBuffer(l2.inner));
    assert.ok(xOnlyEquals(l3.nextPeer, xOnlyFromKey(dest)));
    assert.strictEqual(l3.ttl, 1);

    const chat = Message.fromBuffer(l3.inner);
    assert.strictEqual(chat.data.toString('utf8'), 'via-path');
  });

  it('rejects oversized paths', function () {
    const origin = new Key();
    const path = [];
    for (let i = 0; i < P2P_FORWARD_MAX_HOPS + 1; i++) {
      path.push(xOnlyFromKey(new Key()));
    }
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'x']);
    payload.signWithKey(origin);
    assert.throws(() => wrapOnionPath({ path, payload, key: origin }), /exceeds max/);
  });

  it('toXOnlyPeerId / xOnlyFromKey edge cases', function () {
    assert.strictEqual(toXOnlyPeerId(null).length, 32);
    assert.ok(toXOnlyPeerId(null).equals(Buffer.alloc(32)));
    const k = new Key();
    const hex0x = '0x' + xOnlyFromKey(k).toString('hex');
    assert.ok(xOnlyEquals(toXOnlyPeerId(hex0x), xOnlyFromKey(k)));
    assert.ok(xOnlyEquals(xOnlyFromKey({ key: k }), xOnlyFromKey(k)));
    assert.ok(xOnlyEquals(xOnlyFromKey({ pubkey: k.pubkey }), xOnlyFromKey(k)));
    assert.throws(() => toXOnlyPeerId('zz'), /expected 32/);
    assert.throws(() => toXOnlyPeerId(Buffer.alloc(10)), /unsupported pubkey length/);
    assert.throws(() => xOnlyFromKey(null), /key required/);
    assert.throws(() => xOnlyFromKey({}), /no public key/);
    assert.strictEqual(xOnlyEquals(Buffer.alloc(32), Buffer.alloc(31)), false);
  });

  it('wrapForwardLayer validates ttl / key / empty inner', function () {
    const origin = new Key();
    const hop = new Key();
    const inner = Message.fromVector(['P2P_CHAT_MESSAGE', 'x']).signWithKey(origin);
    assert.throws(() => wrapForwardLayer({
      nextPeer: xOnlyFromKey(hop), inner, ttl: 0, key: origin
    }), /ttl must be/);
    assert.throws(() => wrapForwardLayer({
      nextPeer: xOnlyFromKey(hop), inner, ttl: 1
    }), /key required/);
    assert.throws(() => wrapForwardLayer({
      nextPeer: xOnlyFromKey(hop), inner: Buffer.alloc(0), ttl: 1, key: origin
    }), /empty inner/);
  });

  it('tryDecodeForward returns null for non-forward / malformed', function () {
    assert.strictEqual(tryDecodeForward(null), null);
    const chat = Message.fromVector(['P2P_CHAT_MESSAGE', 'nope']).signWithKey(new Key());
    assert.strictEqual(tryDecodeForward(chat), null);
    const bogus = Message.fromVector(['P2P_FORWARD', 'not-fields']).signWithKey(new Key());
    assert.strictEqual(tryDecodeForward(bogus), null);
  });

  it('wrapOnionPath rejects empty path and missing key', function () {
    const origin = new Key();
    const payload = Message.fromVector(['P2P_CHAT_MESSAGE', 'x']).signWithKey(origin);
    assert.throws(() => wrapOnionPath({ path: [], payload, key: origin }), /at least one hop/);
    assert.throws(() => wrapOnionPath({
      path: [xOnlyFromKey(origin)],
      payload
    }), /key required/);
  });
});
