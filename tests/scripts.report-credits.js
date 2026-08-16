'use strict';

const assert = require('assert');
const path = require('path');
const {
  isLockNodeModulesPath,
  resolveLockPackageDir
} = require('../scripts/report-credits');

describe('scripts/report-credits lockfile paths', function () {
  const root = path.resolve('/tmp/fabric-credits-root');

  it('accepts only node_modules lockfile keys', function () {
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo'), true);
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo/node_modules/bar'), true);
    assert.strictEqual(isLockNodeModulesPath(''), false);
    assert.strictEqual(isLockNodeModulesPath('../etc'), false);
    assert.strictEqual(isLockNodeModulesPath('node_modules/../secret'), false);
  });

  it('resolves packages inside node_modules only', function () {
    const inside = resolveLockPackageDir(root, 'node_modules/foo');
    assert.ok(inside.endsWith(path.join('node_modules', 'foo')));
    assert.strictEqual(resolveLockPackageDir(root, 'stores/hub'), null);
    assert.strictEqual(resolveLockPackageDir(root, 'node_modules/../../etc'), null);
  });
});
