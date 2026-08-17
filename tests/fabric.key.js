'use strict';

const Key = require('../types/key');
const assert = require('assert');
const { networks: bitcoinNetworks } = require('bitcoinjs-lib');
const networks = Object.assign({ mainnet: bitcoinNetworks.bitcoin }, bitcoinNetworks);
const { secp256k1, schnorr: nobleSchnorr } = require('@noble/curves/secp256k1.js');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

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
      const key = new Key({ private: SAMPLE.private });
      const message1 = 'test message 1';
      const message2 = 'test message 2';
      const signature1 = key.signSchnorr(message1);
      const signature2 = key.signSchnorr(message2);
      assert.ok(!signature1.equals(signature2), 'distinct messages must not share signature bytes');
      assert.strictEqual(key.verifySchnorr(message1, signature1), true);
      assert.strictEqual(key.verifySchnorr(message2, signature1), false);
      assert.strictEqual(key.verifySchnorr(message1, signature2), false);
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

    it('Schnorr signatures match noble BIP340 with zero auxRand', function () {
      const key = new Key({ private: SAMPLE.private });
      const message = 'Hello, Fabric!';
      const signature = key.signSchnorr(message);
      const messageHash = require('crypto').createHash('sha256').update(Buffer.from(message)).digest();
      const expected = Buffer.from(
        nobleSchnorr.sign(messageHash, Buffer.from(SAMPLE.private, 'hex'), Buffer.alloc(32))
      );
      assert.ok(signature.equals(expected));
      assert.strictEqual(key.verifySchnorr(message, signature), true);
      assert.strictEqual(key.verifySchnorr('Hello, World!', signature), false);
    });

    it('rejects a Schnorr signature from a different key', function () {
      const key1 = new Key({ private: SAMPLE.private });
      const key2 = new Key({ seed: SAMPLE.seed });
      const message = 'Hello, Fabric!';
      const signature = key1.signSchnorr(message);
      assert.strictEqual(key1.verifySchnorr(message, signature), true);
      assert.strictEqual(key2.verifySchnorr(message, signature), false);
    });

    it('throws when signing without private key using Schnorr', function () {
      const key = new Key();
      const publicKey = new Key({ public: key.public.encodeCompressed() });
      const message = 'test message';
      assert.throws(() => publicKey.signSchnorr(message), /Cannot sign without private key/);
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
      const sig = key.signSchnorr('byte-like private key');
      assert.ok(Buffer.isBuffer(sig));
      assert.strictEqual(sig.length, 64);
    });

    it('throws on invalid private key format', function () {
      const key = new Key();
      key.private = 1;
      assert.throws(() => key.signSchnorr('invalid private key'), /Invalid private key format/);
    });

    it('rejects non-hex string private key values', function () {
      const key = new Key();
      key.private = 'z'.repeat(32);
      assert.throws(() => key.signSchnorr('invalid private key'), /Invalid private key format/);
    });

    it('rejects plain array-like private key objects', function () {
      const key = new Key();
      key.private = { length: 32 };
      assert.throws(() => key.signSchnorr('invalid private key'), /Invalid private key format/);
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
  xOnlyHex,
  startFields
} = require('../functions/musig2Session');

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
