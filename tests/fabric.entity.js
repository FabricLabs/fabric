'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/entity', function () {
  describe('Entity', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.Entity instanceof Function, true);
    });

    it('can generate a known string', function () {
      let entity = new Fabric.Entity({ foo: 'bar' });
      assert.equal(entity.toString(), '{"foo":"bar"}');
    });

    it('can generate a known buffer', function () {
      let entity = new Fabric.Entity({ foo: 'bar' });
      assert.equal(entity.toBuffer(), '{"foo":"bar"}');
    });
  });
});
