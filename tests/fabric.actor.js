'use strict';

const Actor = require('../types/actor');
const assert = require('assert');

const data = require('../settings/test');

describe('@fabric/core/types/actor', function () {
  describe('Actor', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Actor instanceof Function, true);
    });

    it('can smoothly create a new actor', function () {
      const actor = new Actor();
      assert.ok(actor);
      assert.ok(actor.id);
    });

    it('provides a risk indicator when seed is provided', function () {
      const actor = new Actor({
        content: 'Hello again, world!',
        seed: data.key.seed
      });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '127a647890f14e2c7449b1eb625c90baa6e1e9345a0d4c672b6549dec339c995');
      assert.strictEqual(actor.private, true);
    });

    it('can uniquely identify some known string', function () {
      const actor = new Actor('Hello again, world!');

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.id);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '34b2898c0bb136a12db724d359ca2e514d927f7396e8d214b72afd7d8f68bce5');
    });

    it('can uniquely identify some known object', function () {
      const actor = new Actor({ content: 'Hello again, world!' });

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, '2ac9486cffac330ca9e2a748675b34676f27f1ba88582027fbfd2e1fbf4173b8');
    });

    it('can uniquely identify some known buffer', function () {
      const buffer = Buffer.from('Hello again, world!', 'utf8');
      const actor = new Actor(buffer);

      actor.sign();

      assert.ok(actor);
      assert.ok(actor.signature);
      assert.strictEqual(actor.id, 'a417d5bea019922f709acc60e62ec6a0de875c8838009a676fbe89c1d4b8745c');
    });
  });
});
