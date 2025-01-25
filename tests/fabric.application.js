'use strict';

const App = require('../types/app');

const assert = require('assert');
const expect = require('chai').expect;

describe('@fabric/core/types/app', function () {
  describe('App', function () {
    it('is available from @fabric/core', function () {
      assert.equal(App instanceof Function, true);
    });

    xit('should expose a constructor', function () {
      assert.equal(typeof App, 'function');
    });

    it('has a normal lifecycle', async function () {
      const app = new App();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('allow a Resource to be defined', async function () {
      const app = new App();
      app.define('Example', {
        components: {
          list: 'fabric-example-list',
          view: 'fabric-example-view'
        }
      });

      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('should create an application smoothly', async function () {
      const app = new App();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    xit('should load data from an oracle', async function () {
      const app = new App();
      const oracle = new Oracle({
        path: './data/oracle'
      });

      await app.start();
      await oracle.start();

      await oracle._load('./resources');
      await app._defer(oracle);
      // await app._explore();

      await app.stop();
      await oracle.stop();

      assert.ok(oracle);
      assert.ok(app);
    });
  });
});
