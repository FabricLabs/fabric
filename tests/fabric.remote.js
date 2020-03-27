'use strict';

const Fabric = require('../');
const assert = require('assert');

const http = require('http');

const Web = require(__dirname+'/fixtures/web'); //require('@fabric/http');


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
    it('can load OPTIONS from local server', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();
      let result = await remote._OPTIONS(`/`);
      await server.stop();

      assert.equal(result.status, 200);
    });

    it('can load GET from local server', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();
      let result = await remote._GET(`/`);
      await server.stop();

      assert.equal(result.status, 200);
    });

    it('can POST to local server', async function () {
      //let server = new Web.Server();

      const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({status:200}));
      });
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      //await server.start();
      server.listen(LOCAL_SERVER_CONFIG.port);

      let result = await remote._POST(`/widgets`, { foo: 'bar' });

      //await server.stop();

      assert.equal(result.status, 200);

      server.close(function() {
          console.log('We closed!');
      });
    });

    it('can PATCH to local server (new)', async function () {
      let server = new Web.Server();
      let remote = new Fabric.Remote(LOCAL_SERVER_CONFIG);

      await server.start();

      let result = await remote._POST(`/widgets`, { foo: 'bar' });
      let result2 = await remote._PATCH(`/widgets/${result.id || 0}`, { foo: 'bar' });

      await server.stop();

      assert.equal(result2.status, 200);
    });

  });
});
