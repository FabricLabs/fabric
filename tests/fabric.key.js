'use strict';

const Key = require('../types/key');
const assert = require('assert');
const { networks: bitcoinNetworks } = require('bitcoinjs-lib');
const networks = Object.assign({ mainnet: bitcoinNetworks.bitcoin }, bitcoinNetworks);
const { secp256k1, schnorr: nobleSchnorr } = require('@noble/curves/secp256k1.js');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

const TEST_TAG = 'Fabric/Test';

const SAMPLE = {
  seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  private: '1111111111111111111111111111111111111111111111111111111111111111'
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

    it('can load from a raw BIP32 seed hex (FABRIC_SEED)', function () {
      const bip39 = require('../functions/bip39');
      const fromMnemonic = new Key({ mnemonic: SAMPLE.seed });
      const hex = bip39.mnemonicToSeedSync(SAMPLE.seed).toString('hex');
      const fromHex = new Key({ seed: hex });
      assert.equal(fromHex.xprv, fromMnemonic.xprv);
      assert.equal(fromHex.seed, hex);
      assert.equal(fromHex.status, 'seeded');
      assert.equal(fromHex.public.encodeCompressed('hex'), fromMnemonic.public.encodeCompressed('hex'));
    });

    it('rejects a short byte seed instead of treating it as a mnemonic', function () {
      assert.throws(() => new Key({ seed: Buffer.alloc(8) }), /Seed must be 16–64 bytes/);
      assert.throws(() => new Key({ seed: new Uint8Array(8) }), /Seed must be 16–64 bytes/);
    });

    it('classifies an xprv passed as seed (legacy FABRIC_SEED)', function () {
      const { FIXTURE_XPRV } = require('../constants');
      const fromXprv = new Key({ xprv: FIXTURE_XPRV });
      const fromSeed = new Key({ seed: FIXTURE_XPRV });
      assert.equal(fromSeed.xprv, fromXprv.xprv);
      assert.equal(fromSeed.xprv, FIXTURE_XPRV);
    });

    it('can load from a WIF', function () {
      const origin = new Key();
      const wif = origin.toWIF();
      const key = Key.fromWIF(wif);
      assert.equal(key.toWIF(), wif);
      assert.equal(key.toBitcoinAddress(), origin.toBitcoinAddress());
    });

    it('can load from a WIF passed in options', function () {
      const origin = new Key();
      const wif = origin.toWIF();
      const key = new Key({ wif: wif });
      assert.equal(key.toWIF(), wif);
      assert.equal(key.toBitcoinAddress(), origin.toBitcoinAddress());
    });

    it('can load from a known WIF', function () {
      const wif = '5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF';
      const key = Key.fromWIF(wif);
      const address = key.toBitcoinAddress();
      assert.equal(address, '1CC3X2gu58d6wXUWMffpuzN9JAfTUWu4Kj');
    });

    it('can load from an existing xprv', function () {
      const key = new Key({ xprv: playnet.key.xprv });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can load from an existing xpub', function () {
      const spec = new Key();
      const thing = new Key({ xpub: spec.xpub });
      assert.equal(thing.xpub, spec.xpub);
      const key = new Key({ xpub: playnet.key.xpub });
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
    });

    it('can generate many keypairs', function () {
      // 31 byte keys every ~256 iterations
      for (let i = 0; i < 256; i++) {
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

    it('signs a Uint8Array as the same raw bytes as a Buffer', function () {
      const key = new Key({ private: SAMPLE.private });
      const bytes = Uint8Array.from([1, 2, 3, 4]);
      const signature = key._sign(bytes);
      assert.ok(signature.equals(key._sign(Buffer.from(bytes))));
      assert.ok(key._verify(Buffer.from(bytes), signature));
      assert.ok(key._verify(bytes, signature));
    });

    it('can encrypt and decrypt messages', function () {
      const key = new Key();
      const testMessage = 'Hello, Fabric!';
      const encrypted = key.encrypt(testMessage);
      const decrypted = key.decrypt(encrypted);
      assert.strictEqual(decrypted, testMessage);
    });

    it('encrypt/decrypt return null without private key material', function () {
      const key = new Key();
      key.secure();
      assert.strictEqual(key.encrypt('hello'), null);
      assert.strictEqual(key.decrypt('abcd:1234'), null);
    });

    it('decrypt returns null on malformed ciphertext', function () {
      const key = new Key();
      assert.strictEqual(key.decrypt('not-a-ciphertext'), null);
      assert.strictEqual(key.decrypt('zzzz:abcd'), null);
      assert.strictEqual(key.decrypt('0011aabbccddeeff0011aabbccddeeff:not-hex'), null);
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

    it('can generate BIP-49 p2sh-p2wpkh addresses without changing the default path', function () {
      const key = new Key({ seed: playnet.key.seed });
      const target = key.deriveAddress(0, 0, 'p2sh-p2wpkh');
      assert.match(target.address, /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/);
      const alias = key.deriveAddress(0, 0, 'p2shp2wpkh');
      assert.strictEqual(alias.address, target.address);
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

    it('derives p2tr addresses matching the BIP-86 test vectors', function () {
      const key = new Key({
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        purpose: 86,
        network: 'main'
      });
      assert.equal(key.deriveAddress(0, 0, 'p2tr').address, 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
      assert.equal(key.deriveAddress(1, 0, 'p2tr').address, 'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh');
      assert.equal(key.deriveAddress(0, 1, 'p2tr').address, 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7');
    });

    it('derives addresses for the network it is on, never mainnet by default', function () {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const on = (network) => new Key({ mnemonic, purpose: 86, network });
      assert.equal(on('mainnet').deriveAddress(0, 0, 'p2tr').address, 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
      for (const network of ['signet', 'testnet', 'testnet4', 'testnet5']) {
        assert.match(on(network).deriveAddress(0, 0, 'p2tr').address, /^tb1p/, network);
        assert.match(on(network).deriveAddress(0, 0, 'p2wpkh').address, /^tb1q/, network);
        assert.match(on(network).deriveAddress(0, 0, 'p2pkh').address, /^[mn]/, network);
      }
      for (const network of ['regtest', 'playnet']) {
        assert.match(on(network).deriveAddress(0, 0, 'p2tr').address, /^bcrt1p/, network);
        assert.match(on(network).deriveAddress(0, 0, 'p2wpkh').address, /^bcrt1q/, network);
      }
      assert.throws(() => on('nosuchnet').deriveAddress(0, 0, 'p2wpkh'), /Unsupported network/);
    });

    it('can sign messages using Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message, TEST_TAG);
      assert.ok(signature instanceof Buffer);
      assert.equal(signature.length, 64); // Schnorr signatures are 64 bytes
    });

    it('can verify valid Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message, TEST_TAG);
      const valid = key.verifySchnorr(message, signature, TEST_TAG);
      assert.ok(valid);
    });

    it('rejects invalid Schnorr signatures', function () {
      const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
      const message = 'test message';
      const signature = key.signSchnorr(message, TEST_TAG);
      const invalidSignature = Buffer.from(signature);
      invalidSignature[0] ^= 1; // Flip a bit to make the signature invalid
      const valid = key.verifySchnorr(message, invalidSignature, TEST_TAG);
      assert.ok(!valid);
    });

    it('rejects Schnorr signatures for different messages', function () {
      const key = new Key({ private: SAMPLE.private });
      const message1 = 'test message 1';
      const message2 = 'test message 2';
      const signature1 = key.signSchnorr(message1, TEST_TAG);
      const signature2 = key.signSchnorr(message2, TEST_TAG);
      assert.ok(!signature1.equals(signature2), 'distinct messages must not share signature bytes');
      assert.strictEqual(key.verifySchnorr(message1, signature1, TEST_TAG), true);
      assert.strictEqual(key.verifySchnorr(message2, signature1, TEST_TAG), false);
      assert.strictEqual(key.verifySchnorr(message1, signature2, TEST_TAG), false);
    });

    it('can create a new key from a seed', function () {
      const key = new Key({
        seed: SAMPLE.seed
      });
      assert.ok(key);
      assert.ok(key.public);
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
      const expectedPubkey = Buffer.from(
        secp256k1.getPublicKey(Buffer.from(SAMPLE.private, 'hex'), true)
      ).toString('hex');

      assert.equal(actualPubkey, expectedPubkey);
    });

    it('Schnorr signatures match noble BIP340 over the tagged hash with zero auxRand', function () {
      const key = new Key({ private: SAMPLE.private });
      const message = 'Hello, Fabric!';
      const signature = key.signSchnorr(message, TEST_TAG);
      const messageHash = require('../functions/taggedHash')(TEST_TAG, Buffer.from(message));
      const expected = Buffer.from(
        nobleSchnorr.sign(messageHash, Buffer.from(SAMPLE.private, 'hex'), Buffer.alloc(32))
      );
      assert.ok(signature.equals(expected));
      assert.strictEqual(key.verifySchnorr(message, signature, TEST_TAG), true);
      assert.strictEqual(key.verifySchnorr('Hello, World!', signature, TEST_TAG), false);
    });

    it('rejects a Schnorr signature from a different key', function () {
      const key1 = new Key({ private: SAMPLE.private });
      const key2 = new Key({ seed: SAMPLE.seed });
      const message = 'Hello, Fabric!';
      const signature = key1.signSchnorr(message, TEST_TAG);
      assert.strictEqual(key1.verifySchnorr(message, signature, TEST_TAG), true);
      assert.strictEqual(key2.verifySchnorr(message, signature, TEST_TAG), false);
    });

    it('throws when signing without private key using Schnorr', function () {
      const key = new Key();
      const publicKey = new Key({ public: key.public.encodeCompressed() });
      const message = 'test message';
      assert.throws(() => publicKey.signSchnorr(message, TEST_TAG), /Cannot sign without private key/);
    });

    it('secure clears private material and marks state', function () {
      const key = new Key();
      assert.ok(key.private);
      key.secure();
      assert.strictEqual(key.private, null);
      assert.strictEqual(key.seed, null);
      assert.strictEqual(key.xprv, null);
      assert.strictEqual(key._state.status, 'secured');
    });

    it('accepts Uint8Array private keys for signing', function () {
      const bytes = new Uint8Array(32).fill(1);
      const key = new Key({ private: bytes });
      const sig = key.signSchnorr('byte-like private key', TEST_TAG);
      assert.ok(Buffer.isBuffer(sig));
      assert.strictEqual(sig.length, 64);
    });

    it('throws on invalid private key format', function () {
      const key = new Key();
      key.private = 1;
      assert.throws(() => key.signSchnorr('invalid private key', TEST_TAG), /Invalid private key format/);
    });

    it('rejects non-hex string private key values', function () {
      const key = new Key();
      key.private = 'z'.repeat(32);
      assert.throws(() => key.signSchnorr('invalid private key', TEST_TAG), /Invalid private key format/);
    });

    it('rejects plain array-like private key objects', function () {
      const key = new Key();
      key.private = { length: 32 };
      assert.throws(() => key.signSchnorr('invalid private key', TEST_TAG), /Invalid private key format/);
    });
  });
});

const fs = require('fs');
const path = require('path');
const {
  InvalidContributionError,
  ValueError,
  musig2IsNOfN,
  individualPk,
  keySort,
  keyAgg,
  getXonlyPk,
  keyAggAndTweak,
  nonceGenInternal,
  nonceAgg,
  sessionContext,
  sign,
  partialSigVerify,
  partialSigVerifyInternal,
  partialSigAgg,
  deterministicSign,
  aggregateXonly,
  verifyAggregatedSchnorr
} = require('../functions/musig2');

const VEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'bip327.json'), 'utf8'));

function load (name) {
  return VEC[name];
}

function hx (hex) {
  return Buffer.from(String(hex), 'hex');
}

function pick (arr, indices) {
  return indices.map((i) => arr[i]);
}

function expectError (fn, spec) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected exception: ' + JSON.stringify(spec));
  if (spec.type === 'invalid_contribution') {
    assert.ok(err instanceof InvalidContributionError, err.message);
    if (Object.prototype.hasOwnProperty.call(spec, 'signer')) {
      assert.strictEqual(err.signer, spec.signer);
    }
    if (spec.contrib) assert.strictEqual(err.contrib, spec.contrib);
  } else if (spec.type === 'value') {
    assert.ok(err instanceof ValueError, err.name + ': ' + err.message);
    assert.strictEqual(err.message, spec.message);
  } else {
    throw new Error('unknown error type ' + spec.type);
  }
}

describe('@fabric/core/functions/musig2 BIP-327', function () {
  it('treats MuSig2 as n-of-n only', function () {
    assert.strictEqual(musig2IsNOfN(2, 2), true);
    assert.strictEqual(musig2IsNOfN(2, 3), false);
    assert.strictEqual(musig2IsNOfN(1, 1), false);
  });

  it('matches key_sort_vectors.json', function () {
    const data = load('key_sort_vectors.json');
    const sorted = keySort(data.pubkeys.map(hx));
    assert.deepStrictEqual(
      sorted.map((b) => b.toString('hex').toUpperCase()),
      data.sorted_pubkeys.map((s) => s.toUpperCase())
    );
  });

  it('matches key_agg_vectors.json', function () {
    const data = load('key_agg_vectors.json');
    const X = data.pubkeys.map(hx);
    const T = data.tweaks.map(hx);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const got = getXonlyPk(keyAgg(pubkeys));
      assert.strictEqual(got.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases) {
      expectError(() => {
        keyAggAndTweak(pick(X, tc.key_indices), pick(T, tc.tweak_indices), tc.is_xonly);
      }, tc.error);
    }
  });

  it('matches nonce_gen_vectors.json', function () {
    const data = load('nonce_gen_vectors.json');
    for (const tc of data.test_cases) {
      const maybe = (key) => (tc[key] == null ? null : hx(tc[key]));
      const { secnonce, pubnonce } = nonceGenInternal(
        hx(tc.rand_),
        maybe('sk'),
        hx(tc.pk),
        maybe('aggpk'),
        maybe('msg'),
        maybe('extra_in')
      );
      assert.strictEqual(secnonce.toString('hex').toUpperCase(), tc.expected_secnonce.toUpperCase());
      assert.strictEqual(pubnonce.toString('hex').toUpperCase(), tc.expected_pubnonce.toUpperCase());
    }
  });

  it('matches nonce_agg_vectors.json', function () {
    const data = load('nonce_agg_vectors.json');
    const pnonce = data.pnonces.map(hx);
    for (const tc of data.valid_test_cases) {
      const got = nonceAgg(pick(pnonce, tc.pnonce_indices));
      assert.strictEqual(got.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases) {
      expectError(() => nonceAgg(pick(pnonce, tc.pnonce_indices)), tc.error);
    }
  });

  it('matches sign_verify_vectors.json', function () {
    const data = load('sign_verify_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    assert.deepStrictEqual(individualPk(sk), X[0]);
    const secnonces = data.secnonces.map(hx);
    const pnonce = data.pnonces.map(hx);
    const aggnonces = data.aggnonces.map(hx);
    const msgs = data.msgs.map(hx);

    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const aggnonce = aggnonces[tc.aggnonce_index];
      assert.deepStrictEqual(nonceAgg(pubnonces), aggnonce);
      const msg = msgs[tc.msg_index];
      const sessionCtx = sessionContext(aggnonce, pubkeys, [], [], msg);
      const secnonceTmp = Buffer.from(secnonces[0]);
      const psig = sign(secnonceTmp, sk, sessionCtx);
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
      assert.ok(partialSigVerify(psig, pubnonces, pubkeys, [], [], msg, tc.signer_index));
      assert.ok(secnonceTmp.subarray(0, 64).equals(Buffer.alloc(64)));
    }

    for (const tc of data.sign_error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const aggnonce = aggnonces[tc.aggnonce_index];
      const msg = msgs[tc.msg_index];
      const sessionCtx = sessionContext(aggnonce, pubkeys, [], [], msg);
      const secnonce = Buffer.from(secnonces[tc.secnonce_index]);
      expectError(() => sign(secnonce, sk, sessionCtx), tc.error);
    }

    for (const tc of data.verify_fail_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const msg = msgs[tc.msg_index];
      assert.strictEqual(
        partialSigVerify(hx(tc.sig), pubnonces, pubkeys, [], [], msg, tc.signer_index),
        false
      );
    }

    for (const tc of data.verify_error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const msg = msgs[tc.msg_index];
      expectError(() => {
        partialSigVerify(hx(tc.sig), pubnonces, pubkeys, [], [], msg, tc.signer_index);
      }, tc.error);
    }
  });

  it('matches tweak_vectors.json', function () {
    const data = load('tweak_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    const pnonce = data.pnonces.map(hx);
    const aggnonce = hx(data.aggnonce);
    const tweaks = data.tweaks.map(hx);
    const msg = hx(data.msg);
    const secnonce = hx(data.secnonce);

    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const tw = pick(tweaks, tc.tweak_indices);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly, msg);
      const secnonceTmp = Buffer.from(secnonce);
      const psig = sign(secnonceTmp, sk, sessionCtx);
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
      assert.ok(partialSigVerify(psig, pubnonces, pubkeys, tw, tc.is_xonly, msg, tc.signer_index));
    }

    for (const tc of data.error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tw = pick(tweaks, tc.tweak_indices);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly, msg);
      expectError(() => sign(Buffer.from(secnonce), sk, sessionCtx), tc.error);
    }
  });

  it('matches det_sign_vectors.json', function () {
    const data = load('det_sign_vectors.json');
    const sk = hx(data.sk);
    const X = data.pubkeys.map(hx);
    const msgs = data.msgs.map(hx);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tweaks = (tc.tweaks || []).map(hx);
      const msg = msgs[tc.msg_index];
      const rand = tc.rand != null ? hx(tc.rand) : null;
      const { pubnonce, psig } = deterministicSign(
        sk,
        hx(tc.aggothernonce),
        pubkeys,
        tweaks,
        tc.is_xonly,
        msg,
        rand
      );
      assert.strictEqual(pubnonce.toString('hex').toUpperCase(), tc.expected[0].toUpperCase());
      assert.strictEqual(psig.toString('hex').toUpperCase(), tc.expected[1].toUpperCase());
      const aggnonce = nonceAgg([hx(tc.aggothernonce), pubnonce]);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tweaks, tc.is_xonly, msg);
      assert.ok(partialSigVerifyInternal(psig, pubnonce, pubkeys[tc.signer_index], sessionCtx));
    }
    for (const tc of data.error_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const tweaks = (tc.tweaks || []).map(hx);
      const msg = msgs[tc.msg_index];
      const rand = tc.rand != null ? hx(tc.rand) : null;
      expectError(() => {
        deterministicSign(sk, hx(tc.aggothernonce), pubkeys, tweaks, tc.is_xonly, msg, rand);
      }, tc.error);
    }
  });

  it('matches sig_agg_vectors.json', function () {
    const data = load('sig_agg_vectors.json');
    const X = data.pubkeys.map(hx);
    const pnonce = data.pnonces.map(hx);
    const tweaks = data.tweaks.map(hx);
    const psigs = data.psigs.map(hx);
    const msg = hx(data.msg);
    for (const tc of data.valid_test_cases) {
      const pubkeys = pick(X, tc.key_indices);
      const pubnonces = pick(pnonce, tc.nonce_indices);
      const tw = pick(tweaks, tc.tweak_indices || []);
      const aggnonce = hx(tc.aggnonce);
      assert.deepStrictEqual(nonceAgg(pubnonces), aggnonce);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly || [], msg);
      const sig = partialSigAgg(pick(psigs, tc.psig_indices), sessionCtx);
      assert.strictEqual(sig.toString('hex').toUpperCase(), tc.expected.toUpperCase());
    }
    for (const tc of data.error_test_cases || []) {
      const pubkeys = pick(X, tc.key_indices);
      const tw = pick(tweaks, tc.tweak_indices || []);
      const aggnonce = hx(tc.aggnonce);
      const sessionCtx = sessionContext(aggnonce, pubkeys, tw, tc.is_xonly || [], msg);
      expectError(() => partialSigAgg(pick(psigs, tc.psig_indices), sessionCtx), tc.error);
    }
  });

  it('rejects a caller-supplied aggregate that does not match keyAgg', function () {
    const data = load('key_agg_vectors.json');
    const keys = pick(data.pubkeys.map(hx), data.valid_test_cases[0].key_indices);
    const xonly = aggregateXonly(keys);
    assert.ok(!verifyAggregatedSchnorr(
      Buffer.alloc(32),
      Buffer.alloc(64),
      keys,
      Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 1)])
    ));
    assert.ok(xonly.length === 32);
  });

  it('rejects non-hex session message strings instead of truncating', function () {
    assert.throws(
      () => sessionContext(Buffer.alloc(66), [Buffer.alloc(33)], [], [], 'zzzzzz'),
      /expected hex/
    );
  });

  it('zeros secnonce before getSessionValues so a later throw cannot reuse it', function () {
    const sk = skOf(new Key());
    const pk = individualPk(sk);
    const { secnonce } = nonceGenInternal(
      Buffer.alloc(32, 7),
      sk,
      pk,
      null,
      Buffer.alloc(32),
      null
    );
    assert.ok(secnonce.some((byte) => byte !== 0));
    const ctx = {
      aggnonce: Buffer.alloc(66, 2),
      pubkeys: [],
      tweaks: [],
      isXonly: [],
      msg: Buffer.alloc(32)
    };
    assert.throws(() => sign(secnonce, sk, ctx));
    assert.ok(secnonce.every((byte) => byte === 0));
  });
});

