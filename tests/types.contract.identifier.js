'use strict';

const assert = require('assert');
const {
  normalizeIdentifier,
  resolveIdentifier,
  stampIdentifier
} = require('../types/contract');

describe('Contract identifier (contractId rename prep)', function () {
  it('resolve prefers contractIdentifier over legacy contractId', function () {
    assert.strictEqual(resolveIdentifier({
      contractId: 'legacy',
      contractIdentifier: 'canonical'
    }), 'canonical');
    assert.strictEqual(resolveIdentifier({ contractId: 'only-legacy' }), 'only-legacy');
    assert.strictEqual(resolveIdentifier({}), null);
    assert.strictEqual(resolveIdentifier(null), null);
  });

  it('stamp writes both fields without dropping either', function () {
    const row = { contractId: 'old' };
    stampIdentifier(row, 'aa'.repeat(32));
    assert.strictEqual(row.contractIdentifier, 'aa'.repeat(32));
    assert.strictEqual(row.contractId, 'aa'.repeat(32));
  });

  it('normalize rejects empty strings', function () {
    assert.strictEqual(normalizeIdentifier('  '), null);
    assert.strictEqual(normalizeIdentifier('x'), 'x');
  });
});
