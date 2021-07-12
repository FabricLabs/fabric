'use strict';

const Actor = require('../types/actor');
const assert = require('assert');
const fs = require('fs');

const data = require('../settings/test');

describe('@fabric/core/types/actor', function () {
  describe('Actor', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Actor instanceof Function, true);
    });

    it('can smoothly create a new actor', function () {
      let actor = new Actor();
      assert.ok(actor);
    });

    it('can sign some data', function () {
      let actor = new Actor({
        content: 'Hello again, world!'
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, 'c9793947c211af0c48921172626683aec7591d0bf0210b282d68f5d82e599d73');
    });

    it('can sign some data with a known seed', function () {
      let actor = new Actor({
        content: 'Hello again, world!',
        seed: data.key.seed
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, 'ec23d93c07e7b479d19438b897e60010a615d68a6bb3ff4d50696cd3eeda945d');
    });
  });
});
