'use strict';

/**
 * Keeps {@link Lightning.CLN_RPC_METHODS} aligned with docs/LIGHTNING_COMPAT.md
 * and actual _makeRPCRequest('…') usage in services/lightning.js.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Lightning = require('../../services/lightning');

describe('@fabric/core/services/lightning CLN RPC surface', function () {
  it('exports CLN_RPC_METHODS sorted and unique', function () {
    const m = Lightning.CLN_RPC_METHODS;
    assert.ok(Array.isArray(m));
    assert.deepStrictEqual(m, [...m].sort());
    assert.strictEqual(new Set(m).size, m.length);
  });

  it('every _makeRPCRequest method in lightning.js appears in CLN_RPC_METHODS', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../services/lightning.js'), 'utf8');
    const re = /_makeRPCRequest\s*\(\s*['"]([^'"]+)['"]/g;
    const found = new Set();
    let match;
    while ((match = re.exec(src)) !== null) {
      found.add(match[1]);
    }
    const exported = new Set(Lightning.CLN_RPC_METHODS);
    for (const method of found) {
      assert.ok(exported.has(method), `Add "${method}" to Lightning.CLN_RPC_METHODS and docs/LIGHTNING_COMPAT.md`);
    }
    for (const method of exported) {
      assert.ok(found.has(method), `Remove stale "${method}" from CLN_RPC_METHODS or restore _makeRPCRequest call`);
    }
  });
});
