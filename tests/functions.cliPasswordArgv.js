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

  it('does not consume a following long option as the password', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(['--password', '--force'], {}),
      ''
    );
  });

  it('accepts a separate value that begins with a single dash', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(['--password', '-secret'], {}),
      '-secret'
    );
  });

  it('treats explicit --password= as empty (no env fallback)', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(['--password='], { FABRIC_PASSWORD: 'from-env' }),
      ''
    );
  });

  it('stops option scanning at a standalone -- terminator', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(
        ['node', 'fabric', '--', '--password=positional'],
        { FABRIC_PASSWORD: 'from-env' }
      ),
      'from-env'
    );
  });

  it('does not fall back to env when --password is present without a value', function () {
    assert.strictEqual(
      readCliPasswordFromArgv(['--password'], { FABRIC_PASSWORD: 'from-env' }),
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
