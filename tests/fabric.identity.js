'use strict';

const Identity = require('../types/identity');
const assert = require('assert');
const bip39 = require('../functions/bip39');
const BIP32 = require('../functions/bip32').default;
const ecc = require('../types/ecc');
const { FABRIC_KEY_DERIVATION_PATH, bitcoinReceiveDerivationPath } = require('../constants');
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

    it('provides the Fabric-path public key for a known seed phrase', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualPubkey = identity.pubkey;

      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const child = root.derivePath(FABRIC_KEY_DERIVATION_PATH);
      const expectedPubkey = Buffer.from(
        secp256k1.getPublicKey(child.privateKey, true)
      ).toString('hex');

      assert.ok(identity);
      assert.equal(identity.derivation, FABRIC_KEY_DERIVATION_PATH);
      assert.equal(actualPubkey, expectedPubkey);
      // Master pubkey must differ from Fabric identity pubkey.
      const masterPubkey = Buffer.from(
        secp256k1.getPublicKey(root.privateKey, true)
      ).toString('hex');
      assert.notEqual(actualPubkey, masterPubkey);
    });

    it('keeps Bitcoin fund paths on coin type 0 from the master', function () {
      const identity = new Identity({ seed: SAMPLE.seed });
      const fundPath = bitcoinReceiveDerivationPath(0, 0);
      const fund = identity.master.derive(fundPath);
      assert.ok(fund.pubkey);
      assert.notEqual(fund.pubkey, identity.pubkey);
      assert.match(fundPath, /^m\/44'\/0'\//);
    });

    it('can derive child keys from the master', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const actualChild = identity.key.derive('m/0');
      const actualChildPubkey = actualChild.pubkey;

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

    it('can sign and verify messages with the Fabric key', function () {
      const identity = new Identity({
        seed: SAMPLE.seed
      });
      const message = 'Hello, Fabric!';
      const actualSignature = identity.sign(message);
      const actualVerified = identity.fabricKey.verify(message, actualSignature);

      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const fabricNode = root.derivePath(FABRIC_KEY_DERIVATION_PATH);
      const msgHash = crypto.createHash('sha256').update(Buffer.from(message)).digest();
      const expectedSig = nobleSchnorr.sign(msgHash, fabricNode.privateKey);
      const xOnlyPubkey = Buffer.from(
        secp256k1.getPublicKey(fabricNode.privateKey, true)
      ).slice(1); // drop prefix for x-only
      const expectedVerified = nobleSchnorr.verify(expectedSig, msgHash, xOnlyPubkey);

      assert.ok(actualSignature);
      assert.equal(actualVerified, true);
      assert.equal(actualVerified, expectedVerified);
    });
  });
});
