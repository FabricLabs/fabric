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
      assert.ok(actor.id);
    });

    it('can adopt changes', function () {
      const actor = new Actor({ activity: 'SLEEPING' });

      actor.adopt([
        { op: 'replace', path: '/activity', value: 'WAKING' }
      ]);

      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.state.activity, 'WAKING');
    });

    xit('provides a risk indicator when seed is provided', function () {
      const actor = new Actor({
        content: 'Hello again, world!',
        seed: settings.key.seed
      });

      assert.ok(actor);
      assert.strictEqual(actor.id, '127a647890f14e2c7449b1eb625c90baa6e1e9345a0d4c672b6549dec339c995');
      assert.strictEqual(actor.private, true);
    });

    it('can uniquely identify some known string', function () {
      const actor = new Actor('Hello again, world!');
      assert.ok(actor);
      assert.ok(actor.id);
      assert.strictEqual(actor.id, '7e5ef12f0db57e49860ef60ae7c0e9d58b2a752bbdb4c294264632d1779cfab9');
    });

    it('can uniquely identify some known object', function () {
      const actor = new Actor({ content: 'Hello again, world!' });
      assert.ok(actor);
      assert.strictEqual(actor.id, '38e96125d9b89162ffc5ee7decbc23974decfdb9c1fee2f730c31a75fa97e2c3');
    });

    it('can uniquely identify some known buffer', function () {
      const buffer = Buffer.from('Hello again, world!', 'utf8');
      const actor = new Actor(buffer);
      assert.ok(actor);
      assert.strictEqual(actor.id, '13f9dd809443f334da56da92f11ccc0f62a69979dc083053aa400bfbf297db68');
    });
  });
});
