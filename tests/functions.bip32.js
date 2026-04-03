'use strict';

const assert = require('assert');
const { fromSeed, fromBase58, DEFAULT_NETWORK } = require('../functions/bip32');
const { encodeCheck, decodeCheck } = require('../functions/base58');

const SEED_A = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const SEED_B = Buffer.from('ff0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const SEED_C = Buffer.from('aa0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const SEED_D = Buffer.from('bb0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const SEED_E = Buffer.from('cc0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const SEED_F = Buffer.from('dd0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

describe('@fabric/core/functions/bip32', function () {
  it('fromSeed rejects seed length outside 16–64 bytes', function () {
    assert.throws(() => fromSeed(Buffer.alloc(15)), /16–64/);
    assert.throws(() => fromSeed(Buffer.alloc(65)), /16–64/);
  });

  it('fromBase58 round-trips a derived node', function () {
    const root = fromSeed(SEED_A);
    const child = root.derive(0);
    const again = fromBase58(child.toBase58());
    assert.strictEqual(again.toBase58(), child.toBase58());
  });

  it('fromBase58 throws on invalid extended key length', function () {
    assert.throws(() => fromBase58('KwDiBf89QgGbjEhKnhXJuHnp'), /Invalid extended key length|Invalid base58/);
  });

  it('fromBase58 throws on unknown extended key version', function () {
    const root = fromSeed(SEED_B);
    const raw = decodeCheck(root.toBase58());
    assert.strictEqual(raw.length, 78);
    raw.writeUInt32BE(0xdeadbeef, 0);
    const tampered = encodeCheck(raw);
    assert.throws(() => fromBase58(tampered), /Unknown extended key version/);
  });

  it('fromBase58 rejects invalid private key prefix in xprv', function () {
    const root = fromSeed(SEED_C);
    const raw = decodeCheck(root.toBase58());
    raw.writeUInt8(0x01, 45);
    const badPriv = encodeCheck(raw);
    assert.throws(() => fromBase58(badPriv), /Invalid private key prefix/);
  });

  it('fromBase58 rejects invalid compressed public key prefix in xpub', function () {
    const xpub = fromSeed(SEED_C).neutered();
    const raw = decodeCheck(xpub.toBase58());
    raw.writeUInt8(0x04, 45);
    const badPub = encodeCheck(raw);
    assert.throws(() => fromBase58(badPub), /Invalid public key prefix/);
  });

  it('BIP32Factory forwards to fromSeed / fromBase58', function () {
    const ecc = require('../types/ecc');
    const BIP32 = require('../functions/bip32').default;
    const f = new BIP32(ecc);
    const a = f.fromSeed(SEED_D);
    const b = fromSeed(SEED_D);
    assert.strictEqual(a.toBase58(), b.toBase58());
    assert.strictEqual(f.fromBase58(a.toBase58()).toBase58(), a.toBase58());
  });

  it('HDNode.neutered drops private material', function () {
    assert.strictEqual(DEFAULT_NETWORK.bip32.public, 0x0488b21e);
    const root = fromSeed(SEED_E);
    const n = root.neutered();
    assert.strictEqual(n.isNeutered, true);
    assert.strictEqual(n.privateKey, null);
  });

  it('neutered node derives non-hardened public children (xpub path)', function () {
    const root = fromSeed(SEED_F);
    const xpub = root.neutered();
    const c0 = xpub.derive(0);
    const c1 = xpub.derive(1);
    assert.ok(c0.publicKey);
    assert.strictEqual(c0.privateKey, null);
    assert.ok(!c0.publicKey.equals(c1.publicKey));
    assert.throws(() => xpub.derive(0x80000000), /hardened child from public parent/);
  });
});
