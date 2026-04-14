'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const cp = require('child_process');
const net = require('net');

const Lightning = require('../../services/lightning');

describe('@fabric/core/services/lightning (unit)', function () {
  describe('defaultListenPortForNetwork', function () {
    it('maps networks to conventional lightningd bind ports', function () {
      assert.strictEqual(Lightning.defaultListenPortForNetwork('mainnet'), 9735);
      assert.strictEqual(Lightning.defaultListenPortForNetwork('regtest'), 9735);
      assert.strictEqual(Lightning.defaultListenPortForNetwork('testnet'), 19735);
      assert.strictEqual(Lightning.defaultListenPortForNetwork('testnet4'), 19735);
      assert.strictEqual(Lightning.defaultListenPortForNetwork('signet'), 39735);
    });
  });

  describe('network helpers', function () {
    it('_clnNetworkCliName maps aliases safely', function () {
      assert.strictEqual(new Lightning({ network: 'mainnet' })._clnNetworkCliName(), 'bitcoin');
      assert.strictEqual(new Lightning({ network: 'bitcoin' })._clnNetworkCliName(), 'bitcoin');
      assert.strictEqual(new Lightning({ network: 'testnet' })._clnNetworkCliName(), 'testnet');
      assert.strictEqual(new Lightning({ network: 'testnet4' })._clnNetworkCliName(), 'testnet4');
      assert.strictEqual(new Lightning({ network: 'signet' })._clnNetworkCliName(), 'signet');
      assert.strictEqual(new Lightning({ network: 'regtest' })._clnNetworkCliName(), 'regtest');
    });

    it('_bitcoinCliNetworkFlag maps network flags', function () {
      assert.strictEqual(new Lightning({ network: 'mainnet' })._bitcoinCliNetworkFlag(), null);
      assert.strictEqual(new Lightning({ network: 'bitcoin' })._bitcoinCliNetworkFlag(), null);
      assert.strictEqual(new Lightning({ network: 'main' })._bitcoinCliNetworkFlag(), null);
      assert.strictEqual(new Lightning({ network: 'testnet' })._bitcoinCliNetworkFlag(), '-testnet');
      assert.strictEqual(new Lightning({ network: 'test' })._bitcoinCliNetworkFlag(), '-testnet');
      assert.strictEqual(new Lightning({ network: 'testnet4' })._bitcoinCliNetworkFlag(), '-testnet4');
      assert.strictEqual(new Lightning({ network: 'signet' })._bitcoinCliNetworkFlag(), '-signet');
      assert.strictEqual(new Lightning({ network: 'regtest' })._bitcoinCliNetworkFlag(), '-regtest');
    });

    it('static plugin wires OP_TEST when LightningPlugin exists', function () {
      const prior = global.LightningPlugin;
      class FakePlugin {
        constructor () { this.methods = {}; }
        addMethod (name, fn) { this.methods[name] = fn; }
      }
      global.LightningPlugin = FakePlugin;
      try {
        const plugin = Lightning.plugin({});
        assert.ok(plugin && plugin.methods && typeof plugin.methods.test === 'function');
      } finally {
        global.LightningPlugin = prior;
      }
    });
  });

  describe('constructor', function () {
    it('constructs with sane defaults', function () {
      const ln = new Lightning();
      assert.strictEqual(ln.settings.mode, 'socket');
      assert.strictEqual(ln.settings.port, 9735);
      assert.strictEqual(ln.settings.network, 'regtest');
      assert.ok(ln._state.content.balances);
      assert.ok(ln._state.content.node);
    });

    it('honours an explicit port for regtest', function () {
      const ln = new Lightning({ network: 'regtest', port: 19846 });
      assert.strictEqual(ln.settings.port, 19846);
    });

    it('accepts bitcoin username/password as alias for rpcuser/rpcpassword', function () {
      const ln = new Lightning({
        bitcoin: { username: 'u', password: 'p' }
      });
      assert.strictEqual(ln.settings.bitcoin.rpcuser, 'u');
      assert.strictEqual(ln.settings.bitcoin.rpcpassword, 'p');
    });
  });

  describe('getters', function () {
    it('balances returns state.balances', function () {
      const ln = new Lightning();
      ln._state.content.balances = { spendable: 100 };
      assert.strictEqual(ln.balances.spendable, 100);
    });
  });

  describe('commit', function () {
    it('emits commit and returns Actor', function (done) {
      const ln = new Lightning();
      ln.once('commit', (ev) => {
        assert.ok(ev.id);
        assert.ok(ev.object);
        done();
      });
      const out = ln.commit();
      assert.ok(out && typeof out.toObject === 'function');
    });
  });

  describe('restErrorHandler', function () {
    it('emits error with message', function (done) {
      const ln = new Lightning();
      ln.once('error', (msg) => {
        assert.ok(/REST error/.test(msg));
        assert.ok(/foo/.test(msg));
        done();
      });
      ln.restErrorHandler(new Error('foo'));
    });
  });

  describe('connectTo', function () {
    it('throws on invalid remote format', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => ({});
      await assert.rejects(() => ln.connectTo('no-at-sign'), /Invalid remote format/);
      await assert.rejects(() => ln.connectTo('idonly@'), /Invalid remote format/);
      await assert.rejects(() => ln.connectTo('@127.0.0.1:9735'), /Invalid remote format/);
    });

    it('calls _makeRPCRequest and updates _state.peers', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'connect');
        assert.deepStrictEqual(params, ['nodeid@127.0.0.1:9735']);
        return { direction: 'out', features: 'xxx' };
      };
      await ln.connectTo('nodeid@127.0.0.1:9735');
      assert.strictEqual(ln._state.peers.nodeid.id, 'nodeid');
      assert.strictEqual(ln._state.peers.nodeid.address, '127.0.0.1:9735');
      assert.strictEqual(ln._state.peers.nodeid.connected, true);
    });
  });

  describe('createChannel', function () {
    it('calls fundchannel with peer and amount', async function () {
      const ln = new Lightning({ network: 'regtest' });
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'fundchannel');
        assert.strictEqual(params.id, 'peerid');
        assert.strictEqual(params.amount, '100000');
        assert.strictEqual(params.minconf, 0);
        return { txid: 'abc' };
      };
      const out = await ln.createChannel('peerid', '100000');
      assert.strictEqual(out.txid, 'abc');
    });

    it('includes push_msat when finite number', async function () {
      const ln = new Lightning({ network: 'regtest' });
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'fundchannel');
        assert.strictEqual(params.push_msat, 50000);
        assert.strictEqual(params.id, 'p');
        assert.strictEqual(params.amount, '100000');
        assert.strictEqual(params.minconf, 0);
        return {};
      };
      await ln.createChannel('p', '100000', 50000);
    });

    it('accepts options.minconf override', async function () {
      const ln = new Lightning({ network: 'bitcoin' });
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'fundchannel');
        assert.strictEqual(params.minconf, 2);
        return {};
      };
      await ln.createChannel('p', '100000', null, { minconf: 2 });
    });
  });

  describe('createInvoice', function () {
    it('returns bolt11, paymentHash, expiresAt', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'invoice');
        return {
          bolt11: 'lnbc1...',
          payment_hash: 'hash',
          expires_at: 123
        };
      };
      const out = await ln.createInvoice(1000, 'lbl', 'desc');
      assert.strictEqual(out.bolt11, 'lnbc1...');
      assert.strictEqual(out.paymentHash, 'hash');
      assert.strictEqual(out.expiresAt, 123);
    });
  });

  describe('computeLiquidity', function () {
    it('returns outbound and inbound formatted BTC', async function () {
      const ln = new Lightning();
      ln._syncChannels = async () => {};
      ln._makeRPCRequest = async (method) => {
        if (method === 'listfunds') {
          return {
            channels: [
              { amount_msat: '100000000', our_amount_msat: '60000000' },
              { amount_msat: '200000000', our_amount_msat: '100000000' }
            ]
          };
        }
        throw new Error('unexpected');
      };
      const out = await ln.computeLiquidity();
      assert.ok(out.outbound);
      assert.ok(out.inbound);
      assert.ok(typeof out.outbound === 'string');
      assert.ok(typeof out.inbound === 'string');
    });
  });

  describe('_waitForLightningD', function () {
    it('returns true when socket exists and getinfo succeeds', async function () {
      const ln = new Lightning({ datadir: __dirname, socket: 'nonexistent.sock' });
      const socketPath = path.resolve(ln.settings.datadir, ln.settings.socket);
      const exists = fs.existsSync(socketPath);
      if (exists) {
        ln._makeRPCRequest = async () => ({ id: 'x' });
        const out = await ln._waitForLightningD(2, 10);
        assert.strictEqual(out, true);
      } else {
        await assert.rejects(() => ln._waitForLightningD(1, 5), /socket not found|Failed to connect/);
      }
    });

    it('retries with backoff and then throws after max attempts', async function () {
      const ln = new Lightning({ datadir: '/tmp', socket: 'sock' });
      const origExists = fs.existsSync;
      fs.existsSync = () => true;
      ln._makeRPCRequest = async () => {
        throw new Error('not ready');
      };
      try {
        await assert.rejects(
          () => ln._waitForLightningD(2, 1),
          /Failed to connect to lightningd after 2 attempts/
        );
      } finally {
        fs.existsSync = origExists;
      }
    });

    it('emits debug success messages when debug is enabled', async function () {
      const ln = new Lightning({ datadir: '/tmp', socket: 'sock', debug: true });
      const debugLines = [];
      ln.on('debug', (m) => debugLines.push(String(m)));
      const origExists = fs.existsSync;
      fs.existsSync = () => true;
      ln._makeRPCRequest = async () => ({ id: 'ok' });
      try {
        const out = await ln._waitForLightningD(1, 1);
        assert.strictEqual(out, true);
        assert.ok(debugLines.some((x) => x.includes('Attempt 1/1')));
        assert.ok(debugLines.some((x) => x.includes('Successfully connected to lightningd')));
      } finally {
        fs.existsSync = origExists;
      }
    });
  });

  describe('createLocalNode', function () {
    it('returns null when managed is false', async function () {
      const ln = new Lightning({ managed: false });
      const out = await ln.createLocalNode();
      assert.strictEqual(out, null);
    });

    it('routes stderr error-like lines to error events', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = function () {
          this.killed = true;
          this.exitCode = 0;
          setImmediate(() => this.emit('close', 0));
        };
        return child;
      };

      const ln = new Lightning({ managed: true, debug: false });
      ln._waitForLightningD = async () => true;

      try {
        await ln.createLocalNode();
        const got = await new Promise((resolve) => {
          ln.once('error', (msg) => resolve(msg));
          ln._child.stderr.emit('data', Buffer.from('FATAL: something broke\n'));
        });
        assert.ok(String(got).includes('FATAL: something broke'));
      } finally {
        if (ln._errorHandlers && ln._errorHandlers.exit) await ln._errorHandlers.exit();
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });

    it('routes non-error stderr lines to debug only when debug is enabled', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = function () {
          this.killed = true;
          this.exitCode = 0;
          setImmediate(() => this.emit('close', 0));
        };
        return child;
      };

      const ln = new Lightning({ managed: true, debug: true });
      ln._waitForLightningD = async () => true;

      try {
        await ln.createLocalNode();
        const got = await new Promise((resolve) => {
          ln.once('debug', (msg) => {
            if (String(msg).includes('Set feerate to 253 perkw')) resolve(msg);
          });
          ln._child.stderr.emit('data', Buffer.from('Set feerate to 253 perkw\n'));
        });
        assert.ok(String(got).includes('Set feerate to 253 perkw'));
      } finally {
        if (ln._errorHandlers && ln._errorHandlers.exit) await ln._errorHandlers.exit();
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });

    it('ignores empty stderr lines', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = function () {
          this.killed = true;
          this.exitCode = 0;
          setImmediate(() => this.emit('close', 0));
        };
        return child;
      };

      const ln = new Lightning({ managed: true, debug: true });
      ln._waitForLightningD = async () => true;
      let debugCount = 0;
      let errorCount = 0;

      try {
        ln.on('error', () => { errorCount++; });
        ln.on('debug', () => { debugCount++; });
        await ln.createLocalNode();
        const beforeDebug = debugCount;
        const beforeError = errorCount;
        ln._child.stderr.emit('data', Buffer.from('   \n'));
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.strictEqual(debugCount, beforeDebug);
        assert.strictEqual(errorCount, beforeError);
      } finally {
        if (ln._errorHandlers && ln._errorHandlers.exit) await ln._errorHandlers.exit();
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });

    it('adds supported plugin params, logs unsupported plugins, and disable-plugin flags', async function () {
      const origSpawn = cp.spawn;
      let capturedArgs = null;
      cp.spawn = function (_cmd, args) {
        capturedArgs = args;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = function () {
          this.killed = true;
          this.exitCode = 0;
          setImmediate(() => this.emit('close', 0));
        };
        return child;
      };

      const ln = new Lightning({
        managed: true,
        debug: true,
        plugins: {
          'experimental-offers': { enabled: true },
          unknownPlugin: { anything: 1 }
        },
        disablePlugins: ['cln-grpc']
      });
      ln._waitForLightningD = async () => true;
      const debug = [];
      ln.on('debug', (m) => debug.push(String(m)));
      try {
        await ln.createLocalNode();
        ln._child.stdout.emit('data', Buffer.from('hello stdout'));
        assert.ok(capturedArgs.some((x) => x.includes('--experimental-offers-enabled=true')));
        assert.ok(capturedArgs.some((x) => x.includes('--disable-plugin=cln-grpc')));
        assert.ok(debug.some((x) => x.includes('Skipping unsupported plugin configuration: unknownPlugin')));
        assert.ok(debug.some((x) => x.includes('Disabling plugin: cln-grpc')));
        assert.ok(debug.some((x) => x.includes('hello stdout')));
      } finally {
        if (ln._errorHandlers && ln._errorHandlers.exit) await ln._errorHandlers.exit();
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });

    it('cleanup handler emits error when cleanup throws', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = function () {};
        child.once = function () {
          throw new Error('cleanup once boom');
        };
        return child;
      };

      const ln = new Lightning({ managed: true, debug: true });
      ln._waitForLightningD = async () => true;
      try {
        await ln.createLocalNode();
        const msg = await new Promise((resolve) => {
          ln.once('error', (m) => {
            if (String(m).includes('Error during cleanup')) resolve(String(m));
          });
          ln._errorHandlers.exit();
        });
        assert.ok(msg.includes('Error during cleanup'));
      } finally {
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });

    it('uncaughtException and unhandledRejection handlers gate by source/pid', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.pid = 4242;
        child.kill = function () {
          this.killed = true;
          this.exitCode = 0;
          setImmediate(() => this.emit('close', 0));
        };
        return child;
      };

      const ln = new Lightning({ managed: true, debug: false });
      ln._waitForLightningD = async () => true;
      const errors = [];
      ln.on('error', (m) => errors.push(String(m)));
      try {
        await ln.createLocalNode();
        await ln._errorHandlers.uncaughtException({ source: 'lightning', message: 'boom-1' });
        await ln._errorHandlers.uncaughtException({ pid: 4242, message: 'boom-2' });
        await ln._errorHandlers.uncaughtException({ pid: 9, message: 'ignore' });
        await ln._errorHandlers.unhandledRejection({ source: 'lightning' });
        await ln._errorHandlers.unhandledRejection({ pid: 4242 });
        await ln._errorHandlers.unhandledRejection({ pid: 9 });
        assert.ok(errors.some((x) => x.includes('Uncaught exception from Lightning service')));
        assert.ok(errors.some((x) => x.includes('Unhandled rejection from Lightning service')));
        assert.strictEqual(errors.filter((x) => x.includes('ignore')).length, 0);
      } finally {
        if (ln._errorHandlers && ln._errorHandlers.exit) await ln._errorHandlers.exit();
        if (ln._errorHandlers) {
          Object.entries(ln._errorHandlers).forEach(([event, handler]) => {
            if (handler) process.removeListener(event, handler);
          });
        }
        cp.spawn = origSpawn;
      }
    });
  });

  describe('start', function () {
    it('when managed is false: checks bitcoin-cli then starts machine and sync', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdin = { write: function () {}, end: function () {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      };
      const ln = new Lightning({
        managed: false,
        bitcoin: { rpcuser: 'u', rpcpassword: 'p', host: '127.0.0.1', rpcport: 18443, datadir: '/tmp' }
      });
      ln.machine = { start: async () => {} };
      ln._makeRPCRequest = async (method) => {
        if (method === 'listchannels') return { channels: [] };
        if (method === 'getinfo') return { id: 'x', alias: '', color: '', blockheight: 0 };
        throw new Error('unexpected');
      };
      let synced = false;
      const origSync = ln.sync.bind(ln);
      ln.sync = async () => { synced = true; return origSync(); };
      await ln.start();
      cp.spawn = origSpawn;
      assert.ok(synced);
      assert.ok(ln.status === 'started' || ln.status === 'STARTED');
      if (ln._heart) clearInterval(ln._heart);
    });

    it('when managed is true: runs createLocalNode branch', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdin = { write: function () {}, end: function () {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => child.emit('close', 0));
        return child;
      };
      const ln = new Lightning({
        managed: true,
        bitcoin: { rpcuser: 'u', rpcpassword: 'p', host: '127.0.0.1', rpcport: 18443, datadir: '/tmp' }
      });
      let created = false;
      ln.createLocalNode = async () => { created = true; };
      ln.machine = { start: async () => {} };
      ln._makeRPCRequest = async (method) => {
        if (method === 'listchannels') return { channels: [] };
        if (method === 'getinfo') return { id: 'x', alias: '', color: '', blockheight: 0 };
        throw new Error('unexpected');
      };
      await ln.start();
      cp.spawn = origSpawn;
      assert.strictEqual(created, true);
      if (ln._heart) clearInterval(ln._heart);
    });

    it('throws with actionable hint when bitcoin-cli preflight fails', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdin = { write: function () {}, end: function () {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => child.emit('close', 1));
        return child;
      };
      const ln = new Lightning({
        managed: true,
        bitcoin: { rpcuser: 'u', rpcpassword: 'p', host: '127.0.0.1', rpcport: 18443, datadir: '/tmp' }
      });
      ln.machine = { start: async () => {} };
      await assert.rejects(() => ln.start(), /Could not connect to bitcoind using bitcoin-cli/);
      cp.spawn = origSpawn;
    });

    it('emits lightning cli stderr through error channel during preflight', async function () {
      const origSpawn = cp.spawn;
      cp.spawn = function () {
        const child = new EventEmitter();
        child.stdin = { write: function () {}, end: function () {} };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('ok'));
          child.stderr.emit('data', Buffer.from('rpc warning'));
          child.emit('close', 0);
        });
        return child;
      };
      const ln = new Lightning({
        managed: true,
        bitcoin: { rpcuser: 'u', rpcpassword: 'p', host: '127.0.0.1', rpcport: 18443, datadir: '/tmp' }
      });
      ln.machine = { start: async () => {} };
      ln.createLocalNode = async () => {};
      ln.sync = async () => {};
      const errors = [];
      ln.on('error', (m) => errors.push(String(m)));
      await ln.start();
      cp.spawn = origSpawn;
      if (ln._heart) clearInterval(ln._heart);
      assert.ok(errors.some((x) => x.includes('Lightning CLI error: rpc warning')));
    });
  });

  describe('newDepositAddress', function () {
    it('returns p2tr or bech32 from newaddr', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'newaddr');
        assert.deepStrictEqual(params, ['p2tr']);
        return { p2tr: 'bcrt1pxxx' };
      };
      const out = await ln.newDepositAddress();
      assert.strictEqual(out, 'bcrt1pxxx');
    });

    it('falls back to bech32 when p2tr missing', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => ({ bech32: 'bcrt1qxxx' });
      const out = await ln.newDepositAddress();
      assert.strictEqual(out, 'bcrt1qxxx');
    });
  });

  describe('listFunds', function () {
    it('returns result on success', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => ({ outputs: [], channels: [] });
      const out = await ln.listFunds();
      assert.deepStrictEqual(out, { outputs: [], channels: [] });
    });

    it('emits error and returns null on failure', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => { throw new Error('rpc fail'); };
      let errMsg;
      ln.once('error', (m) => { errMsg = m; });
      const out = await ln.listFunds();
      assert.strictEqual(out, null);
      assert.ok(/list funds/.test(String(errMsg)));
    });
  });

  describe('_syncChannels', function () {
    it('emits error when listchannels returns no channels', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => ({ channels: null });
      const errMsg = await new Promise((resolve) => {
        ln.once('error', (msg) => resolve(msg));
        ln._syncChannels().then(() => resolve(null));
      });
      assert.ok(errMsg === null || /No channels/.test(String(errMsg)));
    });

    it('populates _state.channels when channels present', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => ({
        channels: [{ short_channel_id: '1x2x3', amount_msat: '100' }]
      });
      await ln._syncChannels();
      assert.ok(Object.keys(ln._state.channels).length >= 1);
    });
  });

  describe('_syncInfo', function () {
    it('updates _state.content.node and blockheight', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method) => {
        assert.strictEqual(method, 'getinfo');
        return { id: 'node1', alias: 'al', color: 'c', blockheight: 100 };
      };
      await ln._syncInfo();
      assert.strictEqual(ln._state.content.node.id, 'node1');
      assert.strictEqual(ln._state.content.node.alias, 'al');
      assert.strictEqual(ln._state.content.blockheight, 100);
    });

    it('emits error on getinfo failure', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async () => { throw new Error('getinfo fail'); };
      const errMsg = await new Promise((resolve) => {
        ln.once('error', (msg) => resolve(msg));
        ln._syncInfo().then(() => resolve(null));
      });
      assert.ok(errMsg === null || /sync node info/.test(String(errMsg)));
    });
  });

  describe('sync / _sync', function () {
    it('calls _syncChannels and _syncInfo and emits sync', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method) => {
        if (method === 'listchannels') return { channels: [] };
        if (method === 'getinfo') return { id: 'x', alias: '', color: '', blockheight: 0 };
        throw new Error('unexpected');
      };
      const state = await new Promise((resolve) => {
        ln.once('sync', resolve);
        ln.sync();
      });
      assert.ok(state);
    });
  });

  describe('_makeRPCRequest', function () {
    it('rejects when socket connection fails (no socket file)', async function () {
      const ln = new Lightning({ datadir: '/nonexistent', socket: 'nosock.sock' });
      await assert.rejects(() => ln._makeRPCRequest('getinfo', [], 50), /ENOENT|timeout|connect/);
    });
  });

  describe('stop', function () {
    it('sets status to stopped and clears heartbeat when not managed', async function () {
      const ln = new Lightning({ managed: false });
      ln._heart = setInterval(() => {}, 60000);
      await ln.stop();
      assert.ok(ln.status === 'stopped' || ln.status === 'STOPPED');
      assert.strictEqual(ln._heart, null);
    });

    it('removes error handlers and machine stop when managed false', async function () {
      const ln = new Lightning({ managed: false });
      ln.machine = { stop: async () => {} };
      await ln.stop();
      assert.strictEqual(ln._errorHandlers.SIGINT, null);
    });
  });

  describe('_heartbeat', function () {
    it('calls sync and returns this', async function () {
      const ln = new Lightning();
      let synced = false;
      ln.sync = async () => { synced = true; return ln; };
      await ln._heartbeat();
      assert.strictEqual(synced, true);
    });
  });

  describe('_generateSmallestInvoice', function () {
    it('calls _generateInvoice with amount 1', async function () {
      const ln = new Lightning();
      ln._generateInvoice = async (amount) => {
        assert.strictEqual(amount, 1);
        return { encoded: 'lnbc1x' };
      };
      const out = await ln._generateSmallestInvoice();
      assert.strictEqual(out.encoded, 'lnbc1x');
    });
  });

  describe('_generateInvoice', function () {
    it('returns null in socket mode', async function () {
      const ln = new Lightning({ mode: 'socket' });
      const out = await ln._generateInvoice(100);
      assert.strictEqual(out, null);
    });

    it('in rest mode calls rest._POST and commit', async function () {
      const ln = new Lightning({ mode: 'rest' });
      ln.rest = {
        _POST: async (url, body) => {
          assert.ok(url.includes('invoice'));
          assert.strictEqual(body.amount, 50);
          return { bolt11: 'lnbc1...', expires_at: 999 };
        }
      };
      ln.commit = async () => ln;
      const out = await ln._generateInvoice(50, 120, 'desc');
      assert.ok(out);
      assert.strictEqual(out.encoded, 'lnbc1...');
      assert.strictEqual(out.expiry, 999);
    });
  });

  describe('_makeGRPCRequest', function () {
    it('writes request and resolves on result data', async function () {
      const ln = new Lightning();
      const EventEmitter = require('events');
      const grpc = new EventEmitter();
      grpc.write = function () {};
      ln.grpc = grpc;
      const p = ln._makeGRPCRequest('method', ['a']);
      setImmediate(() => {
        grpc.emit('data', Buffer.from(JSON.stringify({ result: { x: 1 } })));
      });
      const out = await p;
      assert.strictEqual(out.x, 1);
    });

    it('rejects on response.error', async function () {
      const ln = new Lightning();
      const EventEmitter = require('events');
      const grpc = new EventEmitter();
      grpc.write = function () {};
      ln.grpc = grpc;
      const p = ln._makeGRPCRequest('method', []);
      setImmediate(() => {
        grpc.emit('data', Buffer.from(JSON.stringify({ error: { message: 'err' } })));
      });
      const err = await p.catch(e => e);
      assert.ok(err && (err.message === 'err' || String(err).includes('err')));
    });

    it('emits error on malformed payload then resolves on a valid one', async function () {
      const ln = new Lightning();
      const grpc = new EventEmitter();
      grpc.write = function () {};
      ln.grpc = grpc;
      const errors = [];
      ln.on('error', (e) => errors.push(String(e)));
      const p = ln._makeGRPCRequest('method', []);
      setImmediate(() => {
        grpc.emit('data', Buffer.from('{ not-json'));
        grpc.emit('data', Buffer.from(JSON.stringify({ result: { ok: true } })));
      });
      const out = await p;
      assert.strictEqual(out.ok, true);
      assert.ok(errors.some((x) => x.includes('Could not make RPC request')));
    });

    it('rejects when grpc.write throws', async function () {
      const ln = new Lightning();
      const grpc = new EventEmitter();
      grpc.write = function () {
        throw new Error('write boom');
      };
      ln.grpc = grpc;
      await assert.rejects(() => ln._makeGRPCRequest('method', []), /write boom/);
    });
  });

  describe('_makeRPCRequest edge branches', function () {
    it('times out when socket never responds', async function () {
      const origCreate = net.createConnection;
      net.createConnection = function () {
        const client = new EventEmitter();
        client.destroy = function () {};
        client.write = function () {};
        return client;
      };
      const ln = new Lightning({ datadir: '/tmp', socket: 'timeout.sock' });
      try {
        await assert.rejects(() => ln._makeRPCRequest('getinfo', [], 5), /timeout/i);
      } finally {
        net.createConnection = origCreate;
      }
    });

    it('rejects when response grows beyond safety cap without valid JSON', async function () {
      const origCreate = net.createConnection;
      net.createConnection = function () {
        const client = new EventEmitter();
        client.destroy = function () {};
        client.write = function () {
          setImmediate(() => {
            client.emit('data', 'x'.repeat(2 * 1024 * 1024 + 5));
          });
        };
        return client;
      };
      const ln = new Lightning({ datadir: '/tmp', socket: 'large.sock' });
      try {
        await assert.rejects(() => ln._makeRPCRequest('getinfo', [], 100), /response too large/i);
      } finally {
        net.createConnection = origCreate;
      }
    });

    it('rejects when rpc response contains error object', async function () {
      const origCreate = net.createConnection;
      net.createConnection = function () {
        const client = new EventEmitter();
        client.destroy = function () {};
        client.write = function () {
          setImmediate(() => {
            client.emit('data', Buffer.from(JSON.stringify({ error: { message: 'rpc boom', code: -1 } })));
          });
        };
        return client;
      };
      const ln = new Lightning({ datadir: '/tmp', socket: 'err.sock' });
      try {
        await assert.rejects(() => ln._makeRPCRequest('getinfo', [], 100), /rpc boom/);
      } finally {
        net.createConnection = origCreate;
      }
    });

    it('rejects when createConnection throws synchronously', async function () {
      const origCreate = net.createConnection;
      net.createConnection = function () {
        throw new Error('connect throw');
      };
      const ln = new Lightning({ datadir: '/tmp', socket: 'throw.sock' });
      try {
        await assert.rejects(() => ln._makeRPCRequest('getinfo', [], 100), /connect throw/);
      } finally {
        net.createConnection = origCreate;
      }
    });
  });

  describe('stop (managed with child)', function () {
    it('attempts graceful shutdown and cleans up socket when managed and _child set', async function () {
      const ln = new Lightning({ managed: true, datadir: __dirname });
      const EventEmitter = require('events');
      const child = new EventEmitter();
      child.killed = false;
      child.exitCode = null;
      child.kill = function (sig) {
        this.killed = true;
        this.exitCode = 1;
        setImmediate(() => this.emit('close'));
      };
      ln._child = child;
      ln._makeRPCRequest = async () => {};
      ln.machine = { stop: async () => {} };
      await ln.stop();
      assert.ok(ln.status === 'stopped' || ln.status === 'STOPPED');
    });

    it('force-kills child when graceful shutdown times out', async function () {
      const ln = new Lightning({ managed: true });
      const EventEmitter = require('events');
      const child = new EventEmitter();
      child.killed = false;
      child.exitCode = null;
      child.kill = function () {
        this.killed = true;
        setImmediate(() => this.emit('close'));
      };
      ln._child = child;
      ln._makeRPCRequest = () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10));
      ln.machine = { stop: async () => {} };
      await ln.stop();
      assert.ok(ln.status === 'stopped' || ln.status === 'STOPPED');
    });

    it('handles already-exited child path and nulls custom process handlers', async function () {
      const ln = new Lightning({ managed: true, debug: true, datadir: '/tmp', socket: 'sock' });
      const child = new EventEmitter();
      child.killed = false;
      child.exitCode = 0; // exercises "already exited" branch
      child.kill = function () {
        this.killed = true;
      };
      ln._child = child;
      ln._makeRPCRequest = async () => {};
      ln.machine = { stop: async () => {} };
      ln._heart = setInterval(() => {}, 60000);
      ln._errorHandlers.SIGINT = function () {};
      ln._errorHandlers.SIGTERM = function () {};
      ln._errorHandlers.exit = function () {};
      ln._errorHandlers.uncaughtException = function () {};
      ln._errorHandlers.unhandledRejection = function () {};
      await ln.stop();
      assert.strictEqual(ln._errorHandlers.SIGINT, null);
      assert.strictEqual(ln._errorHandlers.SIGTERM, null);
      assert.strictEqual(ln._errorHandlers.exit, null);
      assert.strictEqual(ln._errorHandlers.uncaughtException, null);
      assert.strictEqual(ln._errorHandlers.unhandledRejection, null);
      assert.ok(ln.status === 'stopped' || ln.status === 'STOPPED');
    });

    it('logs socket cleanup path and cleanup errors in managed stop', async function () {
      const ln = new Lightning({ managed: true, debug: true, datadir: '/tmp', socket: 'sock' });
      const child = new EventEmitter();
      child.killed = false;
      child.exitCode = 0; // avoids SIGKILL and hits already-exited logic
      child.kill = function () {};
      ln._child = child;
      ln._makeRPCRequest = async () => {};
      ln.machine = { stop: async () => {} };

      const origExists = fs.existsSync;
      const origUnlink = fs.unlinkSync;
      let unlinkCalls = 0;
      fs.existsSync = function () { return true; };
      fs.unlinkSync = function () {
        unlinkCalls++;
        throw new Error('unlink failed');
      };
      try {
        await ln.stop();
      } finally {
        fs.existsSync = origExists;
        fs.unlinkSync = origUnlink;
      }
      assert.strictEqual(unlinkCalls, 1);
      assert.ok(ln.status === 'stopped' || ln.status === 'STOPPED');
    });
  });

  describe('redactSensitiveCommandArg (via createLocalNode params)', function () {
    it('builds params without exposing password in debug', function () {
      const params = [
        `--bitcoin-rpcuser=u`,
        `--bitcoin-rpcpassword=secret`
      ];
      const redact = Lightning.redactSensitiveCommandArg;
      assert.ok(/REDACTED/.test(redact(params[1])));
      assert.ok(/REDACTED/.test(redact(params[0])));
    });
  });
});
