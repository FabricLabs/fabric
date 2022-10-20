'use strict';

const fixtures = require('../fixtures');
const config = require('../settings/test');
const Actor = require('../types/actor');
const Hash256 = require('../types/hash256');
const Message = require('../types/message');
const Signer = require('../types/signer');

// Testing
const assert = require('assert');

describe('@fabric/core/types/signer', function () {
  describe('Signer', function () {
    it('should expose a constructor', function () {
      assert.equal(Signer instanceof Function, true);
    });    

    it('can start and stop cleanly', async function () {
      const signer = new Signer();
      await signer.start();
      assert.strictEqual(signer.status, 'STARTED');
      await signer.stop();
      assert.ok(signer);
    });

    it('can start and stop with the test configuration', async function () {
      const signer = new Signer(config);
      await signer.start();
      assert.strictEqual(signer.status, 'STARTED');
      await signer.stop();
      assert.ok(signer);
    });
  });
});
