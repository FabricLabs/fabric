'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Network = require('../types/network');

describe('@fabric/core/types/network', function () {
  it('constructs with merged settings', function () {
    const n = new Network({ foo: 1 });
    assert.ok(n instanceof Actor);
    assert.strictEqual(n.settings.foo, 1);
  });

  it('constructs with empty settings', function () {
    const n = new Network();
    assert.ok(n instanceof Actor);
    assert.deepStrictEqual(n.settings, {});
  });
});