const Message = require('../types/message');
const {
  packPubkeys,
  unpackPubkeys,
  createLocalSession,
  createFromStart,
  recordPubnonce,
  allPubnoncesPresent,
  computeAggNonce,
  setAggNonce,
  createPartial,
  recordPartial,
  allPartialsPresent,
  aggregatePartials,
  verifyFinalSignature,
  wipeSession,
  xOnlyHex,
  startFields
} = require('../functions/musig2Session');
const keyHasPrivateSigningMaterial = require('../types/key').hasPrivateSigningMaterial;

function skOf (key) {
  return Buffer.isBuffer(key.private) ? key.private : Buffer.from(String(key.private), 'hex');
}

function runRound (keys, msg) {
  const sks = keys.map(skOf);
  const pks = sks.map((sk) => individualPk(sk));
  const initiator = createLocalSession({
    msg,
    pubkeys: pks,
    sk: sks[0],
    purpose: 'test'
  });
  const sessions = [initiator];
  const author = xOnlyHex(pks[0]);
  for (let i = 1; i < keys.length; i++) {
    const made = createFromStart(startFields(initiator), {
      sk: sks[i],
      signerXOnly: author
    });
    assert.strictEqual(made.ok, true, made.reason);
    sessions.push(made.session);
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = 0; j < sessions.length; j++) {
      if (i === j) continue;
      const rec = recordPubnonce(
        sessions[i],
        xOnlyHex(pks[j]),
        sessions[j].ownPubnonce
      );
      assert.strictEqual(rec.ok, true, rec.reason);
    }
    assert.strictEqual(allPubnoncesPresent(sessions[i]), true);
  }
  const aggnonce = computeAggNonce(initiator);
  assert.ok(aggnonce);
  for (const session of sessions) {
    const set = setAggNonce(session, aggnonce);
    assert.strictEqual(set.ok, true, set.reason);
  }
  const psigs = [];
  for (let i = 0; i < sessions.length; i++) {
    const signed = createPartial(sessions[i], sks[i]);
    assert.strictEqual(signed.ok, true, signed.reason);
    psigs.push(signed.psig);
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = 0; j < sessions.length; j++) {
      if (i === j) continue;
      const rec = recordPartial(sessions[i], xOnlyHex(pks[j]), psigs[j]);
      assert.strictEqual(rec.ok, true, rec.reason);
    }
    assert.strictEqual(allPartialsPresent(sessions[i]), true);
  }
  const agg = aggregatePartials(initiator);
  assert.strictEqual(agg.ok, true, agg.reason);
  for (let i = 1; i < sessions.length; i++) {
    const v = verifyFinalSignature(sessions[i], agg.signature);
    assert.strictEqual(v.ok, true, v.reason);
  }
  assert.strictEqual(
    verifyAggregatedSchnorr(initiator.challenge, agg.signature, initiator.pubkeys),
    true
  );
  return { initiator, signature: agg.signature, pubkeys: initiator.pubkeys };
}

