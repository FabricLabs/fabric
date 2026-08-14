'use strict';

const assert = require('assert');
const { readCliPasswordFromArgv } = require('../functions/cliPasswordArgv');

describe('@fabric/core/functions/cliPasswordArgv', function () {
  it('reads --password=VALUE and --password VALUE', function () {
    assert.strictEqual(readCliPasswordFromArgv(['node', 'fabric', '--password=secret=ok'], {}), 'secret=ok');
    assert.strictEqual(
      readCliPasswordFromArgv(['node', 'fabric', '--password', 'separate'], {}),
      'separate'
    );
  });

  it('prefers the inline form and ignores a following flag', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(['--password', '--force'], {}),
      ''
    );
  });

  it('falls back to FABRIC_PASSWORD only (not generic PASSWORD)', function () {
    assert.strictEqual(
      readCliPasswordFromArgv([], { FABRIC_PASSWORD: 'from-env', PASSWORD: 'generic' }),
      'from-env'
    );
    assert.strictEqual(
      readCliPasswordFromArgv([], { PASSWORD: 'generic' }),
      ''
    );
  });
});
