'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/remote', function () {
  describe('Remote', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Remote instanceof Function, true);
    });

    xit('can load OPTIONS', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote({
        host: 'google.com',
        port: 443
      });

      await server.start();

      let result = await remote._OPTIONS(`/`);

      await server.stop();

      console.log('remote:', remote);
      console.log('result:', result);
      // assert.equal(result.toString('utf8'), '');
    });

    // TODO: fix local options
    xit('can load OPTIONS from local server', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();
      let result = await remote._OPTIONS(`/`);
      await server.stop();

      assert.equal(result.status, 200);
    });

    xit('can load GET from local server', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();
      let result = await remote._GET(`/`);
      await server.stop();

      assert.equal(result.status, 200);
    });

    xit('can POST to local server', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();
      try {
        let result = await remote._POST(`/widgets`, { foo: 'bar' });
        console.log('result:', result);
      } catch (E) {
        console.error('Could not:', E);
      }
      await server.stop();

      assert.equal(result.status, 200);
    });
  });
});
