'use strict';

/**
 * JS stand-in for `fabric.node` so {@link functions/fabricNativeAccel} native code paths
 * are exercised under c8 without a compiled addon.
 */
const crypto = require('crypto');
const path = require('path');
const repoRoot = path.join(__dirname, '..', '..');
const sipaBech32 = require(path.join(repoRoot, 'functions', 'sipa', 'bech32'));
const sipaSegwit = require(path.join(repoRoot, 'functions', 'sipa', 'segwit_addr'));

function doubleSha256 (buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

function bech32Encode (hrp, wordsBuf, enc) {
  const words = [...wordsBuf];
  const encoding = enc ? sipaBech32.encodings.BECH32M : sipaBech32.encodings.BECH32;
  return sipaBech32.encode(hrp, words, encoding);
}

function bech32Decode (str) {
  let d = sipaBech32.decode(str, sipaBech32.encodings.BECH32);
  let spec = 'bech32';
  if (d === null) {
    d = sipaBech32.decode(str, sipaBech32.encodings.BECH32M);
    spec = 'bech32m';
  }
  if (d === null) return null;
  return { hrp: d.hrp, words: Buffer.from(d.data), spec };
}

function segwitAddrEncode (hrp, version, programBuf) {
  return sipaSegwit.encode(hrp, version, [...programBuf]);
}

function segwitAddrDecode (hrp, addr) {
  const d = sipaSegwit.decode(hrp, addr);
  if (!d) return null;
  return { version: Number(d.version), program: Buffer.from(d.program) };
}

module.exports = {
  doubleSha256,
  bech32Encode,
  bech32Decode,
  segwitAddrEncode,
  segwitAddrDecode
};
