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

  it('toRelativeTime covers hours, minutes, seconds, weeks, months, years', function () {
    const past = (ms) => new Date(Date.now() - ms);
    assert.strictEqual(Text.toRelativeTime(past(45 * 1000)), '45 seconds ago');
    assert.strictEqual(Text.toRelativeTime(past(6 * 60 * 1000)), '6 minutes ago');
    assert.strictEqual(Text.toRelativeTime(past(4 * 3600 * 1000)), '4 hours ago');
    assert.strictEqual(Text.toRelativeTime(past(14 * 86400 * 1000)), '2 weeks ago');
    assert.strictEqual(Text.toRelativeTime(past(120 * 86400 * 1000)), '4 months ago');
    assert.strictEqual(Text.toRelativeTime(past(800 * 86400 * 1000)), '2 years ago');
  });

  it('oxfordJoin delegates', function () {
    assert.strictEqual(Text.oxfordJoin(['a', 'b']), 'a and b');
    assert.strictEqual(Text.oxfordJoin(['a', 'b', 'c']), 'a, b, and c');
  });
});
