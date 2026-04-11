'use strict';

const assert = require('assert');
const fabricCanonicalJson = require('../../functions/fabricCanonicalJson');
const { fuzzIterations, randomAcyclicObject, randomUtf8String } = require('./helpers');

describe('fuzz: fabricCanonicalJson', function () {
  this.timeout(120000);

  it('acyclic random objects: throw only for documented reasons or succeed', function () {
    const n = fuzzIterations(400);
    for (let i = 0; i < n; i++) {
      const depth = Math.floor(Math.random() * 18) + 1;
      const obj = randomAcyclicObject(depth);
      try {
        const s = fabricCanonicalJson(obj);
        assert.ok(typeof s === 'string');
        JSON.parse(s);
      } catch (e) {
        assert.ok(e instanceof Error);
        assert.ok(
          /max nesting|BigInt|Symbol|JSON-safe|serializable/.test(e.message),
          `unexpected: ${e.message}`
        );
      }
    }
  });

  it('parse-then-canonicalize random JSON text when valid', function () {
    const n = fuzzIterations(300);
    for (let i = 0; i < n; i++) {
      const raw = randomUtf8String(400);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      try {
        const s = fabricCanonicalJson(parsed);
        JSON.parse(s);
      } catch (e) {
        assert.ok(e instanceof Error);
        assert.ok(
          /max nesting|BigInt|Symbol|JSON-safe|serializable/.test(e.message),
          `unexpected: ${e.message}`
        );
      }
    }
  });
});
