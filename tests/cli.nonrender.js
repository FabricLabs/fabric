'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
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

  it('does not forward retired flush-chain settings to the Peer node', function () {
    const cli = new CLI({
      render: false,
      bitcoin: { enable: false },
      lightning: { enable: false },
      flushChainMinTrustedScore: 650,
      flushChainAuthorizedPubkeys: ['ab'.repeat(32)]
    });
    assert.strictEqual(cli.node.settings.flushChainMinTrustedScore, undefined);
    assert.strictEqual(cli.node.settings.flushChainAuthorizedPubkeys, undefined);
    assert.strictEqual(typeof cli._handleFlushChainCli, 'undefined');
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

  it('does not print actor registrations unless debugging', async function () {
    async function register (debug) {
      const messages = [];
      const errors = [];
      const cli = new EventEmitter();
      cli.settings = { services: ['relay'], debug, verbosity: 1 };
      cli.services = {};
      cli._appendMessage = async (line) => { messages.push(String(line)); };
      cli._appendError = async (line) => { errors.push(String(line)); };
      cli._appendDebug = CLI.prototype._appendDebug;

      class Relay extends EventEmitter {
        async _registerActor (identity) {
          return { id: identity.id, secret: identity.secret, blob: 'x'.repeat(80) };
        }
      }

      CLI.prototype._registerService.call(cli, 'relay', Relay);
      cli.emit('identity', { id: 'actor-1', secret: 'do-not-print' });
      await new Promise((resolve) => setImmediate(resolve));
      return { messages, errors };
    }

    const quiet = await register(false);
    assert.deepStrictEqual(quiet.errors, []);
    assert.ok(!quiet.messages.some((line) => /Registered [Aa]ctor|Registering actor|do-not-print|xxxx/.test(line)));

    const verbose = await register(true);
    assert.deepStrictEqual(verbose.errors, []);
    assert.ok(verbose.messages.some((line) => line.includes('Registered actor on "relay": actor-1')));
    assert.ok(!verbose.messages.some((line) => /do-not-print|xxxx/.test(line)));
  });

  it('keeps startup to one line per listen, peer, and service', async function () {
    const lines = [];
    const cli = Object.create(CLI.prototype);
    cli.settings = { debug: false, verbosity: 3 };
    cli._appendMessage = (line) => { lines.push(String(line)); };
    cli._appendWarning = CLI.prototype._appendWarning;
    cli._appendDebug = CLI.prototype._appendDebug;
    cli._appendError = (line) => { lines.push('ERR ' + line); };
    cli.reconnectTimers = {};
    cli.reconnectAttempts = {};
    cli.peers = {};
    cli.connections = {};
    cli._state = { content: { bitcoin: {} } };
    cli.commit = () => {};
    cli.bitcoin = { height: 230 };
    cli._handleConnection = async () => {};
    cli._syncConnectionList = () => {};
    cli._syncPeerList = () => {};
    cli._syncChainDisplay = async () => {};
    cli._syncBalance = async () => {};

    await cli._handlePeerLog('Peer starting...');
    await cli._handlePeerLog('Listener starting...');
    await cli._handlePeerLog('Now listening on tcp://0.0.0.0:7777 [!!!]');
    await cli._handlePeerLog('Listener started!');
    await cli._handlePeerWarning('Networking enabled.  Connecting to peers: ["hub.fabric.pub:7777","goliath:7777"]');
    await cli._handlePeerWarning('Suppressing transient outbound socket error (ECONNREFUSED) from _connect() to hub.fabric.pub:7777.');
    await cli._handleConnectionClose({ address: 'hub.fabric.pub:7777', name: 'hub.fabric.pub:7777' });
    await cli._handleConnectionOpen({ address: 'gamma:7777', id: 'gamma:7777', url: 'tcp://gamma:7777' });
    await cli._handleBitcoinLog('[FABRIC:BITCOIN] Initial block download: transaction notifications paused until the node catches up');
    await cli._handleBitcoinLog('Beginning chain sync for height 230 with best block: 1354ca8b');
    await cli._handleBitcoinSync({ best: '1354ca8b', height: 230 });
    await cli._handleBitcoinReady({ id: '027d', tip: null });
    await cli._handleLightningReady({
      id: '89',
      type: 'FabricActor',
      object: { node: { alias: 'ANGRYTROUGH' }, balances: { total: 0 } }
    });
    await cli._handlePeerWarning('Socket timeout: connect goliath:7777 after 5000ms');
    await cli._handlePeerWarning('Socket error: Error: Socket timeout: connect goliath:7777 after 5000ms');
    await cli._handlePeerWarning('Socket timeout: connect pike:7777 after 5000ms');
    await cli._handlePeerWarning('Socket error: Error: Socket timeout: connect pike:7777 after 5000ms');
    await cli._handleConnectionClose({ address: 'pike:7777', name: 'pike:7777' });
    await cli._handleConnectionClose({ address: 'goliath:7777', name: 'goliath:7777' });
    await cli._handlePeerWarning('NOISE decrypt error: Error: noise_handshake_timeout (10000ms) (gamma:7777)');
    await cli._handlePeerWarning('NOISE encrypt error: Error: noise_handshake_timeout (10000ms) (gamma:7777)');
    await cli._handleConnectionClose({ address: 'gamma:7777', name: 'gamma:7777' });

    const plain = lines.map((line) => line.replace(/\{[^}]+\}/g, ''));
    assert.deepStrictEqual(plain, [
      'Listening on tcp://0.0.0.0:7777',
      'Could not connect to hub.fabric.pub:7777 (connection refused)',
      'Connected gamma:7777',
      'Bitcoin ready at height 230',
      'Lightning ready (ANGRYTROUGH)',
      'Could not connect to goliath:7777 (timeout)',
      'Could not connect to pike:7777 (timeout)',
      'Disconnected gamma:7777 (handshake timeout)'
    ]);
    assert.ok(!plain.some((line) => /\{|1354ca8b|ANGRYTROUGH",|balances|Registered Actor|Peer starting/.test(line)));
  });

  it('shows a modal while managed subprocesses stop', async function () {
    const frames = [];
    const exits = [];
    const origExit = process.exit;
    process.exit = (code) => { exits.push(code); };
    const cli = Object.create(CLI.prototype);
    cli.settings = {
      render: true,
      lightning: { enable: true },
      bitcoin: { enable: true }
    };
    cli.elements = {};
    cli.reconnectTimers = {};
    cli.screen = { render () {} };
    cli.node = { stop: async () => {} };
    cli._appendError = () => {};
    cli._renderShutdownModal = (steps) => {
      frames.push(steps.map((step) => `${step.name}=${step.state}`).join(','));
    };
    cli.lightning = {
      settings: { managed: true },
      _child: { pid: 1 },
      stop: async () => {}
    };
    cli.bitcoin = {
      _nodeProcess: { pid: 2 },
      stop: async () => {}
    };

    try {
      const text = cli._shutdownModalLines([
        { name: 'Lightning', state: 'stopping' },
        { name: 'Bitcoin', state: 'waiting' }
      ]).join('\n');
      assert.ok(text.startsWith('Waiting for subprocesses to stop.'));
      assert.ok(text.includes('Lightning'));
      assert.ok(text.includes('stopping'));
      assert.ok(text.includes('Bitcoin'));
      assert.ok(text.includes('waiting'));

      await cli.stop();
      assert.deepStrictEqual(frames, [
        'Lightning=waiting,Bitcoin=waiting',
        'Lightning=stopping,Bitcoin=waiting',
        'Lightning=stopped,Bitcoin=waiting',
        'Lightning=stopped,Bitcoin=stopping',
        'Lightning=stopped,Bitcoin=stopped'
      ]);
      assert.deepStrictEqual(exits, [0]);
    } finally {
      process.exit = origExit;
    }
  });

  it('does not draw a shutdown modal when no child process is running', async function () {
    const frames = [];
    const exits = [];
    const origExit = process.exit;
    process.exit = (code) => { exits.push(code); };
    const cli = Object.create(CLI.prototype);
    cli.settings = {
      render: true,
      lightning: { enable: true },
      bitcoin: { enable: true }
    };
    cli.elements = {};
    cli.reconnectTimers = {};
    cli.screen = { render () { frames.push('render'); } };
    cli.node = { stop: async () => {} };
    cli._appendError = () => {};
    cli.lightning = { settings: { managed: true }, stop: async () => {} };
    cli.bitcoin = { stop: async () => {} };

    try {
      await cli.stop();
      assert.deepStrictEqual(frames, []);
      assert.deepStrictEqual(exits, [0]);
    } finally {
      process.exit = origExit;
    }
  });

  it('ignores a second quit while subprocesses are still stopping', async function () {
    const exits = [];
    const origExit = process.exit;
    process.exit = (code) => { exits.push(code); };
    let release = () => {};
    const cli = Object.create(CLI.prototype);
    cli.settings = {
      render: false,
      lightning: { enable: true },
      bitcoin: { enable: false }
    };
    cli.reconnectTimers = {};
    cli.node = { stop: async () => {} };
    cli._appendError = () => {};
    cli.lightning = {
      settings: { managed: true },
      _child: { pid: 1 },
      stop: () => new Promise((resolve) => { release = resolve; })
    };

    try {
      const first = cli.stop();
      await cli.stop();
      assert.deepStrictEqual(exits, []);
      release();
      await first;
      assert.deepStrictEqual(exits, [0]);
    } finally {
      process.exit = origExit;
    }
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
    const fanout = [];
    cli.services = {
      bitcoin: { _send (msg) { fanout.push(['bitcoin', msg]); } },
      dead: { /* no _send */ }
    };
    cli.settings = { services: ['bitcoin', 'dead', 'missing'] };
    cli.elements = { form: { reset () {} } };
    cli.screen = { render () {} };

    cli._handleFormSubmit({ input: 'héllo 🌍' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'P2P_CHAT_MESSAGE');
    const body = messageDataToString(sent[0].raw ? sent[0].raw.data : sent[0].data);
    assert.strictEqual(body, 'héllo 🌍');
    assert.ok(lines.some((l) => /héllo/.test(l)));
    assert.ok(!body.startsWith('{'));
    assert.deepStrictEqual(fanout, [['bitcoin', { type: 'P2P_CHAT_MESSAGE', text: 'héllo 🌍' }]]);
  });

  it('reports rejected service._send promises without unhandled rejection', async function () {
    const errors = [];
    const cli = Object.create(CLI.prototype);
    cli.history = [];
    cli.key = new (require('../types/key'))();
    cli.node = {
      id: 'aa'.repeat(32),
      relayFrom () {}
    };
    cli._peerAliasByPubkey = {};
    cli._processInput = () => false;
    cli._appendMessage = () => {};
    cli._appendError = (line) => { errors.push(String(line)); };
    cli.setPane = () => {};
    cli.services = {
      bitcoin: {
        _send () {
          return Promise.reject(new Error('send failed'));
        }
      }
    };
    cli.settings = { services: ['bitcoin'] };
    cli.elements = { form: { reset () {} } };
    cli.screen = { render () {} };

    cli._handleFormSubmit({ input: 'ping' });
    await new Promise((r) => setImmediate(r));
    assert.ok(errors.some((e) => /bitcoin/i.test(e) && /send failed/i.test(e)));
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const http = require('http');
const { safeJoin, isRealpathInsideRoot, serveFile, handler } = require('../scripts/static-server');

class FakeResponse extends Writable {
  constructor () {
    super();
    this.headersSent = false;
    this.writeHeadCount = 0;
    this.destroyed = false;
  }

  writeHead () {
    this.writeHeadCount++;
    this.headersSent = true;
  }

  _write (chunk, encoding, callback) {
    callback();
  }

  destroy (err) {
    this.destroyed = true;
    return super.destroy(err);
  }
}

describe('scripts/static-server', function () {
  it('rejects malformed percent-encoding and path escape', function () {
    const root = path.resolve(os.tmpdir(), 'fabric-static-root');
    assert.strictEqual(safeJoin(root, '/%E0%A4%A'), null);
    assert.strictEqual(safeJoin(root, '/../etc/passwd'), null);
  });

  it('does not call writeHead after headers are sent', function (done) {
    const res = new FakeResponse();
    serveFile(res, path.join(os.tmpdir(), 'fabric-static-missing-' + Date.now()));
    setTimeout(() => {
      assert.ok(res.writeHeadCount >= 1);
      assert.strictEqual(res.writeHeadCount, 1);
      assert.strictEqual(res.destroyed, true);
      done();
    }, 80);
  });

  it('handler returns 403 for a malformed URI', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-h-'));
    const req = { url: '/%E0%A4%A' };
    const res = { statusCode: 0, writeHead (code) { this.statusCode = code; }, end () {} };
    handler(dir)(req, res);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(res.statusCode, 403);
  });

  it('rejects a symlink whose real path is outside the document root', function (done) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-out-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-in-'));
    const secret = path.join(outside, 'secret.txt');
    const leak = path.join(root, 'leak.txt');
    fs.writeFileSync(secret, 'nope');
    fs.symlinkSync(secret, leak);
    assert.strictEqual(isRealpathInsideRoot(root, leak), false);
    const server = http.createServer(handler(root));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}/leak.txt`, (res) => {
        const code = res.statusCode;
        res.resume();
        server.close(() => {
          fs.rmSync(root, { recursive: true, force: true });
          fs.rmSync(outside, { recursive: true, force: true });
          try {
            assert.strictEqual(code, 403);
            done();
          } catch (err) {
            done(err);
          }
        });
      }).on('error', (err) => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        done(err);
      });
    });
  });

  it('serves a symlink that stays inside the document root', function (done) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-static-ok-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<p>ok</p>');
    fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'alias.html'));
    assert.strictEqual(isRealpathInsideRoot(root, path.join(root, 'alias.html')), true);
    const server = http.createServer(handler(root));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}/alias.html`, (res) => {
        const code = res.statusCode;
        res.resume();
        server.close(() => {
          fs.rmSync(root, { recursive: true, force: true });
          try {
            assert.strictEqual(code, 200);
            done();
          } catch (err) {
            done(err);
          }
        });
      }).on('error', (err) => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
        done(err);
      });
    });
  });
});

const {
  isLockNodeModulesPath,
  resolveLockPackageDir
} = require('../scripts/report-credits');

describe('scripts/report-credits lockfile paths', function () {
  const root = path.resolve('/tmp/fabric-credits-root');

  it('accepts only node_modules lockfile keys', function () {
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo'), true);
    assert.strictEqual(isLockNodeModulesPath('node_modules/foo/node_modules/bar'), true);
    assert.strictEqual(isLockNodeModulesPath(''), false);
    assert.strictEqual(isLockNodeModulesPath('../etc'), false);
    assert.strictEqual(isLockNodeModulesPath('node_modules/../secret'), false);
  });

  it('resolves packages inside node_modules only', function () {
    const inside = resolveLockPackageDir(root, 'node_modules/foo');
    assert.ok(inside.endsWith(path.join('node_modules', 'foo')));
    assert.strictEqual(resolveLockPackageDir(root, 'stores/hub'), null);
    assert.strictEqual(resolveLockPackageDir(root, 'node_modules/../../etc'), null);
  });
});
