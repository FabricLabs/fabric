'use strict';

const Identity = require('../types/identity');
const Key = require('../types/key');
const assert = require('assert');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const bip39 = require('bip39');
const BIP32 = require('bip32').default;
const ecc = require('tiny-secp256k1');

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

      // Compute expected pubkey using bip32
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const keypair = ec.keyFromPrivate(root.privateKey);
      const expectedPubkey = keypair.getPublic().encodeCompressed('hex');

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

      // Compute expected child key using bip32
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const child = root.derivePath('m/0');
      const childKeypair = ec.keyFromPrivate(child.privateKey);
      const expectedChildPubkey = childKeypair.getPublic().encodeCompressed('hex');

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

      // Compute expected signature using bip32
      const seed = bip39.mnemonicToSeedSync(SAMPLE.seed);
      const root = new BIP32(ecc).fromSeed(seed);
      const keypair = ec.keyFromPrivate(root.privateKey);
      const msgHash = Buffer.from(message).toString('hex');
      const expectedSignature = keypair.sign(msgHash).toDER('hex');
      const expectedVerified = keypair.verify(msgHash, expectedSignature);

      assert.ok(actualSignature);
      assert.equal(actualVerified, true);
      assert.equal(actualVerified, expectedVerified);
    });
  });
});