describe('@fabric/core/functions/musig2Session', function () {
  it('packs and unpacks compressed pubkeys', function () {
    const a = individualPk(skOf(new Key()));
    const b = individualPk(skOf(new Key()));
    const packed = packPubkeys([b, a]);
    const unpacked = unpackPubkeys(packed);
    assert.strictEqual(unpacked.length, 2);
    assert.strictEqual(packed.length, 66);
    const hex = (pk) => Buffer.from(pk).toString('hex');
    const got = unpacked.map(hex).sort();
    const want = [hex(a), hex(b)].sort();
    assert.deepStrictEqual(got, want);
  });

  it('completes a 2-of-2 session', function () {
    runRound([new Key(), new Key()], Buffer.from('hello musig2'));
  });

  it('completes a 3-of-3 session', function () {
    runRound([new Key(), new Key(), new Key()], Buffer.from('three party'));
  });

  it('rejects a START whose AMP signer is not a participant', function () {
    const a = new Key();
    const b = new Key();
    const rogue = new Key();
    const session = createLocalSession({
      msg: Buffer.from('x'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const made = createFromStart(startFields(session), {
      sk: skOf(b),
      signerXOnly: xOnlyHex(individualPk(skOf(rogue)))
    });
    assert.strictEqual(made.ok, false);
    assert.strictEqual(made.reason, 'signer-not-participant');
  });

  it('rejects a claimed aggnonce that does not recompute', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('x'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const other = createFromStart(startFields(session), {
      sk: skOf(b),
      signerXOnly: xOnlyHex(individualPk(skOf(a)))
    });
    assert.ok(other.ok);
    recordPubnonce(session, xOnlyHex(individualPk(skOf(b))), other.session.ownPubnonce);
    const fake = Buffer.alloc(66, 2);
    fake[0] = 0x02;
    fake[33] = 0x02;
    const set = setAggNonce(session, fake);
    assert.strictEqual(set.ok, false);
    assert.strictEqual(set.reason, 'aggnonce-mismatch');
  });

  it('encodes P2P_MUSIG_START as a first-class AMP type', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('wire'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const msg = Message.fromFields('P2P_MUSIG_START', startFields(session));
    assert.strictEqual(msg.type, 'P2P_MUSIG_START');
    const decoded = Message.fromBuffer(msg.toBuffer());
    assert.strictEqual(decoded.type, 'P2P_MUSIG_START');
    const fields = decoded.toFields();
    assert.ok(fields);
    assert.ok(Buffer.isBuffer(fields.sessionId));
    assert.strictEqual(fields.sessionId.equals(session.sessionId), true);
  });

  it('verifyFinalSignature returns ok:false without a session', function () {
    assert.deepStrictEqual(
      verifyFinalSignature(null, Buffer.alloc(64)),
      { ok: false, reason: 'no-session' }
    );
  });

  it('does not wipe secnonce while aggregatePartials waits for more partials', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('incomplete'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    assert.ok(Buffer.isBuffer(session.secnonce));
    const agg = aggregatePartials(session);
    assert.strictEqual(agg.ok, false);
    assert.strictEqual(agg.reason, 'incomplete-psigs');
    assert.ok(Buffer.isBuffer(session.secnonce));
    wipeSession(session);
    assert.strictEqual(session.secnonce, null);
  });

  it('wipes session.secnonce when createPartial cannot complete sign', function () {
    const a = new Key();
    const b = new Key();
    const session = createLocalSession({
      msg: Buffer.from('partial-fail'),
      pubkeys: [individualPk(skOf(a)), individualPk(skOf(b))],
      sk: skOf(a)
    });
    const held = session.secnonce;
    session.aggnonce = Buffer.alloc(5);
    const signed = createPartial(session, skOf(a));
    assert.strictEqual(signed.ok, false);
    assert.strictEqual(session.secnonce, null);
    assert.ok(held.every((byte) => byte === 0));
  });

  it('rejects an unparsed START body instead of falling back', function () {
    const a = new Key();
    const b = new Key();
    const made = createFromStart({
      sessionId: 'not-32-bytes',
      msg: 'x',
      pubkeys: 'zzzz',
      pubnonce: '00'
    }, {
      sk: skOf(b),
      signerXOnly: xOnlyHex(individualPk(skOf(a)))
    });
    assert.strictEqual(made.ok, false);
    assert.strictEqual(made.reason, 'invalid-start');
  });
});

describe('@fabric/core/types/key statics', function () {
  it('expose the modules the functions/ shims re-export', function () {
    assert.strictEqual(require('../functions/bip32'), Key.BIP32);
    assert.strictEqual(require('../functions/bip49'), Key.BIP49);
    assert.strictEqual(require('../functions/bip85'), Key.BIP85);
    assert.strictEqual(require('../functions/base58'), Key.Base58);
    assert.strictEqual(require('../types/key').Material, Key.Material);
    assert.strictEqual(require('../types/key').TAGS, Key.TAGS);
    assert.strictEqual(require('../types/key').hasPrivateSigningMaterial, Key.hasPrivateSigningMaterial);
    const pubkey = require('../types/key');
    assert.strictEqual(pubkey.pubkeyXOnly, Key.pubkeyXOnly);
    assert.strictEqual(pubkey.normalizePeerPubkeyHex, Key.normalizePeerPubkeyHex);
    const bip39 = require('../functions/bip39');
    assert.strictEqual(bip39.validateMnemonic, Key.Mnemonic.validate);
    assert.strictEqual(bip39.mnemonicToSeedSync, Key.Mnemonic.toSeedSync);
    assert.strictEqual(Key.HDNode, Key.BIP32.HDNode);
    assert.strictEqual(Key.SIGN_TAG, Key.TAGS.SIGN);
  });

  it('Key.Mnemonic carries BIP-39 (Trezor vector)', function () {
    const phrase = Key.Mnemonic.fromEntropy(Buffer.alloc(16));
    assert.strictEqual(phrase, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    assert.strictEqual(Key.Mnemonic.validate(phrase), true);
    assert.strictEqual(Buffer.from(Key.Mnemonic.toEntropy(phrase)).toString('hex'), '00000000000000000000000000000000');
    assert.strictEqual(
      Buffer.from(Key.Mnemonic.toSeedSync(phrase, 'TREZOR')).toString('hex'),
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
    );
    assert.deepStrictEqual(Key.Mnemonic.WORD_COUNTS, [12, 15, 18, 21, 24]);
    assert.strictEqual(Key.Mnemonic.wordlist.length, 2048);
    assert.strictEqual(Key.Mnemonic.generate().split(' ').length, 12);
  });

  it('Key.Mnemonic(entropy) still makes a key from that phrase', function () {
    const key = Key.Mnemonic(Buffer.alloc(16));
    assert.strictEqual(key.seed.split(' ').pop(), 'about');
    assert.ok(key.private);
  });

  it('Key.TAGS is frozen', function () {
    assert.ok(Object.isFrozen(Key.TAGS));
  });
});

describe('keyHasPrivateSigningMaterial', function () {
  it('returns false for null / missing private', function () {
    assert.strictEqual(keyHasPrivateSigningMaterial(null), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({}), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: null }), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: '' }), false);
    assert.strictEqual(keyHasPrivateSigningMaterial({ private: Buffer.alloc(0) }), false);
  });

  it('returns true for Key with private material and false for watch-only', function () {
    const full = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const watch = new Key({ public: full.pubkey });
    assert.strictEqual(keyHasPrivateSigningMaterial(full), true);
    assert.strictEqual(keyHasPrivateSigningMaterial(watch), false);
  });
});


