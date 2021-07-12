'use strict';

const assert = require('assert');
const settings = require('../settings/test');
const Actor = require('../types/actor');

describe('@fabric/core/types/actor', function () {
  describe('Actor', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Actor instanceof Function, true);
    });

    it('can smoothly create a new actor', function () {
      const actor = new Actor();
      assert.ok(actor);
    });

    it('can sign some data', function () {
      const actor = new Actor({
        content: 'Hello again, world!'
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '2ac9486cffac330ca9e2a748675b34676f27f1ba88582027fbfd2e1fbf4173b8');
    });

    it('can sign some data with a known seed', function () {
      const actor = new Actor({
        content: 'Hello again, world!',
        seed: settings.key.seed
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '127a647890f14e2c7449b1eb625c90baa6e1e9345a0d4c672b6549dec339c995');
    });
  });
});
