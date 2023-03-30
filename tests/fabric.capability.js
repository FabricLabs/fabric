'use strict';

const assert = require('assert');
const Capability = require('../types/capability');
const Identity = require('../types/identity');
const Signer = require('../types/signer');

const sample = {
  type: 'CREATE_BLOCK'
};

describe('@fabric/core/types/capability', function () {
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

    it('can generate a token for an identity', function (done) {
      async function test () {
        const identity = new Identity(sample);
        const capability = new Capability(sample);
        const token = await capability._generateToken();

        assert.ok(identity);
        assert.ok(capability);
        assert.ok(token);

        assert.strictEqual(token.macaroon.s64, '2RbOb5ti3EoIDOXUpmCVZHHxm4YNpCQrCFJyczHBAz0');

        done();
      }

      test();
    });
  });
});
