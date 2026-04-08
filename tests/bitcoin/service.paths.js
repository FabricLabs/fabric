'use strict';

const assert = require('assert');
const path = require('path');

const Bitcoin = require('../../services/bitcoin');

describe('@services/bitcoin path helpers', function () {
  it('resolveBitcoinDatadirForLocalAccess rejects relative escape from cwd', function () {
    assert.strictEqual(Bitcoin.resolveBitcoinDatadirForLocalAccess('../outside'), null);
  });

  it('resolveBitcoinDatadirForLocalAccess accepts safe relative path', function () {
    const got = Bitcoin.resolveBitcoinDatadirForLocalAccess('stores/bitcoin-regtest');
    assert.strictEqual(got, path.resolve(process.cwd(), 'stores/bitcoin-regtest'));
  });

  it('buildRegtestCookiePathList includes project regtest cookie and optional env path', function () {
    const list = Bitcoin.buildRegtestCookiePathList({
      envCookieFile: '/tmp/fabric-test-cookie',
      settingsDatadir: null
    });
    assert.ok(list.includes('/tmp/fabric-test-cookie'));
    assert.ok(list.some((p) => p.endsWith(path.join('stores', 'bitcoin-regtest', 'regtest', '.cookie'))));
  });

  it('cookiePathForChainSubtree joins datadir, chain, .cookie', function () {
    assert.strictEqual(
      Bitcoin.cookiePathForChainSubtree('/data', 'regtest'),
      path.join('/data', 'regtest', '.cookie')
    );
  });
});
