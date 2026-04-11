'use strict';

const assert = require('assert');
const Network = require('../types/network');

describe('@fabric/core/types/network', function () {
  it('constructs with merged settings', function () {
    const n = new Network({ foo: 1 });
    assert.strictEqual(n.settings.foo, 1);
  });

  it('constructs with empty settings', function () {
    const n = new Network();
    assert.deepStrictEqual(n.settings, {});
  });
});
