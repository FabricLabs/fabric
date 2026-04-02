'use strict';

const assert = require('assert');
const Text = require('../services/text');

describe('services/text', function () {
  it('tokenize splits on whitespace', function () {
    assert.deepStrictEqual(Text.tokenize('a  b\nc'), ['a', '', 'b', 'c']);
    assert.deepStrictEqual(Text.tokenize(''), ['']);
  });

  it('truncateMiddle delegates to shared helper', function () {
    assert.strictEqual(Text.truncateMiddle('hi', 10), 'hi');
    const out = Text.truncateMiddle('0123456789abcdef', 8, '…');
    assert.ok(out.includes('…'));
    assert.ok(out.length <= 8);
  });

  it('toRelativeTime labels past intervals', function () {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400 * 1000);
    assert.strictEqual(Text.toRelativeTime(twoDaysAgo), '2 days ago');
    const t = new Date();
    assert.strictEqual(Text.toRelativeTime(t), 'just now');
  });

  it('oxfordJoin delegates', function () {
    assert.strictEqual(Text.oxfordJoin(['a', 'b']), 'a and b');
    assert.strictEqual(Text.oxfordJoin(['a', 'b', 'c']), 'a, b, and c');
  });
});
