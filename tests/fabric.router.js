'use strict';

const assert = require('assert');
const Router = require('../types/router');

// TODO: test class/function middleware
const middleware = {
  name: 'example',
  value: 'Hello, world.'
};

const message = {
  actor: 'Tester',
  object: 'Some !example especially for this.',
  target: '/messages'
};

describe('@fabric/core/types/router', function () {
  describe('Router', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Router instanceof Function, true);
    });

    it('can start and stop cleanly', async function () {
      async function test () {
        const router = new Router();
        await router.start();
        await router.stop();
        assert.ok(router);
      }

      await test();
    });

    it('can use a middleware', async function () {
      async function test () {
        const router = new Router();
        router.use(middleware);

        await router.start();
        await router.stop();

        assert.ok(router);
      }

      await test();
    });

    it('can route a message', async function () {
      async function test () {
        const router = new Router();
        let response = null;
        router.use(middleware);

        await router.start();

        try {
          response = await router.route(message);
        } catch (exception) {
          assert.fail('Routing failed:', exception);
        }

        await router.stop();

        assert.ok(router);
        assert.ok(response);
      }

      await test();
    });
  });
});
