'use strict';

const assert = require('assert');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const { stableStringify } = require('../types/distributedExecution');

describe('functions/fabricCanonicalJson', function () {
  it('sorts object keys deterministically', function () {
    const a = fabricCanonicalJson({ z: 1, a: 2, m: { b: 1, a: 2 } });
    const b = fabricCanonicalJson({ m: { a: 2, b: 1 }, a: 2, z: 1 });
    assert.strictEqual(a, b);
    assert.strictEqual(a, '{"a":2,"m":{"a":2,"b":1},"z":1}');
  });

  it('encodes undefined as null (JSON-safe concatenation)', function () {
    assert.strictEqual(fabricCanonicalJson(undefined), 'null');
    assert.strictEqual(fabricCanonicalJson([1, undefined, 2]), '[1,null,2]');
  });

  it('matches distributedExecution stableStringify (beacon / federation binding)', function () {
    const payload = { version: 1, kind: 'BeaconEpoch', epoch: { h: 1, x: 2 } };
    assert.strictEqual(fabricCanonicalJson(payload), stableStringify(payload));
  });

  it('rejects BigInt and Symbol', function () {
    assert.throws(() => fabricCanonicalJson(1n), /BigInt/);
    assert.throws(() => fabricCanonicalJson(Symbol('x')), /Symbol/);
  });

  it('throws on excessive nesting (cycle / DoS)', function () {
    const a = {};
    let cur = a;
    for (let i = 0; i < 70; i++) {
      cur.n = {};
      cur = cur.n;
    }
    assert.throws(() => fabricCanonicalJson(a), /max nesting depth/);
  });
});
