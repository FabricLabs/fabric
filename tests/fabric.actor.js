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
      assert.strictEqual(actor.id, '4fc21835a13a9e1fb1471c68ba47412bd8bd905bf58900e47042a6a45ec15e91');
    });

    it('can sign some data with a known seed', function () {
      let actor = new Actor({
        content: 'Hello again, world!',
        seed: data.key.seed
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '9d8a516d046906b237d664ad1ea7545c18028b74efe49685f145ff56b584b336');
    });
  });
});
