'use strict';

const assert = require('assert');
const {
  tryParseJsonBounded,
  tryParseWireJson,
  tryParseWireJsonBody,
  tryParsePersistedJson,
  utf8FromPersistedRaw,
  messageDataToString
} = require('../../functions/wireJson');
const { MAX_MESSAGE_SIZE, PERSISTED_JSON_MAX_CHARS } = require('../../constants');
const {
  fuzzIterations,
  randomWireLikeString,
  randomPersistedLikeString,
  randomBuffer
} = require('./helpers');

describe('fuzz: wire JSON parsers', function () {
  this.timeout(120000);

  it('tryParseWireJson / Body never throw', function () {
    const n = fuzzIterations(600);
    for (let i = 0; i < n; i++) {
      const s = randomWireLikeString();
      const a = tryParseWireJson(s);
      const b = tryParseWireJsonBody(s);
      assert.ok(typeof a.ok === 'boolean');
      assert.ok(typeof b.ok === 'boolean');
    }
  });

  it('tryParsePersistedJson never throws', function () {
    const n = fuzzIterations(400);
    for (let i = 0; i < n; i++) {
      const s = randomPersistedLikeString();
      const pr = tryParsePersistedJson(s);
      assert.ok(typeof pr.ok === 'boolean');
    }
  });

  it('tryParseJsonBounded respects maxChars', function () {
    const n = fuzzIterations(200);
    for (let i = 0; i < n; i++) {
      const maxC = Math.max(0, Math.floor(Math.random() * (MAX_MESSAGE_SIZE + 50)));
      const s = randomWireLikeString();
      const pr = tryParseJsonBounded(s, maxC);
      assert.ok(typeof pr.ok === 'boolean');
      if (s.length > maxC) assert.strictEqual(pr.ok, false);
    }
  });

  it('utf8FromPersistedRaw + messageDataToString are total', function () {
    const n = fuzzIterations(300);
    for (let i = 0; i < n; i++) {
      const raw = Math.random() < 0.5 ? randomBuffer(800) : randomPersistedLikeString();
      void utf8FromPersistedRaw(raw);
      void messageDataToString(raw);
      void messageDataToString(null);
    }
  });

  it('edge max sizes', function () {
    const okWire = tryParseWireJson('{}');
    assert.strictEqual(okWire.ok, true);
    const overWire = '{"p":"' + 'z'.repeat(MAX_MESSAGE_SIZE) + '"}';
    assert.ok(overWire.length > MAX_MESSAGE_SIZE);
    const prW = tryParseWireJson(overWire);
    assert.strictEqual(prW.ok, false);
    assert.ok(/exceeds maxChars/i.test(prW.error.message));

    const okP = tryParsePersistedJson('[]');
    assert.strictEqual(okP.ok, true);
    const inner = 'y'.repeat(PERSISTED_JSON_MAX_CHARS);
    const overP = '{"p":"' + inner + '"}';
    assert.ok(overP.length > PERSISTED_JSON_MAX_CHARS);
    const prP = tryParsePersistedJson(overP);
    assert.strictEqual(prP.ok, false);
    assert.ok(/exceeds maxChars/i.test(prP.error.message));
  });
});
