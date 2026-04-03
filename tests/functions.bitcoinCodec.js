'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base58 = require('../functions/base58');
const { encodeCheck, decodeCheck } = base58;
const {
  encode: bech32Encode,
  decode: bech32Decode,
  toWords,
  fromWords,
  encodeSegwitAddress,
  decodeSegwitAddress
} = require('../functions/bech32');

const { spawnSync } = require('child_process');

function bech32SubprocessOpts () {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('FABRIC_')) delete env[k];
  }
  return { encoding: 'utf8', timeout: 30000, env };
}

describe('functions/base58', function () {
  it('encodes empty as empty string', function () {
    assert.strictEqual(base58.encode(Buffer.alloc(0)), '');
  });

  it('decodes empty string as empty buffer', function () {
    assert.deepStrictEqual(base58.decode(''), Buffer.alloc(0));
  });

  it('round-trips arbitrary bytes', function () {
    const samples = [
      Buffer.from([0x00]),
      Buffer.from([0x00, 0x00, 0x01, 0xff]),
      Buffer.from('deadbeef', 'hex'),
      Buffer.alloc(32, 7)
    ];
    for (const b of samples) {
      const s = base58.encode(b);
      assert.deepStrictEqual(base58.decode(s), b, s);
    }
  });

  it('rejects invalid characters', function () {
    assert.throws(() => base58.decode('0OIl'), /Invalid base58/);
  });
});

describe('functions/base58 (Base58Check)', function () {
  const KNOWN_WIF = '5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF';

  it('decodes a known mainnet WIF payload (uncompressed)', function () {
    const payload = decodeCheck(KNOWN_WIF);
    assert.strictEqual(payload[0], 0x80);
    assert.strictEqual(payload.length, 33); // version + 32-byte key (no 0x01 suffix)
  });

  it('encode/decode round-trip matches WIF', function () {
    const payload = decodeCheck(KNOWN_WIF);
    assert.strictEqual(encodeCheck(payload), KNOWN_WIF);
  });

  it('rejects bad checksum', function () {
    const bad = KNOWN_WIF.slice(0, -1) + (KNOWN_WIF.slice(-1) === 'a' ? 'b' : 'a');
    assert.throws(() => decodeCheck(bad), /checksum/);
  });

  it('rejects truncated input', function () {
    assert.throws(() => decodeCheck('1'), /too short/);
  });
});

describe('functions/bech32', function () {
  it('round-trips payload via bech32m (identity-style)', function () {
    const payload = Buffer.from('deadbeef', 'hex');
    const words = toWords(payload);
    const s = bech32Encode('id', words, 'bech32m');
    const d = bech32Decode(s);
    assert.strictEqual(d.hrp, 'id');
    assert.strictEqual(d.spec, 'bech32m');
    assert.deepStrictEqual(fromWords(d.words), payload);
  });

  it('decodes a known segwit test vector (bech32)', function () {
    const addr = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'.toLowerCase();
    const d = bech32Decode(addr);
    assert.strictEqual(d.hrp, 'bc');
    assert.strictEqual(d.spec, 'bech32');
    assert.strictEqual(d.words[0], 0); // witness v0
  });

  it('segwit address encode/decode (sipa reference on Node, pure otherwise)', function () {
    const program = Buffer.alloc(20, 0xab);
    const addr = encodeSegwitAddress('bc', 0, program);
    assert.ok(addr);
    const back = decodeSegwitAddress('bc', addr);
    assert.ok(back);
    assert.strictEqual(back.version, 0);
    assert.deepStrictEqual(back.program, program);
  });

  it('native C matches JS when FABRIC_NATIVE_BECH32=1 and fabric.node exists', function () {
    const addonPath = path.join(__dirname, '..', 'build', 'Release', 'fabric.node');
    if (!fs.existsSync(addonPath)) {
      this.skip();
    }
    const bech32Path = path.join(__dirname, '..', 'functions', 'bech32.js');
    const script = `
      process.env.FABRIC_NATIVE_BECH32 = '1';
      const b = require(${JSON.stringify(bech32Path)});
      const program = Buffer.alloc(20, 0xab);
      const a = b.encodeSegwitAddress('bc', 0, program);
      if (!a) process.exit(2);
      const back = b.decodeSegwitAddress('bc', a);
      if (!back || !back.program.equals(program)) process.exit(3);
      const payload = Buffer.from('deadbeef', 'hex');
      const w = b.toWords(payload);
      const s = b.encode('id', w, 'bech32m');
      const d = b.decode(s);
      if (d.spec !== 'bech32m' || !b.fromWords(d.words).equals(payload)) process.exit(4);
      process.exit(0);
    `;
    const r = spawnSync(process.execPath, ['-e', script], bech32SubprocessOpts());
    assert.strictEqual(r.status, 0, r.stderr || r.stdout || 'native bech32 subprocess failed');
  });

  it('fromWords rejects invalid 5-to-8 padding (convertBits strict path)', function () {
    assert.throws(() => fromWords(Array(10).fill(31)), /invalid padding/);
  });

  it('decodeSegwitAddress pure path rejects witness/version mismatch', function () {
    const program = Buffer.alloc(20, 1);
    const addr = encodeSegwitAddress('tb', 0, program);
    assert.ok(addr);
    assert.strictEqual(decodeSegwitAddress('bc', addr), null);
  });

  it('FABRIC_PURE_BECH32=1 uses bundled pure codec (fresh process)', function () {
    const bech32Path = path.join(__dirname, '../functions/bech32.js');
    const r = spawnSync(process.execPath, [
      '-e',
      `process.env.FABRIC_PURE_BECH32='1';
      const b = require(${JSON.stringify(bech32Path)});
      const program = Buffer.alloc(20, 2);
      const a = b.encodeSegwitAddress('tb', 0, program);
      const d = b.decodeSegwitAddress('tb', a);
      if (!d || !d.program.equals(program)) process.exit(2);
      const payload = Buffer.from('cafe', 'hex');
      const w = b.toWords(payload);
      const s = b.encode('id', w, 'bech32m');
      if (b.decode(s).spec !== 'bech32m') process.exit(3);`
    ], bech32SubprocessOpts());
    assert.strictEqual(r.status, 0, r.stderr || r.stdout || '');
  });

  it('FABRIC_PURE_BECH32=1 decode throws on bad checksum (decodePure path)', function () {
    const bech32Path = path.join(__dirname, '../functions/bech32.js');
    const r = spawnSync(process.execPath, [
      '-e',
      `process.env.FABRIC_PURE_BECH32='1';
      const b = require(${JSON.stringify(bech32Path)});
      const bad = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5';
      try {
        b.decode(bad);
        process.exit(2);
      } catch (e) {
        if (!/Invalid bech32 checksum/.test(e.message)) process.exit(3);
      }`
    ], bech32SubprocessOpts());
    assert.strictEqual(r.status, 0, r.stderr || r.stdout || '');
  });

  it('FABRIC_PURE_BECH32=1 decodeSegwitAddress returns null on mixed-case addr (decodePure throw)', function () {
    const { spawnSync } = require('child_process');
    const bech32Path = path.join(__dirname, '../functions/bech32.js');
    const r = spawnSync(process.execPath, [
      '-e',
      `process.env.FABRIC_PURE_BECH32='1';
      const b = require(${JSON.stringify(bech32Path)});
      const mixed = 'Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      if (b.decodeSegwitAddress('bc', mixed) !== null) process.exit(2);`
    ], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout || '');
  });
});
