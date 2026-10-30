'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checkDownstream,
  findImports,
  resolvesInCore
} = require('../scripts/check-downstream-imports');

describe('scripts/check-downstream-imports', function () {
  let dir = null;

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-downstream-'));
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves paths that exist in core and refuses ones that do not', function () {
    assert.strictEqual(resolvesInCore('types/key'), true);
    assert.strictEqual(resolvesInCore('constants'), true);
    assert.strictEqual(resolvesInCore('functions/playnetChaosNeighbors'), true);
    assert.strictEqual(resolvesInCore('functions/fabricSiteLogin'), false);
    assert.strictEqual(resolvesInCore('../package.json'), false);
  });

  it('finds require, import, and dynamic import, and skips comments and generated trees', function () {
    fs.writeFileSync(path.join(dir, 'a.js'), [
      "const Key = require('@fabric/core/types/key');",
      "import Message from '@fabric/core/types/message';",
      "const later = import('@fabric/core/functions/fabricUri');",
      "// const Old = require('@fabric/core/types/stash');",
      ' * See `@fabric/core/types/offerBook`.',
      "const label = 'see @fabric/core/types/signer';"
    ].join('\n'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'b.js'), "require('@fabric/core/types/stash');");
    const found = findImports(dir).map((i) => i.subpath).sort();
    assert.deepStrictEqual(found, ['functions/fabricUri', 'types/key', 'types/message']);
  });

  it('reports imports that no longer resolve, with file and line', function () {
    fs.writeFileSync(path.join(dir, 'c.js'), "\nrequire('@fabric/core/functions/fabricSiteLogin');\n");
    const report = checkDownstream([dir]);
    assert.strictEqual(report.missing.length, 1);
    assert.strictEqual(report.missing[0].file, 'c.js');
    assert.strictEqual(report.missing[0].line, 2);
    assert.strictEqual(report.missing[0].subpath, 'functions/fabricSiteLogin');
  });
});
