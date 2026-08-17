'use strict';

const assert = require('assert');
const CLI = require('../types/cli');

describe('@fabric/core/types/cli (non-render guards)', function () {
  // Constructing CLI pulls a large module graph; under full-suite CPU contention this can exceed the default timeout.
  this.timeout(30000);

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

  it('forwards flushChainMinTrustedScore from CLI settings to the Peer node', function () {
    const cli = new CLI({
      render: false,
      bitcoin: { enable: false },
      lightning: { enable: false },
      flushChainMinTrustedScore: 650
    });
    assert.strictEqual(cli.node.settings.flushChainMinTrustedScore, 650);
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

  it('redacts /unlock passwords from command history', function () {
    const cli = Object.create(CLI.prototype);
    cli.history = [];
    cli._appendMessage = () => {};
    cli._processInput = () => true;
    cli.elements = { form: { reset () {} } };
    cli.screen = { render () {} };
    cli._handleFormSubmit({ input: '/unlock secret-pass' });
    cli._handleFormSubmit({ input: '/wallet unlock also-secret' });
    cli._handleFormSubmit({ input: '/help' });
    assert.deepStrictEqual(cli.history, ['/unlock ***', '/wallet unlock ***', '/help']);
  });

  it('sends mesh shoutbox as UTF-8 P2P_CHAT_MESSAGE (not ChatMessage JSON)', function () {
    const Key = require('../types/key');
    const { messageDataToString } = require('../functions/wireJson');
    const sent = [];
    const lines = [];
    const cli = Object.create(CLI.prototype);
    cli.history = [];
    cli.key = new Key();
    cli.node = {
      id: 'aa'.repeat(32),
      relayFrom (_from, message) { sent.push(message); }
    };
    cli._peerAliasByPubkey = {};
    cli._processInput = () => false;
    cli._appendMessage = (line) => { lines.push(line); };
    cli.setPane = () => {};
    cli._sendToAllServices = () => {};
    cli.elements = { form: { reset () {} } };
    cli.screen = { render () {} };

    cli._handleFormSubmit({ input: 'héllo 🌍' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'P2P_CHAT_MESSAGE');
    const body = messageDataToString(sent[0].raw ? sent[0].raw.data : sent[0].data);
    assert.strictEqual(body, 'héllo 🌍');
    assert.ok(lines.some((l) => /héllo/.test(l)));
    assert.ok(!body.startsWith('{'));
  });

  it('renders Peer { text } + signer and P2P_PEER_ALIAS nicknames', async function () {
    const lines = [];
    const cli = Object.create(CLI.prototype);
    cli.node = { id: 'local' };
    cli._peerAliasByPubkey = {};
    cli._appendMessage = (line) => { lines.push(line); };

    const compressed = '02' + 'aa'.repeat(32);
    await cli._handlePeerAlias({ alias: 'neorion', signer: compressed });
    await cli._handlePeerChat(
      { text: 'from hub', type: 'P2P_CHAT_MESSAGE' },
      { signer: compressed }
    );
    assert.deepStrictEqual(lines, ['[neorion]: from hub']);
  });
});


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
