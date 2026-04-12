'use strict';

const assert = require('assert');
const { blessedParamsFromJadeAttrs } = require('../../functions/wireJson');
const { fuzzIterations, randomUtf8String } = require('./helpers');

/**
 * Jade attr arrays are numeric-keyed lists of { name, val }. Fuzz mimics odd shapes.
 * Goal: no throw from blessedParamsFromJadeAttrs (UI / compiler path).
 */
describe('fuzz: blessedParamsFromJadeAttrs', function () {
  this.timeout(120000);

  it('survives random attr lists', function () {
    const n = fuzzIterations(500);
    for (let i = 0; i < n; i++) {
      const count = Math.floor(Math.random() * 12);
      const attrs = [];
      for (let j = 0; j < count; j++) {
        const name = randomUtf8String(24) || 'a';
        let val = randomUtf8String(80) || '{}';
        if (Math.random() < 0.25) val = `'${val}'`;
        if (Math.random() < 0.1) val = `'{'${randomUtf8String(20)}'}'`;
        attrs.push({ name, val });
      }
      try {
        blessedParamsFromJadeAttrs(attrs);
      } catch (e) {
        assert.fail(`blessedParamsFromJadeAttrs threw: ${e && e.message}`);
      }
    }
  });

  it('accepts undefined / empty', function () {
    const a = blessedParamsFromJadeAttrs(undefined);
    assert.deepStrictEqual(a.attrs, []);
    assert.strictEqual(Object.getPrototypeOf(a.params), null);
    assert.deepStrictEqual(Object.keys(a.params), []);
  });
});
