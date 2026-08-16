'use strict';

const assert = require('assert');
const settings = require('../../fixtures');
const OP_ADVANCE_BLOCK = require('../../contracts/federation');

describe('@fabric/core/contracts/federation', function () {
  describe('OP_ADVANCE_BLOCK', function () {
    it('exports the block-advance opcode', function () {
      assert.strictEqual(typeof OP_ADVANCE_BLOCK, 'function');
    });

    it('wraps input as an Actor', function () {
      const out = OP_ADVANCE_BLOCK(settings);
      assert.ok(out);
      assert.ok(out.input);
      assert.ok(out.input.id);
      assert.match(String(out.input.id), /^[0-9a-f]{64}$/);
    });
  });
});
