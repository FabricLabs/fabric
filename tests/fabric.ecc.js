'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ecc = require('../types/ecc');

const h = (hex) => Buffer.from(hex, 'hex');

describe('@fabric/core/types/ecc', function () {
  it('runs browser self-test path once when window exists', function () {
    const modulePath = require.resolve('../types/ecc');
    const originalWindow = global.window;
    const originalFlag = globalThis.__FABRIC_ECC_SELFTESTED__;
    const originalLog = console.log;
    const originalError = console.error;

    delete require.cache[modulePath];
    global.window = {};
    delete globalThis.__FABRIC_ECC_SELFTESTED__;

    try {
      console.log = function () {};
      console.error = function () {};
      const browserEcc = require('../types/ecc');
      assert.ok(browserEcc);
      assert.equal(globalThis.__FABRIC_ECC_SELFTESTED__, true);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      delete require.cache[modulePath];
      if (typeof originalWindow === 'undefined') delete global.window;
      else global.window = originalWindow;
      if (typeof originalFlag === 'undefined') delete globalThis.__FABRIC_ECC_SELFTESTED__;
      else globalThis.__FABRIC_ECC_SELFTESTED__ = originalFlag;
    }
  });

  it('accepts and rejects private keys by range', function () {
    assert.equal(ecc.isPrivate(h('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')), true);
    assert.equal(ecc.isPrivate(h('0000000000000000000000000000000000000000000000000000000000000000')), false);
    assert.equal(ecc.isPrivate(h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')), false);
    assert.equal(ecc.isPrivate(Buffer.alloc(31, 1)), false);
    assert.equal(ecc.isPrivate(null), false);
  });

  it('validates compressed points and rejects invalid ones', function () {
    assert.equal(ecc.isPoint(h('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')), true);
    assert.equal(ecc.isPoint(h('030000000000000000000000000000000000000000000000000000000000000005')), false);
    assert.equal(ecc.isPoint(null), false);
  });

  it('derives public points from scalar and returns null for invalid scalar', function () {
    const point = ecc.pointFromScalar(
      h('b1121e4088a66a28f5b6b0f5844943ecd9f610196d7bb83b25214b60452c09af'),
      true
    );
    assert.ok(point);
    assert.equal(
      point.toString('hex'),
      '02b07ba9dca9523b7ef4bd97703d43d20399eb698e194704791a25ce77a400df99'
    );
    assert.equal(ecc.pointFromScalar(Buffer.alloc(32), true), null);
    assert.equal(ecc.pointFromScalar(null, true), null);
  });

  it('adds tweak to point and handles invalid tweaks', function () {
    const point = ecc.pointAddScalar(
      h('0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
      h('0000000000000000000000000000000000000000000000000000000000000003'),
      true
    );
    assert.ok(point);
    assert.equal(
      point.toString('hex'),
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
    );
    assert.equal(ecc.pointAddScalar(point, Buffer.alloc(32), true), null);
    assert.equal(
      ecc.pointAddScalar(point, h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'), true),
      null
    );
  });

  it('compresses and decompresses points', function () {
    const compressed = h('02b07ba9dca9523b7ef4bd97703d43d20399eb698e194704791a25ce77a400df99');
    const uncompressed = ecc.pointCompress(compressed, false);
    assert.ok(uncompressed);
    assert.equal(uncompressed.length, 65);
    assert.equal(uncompressed[0], 0x04);

    const recompressed = ecc.pointCompress(uncompressed, true);
    assert.ok(recompressed);
    assert.equal(recompressed.toString('hex'), compressed.toString('hex'));
    assert.equal(ecc.pointCompress(Buffer.from([0x01, 0x02]), true), null);
  });

  it('validates x-only points and applies x-only tweaks', function () {
    assert.equal(
      ecc.isXOnlyPoint(h('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')),
      true
    );
    assert.equal(ecc.isXOnlyPoint(Buffer.alloc(31, 1)), false);

    const tweaked = ecc.xOnlyPointAddTweak(
      h('1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b'),
      h('a8397a935f0dfceba6ba9618f6451ef4d80637abf4e6af2669fbc9de6a8fd2ac')
    );
    assert.ok(tweaked);
    assert.equal(tweaked.xOnlyPubkey.toString('hex'), 'e478f99dab91052ab39a33ea35fd5e6e4933f4d28023cd597c9a1f6760346adf');
    assert.equal(tweaked.parity, 1);

    assert.equal(
      ecc.xOnlyPointAddTweak(
        h('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
        h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140')
      ),
      null
    );
    assert.equal(ecc.xOnlyPointAddTweak(Buffer.alloc(31, 1), Buffer.alloc(32, 1)), null);
  });

  it('supports private key arithmetic with edge-case handling', function () {
    const added = ecc.privateAdd(
      h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd036413e'),
      h('0000000000000000000000000000000000000000000000000000000000000002')
    );
    assert.ok(added);
    assert.equal(added.toString('hex'), 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140');
    assert.equal(
      ecc.privateAdd(
        h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140'),
        h('0000000000000000000000000000000000000000000000000000000000000001')
      ),
      null
    );
    assert.equal(ecc.privateAdd(Buffer.alloc(31, 1), Buffer.alloc(32, 1)), null);

    const negated = ecc.privateNegate(h('0000000000000000000000000000000000000000000000000000000000000001'));
    assert.ok(negated);
    assert.equal(negated.toString('hex'), 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140');
    assert.equal(ecc.privateNegate(Buffer.alloc(32)), null);
    assert.equal(ecc.privateNegate(Buffer.alloc(31, 1)), null);
  });

  it('signs and verifies ECDSA with strict message length checks', function () {
    const priv = h('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140');
    const pub = ecc.pointFromScalar(priv, true);
    const msg = h('5e9f0a0d593efdcf78ac923bc3313e4e7d408d574354ee2b3288c0da9fbba6ed');

    const sig = ecc.sign(msg, priv);
    assert.equal(sig.length, 64);
    assert.equal(ecc.verify(msg, pub, sig), true);
    assert.equal(ecc.verify(Buffer.alloc(31, 1), pub, sig), false);
    assert.equal(ecc.verify(msg, Buffer.from([1, 2]), sig), false);

    assert.throws(() => ecc.sign(Buffer.alloc(31, 1), priv), /32-byte message hash/);
    assert.throws(() => ecc.sign(msg, Buffer.alloc(31, 1)), /32-byte message hash/);
  });

  it('signs and verifies Schnorr and rejects invalid lengths', function () {
    const msg = crypto.createHash('sha256').update('fabric').digest();
    const priv = h('c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9');
    const pub = ecc.pointFromScalar(priv, true).slice(1);

    const sig = ecc.signSchnorr(msg, priv, Buffer.alloc(32, 7));
    assert.equal(sig.length, 64);
    assert.equal(ecc.verifySchnorr(msg, pub, sig), true);
    assert.equal(ecc.verifySchnorr(Buffer.alloc(31, 1), pub, sig), false);
    assert.equal(ecc.verifySchnorr(msg, Buffer.alloc(31, 1), sig), false);
    assert.equal(ecc.verifySchnorr(msg, pub, Buffer.alloc(63, 1)), false);
    assert.throws(() => ecc.signSchnorr(Buffer.alloc(31, 1), priv), /32-byte message hash/);
  });
});
