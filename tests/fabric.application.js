'use strict';

const { FabricShell } = require('../types/service');

const assert = require('assert');
const expect = require('chai').expect;

describe('@fabric/core/types/service (FabricShell)', function () {
  describe('FabricShell', function () {
    this.timeout(10000);

    it('is available from @fabric/core', function () {
      assert.equal(FabricShell instanceof Function, true);
    });

    xit('should expose a constructor', function () {
      assert.equal(typeof FabricShell, 'function');
    });

    it('has a normal lifecycle', async function () {
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    it('allow a Resource to be defined', async function () {
      const app = new FabricShell();
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
      const app = new FabricShell();
      await app.start();
      await app.stop();
      assert.ok(app);
    });

    xit('should load data from an oracle', async function () {
      const app = new FabricShell();
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
