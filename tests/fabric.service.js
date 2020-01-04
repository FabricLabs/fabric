'use strict';

require('debug-trace')({ always: true });

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
      let service = new Service({
        name: 'Test'
      });

      assert.ok(service);
    });

    it('can start offering service', async function () {
      let service = new Service({
        name: 'fun'
      });

      try {
        await service.start().catch(handler);
        await service.stop().catch(handler);
      } catch (E) {
        console.error('Exception:', E);
      }

      assert.ok(service);
    });
  });
});
