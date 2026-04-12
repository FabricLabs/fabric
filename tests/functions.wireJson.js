'use strict';

const assert = require('assert');
const { MAX_MESSAGE_SIZE } = require('../constants');
const {
  messageDataToString,
  tryParseJsonBounded,
  tryParseWireJson,
  tryParseWireJsonBody,
  tryParsePersistedJson,
  utf8FromPersistedRaw,
  parseJsonBounded,
  parsePersistedJson,
  blessedParamsFromJadeAttrs
} = require('../functions/wireJson');

describe('functions/wireJson', function () {
  it('messageDataToString normalizes null and non-strings', function () {
    assert.strictEqual(messageDataToString(null), '{}');
    assert.strictEqual(messageDataToString(undefined), '{}');
    assert.strictEqual(messageDataToString('{"a":1}'), '{"a":1}');
    assert.strictEqual(messageDataToString(Buffer.from('{}')), '{}');
  });

  it('tryParseWireJson accepts valid JSON within bound', function () {
    const pr = tryParseWireJson('{"type":"X","object":{}}');
    assert.strictEqual(pr.ok, true);
    assert.strictEqual(pr.value.type, 'X');
  });

  it('tryParseWireJson rejects oversize payloads (UTF-8 bytes)', function () {
    const huge = 'x'.repeat(MAX_MESSAGE_SIZE + 1);
    const pr = tryParseWireJson(huge);
    assert.strictEqual(pr.ok, false);
    assert.ok(/UTF-8 byte length|exceeds max/.test(pr.error.message));
  });

  it('tryParseWireJson rejects when UTF-8 bytes exceed bound even if code-unit length is smaller', function () {
    const unit = '𐀀';
    const n = Math.ceil((MAX_MESSAGE_SIZE + 1) / 4);
    const raw = unit.repeat(n);
    const pr = tryParseWireJson(raw);
    assert.strictEqual(pr.ok, false);
    assert.ok(/UTF-8 byte length/.test(pr.error.message));
  });

  it('tryParseJsonBounded uses caller maxChars', function () {
    const pr = tryParseJsonBounded('{}', 10);
    assert.strictEqual(pr.ok, true);
    const big = 'y'.repeat(11);
    const pr2 = tryParseJsonBounded(`{"a":"${big}"}`, 10);
    assert.strictEqual(pr2.ok, false);
  });

  it('tryParseWireJson fails closed on invalid JSON', function () {
    const pr = tryParseWireJson('{not json');
    assert.strictEqual(pr.ok, false);
  });

  it('parseJsonBounded throws like JSON.parse when invalid or oversize', function () {
    assert.strictEqual(parseJsonBounded('[]', 10).length, 0);
    assert.throws(() => parseJsonBounded('x'.repeat(11), 10), /exceeds max/);
    assert.throws(() => parseJsonBounded('{', 100), SyntaxError);
  });

  it('tryParseWireJsonBody treats empty as {}', function () {
    const pr = tryParseWireJsonBody('');
    assert.strictEqual(pr.ok, true);
    assert.deepStrictEqual(pr.value, {});
    const pr2 = tryParseWireJsonBody('{"a":1}');
    assert.strictEqual(pr2.ok, true);
    assert.strictEqual(pr2.value.a, 1);
  });

  it('tryParseWireJsonBody coerces non-string raw like wire handlers', function () {
    const pr = tryParseWireJsonBody(null);
    assert.strictEqual(pr.ok, true);
    assert.deepStrictEqual(pr.value, {});
    const prN = tryParseWireJsonBody(42);
    assert.strictEqual(prN.ok, true);
    assert.strictEqual(prN.value, 42);
  });

  it('tryParsePersistedJson and parsePersistedJson match persisted bound', function () {
    const pr = tryParsePersistedJson('{"x":true}');
    assert.strictEqual(pr.ok, true);
    assert.strictEqual(pr.value.x, true);
    assert.strictEqual(parsePersistedJson('[1]')[0], 1);
  });

  it('utf8FromPersistedRaw normalizes Buffer and null', function () {
    assert.strictEqual(utf8FromPersistedRaw(null), '');
    assert.strictEqual(utf8FromPersistedRaw(Buffer.from('ab', 'utf8')), 'ab');
    assert.strictEqual(utf8FromPersistedRaw('cd'), 'cd');
    assert.strictEqual(utf8FromPersistedRaw(99), '99');
  });

  it('blessedParamsFromJadeAttrs returns empty for missing attrs', function () {
    const { attrs, params } = blessedParamsFromJadeAttrs(undefined);
    assert.deepStrictEqual(attrs, []);
    assert.strictEqual(Object.getPrototypeOf(params), null);
    assert.deepStrictEqual(Object.keys(params), []);
  });

  it('blessedParamsFromJadeAttrs parses quoted JSON object attrs', function () {
    const { attrs, params } = blessedParamsFromJadeAttrs([
      { name: 'foo', val: '\'{"a":1}\'' }
    ]);
    assert.strictEqual(attrs.length, 1);
    assert.strictEqual(params.foo.a, 1);
  });

  it('blessedParamsFromJadeAttrs quoted empty string and valid JSON object in quotes', function () {
    const e = blessedParamsFromJadeAttrs([{ name: 'e', val: "''" }]);
    assert.strictEqual(e.params.e, '');
    const obj = blessedParamsFromJadeAttrs([{ name: 'j', val: "'{}'" }]);
    assert.deepStrictEqual(obj.params.j, {});
  });

  it('tryParseJsonBounded rejects non-string and invalid maxChars', function () {
    const a = tryParseJsonBounded(null, 10);
    assert.strictEqual(a.ok, false);
    assert.ok(a.error instanceof TypeError);
    const b = tryParseJsonBounded('{}', NaN);
    assert.strictEqual(b.ok, false);
    const c = tryParseJsonBounded('{}', -1);
    assert.strictEqual(c.ok, false);
    const inf = tryParseJsonBounded('{}', Infinity);
    assert.strictEqual(inf.ok, false);
    assert.ok(/maxChars/.test(inf.error.message));
  });

  it('blessedParamsFromJadeAttrs uses unquoted path when quotes are unbalanced', function () {
    const { params } = blessedParamsFromJadeAttrs([{ name: 'x', val: '\'truncated' }]);
    const pr = tryParsePersistedJson('\'truncated');
    assert.strictEqual(pr.ok, false);
    assert.strictEqual(params.x, '\'truncated');
  });

  it('blessedParamsFromJadeAttrs params object has null prototype (safe __proto__ key)', function () {
    const { params } = blessedParamsFromJadeAttrs([{ name: '__proto__', val: '"polluted"' }]);
    assert.strictEqual(Object.getPrototypeOf(params), null);
    assert.strictEqual(params.__proto__, 'polluted');
  });

  it('blessedParamsFromJadeAttrs skips bad entries and coerces val', function () {
    const sparse = [];
    sparse[0] = { name: 'a', val: '42' };
    sparse[2] = { name: 'b', val: 7 };
    const r0 = blessedParamsFromJadeAttrs(sparse);
    assert.strictEqual(r0.params.a, 42);
    assert.strictEqual(r0.params.b, 7);
    assert.strictEqual(r0.attrs.length, 2);

    const r1 = blessedParamsFromJadeAttrs([
      null,
      { name: null, val: 'x' },
      { name: 'q', val: '\'plain\'' }
    ]);
    assert.ok(!Object.prototype.hasOwnProperty.call(r1.params, 'null'));
    assert.strictEqual(r1.params.q, 'plain');

    const r2 = blessedParamsFromJadeAttrs([
      { name: 'bad', val: '\'{not json}\'' }
    ]);
    assert.strictEqual(r2.params.bad, '{not json}');
  });
});
