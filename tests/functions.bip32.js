'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { fromSeed, fromBase58, DEFAULT_NETWORK } = require('../functions/bip32');
const { encodeCheck, decodeCheck } = require('../functions/base58');

describe('@fabric/core/functions/bip32', function () {
  it('fromSeed rejects seed length outside 16–64 bytes', function () {
    assert.throws(() => fromSeed(Buffer.alloc(15)), /16–64/);
    assert.throws(() => fromSeed(Buffer.alloc(65)), /16–64/);
  });

  it('fromBase58 round-trips a derived node', function () {
    const seed = crypto.randomBytes(32);
    const root = fromSeed(seed);
    const child = root.derive(0);
    const again = fromBase58(child.toBase58());
    assert.strictEqual(again.toBase58(), child.toBase58());
  });

  it('fromBase58 throws on invalid extended key length', function () {
    assert.throws(() => fromBase58('KwDiBf89QgGbjEhKnhXJuHnp'), /Invalid extended key length|Invalid base58/);
  });

  it('fromBase58 throws on unknown extended key version', function () {
    const root = fromSeed(crypto.randomBytes(32));
    const raw = decodeCheck(root.toBase58());
    assert.strictEqual(raw.length, 78);
    raw.writeUInt32BE(0xdeadbeef, 0);
    const tampered = encodeCheck(raw);
    assert.throws(() => fromBase58(tampered), /Unknown extended key version/);
  });

  it('fromBase58 rejects invalid private key prefix in xprv', function () {
    const root = fromSeed(crypto.randomBytes(32));
    const raw = decodeCheck(root.toBase58());
    raw.writeUInt8(0x01, 45);
    const badPriv = encodeCheck(raw);
    assert.throws(() => fromBase58(badPriv), /Invalid private key prefix/);
  });

  it('BIP32Factory forwards to fromSeed / fromBase58', function () {
    const ecc = require('../types/ecc');
    const BIP32 = require('../functions/bip32').default;
    const f = new BIP32(ecc);
    const seed = crypto.randomBytes(32);
    const a = f.fromSeed(seed);
    const b = fromSeed(seed);
    assert.strictEqual(a.toBase58(), b.toBase58());
    assert.strictEqual(f.fromBase58(a.toBase58()).toBase58(), a.toBase58());
  });

  it('HDNode.neutered drops private material', function () {
    assert.strictEqual(DEFAULT_NETWORK.bip32.public, 0x0488b21e);
    const root = fromSeed(crypto.randomBytes(32));
    const n = root.neutered();
    assert.strictEqual(n.isNeutered, true);
    assert.strictEqual(n.privateKey, null);
  });
});
