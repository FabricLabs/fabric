'use strict';

const Fabric = require('../');
const assert = require('assert');

const Scribe = require('../types/scribe');

describe('@fabric/core/types/app', function () {
  describe('Scribe', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Scribe instanceof Function, true);
    });

    it('should expose a constructor', function () {
      assert(Scribe instanceof Function);
    });

    xit('should inherit to a stack', function () {
      const parent = new Scribe({ namespace: 'parent' });
      const scribe = new Scribe();

      scribe.inherits(parent);

      console.log('scribe stack:', scribe.stack);
      assert.equal(scribe.stack[0], 'parent');
    });

    xit('should log some series of tags', function () {
      const scribe = new Scribe();
      const result = scribe.log('debug', 'messaging', 'some data');

      assert.ok(result);
    });
  });
});
