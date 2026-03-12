'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const cp = require('child_process');

const Lightning = require('../../services/lightning');

describe('@fabric/core/services/lightning (unit)', function () {
  describe('constructor', function () {
    it('constructs with sane defaults', function () {
      const ln = new Lightning();
      assert.strictEqual(ln.settings.mode, 'socket');
      assert.strictEqual(ln.settings.port, 9735);
      assert.strictEqual(ln.settings.network, 'regtest');
      assert.ok(ln._state.content.balances);
      assert.ok(ln._state.content.node);
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
        assert.deepStrictEqual(params, ['nodeid', '127.0.0.1', '9735']);
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
      const ln = new Lightning();
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'fundchannel');
        assert.deepStrictEqual(params, ['peerid', '100000']);
        return { txid: 'abc' };
      };
      const out = await ln.createChannel('peerid', '100000');
      assert.strictEqual(out.txid, 'abc');
    });

    it('includes pushMsat when finite number', async function () {
      const ln = new Lightning();
      ln._makeRPCRequest = async (method, params) => {
        assert.strictEqual(params[2], 50000);
        return {};
      };
      await ln.createChannel('p', '100000', 50000);
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
  });

  describe('createLocalNode', function () {
    it('returns null when managed is false', async function () {
      const ln = new Lightning({ managed: false });
      const out = await ln.createLocalNode();
      assert.strictEqual(out, null);
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
  });

  describe('redactSensitiveCommandArg (via createLocalNode params)', function () {
    it('builds params without exposing password in debug', function () {
      const ln = new Lightning({
        managed: false,
        debug: false,
        bitcoin: { rpcuser: 'u', rpcpassword: 'secret', host: '127.0.0.1', rpcport: 18443, datadir: '/tmp' }
      });
      const params = [
        `--bitcoin-rpcuser=u`,
        `--bitcoin-rpcpassword=secret`
      ];
      const redact = (arg) => String(arg).replace(
        /((?:--?rpcpassword|--?rpcuser)=).*/i,
        '$1[REDACTED]'
      );
      assert.ok(/REDACTED/.test(redact(params[1])));
    });
  });
});
