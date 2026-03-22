'use strict';

const assert = require('assert');
const truncateMiddle = require('../functions/truncateMiddle');

describe('functions/truncateMiddle', function () {
  it('returns short strings unchanged', function () {
    assert.strictEqual(truncateMiddle('ab', 10), 'ab');
  });

  it('truncates long strings with separator', function () {
    const s = '0123456789abcdef';
    const out = truncateMiddle(s, 8, '…');
    assert.ok(out.length <= 8);
    assert.ok(out.includes('…'));
  });
});
