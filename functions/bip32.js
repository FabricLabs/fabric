/**
 * BIP-32 hierarchical deterministic wallets (secp256k1) — extended keys, derivation, base58.
 *
 * Uses @noble/curves and @noble/hashes; optional `ecc` in constructor is accepted for API
 * compatibility with the former `bip32` package and is not used for math.
 *
 * @module functions/bip32
 */
'use strict';

const { hmac } = require('@noble/hashes/hmac.js');
const { sha256 } = require('@noble/hashes/sha2.js');
const { sha512 } = require('@noble/hashes/sha2.js');
const { ripemd160 } = require('@noble/hashes/legacy.js');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { encodeCheck, decodeCheck } = require('./base58');
const { toUint8Strict, u32be } = require('./bytes');

const Point = secp256k1.Point;
const ZERO = Point.ZERO;
const N = Point.Fn.ORDER;

/** BIP32 hardened derivation bit (2^31) without a bare 2147483648 literal. */
const HARDENED_OFFSET = (1 << 31) >>> 0;
const MASTER_SECRET = new Uint8Array(Buffer.from('Bitcoin seed', 'utf8'));

function hash160 (buf) {
  return ripemd160(sha256(toUint8Strict(buf)));
}

function bufToBn (b) {
  let x = 0n;
  for (let i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]);
  return x;
}

function bnToBuf32 (n) {
  if (n <= 0n || n >= N) throw new Error('Invalid scalar');
  let hex = n.toString(16);
  if (hex.length > 64) throw new Error('scalar overflow');
  hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function ser32 (i) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(i >>> 0, 0);
  return b;
}

function fingerprintFromPub (pub) {
  return Buffer.from(hash160(pub)).readUInt32BE(0);
}

const DEFAULT_NETWORK = {
  messagePrefix: '\x18Bitcoin Signed Message:\n',
  bech32: 'bc',
  bip32: { public: u32be(4, 136, 178, 30), private: u32be(4, 136, 173, 228) },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80
};

function networkFromVersions (version) {
  const testnetBip32Pub = u32be(4, 53, 135, 207);
  const testnetBip32Priv = u32be(4, 53, 131, 148);
  const pairs = [
    [u32be(4, 136, 178, 30), u32be(4, 136, 173, 228), DEFAULT_NETWORK],
    [testnetBip32Pub, testnetBip32Priv, {
      messagePrefix: '\x18Bitcoin Signed Message:\n',
      bech32: 'tb',
      bip32: { public: testnetBip32Pub, private: testnetBip32Priv },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    }]
  ];
  for (const [pubV, privV, net] of pairs) {
    if (version === pubV || version === privV) return net;
  }
  return DEFAULT_NETWORK;
}

class HDNode {
  constructor (network, depth, parentFingerprint, index, chainCode, privateKey, publicKey) {
    this.network = network;
    this.depth = depth;
    this.parentFingerprint = parentFingerprint;
    this.index = index;
    this.chainCode = chainCode;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.fingerprint = fingerprintFromPub(this.publicKey);
  }

  get isNeutered () {
    return this.privateKey == null;
  }

  neutered () {
    return new HDNode(
      this.network,
      this.depth,
      this.parentFingerprint,
      this.index,
      Buffer.from(this.chainCode),
      null,
      Buffer.from(this.publicKey)
    );
  }

  derive (index) {
    let i;
    if (typeof index === 'number') {
      i = index;
    } else if (typeof index === 'bigint') {
      if (index < 0n || index > 0xffffffffn) throw new Error('Invalid index');
      i = Number(index);
    } else if (typeof index === 'string') {
      if (!/^\d+$/.test(index)) throw new Error('Invalid index');
      i = Number(index);
    } else {
      throw new Error('Invalid index');
    }
    if (!Number.isInteger(i) || i < 0 || i > (2 ** 32) - 1) throw new Error('Invalid index');
    const hardened = i >= HARDENED_OFFSET;

    if (this.privateKey) {
      let data;
      if (hardened) {
        data = Buffer.concat([Buffer.from([0]), this.privateKey, ser32(i)]);
      } else {
        data = Buffer.concat([this.publicKey, ser32(i)]);
      }
      const I = Buffer.from(hmac(sha512, toUint8Strict(this.chainCode), toUint8Strict(data)));
      const IL = I.subarray(0, 32);
      const IR = I.subarray(32, 64);
      const parseIL = bufToBn(IL);
      if (parseIL >= N) throw new Error('Invalid derivation (IL >= n)');
      const kPar = bufToBn(this.privateKey);
      const ki = (parseIL + kPar) % N;
      if (ki === 0n) throw new Error('Invalid derivation (ki = 0)');
      const childPriv = bnToBuf32(ki);
      const childPub = Buffer.from(secp256k1.getPublicKey(toUint8Strict(childPriv), true));
      return new HDNode(
        this.network,
        this.depth + 1,
        this.fingerprint,
        i,
        IR,
        childPriv,
        childPub
      );
    }

    if (hardened) throw new TypeError('Cannot derive hardened child from public parent');
    const data = Buffer.concat([this.publicKey, ser32(i)]);
    const I = Buffer.from(hmac(sha512, toUint8Strict(this.chainCode), toUint8Strict(data)));
    const IL = I.subarray(0, 32);
    const IR = I.subarray(32, 64);
    const parseIL = bufToBn(IL);
    if (parseIL >= N) throw new Error('Invalid derivation (IL >= n)');
    const P = Point.fromBytes(toUint8Strict(this.publicKey));
    const T = Point.BASE.multiply(parseIL);
    const K = P.add(T);
    if (K.equals(ZERO)) throw new Error('Invalid derivation (point at infinity)');
    const childPub = Buffer.from(K.toBytes(true));
    return new HDNode(
      this.network,
      this.depth + 1,
      this.fingerprint,
      i,
      IR,
      null,
      childPub
    );
  }

