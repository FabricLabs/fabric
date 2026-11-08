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
const bitcoin = require('bitcoinjs-lib');
const { TEST_NETWORKS, normalizeNetworkName, isTestNetwork, assertTestNetwork } = require('../functions/bitcoinNetworkAllowlist');
const { networkForFabricName } = require('../types/policy');
const Channel = require('../types/channel');
const ChannelBook = require('../types/channelBook');
const crypto = require('crypto');
const { merkleRootFromTxids, buildBranch, verifyInclusion, buildInclusion, parseHeader, targetFromBits, headerMeetsTarget } = require('../functions/bitcoinTxInclusion');
const Message = require('../types/message');

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

  it('segwit address encode/decode (sipa reference)', function () {
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

  it('decodeSegwitAddress rejects an address for another network', function () {
    const program = Buffer.alloc(20, 1);
    const addr = encodeSegwitAddress('tb', 0, program);
    assert.ok(addr);
    assert.strictEqual(decodeSegwitAddress('bc', addr), null);
  });

  it('decode throws on a bad checksum', function () {
    assert.throws(() => bech32Decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'), /Invalid bech32 string/);
  });

  it('decodeSegwitAddress returns null on a mixed-case address', function () {
    assert.strictEqual(decodeSegwitAddress('bc', 'Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), null);
  });
});

describe('@fabric/core/functions/bitcoinNetworkAllowlist', function () {
  it('allows only regtest / signet / testnet / testnet4 (trimmed, case-insensitive)', function () {
    assert.deepStrictEqual([...TEST_NETWORKS], ['regtest', 'signet', 'testnet', 'testnet4']);
    for (const name of ['regtest', ' Regtest ', 'SIGNET', 'testnet', '\ttestnet4\n']) assert.strictEqual(isTestNetwork(name), true, name);
    for (const name of ['mainnet', 'main', 'bitcoin', 'livenet', 'Mainnet ', '', null, undefined, 'regtestx', 'test net']) {
      assert.strictEqual(isTestNetwork(name), false, String(name));
    }
    assert.strictEqual(normalizeNetworkName('  TestNet4 '), 'testnet4');
    assert.strictEqual(assertTestNetwork(' SigNet ', 'x'), 'signet');
    assert.throws(() => assertTestNetwork('bitcoin', 'Channel'), /Channel: network "bitcoin" refused .*mainnet refused/);
    assert.throws(() => assertTestNetwork('', 'Channel'), /refused/);
  });

  it('maps test networks to bitcoinjs parameters without falling back to mainnet', function () {
    assert.strictEqual(networkForFabricName(' REGTEST '), bitcoin.networks.regtest);
    assert.strictEqual(networkForFabricName('testnet4'), bitcoin.networks.testnet);
    assert.strictEqual(networkForFabricName('Signet'), bitcoin.networks.testnet);
  });

  it('guards channel construction', function () {
    const pub = '02' + '11'.repeat(32);
    const other = '03' + '22'.repeat(32);
    for (const network of ['mainnet', 'bitcoin', 'main', ' Mainnet ', 'nonsense']) {
      assert.throws(() => Channel.buildFunding({ network, localPubkey: pub, remotePubkey: other, expireAfter: 10 }), /refused/, network);
    }
    assert.throws(() => new ChannelBook({ localPrivateKey: Buffer.alloc(32, 1), network: 'bitcoin' }), /refused/);
    assert.strictEqual(new ChannelBook({ localPrivateKey: Buffer.alloc(32, 1), network: ' RegTest ' }).network, 'regtest');
  });
});

/** Header over `txids`, mined at regtest difficulty (`bits` 0x207fffff). */
function headerFor (txids, bits = 0x207fffff) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(2, 0);
  Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
  header.writeUInt32LE(bits, 72);
  while (!headerMeetsTarget(header.toString('hex'))) header.writeUInt32LE(header.readUInt32LE(76) + 1, 76);
  return header.toString('hex');
}

describe('functions/bitcoinTxInclusion', function () {
  it('matches the Bitcoin genesis block (single tx: root == txid)', () => {
    const genesisTx = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
    assert.strictEqual(merkleRootFromTxids([genesisTx]), genesisTx);
    const genesisHeader = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
    const parsed = parseHeader(genesisHeader);
    assert.strictEqual(parsed.blockHash, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
    assert.strictEqual(parsed.merkleRootHex, genesisTx);
    assert.strictEqual(verifyInclusion({ blockHeaderHex: genesisHeader, txid: genesisTx, index: 0, branch: [] }).ok, true);
  });

  it('builds and verifies branches for odd and even tx counts; rejects forgeries', () => {
    for (const n of [2, 3, 5, 8]) {
      const txids = Array.from({ length: n }, () => crypto.randomBytes(32).toString('hex'));
      const headerHex = headerFor(txids);
      for (let i = 0; i < n; i++) {
        const proof = buildInclusion({ blockHeaderHex: headerHex, txids, txid: txids[i] });
        assert.strictEqual(proof.index, i);
        assert.strictEqual(verifyInclusion(proof).ok, true, `n=${n} i=${i}`);
        const other = Object.assign({}, proof, { txid: crypto.randomBytes(32).toString('hex') });
        assert.strictEqual(verifyInclusion(other).ok, false);
        const wrongIndex = Object.assign({}, proof, { index: (i + 1) % n });
        if (n > 1) assert.strictEqual(verifyInclusion(wrongIndex).ok, false);
      }
      assert.throws(() => buildBranch(txids, crypto.randomBytes(32).toString('hex')), /not in block/);
    }
  });

  it('decodes compact bits and rejects headers without proof-of-work', () => {
    assert.strictEqual(targetFromBits(0x1d00ffff), 0xffffn << 208n);
    assert.strictEqual(targetFromBits(0x00000000), null);
    assert.strictEqual(targetFromBits(0x04800000), null, 'negative');
    // A blank header whose Merkle root is the txid itself — trivially forgeable.
    const txid = crypto.randomBytes(32).toString('hex');
    const blank = Buffer.alloc(80);
    Buffer.from(txid, 'hex').reverse().copy(blank, 36);
    const verdict = verifyInclusion({ blockHeaderHex: blank.toString('hex'), txid, index: 0, branch: [] });
    assert.strictEqual(verdict.ok, false);
    assert.match(verdict.reason, /proof-of-work/);
    // Mainnet-difficulty bits on an unmined header fail too.
    const hard = Buffer.from(headerFor([txid]), 'hex');
    hard.writeUInt32LE(0x1d00ffff, 72);
    assert.strictEqual(verifyInclusion({ blockHeaderHex: hard.toString('hex'), txid, index: 0, branch: [] }).ok, false);
  });

  it('pins branch depth with txCount and rejects duplicated nodes (CVE-2012-2459)', () => {
    const txids = Array.from({ length: 3 }, () => crypto.randomBytes(32).toString('hex'));
    const headerHex = headerFor(txids);
    const proof = buildInclusion({ blockHeaderHex: headerHex, txids, txid: txids[2] });
    assert.strictEqual(proof.txCount, 3);
    assert.strictEqual(verifyInclusion(proof).ok, true);
    assert.strictEqual(verifyInclusion(Object.assign({}, proof, { txCount: 9 })).ok, false, 'depth mismatch');
    assert.strictEqual(verifyInclusion(Object.assign({}, proof, { txCount: 2 })).ok, false, 'index beyond count');
    // Mutated tree [a, b, c, c]: same root, but the duplicate (index 3) pairs with an equal left sibling.
    const dup = buildBranch([...txids, txids[2]], txids[2]);
    const mutated = { blockHeaderHex: headerHex, txid: txids[2], index: 3, branch: dup.branch };
    const verdict = verifyInclusion(mutated);
    assert.strictEqual(verdict.ok, false);
    assert.match(verdict.reason, /CVE-2012-2459/);
  });
});

describe('Message.verifyFrameAuthor', function () {
  it('recovers the x-only author of a signed AMP frame and rejects tampering', () => {
    const Key = require('../types/key');
    const key = new Key();
    const frame = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({ name: 'd', body: 'AA==' })]).signWithKey(key).toBuffer();
    const ok = Message.verifyFrameAuthor(frame);
    assert.strictEqual(ok.ok, true, ok.reason);
    assert.strictEqual(ok.author, key.pubkey.slice(2));
    assert.strictEqual(ok.type, 0x59);
    assert.strictEqual(ok.body.toString('utf8'), JSON.stringify({ name: 'd', body: 'AA==' }));
    const tampered = Buffer.from(frame); tampered[tampered.length - 1] ^= 1;
    assert.strictEqual(Message.verifyFrameAuthor(tampered).ok, false);
    assert.strictEqual(Message.verifyFrameAuthor(frame.subarray(0, 100)).ok, false);
    assert.strictEqual(Message.verifyFrameAuthor(Message.fromVector(['P2P_FILE_SEND', 'x']).toBuffer()).ok, false, 'unsigned');
  });
});
