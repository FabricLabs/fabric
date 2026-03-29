'use strict';

const { FabricShell } = require('../types/service');

const assert = require('assert');
const expect = require('chai').expect;

describe('@fabric/core/types/service (FabricShell)', function () {
  describe('FabricShell', function () {
    this.timeout(5000);

    it('is available from @fabric/core', function () {
      assert.equal(FabricShell instanceof Function, true);
    });

    it('should expose a constructor', function () {
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

    it('should defer to an oracle authority', async function () {
      const app = new FabricShell();
      const oracle = { id: 'test-oracle' };
      app.attach({});

      await app.start();
      await app.defer(oracle);

      await app.stop();

      assert.ok(oracle);
      assert.ok(app);
    });
  });
});
