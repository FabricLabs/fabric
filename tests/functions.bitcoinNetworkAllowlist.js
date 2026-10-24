'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const { TEST_NETWORKS, normalizeNetworkName, isTestNetwork, assertTestNetwork } = require('../functions/bitcoinNetworkAllowlist');
const { networkForFabricName } = require('../functions/contractTaproot');
const Channel = require('../types/channel');

describe('@fabric/core/functions/bitcoinNetworkAllowlist', function () {
  it('allows only regtest / signet / testnet / testnet4 (trimmed, case-insensitive)', function () {
    assert.deepStrictEqual([...TEST_NETWORKS], ['regtest', 'signet', 'testnet', 'testnet4']);
    for (const name of ['regtest', ' Regtest ', 'SIGNET', 'testnet', '\ttestnet4\n']) assert.strictEqual(isTestNetwork(name), true, name);
    for (const name of ['mainnet', 'main', 'bitcoin', 'livenet', 'Mainnet ', '', null, undefined, 'regtestx', 'test net']) {
      assert.strictEqual(isTestNetwork(name), false, String(name));
    }
    assert.strictEqual(normalizeNetworkName('  TestNet4 '), 'testnet4');
    assert.strictEqual(assertTestNetwork(' SigNet ', 'x'), 'signet');
    assert.throws(() => assertTestNetwork('bitcoin', 'Channel'), /Channel: network "bitcoin" refused .*mainnet refused/);
    assert.throws(() => assertTestNetwork('', 'Channel'), /refused/);
  });

  it('maps test networks to bitcoinjs parameters without falling back to mainnet', function () {
    assert.strictEqual(networkForFabricName(' REGTEST '), bitcoin.networks.regtest);
    assert.strictEqual(networkForFabricName('testnet4'), bitcoin.networks.testnet);
    assert.strictEqual(networkForFabricName('Signet'), bitcoin.networks.testnet);
  });

  it('guards channel construction', function () {
    const pub = '02' + '11'.repeat(32);
    const other = '03' + '22'.repeat(32);
    for (const network of ['mainnet', 'bitcoin', 'main', ' Mainnet ', 'nonsense']) {
      assert.throws(() => Channel.buildFunding({ network, localPubkey: pub, remotePubkey: other, expireAfter: 10 }), /refused/, network);
    }
    assert.throws(() => new Channel.Book({ localPrivateKey: Buffer.alloc(32, 1), network: 'bitcoin' }), /refused/);
    assert.strictEqual(new Channel.Book({ localPrivateKey: Buffer.alloc(32, 1), network: ' RegTest ' }).network, 'regtest');
  });
});
