'use strict';

const assert = require('assert');
const {
  normalizeContractIdentifier,
  resolveContractIdentifier,
  stampContractIdentifier
} = require('../functions/contractIdentifier');

describe('@fabric/core/functions/contractIdentifier (rename prep)', function () {
  it('resolve prefers contractIdentifier over legacy contractId', function () {
    assert.strictEqual(resolveContractIdentifier({
      contractId: 'legacy',
      contractIdentifier: 'canonical'
    }), 'canonical');
    assert.strictEqual(resolveContractIdentifier({ contractId: 'only-legacy' }), 'only-legacy');
    assert.strictEqual(resolveContractIdentifier({}), null);
    assert.strictEqual(resolveContractIdentifier(null), null);
  });

  it('stamp writes both fields without dropping either', function () {
    const row = { contractId: 'old' };
    stampContractIdentifier(row, 'aa'.repeat(32));
    assert.strictEqual(row.contractIdentifier, 'aa'.repeat(32));
    assert.strictEqual(row.contractId, 'aa'.repeat(32));
  });

  it('normalize rejects empty strings', function () {
    assert.strictEqual(normalizeContractIdentifier('  '), null);
    assert.strictEqual(normalizeContractIdentifier('x'), 'x');
  });
});
