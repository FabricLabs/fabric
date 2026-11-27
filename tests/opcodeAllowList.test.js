'use strict';

const assert = require('assert');
const {
  normalizeOpcodeAllowList,
  opcodesFromGenesis,
  assertStepsAllowed
} = require('../functions/opcodeAllowList');

describe('opcodeAllowList', function () {
  it('normalizes and dedupes', function () {
    assert.deepStrictEqual(
      normalizeOpcodeAllowList([' OP_TRUE ', 'OP_TRUE', '', 'OP_ADD']),
      ['OP_TRUE', 'OP_ADD']
    );
  });

  it('opcodesFromGenesis prefers primitives.opcodes', function () {
    assert.deepStrictEqual(
      opcodesFromGenesis({
        primitives: { opcodes: ['OP_A'] },
        opcodes: ['OP_B']
      }),
      ['OP_A']
    );
    assert.deepStrictEqual(opcodesFromGenesis({ opcodes: ['OP_B'] }), ['OP_B']);
    assert.deepStrictEqual(opcodesFromGenesis({}), []);
  });

  it('assertStepsAllowed fails closed', function () {
    assert.strictEqual(assertStepsAllowed(['OP_TRUE'], ['OP_TRUE']).ok, true);
    const bad = assertStepsAllowed(['OP_TRUE'], ['OP_TRUE', 'OP_EVIL']);
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.unknown, ['OP_EVIL']);
  });
});
