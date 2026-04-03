'use strict';

const assert = require('assert');
const segwitAddr = require('../functions/sipa/segwit_addr');
const bech32 = require('../functions/sipa/bech32');

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

  it('decode rejects witness version > 16', function () {
    const addr = bech32.encode('bc', [17, 0, 0, 0], bech32.encodings.BECH32M);
    assert.strictEqual(segwitAddr.decode('bc', addr), null);
  });

  it('decode rejects bech32m for witness v0 and bech32 for witness v1+', function () {
    const v0bech32m = bech32.encode('tb', [0, 0, 0, 0, 0, 0], bech32.encodings.BECH32M);
    assert.strictEqual(segwitAddr.decode('tb', v0bech32m), null);

    const v1bech32 = bech32.encode('tb', [1, 0, 0, 0, 0, 0], bech32.encodings.BECH32);
    assert.strictEqual(segwitAddr.decode('tb', v1bech32), null);
  });

  it('decode rejects witness programs longer than 40 bytes', function () {
    const tooLongProgramWords = [1].concat(new Array(70).fill(0));
    const addr = bech32.encode('bc', tooLongProgramWords, bech32.encodings.BECH32M);
    assert.strictEqual(segwitAddr.decode('bc', addr), null);
  });
});
