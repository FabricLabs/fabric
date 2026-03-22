'use strict';

const assert = require('assert');
const Witness = require('../types/witness');

const sample = {
  data: 'Hello, world!'
};

describe('@fabric/core/types/witness', function () {
  describe('Witness', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Witness instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const witness = new Witness(sample);
        assert.ok(witness);
        done();
      }

      test();
    });

    it('digest and hash agree for string data', function () {
      const w = new Witness({ data: 'abc' });
      assert.strictEqual(w.digest('abc'), w.hash);
    });

    it('sign and verify round-trip', function () {
      const w = new Witness({ data: 'payload' });
      const sig = w.signature;
      assert.ok(sig.r && sig.s);
      const v = w.verify('payload', sig);
      assert.strictEqual(v.verifies, true);
      assert.strictEqual(v.pubkey, w.pubkey);
    });

    it('accepts hex private key in keypair settings', function () {
      const priv = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const w = new Witness({ keypair: { private: priv } });
      assert.ok(w.keypair.privateKey);
      assert.strictEqual(w.keypair.privateKey.length, 32);
    });

    it('accepts public-only keypair (signature accessor requires private)', function () {
      const Key = require('../types/key');
      const k = new Key();
      const w = new Witness({ keypair: { public: k.pubkey } });
      assert.throws(() => w.signature, /Uint8Array/);
    });

    it('lock returns frozen instance', function () {
      const w = new Witness(sample);
      const locked = w.lock();
      assert.strictEqual(locked, w);
      assert.strictEqual(Object.isFrozen(w), true);
    });

    it('loads non-string data via JSON.stringify', function () {
      const w = new Witness({ data: { hello: 'world' } });
      assert.strictEqual(typeof w.data, 'string');
      assert.ok(w.data.includes('hello'));
    });
  });
});
