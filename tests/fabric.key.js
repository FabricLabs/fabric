'use strict';

const Key = require('../types/key');
const assert = require('assert');
const networks = require('bitcoinjs-lib/src/networks');
const ECPair = require('ecpair').ECPairFactory(require('tiny-secp256k1'));
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const bip39 = require('bip39');
const BIP32 = require('bip32').default;
const ecc = require('tiny-secp256k1');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

const BIP_32_TEST_VECTOR_SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

const SAMPLE = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
};

describe('@fabric/core/types/key', function () {
  this.timeout(180000);

  describe('Key', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Key instanceof Function, true);
    });

    it('can create a new ECDSA key', function () {
      const key = new Key();
      assert.ok(key);
    });

    it('can generate a known keypair', function () {
      const key = new Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });

      assert.equal(key.pubkey, '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa');
    });

    it('can load from an existing seed', function () {
      const key = new Key({ seed: playnet.key.seed });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can load from an existing xprv', function () {
      const key = new Key({ xprv: playnet.key.xprv });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can load from an existing xpub', function () {
      const key = new Key({ xpub: playnet.key.xpub });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can generate many keypairs', function () {
      // 31 byte keys every ~256 iterations
      for (let i = 0; i < 1024; i++) {
        const key = new Key();
        assert.ok(key);
      }
    });

    it('can sign some data', function () {
      const key = new Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });
      const signature = key._sign(message['@data']);
      assert.ok(signature);
    });

    it('produces a valid signature', function () {
      const key = new Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });
      const signature = key._sign(message['@data']);
      const valid = key._verify(message['@data'], signature);
      assert.ok(valid);
    });

    it('rejects invalid signatures', function () {
      const key = new Key({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });
      const signature = key._sign('Different message');
      const valid = key._verify(message['@data'], signature);
      assert.ok(!valid);
    });

    it('can encrypt and decrypt messages', function () {
      const key = new Key();
      const testMessage = 'Hello, Fabric!';
      const encrypted = key.encrypt(testMessage);
      const decrypted = key.decrypt(encrypted);
      assert.strictEqual(decrypted, testMessage);
    });

    it('can generate p2pkh addresses', function () {
      const key = new Key({ seed: playnet.key.seed });
      const target = key.deriveAddress(0, 0, 'p2pkh');
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
      assert.equal(target.address, '1LDmxemmiVgiGbCAZ2zPKWsDRfM2shy7f9');
    });

    it('can generate p2wpkh addresses', function () {
      const key = new Key({ seed: playnet.key.seed });
      const target = key.deriveAddress(0, 0, 'p2wpkh');
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
      assert.equal(target.address, 'bc1q6t2wjeuavrd08fd8pu5ktf2sced5wf5chnd5qc');
    });

    it('can derive valid child keys', function () {
      const key = new Key({ seed: playnet.key.seed });
      const derivedKey = key.derive();
      assert.ok(derivedKey.public);
      assert.ok(derivedKey.private);
      assert.notStrictEqual(derivedKey.public, key.public);
    });

    it('can generate keys from mnemonics', function () {
      const mnemonicKey = Key.Mnemonic();
      assert.ok(mnemonicKey.seed);
      assert.ok(mnemonicKey.public);
      assert.ok(mnemonicKey.private);
    });

    it('can generate p2tr addresses', function () {
      const key = new Key({ seed: playnet.key.seed });
      const target = key.deriveAddress(0, 0, 'p2tr');
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
      // P2TR addresses start with bc1p for mainnet, tb1p for testnet, or bcrt1p for regtest
      assert.match(target.address, /^bc1p|^tb1p|^bcrt1p/);
      // P2TR addresses are bech32m encoded and should be between 62 and 90 characters
      assert.ok(target.address.length >= 62 && target.address.length <= 90);
    });

    it('can sign messages using Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message);
      assert.ok(signature instanceof Buffer);
      assert.equal(signature.length, 64); // Schnorr signatures are 64 bytes
    });

    it('can verify valid Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message);
      const valid = key.verifySchnorr(message, signature);
      assert.ok(valid);
    });

    it('rejects invalid Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message);
      const invalidSignature = Buffer.from(signature);
      invalidSignature[0] ^= 1; // Flip a bit to make the signature invalid
      const valid = key.verifySchnorr(message, invalidSignature);
      assert.ok(!valid);
    });

    it('rejects Schnorr signatures for different messages', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message1 = 'test message 1';
      const message2 = 'test message 2';
      const signature1 = key.signSchnorr(message1);
      const signature2 = key.signSchnorr(message2);
      assert.ok(signature1 !== signature2);
      it('can create a new key from a seed', function () {
        const key = new Key({
          seed: SAMPLE.seed
        });
        assert.ok(key);
      });

      it('can create a new key from a private key', function () {
        const key = new Key({
          private: SAMPLE.private
        });
        assert.ok(key);
      });

      it('provides the correct public key for a known private key', function () {
        const key = new Key({
          private: SAMPLE.private
        });
        const actualPubkey = key.pubkey;

        // Compute expected pubkey using elliptic
        const keypair = ec.keyFromPrivate(SAMPLE.private);
        const expectedPubkey = keypair.getPublic().encodeCompressed('hex');

        assert.equal(actualPubkey, expectedPubkey);
      });

      it('can sign and verify messages using Schnorr signatures', function () {
        const key = new Key({
          private: SAMPLE.private
        });
        const message = 'Hello, Fabric!';
        
        // Sign the message
        const signature = key.signSchnorr(message);
        assert.ok(signature);
        assert.ok(Buffer.isBuffer(signature));

        // Verify the signature
        const verified = key.verifySchnorr(message, signature);
        assert.equal(verified, true);

        // Verify with a different message should fail
        const wrongMessage = 'Hello, World!';
        const wrongVerified = key.verifySchnorr(wrongMessage, signature);
        assert.equal(wrongVerified, false);
      });

      it('can verify Schnorr signatures from other keys', function () {
        // Create two different keys
        const key1 = new Key({
          private: SAMPLE.private
        });
        const key2 = new Key({
          seed: SAMPLE.seed
        });

        const message = 'Hello, Fabric!';
        
        // Sign with key1
        const signature = key1.signSchnorr(message);
        assert.ok(signature);

        // Verify with key1 should succeed
        const verified1 = key1.verifySchnorr(message, signature);
        assert.equal(verified1, true);

        // Verify with key2 should fail
        const verified2 = key2.verifySchnorr(message, signature);
        assert.equal(verified2, false);
      });
    });

    it('throws when signing without private key using Schnorr', function () {
      const key = new Key();
      const publicKey = new Key({ public: key.public.encodeCompressed() });
      const message = 'test message';
      assert.throws(() => publicKey.signSchnorr(message), /Cannot sign without private key/);
    });
  });
});
