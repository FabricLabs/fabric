/**
 * BIP-39 mnemonics (English wordlist) — PBKDF2 seed, validation, entropy conversion.
 *
 * @module functions/bip39
 */
'use strict';

const crypto = require('crypto');
const { sha256 } = require('@noble/hashes/sha2.js');
const { sha512 } = require('@noble/hashes/sha2.js');
const { pbkdf2, pbkdf2Async } = require('@noble/hashes/pbkdf2.js');

const DEFAULT_WORDLIST = require('../settings/bip39-english.json');

function normalize (str) {
  const words = (str || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.join(' ');
}

function salt (passphrase) {
  return 'mnemonic' + (passphrase || '');
}

function seedInputs (mnemonic, passphrase) {
  const m = normalize(mnemonic);
  return {
    pwd: Buffer.from(m, 'utf8'),
    saltBuf: Buffer.from(salt(normalize(passphrase)), 'utf8')
  };
}

/**
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {Buffer}
 */
function mnemonicToSeedSync (mnemonic, passphrase = '') {
  const { pwd, saltBuf } = seedInputs(mnemonic, passphrase);
  const out = pbkdf2(sha512, pwd, saltBuf, { c: 2048, dkLen: 64 });
  return Buffer.from(out);
}

/**
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {Promise<Buffer>}
 */
async function mnemonicToSeed (mnemonic, passphrase = '') {
  const { pwd, saltBuf } = seedInputs(mnemonic, passphrase);
  const out = await pbkdf2Async(sha512, pwd, saltBuf, { c: 2048, dkLen: 64 });
  return Buffer.from(out);
}

function deriveChecksumBits (entropy) {
  const CS = (entropy.length * 8) / 32;
  const h = sha256(Uint8Array.from(entropy));
  const bits = [];
  for (const b of h) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  return bits.slice(0, CS);
}

function binaryToWord (bits, wordlist) {
  const idx = parseInt(bits.join(''), 2);
  return wordlist[idx];
}

/**
 * @param {Buffer} entropy
 * @param {string[]} [wordlist]
 * @returns {string}
 */
function entropyToMnemonic (entropy, wordlist = DEFAULT_WORDLIST) {
  if (!Buffer.isBuffer(entropy)) entropy = Buffer.from(entropy);
  if (entropy.length < 16 || entropy.length > 32 || entropy.length % 4 !== 0) {
    throw new Error('Entropy length must be 16–32 bytes and a multiple of 4');
  }
  const checksum = deriveChecksumBits(entropy);
  const bits = [];
  for (const b of entropy) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  bits.push(...checksum);
  const chunks = [];
  for (let i = 0; i < bits.length; i += 11) {
    chunks.push(binaryToWord(bits.slice(i, i + 11), wordlist));
  }
  return chunks.join(' ');
}

/**
 * @param {number} [strength=128] 128 → 12 words, 256 → 24 words
 * @param {string[]} [wordlist]
 * @returns {string}
 */
function generateMnemonic (strength = 128, wordlist = DEFAULT_WORDLIST) {
  if (strength % 32 !== 0 || strength < 128 || strength > 256) {
    throw new Error('Strength must be 128–256 in steps of 32');
  }
  const entropy = crypto.randomBytes(strength / 8);
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * @param {string} mnemonic
 * @param {string[]} [wordlist]
 * @returns {boolean}
 */
function validateMnemonic (mnemonic, wordlist = DEFAULT_WORDLIST) {
  const n = normalize(mnemonic);
  if (!n) return false;
  const words = n.split(' ');
  if (words.length % 3 !== 0 || words.length < 12 || words.length > 24) return false;
  const set = new Set(wordlist);
  if (!words.every((w) => set.has(w))) return false;
  try {
    mnemonicToEntropy(n, wordlist);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} mnemonic
 * @param {string[]} [wordlist]
 * @returns {Buffer}
 */
function mnemonicToEntropy (mnemonic, wordlist = DEFAULT_WORDLIST) {
  const words = normalize(mnemonic).split(' ');
  if (words.length % 3 !== 0) throw new Error('Invalid mnemonic length');
  const bits = [];
  for (const w of words) {
    const idx = wordlist.indexOf(w);
    if (idx < 0) throw new Error(`Unknown word: ${w}`);
    for (let i = 10; i >= 0; i--) bits.push((idx >> i) & 1);
  }
  const divider = Math.floor(bits.length / 33) * 32;
  const entropyBits = bits.slice(0, divider);
  const checksumBits = bits.slice(divider);
  const entropy = Buffer.alloc(entropyBits.length / 8);
  for (let i = 0; i < entropy.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | entropyBits[i * 8 + j];
    entropy[i] = v;
  }
  const expected = deriveChecksumBits(entropy);
  if (expected.length !== checksumBits.length) throw new Error('Checksum length mismatch');
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== checksumBits[i]) throw new Error('Invalid checksum');
  }
  return entropy;
}

module.exports = {
  mnemonicToSeed,
  mnemonicToSeedSync,
  entropyToMnemonic,
  generateMnemonic,
  validateMnemonic,
  mnemonicToEntropy,
  defaultWordlist: DEFAULT_WORDLIST
};
