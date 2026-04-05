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

  it('fromSeed rejects non-byte inputs (no string coercion)', function () {
    assert.throws(() => fromSeed('000102030405060708090a0b0c0d0e0f'), /Buffer or Uint8Array/);
  });

  it('fromBase58 rejects depth-0 keys with non-zero parent fingerprint or child index', function () {
    const root = fromSeed(SEED_A);
    const raw = decodeCheck(root.toBase58());
    raw.writeUInt32BE(0x01020304, 5);
    assert.throws(() => fromBase58(encodeCheck(raw)), /parent fingerprint must be zero/);
    const raw2 = decodeCheck(root.toBase58());
    raw2.writeUInt32BE(1, 9);
    assert.throws(() => fromBase58(encodeCheck(raw2)), /child number must be zero/);
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

  it('derive rejects non-integer child index', function () {
    const root = fromSeed(SEED_A);
    assert.throws(() => root.derive(1.5), /Invalid index/);
  });

  it('derive rejects non-decimal string indices', function () {
    const root = fromSeed(SEED_A);
    assert.throws(() => root.derive('0x10'), /Invalid index/);
    assert.throws(() => root.derive('1e2'), /Invalid index/);
    const child = root.derive('10');
    assert.ok(Buffer.isBuffer(child.privateKey));
  });

  it('derive accepts bigint index like number', function () {
    const root = fromSeed(SEED_A);
    const a = root.derive(2);
    const b = root.derive(2n);
    assert.ok(a.privateKey.equals(b.privateKey));
  });

  it('derivePath requires master node for absolute paths', function () {
    const root = fromSeed(SEED_A);
    const child = root.derive(0);
    assert.throws(() => child.derivePath('m/0'), /master/);
  });

  it('derivePath rejects loose path segment parsing', function () {
    const root = fromSeed(SEED_A);
    assert.throws(() => root.derivePath('m/0x1'), /Invalid path segment/);
    assert.throws(() => root.derivePath('m/01oops'), /Invalid path segment/);
  });

  it('fromBase58 rejects xpub with invalid secp256k1 point', function () {
    const xpub = fromSeed(SEED_C).neutered();
    const raw = decodeCheck(xpub.toBase58());
    const bogus = Buffer.alloc(33, 0);
    bogus.writeUInt8(0x02, 0);
    bogus.copy(raw, 45);
    const bad = encodeCheck(raw);
    assert.throws(() => fromBase58(bad), /Invalid public key/);
  });
});