  derivePath (path) {
    const parts = path.split('/');
    if (parts[0] !== 'm') throw new Error(`Invalid path: ${path}`);
    if (parts.length - 1 > 255) {
      throw new Error('Invalid path: BIP-32 depth must not exceed 255');
    }
    if (this.depth !== 0) {
      throw new Error(`Invalid path: absolute path "${path}" must be derived from the master (depth 0) node`);
    }
    let node = this;
    for (let p = 1; p < parts.length; p++) {
      let seg = parts[p];
      if (!seg) throw new Error(`Invalid path segment: empty in ${path}`);
      const hardened = seg.endsWith("'") || seg.endsWith('h');
      if (hardened) seg = seg.slice(0, -1);
      if (!/^\d+$/.test(seg)) throw new Error(`Invalid path segment: ${parts[p]}`);
      const index = Number(seg);
      if (!Number.isInteger(index) || index < 0 || index > (2 ** 31) - 1) {
        throw new Error(`Invalid path segment: ${parts[p]}`);
      }
      node = node.derive(hardened ? index + HARDENED_OFFSET : index);
    }
    return node;
  }

  toBase58 () {
    const version = this.isNeutered ? this.network.bip32.public : this.network.bip32.private;
    const b = Buffer.allocUnsafe(78);
    b.writeUInt32BE(version >>> 0, 0);
    b.writeUInt8(this.depth, 4);
    b.writeUInt32BE(this.parentFingerprint >>> 0, 5);
    b.writeUInt32BE(this.index >>> 0, 9);
    Buffer.from(this.chainCode).copy(b, 13);
    if (this.privateKey) {
      b.writeUInt8(0, 45);
      Buffer.from(this.privateKey).copy(b, 46);
    } else {
      Buffer.from(this.publicKey).copy(b, 45);
    }
    return encodeCheck(b);
  }
}

function fromSeed (seed, network = DEFAULT_NETWORK) {
  if (seed == null) throw new Error('Seed is required');
  let s;
  if (Buffer.isBuffer(seed)) s = seed;
  else if (seed instanceof Uint8Array) s = Buffer.from(seed);
  else throw new Error('Seed must be a Buffer or Uint8Array');
  if (s.length < 16 || s.length > 64) throw new Error('Seed must be 16–64 bytes');
  const I = Buffer.from(hmac(sha512, MASTER_SECRET, toUint8Strict(s)));
  const IL = I.subarray(0, 32);
  const IR = I.subarray(32, 64);
  const parseIL = bufToBn(IL);
  if (parseIL === 0n || parseIL >= N) throw new Error('Invalid master seed');
  const privateKey = IL;
  const publicKey = Buffer.from(secp256k1.getPublicKey(toUint8Strict(privateKey), true));
  return new HDNode(network, 0, 0, 0, IR, privateKey, publicKey);
}

function fromBase58 (str) {
  const raw = decodeCheck(str);
  if (raw.length !== 78) throw new Error('Invalid extended key length');
  const version = raw.readUInt32BE(0);
  const net = networkFromVersions(version);
  const depth = raw[4];
  const parentFingerprint = raw.readUInt32BE(5);
  const index = raw.readUInt32BE(9);
  const chainCode = raw.subarray(13, 45);
  const keyData = raw.subarray(45, 78);

  if (depth === 0) {
    if (parentFingerprint !== 0) throw new Error('Invalid master key: parent fingerprint must be zero');
    if (index !== 0) throw new Error('Invalid master key: child number must be zero');
  }

  if (version === net.bip32.private) {
    if (keyData[0] !== 0) throw new Error('Invalid private key prefix');
    const privateKey = keyData.subarray(1, 33);
    const publicKey = Buffer.from(secp256k1.getPublicKey(toUint8Strict(privateKey), true));
    return new HDNode(net, depth, parentFingerprint, index, chainCode, privateKey, publicKey);
  }
  if (version === net.bip32.public) {
    if (keyData[0] !== 2 && keyData[0] !== 3) {
      throw new Error('Invalid public key prefix');
    }
    let publicKey;
    try {
      publicKey = Buffer.from(Point.fromBytes(toUint8Strict(keyData)).toBytes(true));
    } catch {
      throw new Error('Invalid public key');
    }
    return new HDNode(net, depth, parentFingerprint, index, chainCode, null, publicKey);
  }
  throw new Error('Unknown extended key version');
}

/**
 * Drop-in shape for `new (require('bip32').default)(ecc)`.
 */
class BIP32Factory {
  constructor (_ecc) {
    this._ecc = _ecc;
  }

  fromSeed (seed, network) {
    return fromSeed(seed, network || DEFAULT_NETWORK);
  }

  fromBase58 (str) {
    return fromBase58(str);
  }
}

module.exports = {
  default: BIP32Factory,
  fromSeed,
  fromBase58,
  HDNode,
  DEFAULT_NETWORK
};
