'use strict';

const Key = require('../types/key');
const assert = require('assert');

const message = require('../assets/message');
const playnet = require('../settings/playnet');

const BIP_32_TEST_VECTOR_SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

const BIP_84_TEST_VECTOR_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BIP_84_TEST_VECTOR_ZPRV = 'zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5';
const BIP_84_TEST_VECTOR_ZPUB = 'zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF';

// Account 0, root = m/84'/0'/0'
const BIP_84_TEST_VECTOR_XPRV = 'zprvAdG4iTXWBoARxkkzNpNh8r6Qag3irQB8PzEMkAFeTRXxHpbF9z4QgEvBRmfvqWvGp42t42nvgGpNgYSJA9iefm1yYNZKEm7z6qUWCroSQnE';
const BIP_84_TEST_VECTOR_XPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

 // Account 0, first receiving address = m/84'/0'/0'/0/0
const BIP_84_TEST_VECTOR_PRIVKEY = 'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d';
const BIP_84_TEST_VECTOR_PUBKEY = '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c';
const BIP_84_TEST_VECTOR_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

describe('@fabric/core/types/key', function () {
  this.timeout(30000);

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
      const key = new Key();
      const signature = key._sign(message['@data']);

      assert.ok(signature);
    });

    it('produces a valid signature', function () {
      const key = new Key();
      const signature = key._sign(message['@data']);
      const valid = key._verify(message['@data'], signature);
      assert.ok(valid);
    });

    it('can load from test vectors', function () {
      const key = new Key({
        purpose: 84,
        seed: BIP_84_TEST_VECTOR_SEED
      });

        // TODO: test against BIP_84_TEST_VECTOR_ZPRV
      assert.equal(key.public.encodeCompressed('hex'), '03d902f35f560e0470c63313c7369168d9d7df2d49bf295fd9fb7cb109ccee0494');
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

    xit('can generate p2tr addresses', function () {
      const key = new Key({ seed: playnet.key.seed });
      const target = key.deriveAddress(0, 0, 'p2tr');
      assert.equal(key.public.encodeCompressed('hex'), '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71');
      assert.equal(target.address, '1LDmxemmiVgiGbCAZ2zPKWsDRfM2shy7f9');
    });
  });
});
