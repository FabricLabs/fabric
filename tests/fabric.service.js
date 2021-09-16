'use strict';

// Testing
const assert = require('assert');
const Fabric = require('../');

const config = require('../settings/test');
const handler = require('../functions/handleException');
const Service = require('../types/service');

describe('@fabric/core/types/service', function () {
  describe('Service', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Service instanceof Function, true);
    });

    it('can create an instance', async function provenance () {
      const service = new Service({
        name: 'Test'
      });

      assert.ok(service);
    });

    it('can start offering service', async function () {
      let service = new Service({
        name: 'fun'
      });

      try {
        await service.start();
      } catch (E) {
        console.error('Exception starting:', E);
      }

      try {
        await service.stop();
      } catch (E) {
        console.error('Exception stopping:', E);
      }

      assert.ok(service);
    });
  });

  describe('_POST()', function () {
    it('can call _POST successfully', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      await service.stop();
      assert.strictEqual(link, '/examples/e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });

    it('provides a valid collection index', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET('/examples');
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.ok(service);
    });

    it('provides the posted document in the expected location', async function () {
      const service = new Service();
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET(link);
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.address, 'e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });
  });
});
