'use strict';

const assert = require('assert');
const CLI = require('../types/cli');

describe('@fabric/core/types/cli (non-render guards)', function () {
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

