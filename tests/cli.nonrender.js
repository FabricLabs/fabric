'use strict';

const assert = require('assert');
const CLI = require('../types/cli');

describe('@fabric/core/types/cli (non-render guards)', function () {
  it('defaults to regtest with isolated datadir', function () {
    const cli = new CLI({ render: false });
    assert.strictEqual(cli.settings.bitcoin.network, 'regtest');
    assert.strictEqual(cli.settings.bitcoin.datadir, './stores/bitcoin-regtest');
    assert.strictEqual(cli.settings.lightning.network, 'regtest');
  });

  it('respects explicit mainnet network and isolates mainnet datadir', function () {
    const cli = new CLI({
      render: false,
      network: 'mainnet',
      bitcoin: { enable: false },
      lightning: { enable: false }
    });
    assert.strictEqual(cli.settings.bitcoin.network, 'mainnet');
    assert.strictEqual(cli.settings.bitcoin.datadir, './stores/bitcoin-mainnet');
    assert.strictEqual(cli.settings.lightning.network, 'mainnet');
  });

  it('supports explicit signet network with managed mode enabled by default', function () {
    const cli = new CLI({
      render: false,
      network: 'signet',
      bitcoin: { enable: false },
      lightning: { enable: false }
    });
    assert.strictEqual(cli.settings.bitcoin.network, 'signet');
    assert.strictEqual(cli.settings.bitcoin.datadir, './stores/bitcoin-signet');
    assert.strictEqual(cli.settings.bitcoin.managed, true);
  });

  it('does not touch UI elements during _syncUnspent when render=false', async function () {
    const cli = Object.create(CLI.prototype);
    cli.settings = { render: false };
    cli.bitcoin = {
      _listUnspent: async () => [{ txid: 'abc', amount: 1 }]
    };
    cli.commit = () => {};
    cli.elements = undefined;
    cli.screen = undefined;

    const result = await cli._syncUnspent();
    assert.strictEqual(result, cli);
  });

  it('does not touch UI elements during _syncLightningChannels when render=false', async function () {
    const cli = Object.create(CLI.prototype);
    cli.settings = { render: false };
    cli._state = { status: 'READY' };
    cli.lightning = { status: 'started' };
    cli.elements = undefined;

    const result = await cli._syncLightningChannels();
    assert.strictEqual(result, cli);
  });
});

