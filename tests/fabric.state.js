'use strict';

const Fabric = require('../');
const assert = require('assert');

describe('@fabric/core/types/state', function () {
  describe('State', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Fabric.State instanceof Function, true);
    });

    xit('provides an accurate "@id" attribute', function () {
      let state = new Fabric.State(message['@data']);

      assert.ok(state);
      assert.equal(state.id, message['@id']);
    });

    xit('can serialize to a sane element', function () {
      let state = new Fabric.State(message['@data']);

      assert.ok(state);
      assert.equal(state.id, message['@id']);
      assert.equal(state.serialize(), JSON.stringify(message['@data']));
    });

    xit('can deserialize from a string', function () {
      let state = Fabric.State.fromString(JSON.stringify(message['@data']));

      assert.ok(state);
      assert.equal(state.id, message['@id']);
      assert.equal(state.serialize(), JSON.stringify(message['@data']));
    });
  });
});
