'use strict';

const assert = require('assert');
const segwitAddr = require('../functions/sipa/segwit_addr');

describe('@fabric/core/functions/sipa/segwit_addr', function () {
  it('round-trips P2WPKH (v0, 20 bytes)', function () {
    const program = Buffer.alloc(20, 7);
    const addr = segwitAddr.encode('bc', 0, program);
    assert.ok(typeof addr === 'string' && addr.startsWith('bc1'));
    const dec = segwitAddr.decode('bc', addr);
    assert.deepStrictEqual(Buffer.from(dec.program), program);
    assert.strictEqual(dec.version, 0);
  });

  it('round-trips v1 (taproot-style) with bech32m', function () {
    const program = Buffer.alloc(32, 9);
    const addr = segwitAddr.encode('bc', 1, program);
    assert.ok(addr.startsWith('bc1p'));
    const dec = segwitAddr.decode('bc', addr);
    assert.strictEqual(dec.version, 1);
    assert.deepStrictEqual(Buffer.from(dec.program), program);
  });

  it('decode returns null for wrong HRP or malformed address', function () {
    const program = Buffer.alloc(20, 1);
    const addr = segwitAddr.encode('bc', 0, program);
    assert.strictEqual(segwitAddr.decode('tb', addr), null);
    assert.strictEqual(segwitAddr.decode('bc', 'bc1invalid'), null);
    assert.strictEqual(segwitAddr.decode('bc', ''), null);
  });

  it('encode returns null when decode self-check fails (invalid v0 program length)', function () {
    assert.strictEqual(segwitAddr.encode('bc', 0, Buffer.alloc(18, 3)), null);
  });
});
