'use strict';

const assert = require('assert');
const path = require('path');

const Bitcoin = require('../../services/bitcoin');
const regtestCookiePaths = require('../../functions/regtestCookiePaths');

describe('@services/bitcoin path helpers', function () {
  it('Bitcoin static helpers delegate to regtestCookiePaths (same results)', function () {
    assert.strictEqual(
      Bitcoin.resolveBitcoinDatadirForLocalAccess('stores/bitcoin-regtest'),
      regtestCookiePaths.resolveBitcoinDatadirForLocalAccess('stores/bitcoin-regtest')
    );
    assert.strictEqual(
      Bitcoin.cookiePathForChainSubtree('/d', 'regtest'),
      regtestCookiePaths.cookiePathForChainSubtree('/d', 'regtest')
    );
    assert.deepStrictEqual(
      Bitcoin.buildRegtestCookiePathList({ envCookieFile: '/x', settingsDatadir: null }),
      regtestCookiePaths.buildRegtestCookiePathList({ envCookieFile: '/x', settingsDatadir: null })
    );
  });

  it('resolveBitcoinDatadirForLocalAccess rejects relative escape from cwd', function () {
    assert.strictEqual(regtestCookiePaths.resolveBitcoinDatadirForLocalAccess('../outside'), null);
  });

  it('resolveBitcoinDatadirForLocalAccess accepts safe relative path', function () {
    const got = regtestCookiePaths.resolveBitcoinDatadirForLocalAccess('stores/bitcoin-regtest');
    assert.strictEqual(got, path.resolve(process.cwd(), 'stores/bitcoin-regtest'));
  });

  it('buildRegtestCookiePathList includes project regtest cookie and optional env path', function () {
    const list = regtestCookiePaths.buildRegtestCookiePathList({
      envCookieFile: '/tmp/fabric-test-cookie',
      settingsDatadir: null
    });
    assert.ok(list.includes('/tmp/fabric-test-cookie'));
    assert.ok(list.some((p) => p.endsWith(path.join('stores', 'bitcoin-regtest', 'regtest', '.cookie'))));
  });

  it('cookiePathForChainSubtree joins datadir, chain, .cookie', function () {
    assert.strictEqual(
      regtestCookiePaths.cookiePathForChainSubtree('/data', 'regtest'),
      path.join('/data', 'regtest', '.cookie')
    );
  });

  it('parentDirNameForCookieProbe matches dirname basename for regtest layout', function () {
    const p = '/foo/bar/regtest/.cookie';
    assert.strictEqual(regtestCookiePaths.parentDirNameForCookieProbe(p), 'regtest');
  });
});
