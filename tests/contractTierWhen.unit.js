'use strict';

const assert = require('assert');
const { evaluateTierWhen, getPath } = require('../functions/contractTierWhen');

describe('contractTierWhen', function () {
  it('getPath reads own properties only', function () {
    const state = { a: { b: 1 } };
    assert.strictEqual(getPath(state, '/a/b'), 1);
    assert.strictEqual(getPath(state, '/__proto__'), undefined);
    assert.strictEqual(getPath(state, '/constructor'), undefined);
    const polluted = {};
    Object.defineProperty(polluted, '__proto__', { value: { pwned: true }, enumerable: true });
    assert.strictEqual(getPath(polluted, '/__proto__'), undefined);
    assert.strictEqual(getPath(polluted, '/__proto__/pwned'), undefined);
    assert.strictEqual(getPath(state, '/a/missing'), undefined);
    assert.strictEqual(getPath(null, '/a'), undefined);
  });

  it('evaluateTierWhen fails closed on empty or malformed when', function () {
    assert.strictEqual(evaluateTierWhen(null), true);
    assert.strictEqual(evaluateTierWhen({ allOf: [] }), false);
    assert.strictEqual(evaluateTierWhen({}), false);
    assert.strictEqual(evaluateTierWhen({ allOf: [{ op: 'unknown' }] }), false);
    assert.strictEqual(evaluateTierWhen({ allOf: [{ op: 'constructor' }] }), false);
    assert.strictEqual(evaluateTierWhen({ allOf: [{ op: 'toString' }] }), false);
    assert.strictEqual(evaluateTierWhen({ allOf: [{ op: 'valueOf' }] }), false);
    assert.strictEqual(evaluateTierWhen('nope'), false);
  });

  it('tipClockGte and statePathEq', function () {
    assert.strictEqual(evaluateTierWhen({
      allOf: [{ op: 'tipClockGte', value: 3 }]
    }, { tipClock: 3 }), true);
    assert.strictEqual(evaluateTierWhen({
      allOf: [{ op: 'tipClockGte', value: 4 }]
    }, { tipClock: 3 }), false);

    assert.strictEqual(evaluateTierWhen({
      allOf: [{ op: 'statePathEq', path: '/status', value: 'open' }]
    }, { contractState: { status: 'open' } }), true);

    assert.strictEqual(evaluateTierWhen({
      allOf: [{ op: 'statePathEq', path: '/status' }]
    }, { contractState: { status: 'open' } }), false);

    assert.strictEqual(evaluateTierWhen({
      allOf: [{ op: 'statePathEq', value: 'open' }]
    }, { contractState: { status: 'open' } }), false);
  });
});
