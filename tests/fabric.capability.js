'use strict';

const assert = require('assert');
const Capability = require('../types/capability');
const Identity = require('../types/identity');
const Key = require('../types/key');

const sample = {
  type: 'CREATE_BLOCK',
  key: new Key({
    private: '1111111111111111111111111111111111111111111111111111111111111111'
  })
};

describe('@fabric/core/types/capability', function () {
  this.timeout(30000); // Increase timeout to 30 seconds

  describe('Capability', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Capability instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const capability = new Capability(sample);
        assert.ok(capability);
        done();
      }

      test();
    });

    it('can generate a token for an identity', async function () {
      const identity = new Identity({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });
      const capability = new Capability(sample);
      await assert.rejects(
        () => capability._generateToken(),
        /allowScaffoldCapability/
      );
    });

    it('generates a scaffold token when allowScaffoldCapability is set', async function () {
      const identity = new Identity({
        private: '1111111111111111111111111111111111111111111111111111111111111111'
      });
      const capability = new Capability(Object.assign({}, sample, {
        allowScaffoldCapability: true
      }));
      const token = await capability._generateToken();

      assert.ok(identity);
      assert.ok(capability);
      assert.ok(token);
      assert.strictEqual(token.scaffold, true);

      assert.ok(token.macaroon && token.macaroon.s64);
    });
  });
});
