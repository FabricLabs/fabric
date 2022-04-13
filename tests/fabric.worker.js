'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/worker', function () {
  describe('Worker', function () {
    xit('is available from @fabric/core', function () {
      assert.equal(Fabric.Worker instanceof Function, true);
    });

    xit('can handle a task', async function () {
      const worker = new Fabric.Worker();
      const result = await worker.compute(1);
      console.log('worker:', worker);
      console.log('result:', result);
    });
  });
});
