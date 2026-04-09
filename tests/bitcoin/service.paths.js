'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Bitcoin = require('../../services/bitcoin');

describe('@services/bitcoin bitcoind cookie / datadir paths', function () {
  it('bitcoindChainDataDirSegment matches Core layout', function () {
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('mainnet'), '');
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('regtest'), 'regtest');
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('playnet'), 'regtest');
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('testnet'), 'testnet3');
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('testnet4'), 'testnet4');
    assert.strictEqual(Bitcoin.bitcoindChainDataDirSegment('signet'), 'signet');
  });

  it('cookiePathForBitcoind places .cookie in chain dir or datadir root', function () {
    assert.strictEqual(
      Bitcoin.cookiePathForBitcoind('/data', 'mainnet'),
      path.join('/data', '.cookie')
    );
    assert.strictEqual(
      Bitcoin.cookiePathForBitcoind('/data', 'regtest'),
      path.join('/data', 'regtest', '.cookie')
    );
  });

  it('resolveBitcoinDatadirForLocalAccess rejects relative escape from cwd', function () {
    assert.strictEqual(Bitcoin.resolveBitcoinDatadirForLocalAccess('../outside'), null);
  });

  it('resolveBitcoinCookieFileForLocalRead rejects relative escape from cwd', function () {
    assert.strictEqual(Bitcoin.resolveBitcoinCookieFileForLocalRead('../outside/.cookie'), null);
  });

  it('buildLocalCookieProbePaths omits unresolvable env cookie path', function () {
    const list = Bitcoin.buildLocalCookieProbePaths({
      network: 'regtest',
      envCookieFile: '../../outside/.cookie'
    });
    assert.ok(!list.some((p) => String(p).includes('outside')));
  });

  it('resolveBitcoinDatadirForLocalAccess accepts safe relative path', function () {
    const got = Bitcoin.resolveBitcoinDatadirForLocalAccess('stores/bitcoin-regtest');
    assert.strictEqual(got, path.resolve(process.cwd(), 'stores/bitcoin-regtest'));
  });

  it('buildLocalCookieProbePaths includes env path and project layout for regtest', function () {
    const list = Bitcoin.buildLocalCookieProbePaths({
      network: 'regtest',
      envCookieFile: '/tmp/fabric-test-cookie',
      settingsDatadir: null
    });
    assert.ok(list.includes('/tmp/fabric-test-cookie'));
    assert.ok(list.some((p) => p.endsWith(path.join('stores', 'bitcoin-regtest', 'regtest', '.cookie'))));
  });

  it('buildLocalCookieProbePaths includes mainnet project cookie', function () {
    const list = Bitcoin.buildLocalCookieProbePaths({
      network: 'mainnet',
      settingsDatadir: null,
      constraints: {}
    });
    assert.ok(list.some((p) => p.endsWith(path.join('stores', 'bitcoin-mainnet', '.cookie'))));
  });

  it('buildRegtestCookiePathList aliases regtest network probe', function () {
    const a = Bitcoin.buildRegtestCookiePathList({ envCookieFile: null, settingsDatadir: null });
    const b = Bitcoin.buildLocalCookieProbePaths({ network: 'regtest', settingsDatadir: null });
    assert.deepStrictEqual(a, b);
  });

  it('cookiePathForChainSubtree joins datadir, chain, .cookie (or root .cookie)', function () {
    assert.strictEqual(
      Bitcoin.cookiePathForChainSubtree('/data', 'regtest'),
      path.join('/data', 'regtest', '.cookie')
    );
    assert.strictEqual(Bitcoin.cookiePathForChainSubtree('/data', ''), path.join('/data', '.cookie'));
  });

  it('cookiePathForChainSubtree rejects unknown chain subdirectory', function () {
    assert.throws(
      () => Bitcoin.cookiePathForChainSubtree('/data', '../../../etc'),
      /unsupported chain subdirectory/
    );
  });

  it('parentDirNameForCookieProbe matches dirname basename for chain layout', function () {
    assert.strictEqual(Bitcoin.parentDirNameForCookieProbe('/foo/bar/regtest/.cookie'), 'regtest');
  });

  it('tryReadRpcCookieFileCredentials reads user:password from a .cookie file', async function () {
    const f = path.join(os.tmpdir(), `fabric-cookie-test-${process.pid}.cookie`);
    fs.writeFileSync(f, 'rpcuser:rpcpass', 'utf8');
    try {
      const creds = await Bitcoin.tryReadRpcCookieFileCredentials(f);
      assert.deepStrictEqual(creds, { username: 'rpcuser', password: 'rpcpass' });
    } finally {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });
});
