'use strict';

const Identity = require('../types/identity');
const Key = require('../types/key');
const assert = require('assert');
const bip39 = require('bip39');
const BIP32 = require('bip32').default;
const ecc = require('../types/ecc');
let nobleSecp256k1 = null;
try {
  nobleSecp256k1 = require('@noble/curves/secp256k1.js');
} catch (error) {
  // Support older noble-curves subpath exports used in some CI environments.
  nobleSecp256k1 = require('@noble/curves/secp256k1');
}
const { secp256k1, schnorr: nobleSchnorr } = nobleSecp256k1;
const crypto = require('crypto');

const SAMPLE = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
};

describe('@fabric/core/types/identity', function () {
  describe('Identity', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Identity instanceof Function, true);
    });

    it('can create a new ECDSA identity', function () {
      const identity = new Identity();
      assert.ok(identity);
    });

    it('provides the correct public key for a known seed phrase', function () {
      // Create identity and compute actual pubkey
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualPubkey = identity.pubkey;

      // Compute expected pubkey using bip32 + noble curves
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const expectedPubkey = Buffer.from(
        secp256k1.getPublicKey(root.privateKey, true)
      ).toString('hex');

      assert.ok(identity);
      assert.equal(actualPubkey, expectedPubkey);
    });

    it('can derive child keys', function () {
      // Create identity and compute actual child key
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualChild = identity.key.derive('m/0');
      const actualChildPubkey = actualChild.pubkey;

      // Compute expected child key using bip32 (shim expects 'bytes' for Buffer/Uint8Array)
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const child = root.derivePath('m/0');
      const expectedChildPubkey = Buffer.from(
        secp256k1.getPublicKey(child.privateKey, true)
      ).toString('hex');

      assert.ok(actualChild);
      assert.equal(actualChildPubkey, expectedChildPubkey);
      assert.notEqual(actualChildPubkey, identity.pubkey);
    });

    it('can sign and verify messages', function () {
      // Create identity and compute actual signature
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const message = 'Hello, Fabric!';
      const actualSignature = identity.sign(message);
      const actualVerified = identity.key.verify(message, actualSignature);

      // Basic sanity checks on signature format and verification
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const msgHash = crypto.createHash('sha256').update(Buffer.from(message)).digest();
      const expectedSig = nobleSchnorr.sign(msgHash, root.privateKey);
      const xOnlyPubkey = Buffer.from(
        secp256k1.getPublicKey(root.privateKey, true)
      ).slice(1); // drop prefix for x-only
      const expectedVerified = nobleSchnorr.verify(expectedSig, msgHash, xOnlyPubkey);

      assert.ok(actualSignature);
      assert.equal(actualVerified, true);
      assert.equal(actualVerified, expectedVerified);
    });
  });
});