const { FIXTURE_SEED } = require('../constants');
const {
  WALLET_GAP_LIMIT,
  normalizeAccountNetwork,
  extendedKeyForNetwork,
  shareableAccountXpub,
  generateMnemonic,
  importSeed,
  deriveAccount,
  walletDescriptors,
  walletAddress,
  walletReceiveAddress,
  walletChangeAddress,
  cosignerProof,
  verifyCosignerProof,
  sealMaster,
  unsealMaster,
  createAccountVault,
  verifyVaultAccounts,
  openAccountVault,
  selectVaultAccount,
  currentVaultAccount
} = require('../types/key').Accounts;
const { exclusiveOperatorKeySettings, resolveFabricOperatorKeySettings } = require('../types/key').Operator;
const { keySettingsFromEnv, classifyFabricIdentityEnvValue } = require('../types/key').Material;

// BIP84 / BIP44 test vectors share this master ("abandon … about", no passphrase).
const MASTER = 'xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu';
const LOCK = 'correct horse battery';

describe('@fabric/core/functions/accountKeys', function () {
  this.timeout(30000);

  it('imports a seed into the master xprv; the BIP39 passphrase changes it', function () {
    assert.strictEqual(importSeed(FIXTURE_SEED), MASTER);
    assert.notStrictEqual(importSeed(FIXTURE_SEED, 'TREZOR'), MASTER);
    assert.throws(() => importSeed('not a mnemonic'));
  });

  it('generates 24-word mnemonics by default', function () {
    assert.strictEqual(generateMnemonic().split(' ').length, 24);
  });

  it('normalizes networks', function () {
    assert.strictEqual(normalizeAccountNetwork('main'), 'mainnet');
    assert.strictEqual(normalizeAccountNetwork('bitcoin'), 'mainnet');
    assert.strictEqual(normalizeAccountNetwork('regtest'), 'regtest');
    assert.throws(() => normalizeAccountNetwork('dogecoin'));
  });

  it('derives the mainnet paths (BIP84 and BIP44 vectors)', function () {
    const a = deriveAccount(MASTER, { account: 0, network: 'mainnet' });
    assert.strictEqual(a.identity.path, "m/7777'/7777'/0'/0/0");
    assert.strictEqual(a.wallet.segwit.path, "m/84'/0'/0'");
    assert.strictEqual(a.wallet.standard.path, "m/44'/0'/0'");
    assert.strictEqual(a.cosigner.path, "m/87'/0'/0'/0/0");
    assert.strictEqual(a.wallet.receive, 'segwit');
    // BIP84 account xpub (xpub6CatWdiZ…) with depth, parent fingerprint, and child number zeroed.
    assert.strictEqual(a.wallet.segwit.xpub, 'xpub661MyMwAqRbcFHMVYpCiBTXd2Caj7vZhNFHJSgE59Aue2yYkXSrz5q9GaQ4rRjJVhHZTsCiHWSzgMS5beaaTHWVmhpGC7SMdqMXHRXZi8as');
    assert.strictEqual(shareableAccountXpub('xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V', 'mainnet'), a.wallet.segwit.xpub);
    assert.strictEqual(walletReceiveAddress(a.wallet, 'mainnet', 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.strictEqual(walletChangeAddress(a.wallet, 'mainnet', 0), 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
    assert.strictEqual(
      walletAddress({ xpub: a.wallet.standard.xpub, network: 'mainnet', script: 'pkh' }),
      '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'
    );
  });

  it('derives the same account index on a different path per network', function () {
    const r0 = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    const r1 = deriveAccount(MASTER, { account: 1, network: 'regtest' });
    const m1 = deriveAccount(MASTER, { account: 1, network: 'mainnet' });
    assert.strictEqual(r0.identity.path, "m/7777'/7778'/0'/0/0");
    assert.strictEqual(r0.wallet.segwit.path, "m/84'/1'/0'");
    assert.strictEqual(r0.wallet.standard.path, "m/44'/1'/0'");
    assert.strictEqual(r0.cosigner.path, "m/87'/1'/0'/0/0");
    assert.strictEqual(r1.identity.path, "m/7777'/7778'/1'/0/0");
    assert.strictEqual(m1.wallet.segwit.path, "m/84'/0'/1'");
    assert.match(r0.wallet.segwit.xpub, /^tpub/);
    assert.match(walletReceiveAddress(r0.wallet, 'regtest'), /^bcrt1q/);
    assert.match(walletReceiveAddress(deriveAccount(MASTER, { network: 'signet' }).wallet, 'signet'), /^tb1q/);
    const ids = new Set([r0, r1, m1, deriveAccount(MASTER)].map((d) => d.identity.pubkey));
    assert.strictEqual(ids.size, 4);
    assert.match(r0.identity.id, /^id1/);
  });

  it('keeps identity, wallet, and cosigner keys apart', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const keys = new Set([
      a.identity.pubkey,
      a.cosigner.pubkey,
      a.wallet.segwit.key.pubkey,
      a.wallet.standard.key.pubkey
    ]);
    assert.strictEqual(keys.size, 4);
  });

  it('hands out addresses only from 84\' and watches every account', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const d = walletDescriptors(a.wallet);
    const s = a.wallet.segwit.xpub;
    const t = a.wallet.taproot.xpub;
    const l = a.wallet.standard.xpub;
    assert.strictEqual(d.receive, `wpkh(${s}/0/*)`);
    assert.strictEqual(d.change, `wpkh(${s}/1/*)`);
    assert.deepStrictEqual(d.watch, [
      `wpkh(${s}/0/*)`, `wpkh(${s}/1/*)`,
      `tr(${t}/0/*)`, `tr(${t}/1/*)`,
      `pkh(${l}/0/*)`, `pkh(${l}/1/*)`
    ]);
    const { taproot, ...withoutTaproot } = a.wallet;
    assert.ok(taproot);
    assert.strictEqual(walletDescriptors(withoutTaproot).watch.length, 4, 'a wallet from before 86\' still has a watch set');
    for (const descriptor of d.watch) assert.ok(!descriptor.includes('['), 'no key origin / fingerprint');
    assert.strictEqual(WALLET_GAP_LIMIT, 20);
  });

  it('shares account xpubs that point to no parent', function () {
    const header = (xpub) => {
      const bs58check = require('bs58check');
      const raw = (bs58check.default || bs58check).decode(xpub);
      return { depth: raw[4], fingerprint: Buffer.from(raw.subarray(5, 9)).toString('hex'), child: Buffer.from(raw.subarray(9, 13)).toString('hex') };
    };
    for (const network of ['mainnet', 'regtest']) {
      for (const account of [0, 1]) {
        const w = deriveAccount(MASTER, { account, network }).wallet;
        for (const xpub of [w.segwit.xpub, w.taproot.xpub, w.standard.xpub]) {
          assert.deepStrictEqual(header(xpub), { depth: 0, fingerprint: '00000000', child: '00000000' });
        }
      }
    }
    assert.throws(() => shareableAccountXpub(MASTER, 'mainnet'), /only public/);
  });

  it('swaps extended key versions between networks', function () {
    const a = deriveAccount(MASTER);
    const tpub = extendedKeyForNetwork(a.wallet.segwit.xpub, 'regtest');
    assert.match(tpub, /^tpub/);
    assert.strictEqual(extendedKeyForNetwork(tpub, 'mainnet'), a.wallet.segwit.xpub);
  });

  it('binds a cosigner key to an identity within a scope', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const b = deriveAccount(MASTER, { account: 1, network: 'regtest' });
    const scope = 'group:abc';
    const proof = cosignerProof(a.cosigner.key, { identityPubkey: a.identity.pubkey, scope });
    const params = { cosigner: a.cosigner.pubkey, identityPubkey: a.identity.pubkey, scope, proof };
    assert.strictEqual(verifyCosignerProof(params), true);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { scope: 'group:other' })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { identityPubkey: b.identity.pubkey })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { cosigner: b.cosigner.pubkey })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { proof: '00'.repeat(64) })), false);
  });

  it('seals only the master xprv; the lock password never changes keys', function () {
    const sealed = sealMaster(MASTER, LOCK);
    const json = JSON.stringify(sealed);
    assert.ok(!json.includes('xprv9s21'));
    assert.strictEqual(unsealMaster(sealed, LOCK), MASTER);
    assert.strictEqual(unsealMaster(sealMaster(MASTER, 'another lock pw'), 'another lock pw'), MASTER);
    assert.throws(() => unsealMaster(sealed, 'wrong password'));
  });

  it('refuses a tampered seal', function () {
    const sealed = sealMaster(MASTER, LOCK);
    const tampered = JSON.parse(JSON.stringify(sealed));
    const field = ['ciphertext', 'data', 'ct'].find((k) => typeof tampered[k] === 'string')
      || Object.keys(tampered).find((k) => typeof tampered[k] === 'string' && tampered[k].length > 40);
    const value = tampered[field];
    tampered[field] = (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
    assert.throws(() => unsealMaster(tampered, LOCK));
  });

  it('keeps a vault of the sealed master and public account views', function () {
    const vault = createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'regtest' });
    assert.ok(!JSON.stringify(vault).includes('xprv9s21'));
    assert.deepStrictEqual(vault.current, { account: 0, network: 'regtest' });
    const view = currentVaultAccount(vault);
    assert.strictEqual(view.identity.pubkey, deriveAccount(MASTER, { network: 'regtest' }).identity.pubkey);
    assert.strictEqual(view.wallet.receive, 'segwit');
    assert.strictEqual(view.cosigner.key, undefined);

    assert.throws(() => selectVaultAccount(vault, { account: 1, network: 'regtest' }), (err) => err.code === 'FABRIC_ACCOUNT_LOCKED');
    const master = unsealMaster(vault.seal, LOCK);
    const switched = selectVaultAccount(vault, { account: 1, network: 'signet', master, label: 'Alt' });
    assert.deepStrictEqual(switched.current, { account: 1, network: 'signet' });
    assert.strictEqual(currentVaultAccount(switched).label, 'Alt');
    const back = selectVaultAccount(switched, { account: 0, network: 'regtest' });
    assert.strictEqual(currentVaultAccount(back).identity.pubkey, view.identity.pubkey);
  });

  it('opens a vault only when its cached accounts match the master', function () {
    const master = unsealMaster(createAccountVault({ master: MASTER, lockPassword: LOCK }).seal, LOCK);
    const vault = selectVaultAccount(createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'regtest' }), { account: 1, network: 'signet', master });
    assert.strictEqual(openAccountVault(vault, LOCK), MASTER);
    assert.throws(() => openAccountVault(vault, 'wrong password'));

    const other = deriveAccount(importSeed(FIXTURE_SEED, 'TREZOR'), { network: 'regtest' });
    const swapped = JSON.parse(JSON.stringify(vault));
    swapped.accounts['regtest:0'].wallet.segwit.xpub = other.wallet.segwit.xpub;
    assert.throws(() => openAccountVault(swapped, LOCK), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');

    function sortKeys (value) {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
        return out;
      }
      return value;
    }
    assert.strictEqual(openAccountVault(sortKeys(JSON.parse(JSON.stringify(vault))), LOCK), MASTER);

    const moved = JSON.parse(JSON.stringify(vault));
    moved.accounts['regtest:5'] = moved.accounts['regtest:0'];
    assert.throws(() => verifyVaultAccounts(moved, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');

    const lost = JSON.parse(JSON.stringify(vault));
    lost.current = { account: 9, network: 'regtest' };
    assert.throws(() => verifyVaultAccounts(lost, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');
  });

  it('hands out addresses only from a vault view the master checked', function () {
    const vault = createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'mainnet' });
    const unverified = (err) => err.code === 'FABRIC_ACCOUNT_UNVERIFIED';

    const locked = currentVaultAccount(vault);
    assert.strictEqual(locked.verified, false);
    assert.strictEqual(locked.wallet.verified, false);
    assert.throws(() => walletReceiveAddress(locked.wallet, 'mainnet', 0), unverified);
    assert.throws(() => walletChangeAddress(locked.wallet, 'mainnet', 0), unverified);
    assert.strictEqual(walletDescriptors(locked.wallet).watch.length, 6, 'watch-only display still works');

    const master = openAccountVault(vault, LOCK);
    const open = currentVaultAccount(vault, master);
    assert.strictEqual(open.verified, true);
    assert.strictEqual(walletReceiveAddress(open.wallet, 'mainnet', 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.strictEqual(vault.accounts['mainnet:0'].verified, undefined, 'the stored cache is not marked');

    // A swapped xpub, even one stored as verified, never yields an address.
    const other = deriveAccount(importSeed(FIXTURE_SEED, 'TREZOR'), { network: 'mainnet' });
    const swapped = JSON.parse(JSON.stringify(vault));
    Object.assign(swapped.accounts['mainnet:0'], { verified: true });
    Object.assign(swapped.accounts['mainnet:0'].wallet, { verified: true, segwit: { path: other.wallet.segwit.path, xpub: other.wallet.segwit.xpub } });
    assert.throws(() => walletReceiveAddress(currentVaultAccount(swapped).wallet, 'mainnet', 0), unverified);
    assert.throws(() => currentVaultAccount(swapped, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');
  });
});

const PHRASE_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('@fabric/core/functions/fabricOperatorIdentity', function () {
  it('exclusiveOperatorKeySettings prefers xprv over mnemonic (Key is mnemonic-first)', function () {
    const fromMnemonic = new Key({ mnemonic: PHRASE_A });
    const fromXprv = new Key({ mnemonic: PHRASE_B });
    const mixed = { mnemonic: PHRASE_A, xprv: fromXprv.xprv };
    const naive = new Key(mixed);
    assert.strictEqual(naive.pubkey, fromMnemonic.pubkey, 'Key constructor still prefers mnemonic');
    const exclusive = exclusiveOperatorKeySettings(mixed);
    assert.strictEqual(exclusive.xprv, fromXprv.xprv);
    assert.strictEqual(exclusive.mnemonic, undefined);
    const resolved = new Key(exclusive);
    assert.strictEqual(resolved.pubkey, fromXprv.pubkey);
  });

  it('classifyFabricIdentityEnvValue accepts xprv, xpub, and compressed pubkey', function () {
    const k = new Key({ mnemonic: PHRASE_A });
    assert.strictEqual(classifyFabricIdentityEnvValue(k.xprv).kind, 'xprv');
    assert.strictEqual(classifyFabricIdentityEnvValue(k.xpub).kind, 'xpub');
    assert.strictEqual(classifyFabricIdentityEnvValue(k.pubkey).kind, 'pubkey');
  });

  it('keySettingsFromEnv treats public FABRIC_XPRV as watch-only', function () {
    const k = new Key({ mnemonic: PHRASE_A });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: k.xpub }), { xpub: k.xpub });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: k.pubkey }), { public: String(k.pubkey).toLowerCase() });
  });

  it('resolveFabricOperatorKeySettings uses FABRIC_XPRV before mnemonic env', function () {
    const k = new Key({ mnemonic: PHRASE_B });
    const resolved = resolveFabricOperatorKeySettings({
      FABRIC_XPRV: k.xprv,
      FABRIC_MNEMONIC: PHRASE_A
    }, { allowWalletFallback: false });
    assert.strictEqual(resolved.source, 'FABRIC_XPRV');
    assert.strictEqual(resolved.key.xprv, k.xprv);
    assert.strictEqual(resolved.key.mnemonic, undefined);
  });

  it('resolveFabricOperatorKeySettings falls back to FABRIC_XPUB / FABRIC_PUBKEY (watch-only)', function () {
    const k = new Key({ mnemonic: PHRASE_A });
    const fromXpub = resolveFabricOperatorKeySettings({
      FABRIC_XPUB: k.xpub
    }, { allowWalletFallback: false });
    assert.ok(fromXpub);
    assert.strictEqual(fromXpub.source, 'FABRIC_XPUB');
    assert.strictEqual(fromXpub.key.xpub, k.xpub);

    const fromPub = resolveFabricOperatorKeySettings({
      FABRIC_PUBKEY: k.pubkey
    }, { allowWalletFallback: false });
    assert.ok(fromPub);
    assert.strictEqual(fromPub.source, 'FABRIC_PUBKEY');
    assert.ok(fromPub.key.public);

    const xpubInXprvSlot = resolveFabricOperatorKeySettings({
      FABRIC_XPRV: k.xpub
    }, { allowWalletFallback: false });
    assert.strictEqual(xpubInXprvSlot.source, 'FABRIC_XPRV');
    assert.strictEqual(xpubInXprvSlot.key.xpub, k.xpub);
  });

  it('watch-only FABRIC_XPRV beats wallet.json fallback', function () {
    const watch = new Key({ mnemonic: PHRASE_A });
    const walletKey = new Key({ mnemonic: PHRASE_B });
    const orig = require('../functions/fabricWalletIdentity').loadIdentityFromWalletFile;
    const walletMod = require('../functions/fabricWalletIdentity');
    walletMod.loadIdentityFromWalletFile = function () {
      return { xprv: walletKey.xprv, xpub: walletKey.xpub };
    };
    try {
      const resolved = resolveFabricOperatorKeySettings({
        FABRIC_XPRV: watch.xpub,
        HOME: '/tmp/fabric-operator-identity-test-home'
      }, { allowWalletFallback: true });
      assert.ok(resolved);
      assert.strictEqual(resolved.source, 'FABRIC_XPRV');
      assert.strictEqual(resolved.key.xpub, watch.xpub);
      assert.strictEqual(resolved.key.xprv, undefined);
    } finally {
      walletMod.loadIdentityFromWalletFile = orig;
    }
  });
});
