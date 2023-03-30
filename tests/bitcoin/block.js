'use strict';

const assert = require('assert');
const Block = require('../../types/bitcoin/block');

const settings = require('../../settings/test');

describe('@fabric/core/types/bitcoin/block', function () {
  it('is available from @fabric/core', function () {
    assert.equal(Block instanceof Function, true);
  });

  it('creates an empty instance', function () {
    const block = new Block();
    assert.ok(block);
  });
});
