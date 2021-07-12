'use strict';

// Dependencies
const Key = require('../types/key');
const Session = require('../types/session');
const assert = require('assert');

describe('@fabric/core/types/session', function () {
  describe('Session', function () {
    it('is a constructor', function () {
      assert.equal(Session instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      let session = new Session();

      await session.start();
      await session.stop();

      assert.ok(session);
      assert.equal(session.status, 'stopped');
      assert.equal(session.clock, 1);
      assert.equal(session.messages.length, 1);
    });

    it('can append an arbitrary message', async function () {
      let session = new Session();
      let message = session.TypedMessage('arbitrary').buffer();

      await session.start();
      await session._appendMessage(message);
      await session.stop();

      assert.ok(session);
      assert.equal(session.status, 'stopped');
      assert.equal(session.clock, 2);
      assert.equal(session.messages.length, 2);
    });

    it('emits session message event', function (done) {
      async function test () {
        let session = new Session();
        let message = session.TypedMessage('arbitrary').buffer();

        session.on('message', function messageHandler (message) {
          if (message.data.id === 'e3e3b98c7423265cfa64ae4273ad4958deeaff518882ed1d04e0eb9738910d44') {
            assert.ok(message.data.id);
            assert.ok(message.data.signature);
            assert.equal(message.data.id.length, 64);
            done();
          }
        });

        await session.start();
        await session._appendMessage(message);
        await session.stop();

        assert.ok(session);
        assert.equal(session.status, 'stopped');
        assert.equal(session.clock, 2);
        assert.equal(session.messages.length, 2);
      }

      test();
    });
  });
});
