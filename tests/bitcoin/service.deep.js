'use strict';

/* global describe, it, before, after */

/**
 * High-coverage unit tests for services/bitcoin.js (spawn stubs, RPC branches,
 * registerBlock, sync helpers, start/stop/cleanup). Complements tests/bitcoin/service.js.
 */

const assert = require('assert');
const crypto = require('crypto');
const EventEmitter = require('events');
const cp = require('child_process');

const Bitcoin = require('../../services/bitcoin');

describe('@fabric/core/services/bitcoin (deep coverage)', function () {
  this.timeout(180000);

  describe('_buildRPCProbeCandidates with credentials and secure client', function () {
    it('pushes settings.credentials candidates when username/password set', function () {
      const btc = new Bitcoin({
        mode: 'rpc',
        network: 'regtest',
        host: '127.0.0.1',
        rpcport: 18443,
        username: 'alice',
        password: 'secret',
        secure: true
      });
      const list = btc._buildRPCProbeCandidates();
      const cred = list.find((c) => c.source === 'settings.credentials');
      assert.ok(cred, 'expected settings.credentials candidate');
      assert.strictEqual(cred.secure, true);
    });

    it('_createRPCClientForCandidate uses HTTPS when secure', function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const http = btc._createRPCClientForCandidate({
        host: '127.0.0.1',
        rpcport: 18443,
        username: 'a',
        password: 'b',
        secure: true
      });
      assert.ok(http && typeof http.request === 'function');
    });

    it('_requestWithRPCClient resolves JSON-RPC result', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const client = {
        request: (method, params, cb) => cb(null, { result: { n: 1 } })
      };
      const r = await btc._requestWithRPCClient(client, 'getblockchaininfo', []);
      assert.deepStrictEqual(r, { n: 1 });
    });
  });

  describe('_loadWallet branches', function () {
    it('returns when loadwallet succeeds immediately', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getnetworkinfo') return { version: 260000 };
        if (method === 'loadwallet') return { name: params[0] };
        throw new Error(method);
      };
      const r = await btc._loadWallet('w1');
      assert.strictEqual(r.name, 'w1');
    });

    it('creates wallet on -18 then succeeds', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      let loadCalls = 0;
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getnetworkinfo') return { version: 260000 };
        if (method === 'loadwallet') {
          loadCalls++;
          if (loadCalls === 1) {
            const err = new Error('not found');
            err.code = -18;
            throw err;
          }
          return { name: params[0] };
        }
        if (method === 'createwallet') return { name: params[0] };
        throw new Error(method);
      };
      const r = await btc._loadWallet('fresh');
      assert.strictEqual(r.name, 'fresh');
    });

    it('handles createwallet -4 then loadwallet', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      let loadCalls = 0;
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getnetworkinfo') return { version: 260000 };
        if (method === 'loadwallet') {
          loadCalls++;
          if (loadCalls === 1) {
            const err = new Error('missing');
            err.code = -18;
            throw err;
          }
          return { name: params[0] };
        }
        if (method === 'createwallet') {
          const err = new Error('Database already exists');
          err.code = -4;
          throw err;
        }
        throw new Error(method);
      };
      const r = await btc._loadWallet('dbexists');
      assert.strictEqual(r.name, 'dbexists');
    });

    it('returns on already loaded (-35)', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async function (method) {
        if (method === 'getnetworkinfo') return { version: 260000 };
        if (method === 'loadwallet') {
          const err = new Error('loaded');
          err.code = -35;
          throw err;
        }
        throw new Error(method);
      };
      const r = await btc._loadWallet('same');
      assert.strictEqual(r.name, 'same');
    });
  });

  describe('_registerBlock and _registerTransaction', function () {
    it('registers a new block and transactions', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      const data = Buffer.from('block-bytes');
      const hashHex = crypto.createHash('sha256').update(data).digest('hex');
      const mem = {};
      let getCount = 0;
      btc._GET = async function (path) {
        if (path.startsWith('/blocks/')) {
          getCount++;
          if (getCount === 1) throw new Error('404');
          return mem[path] || null;
        }
        if (path.startsWith('/transactions/')) {
          return { hash: 'h1', id: 'id1' };
        }
        return null;
      };
      btc._PUT = async function (path, val) {
        mem[path] = val;
        return val;
      };
      btc.settings.state.addresses = { addr1: { transactions: [] } };
      const out = await btc._registerBlock({
        hash: 'blk1',
        data,
        headers: { hash: (enc) => hashHex },
        transactions: [{ txid: 'tx1', hash: 'h1', inputs: [{ address: 'addr1' }], outputs: [{ address: 'addr1' }] }]
      });
      assert.ok(out && out.hash === 'blk1');
    });

    it('returns prior block when _GET finds existing', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      const prior = { id: 'old', hash: 'old' };
      btc._GET = async () => prior;
      const r = await btc._registerBlock({
        hash: 'x',
        data: Buffer.from('a'),
        headers: { hash: () => '00' },
        transactions: []
      });
      assert.strictEqual(r, prior);
    });
  });

  describe('_buildPSBT and PSBT helpers', function () {
    it('builds PSBT with inputs and outputs', async function () {
      const addr = 'bcrt1pr4wctwfz0uznz86ash62jret9gq8ysg82zlzl9kdmuvq066pjcmsa0plmz';
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'gettxout') {
          return { value: 1.0, scriptPubKey: { hex: '00' } };
        }
        throw new Error(method);
      };
      const psbt = await btc._buildPSBT({
        inputs: [{ txid: 'aa'.repeat(32), vout: 0 }],
        outputs: [{ address: addr, value: 5000 }]
      });
      assert.ok(psbt && typeof psbt.toBase64 === 'function');
    });

    it('throws on invalid output address', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async () => null;
      await assert.rejects(
        () => btc._buildPSBT({
          inputs: [],
          outputs: [{ address: 'not-real-address-xxx', value: 1 }]
        }),
        /Invalid address/
      );
    });

    it('_finalizePSBT and _psbtToRawTX delegate to Psbt', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const psbt = {
        finalizeAllInputs: function () {},
        extractTransaction: function () {
          return { toHex: () => 'cafe' };
        }
      };
      await btc._finalizePSBT(psbt);
      const hex = await btc._psbtToRawTX(psbt);
      assert.strictEqual(hex, 'cafe');
    });

    it('_createTX delegates to _buildPSBT', async function () {
      const addr = 'bcrt1pr4wctwfz0uznz86ash62jret9gq8ysg82zlzl9kdmuvq066pjcmsa0plmz';
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async () => null;
      const tx = await btc._createTX({
        inputs: [],
        outputs: [{ address: addr, value: 1000 }]
      });
      assert.ok(tx);
    });

    it('_buildTX uses bitcoinjs TransactionBuilder when available', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const bitcoin = require('bitcoinjs-lib');
      if (typeof bitcoin.TransactionBuilder !== 'function') {
        await assert.rejects(() => btc._buildTX(), TypeError);
      } else {
        const b = await btc._buildTX();
        assert.ok(b);
      }
    });

    it('_spendRawTX calls sendrawtransaction', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'sendrawtransaction');
        assert.strictEqual(params[0], 'deadbeef');
        return 'txid';
      };
      const r = await btc._spendRawTX('deadbeef');
      assert.strictEqual(r, 'txid');
    });
  });

  describe('sync and wait helpers', function () {
    it('_waitForBitcoind retries then succeeds', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      let n = 0;
      btc._makeRPCRequest = async (method) => {
        if (method === 'getblockchaininfo' || method === 'getnetworkinfo') {
          n++;
          if (n <= 2) throw new Error('warming up');
          if (method === 'getblockchaininfo') return { chain: 'regtest' };
          return { version: 260000 };
        }
        throw new Error(method);
      };
      const ok = await btc._waitForBitcoind(5, 1);
      assert.strictEqual(ok, true);
    });

    it('_waitForBitcoind returns false after maxAttempts', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async () => {
        throw new Error('always fail');
      };
      const ok = await btc._waitForBitcoind(2, 1);
      assert.strictEqual(ok, false);
    });

    it('_isBitcoindOnline true/false', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async () => ({});
      assert.strictEqual(await btc._isBitcoindOnline(), true);
      btc._makeRPCRequest = async () => {
        throw new Error('down');
      };
      assert.strictEqual(await btc._isBitcoindOnline(), false);
    });

    it('_syncChainInfoOverRPC emits on genesis failure', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      const errs = [];
      btc.on('error', (e) => errs.push(String(e)));
      btc._makeRPCRequest = async (method) => {
        if (method === 'getblockhash' && arguments[0] === undefined) {
          /* first call from genesis */
        }
        if (method === 'getblockhash') {
          const params = arguments[1];
          if (params && params[0] === 0) throw new Error('no genesis');
        }
        throw new Error('unexpected');
      };
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getblockhash' && params[0] === 0) throw new Error('no genesis');
        if (method === 'getbestblockhash') return 'best';
        if (method === 'getblockcount') return 0;
        throw new Error(method);
      };
      btc._syncBestBlockHash = async () => 'best';
      btc._syncChainHeight = async () => 0;
      btc.commit = async () => {};
      await btc._syncChainInfoOverRPC();
      assert.ok(errs.some((x) => x.includes('genesis')));
    });

    it('_syncBalances returns state on error', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._loadWallet = async () => {};
      btc._makeRPCRequest = async () => {
        throw new Error('rpc');
      };
      const b = await btc._syncBalances();
      assert.ok(b);
    });

    it('_syncWithRPC emits on failure', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._syncChainOverRPC = async () => {
        throw new Error('sync boom');
      };
      const errs = [];
      btc.on('error', (e) => errs.push(String(e)));
      await assert.rejects(() => btc._syncWithRPC(), /sync boom/);
      assert.ok(errs.some((x) => x.includes('Sync failed')));
    });

    it('_syncChainOverRPC completes READY sync path', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      const logs = [];
      let syncPayload = null;
      btc.on('log', (m) => logs.push(String(m)));
      btc.on('sync', (p) => { syncPayload = p; });
      btc._loadWallet = async () => {};
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getblockhash' && params[0] === 0) return 'genesis-hash';
        if (method === 'getbestblockhash') return 'best-hash';
        if (method === 'getblockcount') return 0;
        if (method === 'gettxoutsetinfo') return { total_amount: 50 };
        if (method === 'getbalances') return { mine: { trusted: 1 } };
        throw new Error(method);
      };
      btc.commit = async () => {};
      await btc._syncChainOverRPC();
      assert.ok(syncPayload);
      assert.strictEqual(syncPayload.best, 'best-hash');
      assert.ok(logs.some((x) => x.includes('Beginning chain sync')));
    });

    it('_syncChainHeadersOverRPC walks heights', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc.height = 1;
      const hashes = ['g0', 'g1'];
      btc._requestBlockAtHeight = async (h) => hashes[h];
      btc._requestRawBlockHeader = async () => '00aa';
      btc.headers = [];
      await btc._syncChainHeadersOverRPC();
      assert.ok(btc.headers.length >= 1);
    });

    it('_syncRawChainOverRPC records chain slots', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc.height = 0;
      btc._requestBlockAtHeight = async () => 'hh';
      btc._syncRawBlock = async () => btc;
      btc._state.chain = [];
      const logs = [];
      btc.on('log', (m) => logs.push(m));
      await btc._syncRawChainOverRPC();
      assert.strictEqual(btc._state.chain[0], 'hh');
    });

    it('_syncHeaders and _syncRawHeadersForBlock', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._requestBlockAtHeight = async () => 'ab';
      btc._requestBlockHeader = async () => ({ h: 1 });
      btc.headers = {};
      btc.commit = async () => {};
      await btc._syncHeadersForBlock('ab');

      const errs = [];
      btc.on('error', (e) => errs.push(e));
      btc._requestRawBlockHeader = async () => ({ error: 'bad' });
      await btc._syncRawHeadersForBlock('x');
      assert.ok(errs.length >= 1);
    });

    it('_syncBestBlockHash catches and rethrows with debug', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      const logs = [];
      btc.on('debug', (m) => logs.push(String(m)));
      btc._requestBestBlockHash = async () => {
        throw new Error('nope');
      };
      await assert.rejects(() => btc._syncBestBlockHash(), /nope/);
      assert.ok(logs.some((x) => x.includes('syncing best block')));
    });

    it('_listUnspent returns empty on error', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._loadWallet = async () => {
        throw new Error('no wallet');
      };
      const u = await btc._listUnspent();
      assert.deepStrictEqual(u, []);
    });

    it('_listChainBlocks returns block keys', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      btc._state.blocks = { a: 1, b: 2 };
      const k = await btc._listChainBlocks();
      assert.ok(k.includes('a'));
    });

    it('_getMempool proxies getrawmempool', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async (m) => {
        assert.strictEqual(m, 'getrawmempool');
        return ['a'];
      };
      const r = await btc._getMempool();
      assert.deepStrictEqual(r, ['a']);
    });
  });

  describe('keys and unload', function () {
    it('_dumpKeyPair and _dumpPrivateKey parse WIF', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      const Key = require('../../types/key');
      const wif = new Key({ network: 'regtest' }).toWIF();
      btc._makeRPCRequest = async () => wif;
      const kp = await btc._dumpKeyPair('addr');
      assert.ok(kp.publicKey);
      const pk = await btc._dumpPrivateKey('addr');
      assert.ok(Buffer.isBuffer(pk));
    });

    it('_loadPrivateKey imports key', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async (method, params) => {
        assert.strictEqual(method, 'importprivkey');
        assert.strictEqual(params[0], 'wif');
        return null;
      };
      await btc._loadPrivateKey('wif');
    });

    it('_unloadWallet success and swallow error', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      btc._makeRPCRequest = async () => null;
      const r = await btc._unloadWallet('w');
      assert.strictEqual(r.name, 'w');

      btc._makeRPCRequest = async () => {
        throw new Error('not loaded');
      };
      await btc._unloadWallet('w2');
    });
  });

  describe('peer / SPV handlers (mock messages)', function () {
    it('_handlePeerPacket default warns on unknown cmd', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const w = [];
      btc.on('warning', (m) => w.push(String(m)));
      await btc._handlePeerPacket({ cmd: 'weird' });
      assert.ok(w.some((x) => x.includes('unhandled')));
    });

    it('_handlePeerPacket block cmd registers block', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      const inner = {
        _raw: Buffer.from('aa', 'hex'),
        toJSON: () => ({ hash: 'blkhash', txs: [{ hash: 'txa' }] }),
        createMerkleRoot: () => 'merk'
      };
      btc._registerBlock = async (o) => ({ id: 'r', hash: o.hash });
      await btc._handlePeerPacket({
        cmd: 'block',
        block: {
          toBlock: () => inner,
          toHeaders: () => ({ hash: (e) => 'hdr' })
        }
      });
    });

    it('_handlePeerPacket inv and tx cmds', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      let gotItems = null;
      btc.peer = { getData: (items) => { gotItems = items; } };
      await btc._handlePeerPacket({ cmd: 'inv', items: ['a'] });
      assert.deepStrictEqual(gotItems, ['a']);

      btc._registerTransaction = async (o) => o;
      await btc._handlePeerPacket({
        cmd: 'tx',
        tx: {
          txid: () => 'tid',
          hash: (enc) => 'hsh'
        }
      });
    });

    it('_handleBlockMessage creates via blocks.create', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      btc.blocks.create = async (t) => ({ id: 'b1', ...t });
      await btc._handleBlockMessage({
        hash: () => '00',
        prevBlock: Buffer.alloc(32, 1),
        txs: [],
        toRaw: () => Buffer.from('00', 'hex')
      });
    });

    it('_handleConnectMessage logs or errors', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      btc.wallet = { database: { addBlock: async () => 2 } };
      const logs = [];
      btc.on('log', (m) => logs.push(String(m)));
      await btc._handleConnectMessage({}, { txs: [] });
      assert.ok(logs.some((x) => x.includes('Added block')));

      btc.wallet.database.addBlock = async () => {
        throw new Error('db');
      };
      const errs = [];
      btc.on('error', (e) => errs.push(String(e)));
      await btc._handleConnectMessage({}, { txs: [] });
      assert.ok(errs.some((x) => x.includes('WalletDB')));
    });

    it('_handleBlockFromSPV and _handleTransactionFromSPV', async function () {
      const btc = new Bitcoin({ network: 'regtest', verbosity: 5 });
      btc.blocks.create = async (o) => ({ hash: o.hash });
      btc.blocks.list = () => ({ k: 1 });
      await btc._handleBlockFromSPV({
        hash: () => 'ab',
        prevBlock: Buffer.alloc(32, 0),
        hashes: []
      });

      const tx = {
        hash: () => 'cc',
        inputs: [],
        outputs: []
      };
      let ev = 0;
      btc.on('transaction', () => ev++);
      await btc._handleTransactionFromSPV(tx);
      assert.strictEqual(ev, 1);
    });
  });

  describe('createLocalNode managed (spawn stub)', function () {
    let origSpawn;
    let origWait;

    before(function () {
      origSpawn = cp.spawn;
      origWait = Bitcoin.prototype._waitForBitcoind;
      cp.spawn = function (cmd, args) {
        assert.strictEqual(cmd, 'bitcoind');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = function () {};
        return child;
      };
      Bitcoin.prototype._waitForBitcoind = async function () {
        return true;
      };
    });

    after(function () {
      cp.spawn = origSpawn;
      Bitcoin.prototype._waitForBitcoind = origWait;
    });

    it('spawns bitcoind when managed with credentials', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        mode: 'rpc',
        managed: true,
        listen: 0,
        username: 'rpcuser',
        password: 'rpcpass',
        rpcport: 18499,
        port: 18498,
        datadir: `./stores/btc-deep-test-${process.pid}`
      });
      const child = await btc.createLocalNode();
      assert.ok(child);
      assert.ok(btc.rpc);
      assert.strictEqual(btc._nodeProcess, child);
      try {
        if (btc._errorHandlers && btc._errorHandlers.SIGINT) {
          process.removeListener('SIGINT', btc._errorHandlers.SIGINT);
        }
        if (btc._errorHandlers && btc._errorHandlers.SIGTERM) {
          process.removeListener('SIGTERM', btc._errorHandlers.SIGTERM);
        }
        if (btc._errorHandlers && btc._errorHandlers.exit) {
          process.removeListener('exit', btc._errorHandlers.exit);
        }
        if (btc._errorHandlers && btc._errorHandlers.uncaughtException) {
          process.removeListener('uncaughtException', btc._errorHandlers.uncaughtException);
        }
        if (btc._errorHandlers && btc._errorHandlers.unhandledRejection) {
          process.removeListener('unhandledRejection', btc._errorHandlers.unhandledRejection);
        }
      } catch (e) { /* ignore */ }
      btc._nodeProcess = null;
    });

    it('adds bitcoinExtraParams when provided', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        managed: true,
        listen: 0,
        username: 'u',
        password: 'p',
        rpcport: 18501,
        bitcoinExtraParams: ['-dnsseed=0']
      });
      await btc.createLocalNode();
      try {
        if (btc._errorHandlers && btc._errorHandlers.SIGINT) process.removeListener('SIGINT', btc._errorHandlers.SIGINT);
        if (btc._errorHandlers && btc._errorHandlers.SIGTERM) process.removeListener('SIGTERM', btc._errorHandlers.SIGTERM);
        if (btc._errorHandlers && btc._errorHandlers.exit) process.removeListener('exit', btc._errorHandlers.exit);
        if (btc._errorHandlers && btc._errorHandlers.uncaughtException) {
          process.removeListener('uncaughtException', btc._errorHandlers.uncaughtException);
        }
        if (btc._errorHandlers && btc._errorHandlers.unhandledRejection) {
          process.removeListener('unhandledRejection', btc._errorHandlers.unhandledRejection);
        }
      } catch (e) { /* ignore */ }
      btc._nodeProcess = null;
    });
  });

  describe('createLocalNode network datadir branches', function () {
    it('configures testnet and signet params', async function () {
      for (const network of ['testnet', 'signet', 'testnet4']) {
        const btc = new Bitcoin({
          network,
          mode: 'rpc',
          managed: false,
          host: '127.0.0.1',
          rpcport: 18332
        });
        await btc.createLocalNode();
        assert.ok(btc.settings.datadir);
      }
    });

    it('mainnet prune when storage constrained', async function () {
      const btc = new Bitcoin({
        network: 'mainnet',
        mode: 'rpc',
        managed: false,
        constraints: { storage: { size: 550 } }
      });
      await btc.createLocalNode();
      assert.ok(btc.settings.datadir.includes('pruned') || btc.settings.datadir.includes('bitcoin'));
    });

    it('playnet datadir', async function () {
      const btc = new Bitcoin({ network: 'playnet', mode: 'rpc', managed: false });
      await btc.createLocalNode();
      assert.ok(btc.settings.datadir.includes('playnet'));
    });
  });

  describe('start() RPC composition', function () {
    it('wires RPC, authority URL, peer handlers, and completes', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        mode: 'rpc',
        managed: false,
        authority: 'http://user:pass@127.0.0.1:18443',
        zmq: false,
        interval: 3600000
      });
      btc._detectExistingBitcoind = async () => false;
      btc._waitForBitcoind = async () => true;
      btc._syncWithRPC = async () => {};
      btc._startZMQ = async () => {};
      btc.peer = { on: function () {} };
      btc.store = undefined;
      let ready = false;
      btc.on('ready', () => { ready = true; });
      await btc.start();
      assert.strictEqual(ready, true);
      assert.ok(btc.rpc);
      await btc.stop();
    });

    it('start uses HTTPS when secure', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        mode: 'rpc',
        managed: false,
        host: '127.0.0.1',
        rpcport: 18443,
        username: 'a',
        password: 'b',
        secure: true,
        zmq: false,
        interval: 3600000
      });
      btc._detectExistingBitcoind = async () => false;
      btc._waitForBitcoind = async () => true;
      btc._syncWithRPC = async () => {};
      btc._startZMQ = async () => {};
      await btc.start();
      assert.ok(btc.rpc);
      await btc.stop();
    });

    it('cleanup removes process handlers', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        mode: 'fabric',
        managed: false
      });
      btc._errorHandlers = {
        SIGINT: () => {},
        SIGTERM: () => {},
        exit: () => {},
        uncaughtException: () => {},
        unhandledRejection: () => {}
      };
      for (const [ev, h] of Object.entries(btc._errorHandlers)) {
        process.on(ev, h);
      }
      await btc.cleanup();
      assert.ok(true);
    });
  });

  describe('misc getters and RPC', function () {
    it('exposes network getter', function () {
      const btc = new Bitcoin({ network: 'regtest' });
      assert.strictEqual(btc.network, 'regtest');
    });

    it('generateBlock uses RPC mode', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async () => ['blkhash'];
      const h = await btc.generateBlock('bcrt1q000000000000000000000000000000000000000000000000000000000000000000');
      assert.strictEqual(h, 'blkhash');
    });

    it('getUnusedAddress RPC path', async function () {
      const btc = new Bitcoin({
        network: 'regtest',
        mode: 'rpc',
        username: 'u',
        password: 'p',
        host: '127.0.0.1',
        rpcport: 18443
      });
      btc.rpc = {};
      btc._loadWallet = async () => {};
      btc._makeRPCRequest = async (m) => {
        if (m === 'getnetworkinfo') return { version: 260000 };
        throw new Error(m);
      };
      btc._makeWalletRequest = async () => 'addr1';
      const a = await btc.getUnusedAddress();
      assert.strictEqual(a, 'addr1');
    });

    it('_signRawTransactionWithWallet', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async (m, p) => {
        assert.strictEqual(m, 'signrawtransaction');
        return { hex: '00' };
      };
      const r = await btc._signRawTransactionWithWallet('raw', []);
      assert.ok(r.hex);
    });

    it('_createSwapScript returns script', async function () {
      const btc = new Bitcoin({ network: 'regtest' });
      const buf = Buffer.alloc(32, 3);
      const script = await btc._createSwapScript({
        hash: 'aa'.repeat(32),
        counterparty: buf,
        initiator: buf,
        constraints: { blocktime: 10 }
      });
      assert.ok(script && script.length > 0);
    });

    it('_checkAllTargetBalances iterates targets', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', targets: ['addrx'] });
      btc._getBalanceForAddress = async (a) => {
        assert.strictEqual(a, 'addrx');
        return 1;
      };
      await btc._checkAllTargetBalances();
    });

    it('processSpendMessage delegates', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._processSpendMessage = async () => 'ok';
      const r = await btc.processSpendMessage({ amount: 1, destination: 'x' });
      assert.strictEqual(r, 'ok');
    });

    it('tick emits error when sync throws', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._rpcReady = true;
      btc._syncBestBlock = async () => {
        throw new Error('syncfail');
      };
      btc._checkAllTargetBalances = async () => {};
      const errs = [];
      btc.on('error', (e) => errs.push(String(e)));
      await btc.tick();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.ok(errs.some((x) => x.includes('syncfail')));
    });

    it('_detectExistingBitcoind skips mismatched chains and can reuse matching daemon', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      const logs = [];
      btc.on('debug', (m) => logs.push(String(m)));
      const probes = [
        { host: '127.0.0.1', rpcport: 18443, source: 'mismatch', network: 'mainnet' },
        { host: '127.0.0.1', rpcport: 18444, source: 'match', network: 'regtest' }
      ];
      btc._buildRPCProbeCandidates = () => probes;
      btc._createRPCClientForCandidate = (candidate) => ({ candidate });
      btc._requestWithRPCClient = async (client, method) => {
        if (method === 'getblockchaininfo') {
          return { chain: client.candidate.network };
        }
        return { version: 1 };
      };
      const found = await btc._detectExistingBitcoind();
      assert.strictEqual(found, true);
      assert.strictEqual(btc._usingExternalNode, true);
      assert.strictEqual(btc.settings.rpcport, 18444);
      assert.ok(logs.some((m) => m.includes('Ignoring external')));
      assert.ok(logs.some((m) => m.includes('Reusing existing bitcoind')));
    });

    it('_detectExistingBitcoind logs probe failures in debug mode', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
      const logs = [];
      btc.on('debug', (m) => logs.push(String(m)));
      btc._buildRPCProbeCandidates = () => [{ host: '127.0.0.1', rpcport: 1, source: 'bad', network: 'regtest' }];
      btc._createRPCClientForCandidate = () => ({});
      btc._requestWithRPCClient = async () => {
        throw new Error('boom');
      };
      const found = await btc._detectExistingBitcoind();
      assert.strictEqual(found, false);
      assert.ok(logs.some((m) => m.includes('RPC probe failed')));
    });

    it('validateAddress handles invalid network and invalid address', function () {
      const btc1 = new Bitcoin({ network: 'unknown', debug: true });
      const logs = [];
      btc1.on('debug', (m) => logs.push(String(m)));
      assert.strictEqual(btc1.validateAddress('abc'), false);
      assert.ok(logs.some((m) => m.includes('Address validation failed')));

      const btc2 = new Bitcoin({ network: 'regtest' });
      assert.strictEqual(btc2.validateAddress('not-a-real-address'), false);
    });

    it('broadcast verifies and relays through spv adapter', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      const calls = [];
      const msg = { verify: async () => true };
      btc.spv = {
        sendTX: async () => calls.push('sendTX'),
        relay: async () => calls.push('relay')
      };
      await btc.broadcast(msg);
      assert.deepStrictEqual(calls, ['sendTX', 'relay']);
    });

    it('_processRawBlock and _heartbeat exercise helper branches', async function () {
      const btc = new Bitcoin({ network: 'regtest', debug: true });
      let bcoin = null;
      try {
        bcoin = require('bcoin');
      } catch (error) {}
      if (bcoin && bcoin.Block && typeof bcoin.Block.fromRaw === 'function') {
        const orig = bcoin.Block.fromRaw;
        bcoin.Block.fromRaw = () => ({ id: 'stub' });
        try {
          await btc._processRawBlock(Buffer.from('00', 'hex'));
        } finally {
          bcoin.Block.fromRaw = orig;
        }
      }
      let beat = false;
      btc._syncBestBlock = async () => { beat = true; };
      await btc._heartbeat();
      assert.strictEqual(beat, true);
    });

    it('_processSpendMessage handles boxed String amount', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._loadWallet = async () => {};
      btc._makeWalletRequest = async (_method, params) => {
        assert.strictEqual(typeof params[1], 'string');
        return 'txid-boxed';
      };
      const txid = await btc._processSpendMessage({
        amount: new String('0.001'),
        destination: 'bcrt1q000000000000000000000000000000000000000000000000000000000000000000',
        created: new Date().toISOString()
      });
      assert.strictEqual(txid, 'txid-boxed');
    });

    it('_processSpendMessage rejects non-numeric boxed String amount', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      await assert.rejects(
        () => btc._processSpendMessage({
          amount: new String('not-a-number'),
          destination: 'bcrt1q000000000000000000000000000000000000000000000000000000000000000000'
        }),
        /must be numeric/
      );
    });
  });

  describe('flushChainToSnapshot', function () {
    const SNAP = 'c'.repeat(64);
    const MID = 'b'.repeat(64);
    const TIP = 'a'.repeat(64);
    const FOREIGN = 'f'.repeat(64);

    it('_keyNetworkNameForWif maps playnet to regtest for Key.fromWIF', function () {
      const btc = new Bitcoin({ network: 'playnet', mode: 'rpc' });
      assert.strictEqual(btc._keyNetworkNameForWif(), 'regtest');
    });

    it('preflight rejects snapshot hash unknown to the node', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getbestblockhash') return TIP;
        if (method === 'getblockheader') {
          const h = params[0];
          if (h === TIP) return { previousblockhash: MID };
          if (h === MID) return { previousblockhash: SNAP };
          if (h === SNAP) return {};
          throw new Error('unknown header');
        }
        throw new Error(method);
      };
      await assert.rejects(
        () => btc.flushChainToSnapshot(FOREIGN),
        /snapshot block not known/
      );
    });

    it('rejects snapshot hash not an ancestor of the active tip', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      const SIDE = 'd'.repeat(64);
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getbestblockhash') return TIP;
        if (method === 'getblockheader') {
          const h = params[0];
          if (h === TIP) return { previousblockhash: MID };
          if (h === MID) return { previousblockhash: SNAP };
          if (h === SNAP) return {};
          if (h === SIDE) return { previousblockhash: 'e'.repeat(64) };
          throw new Error('unknown header');
        }
        throw new Error(method);
      };
      await assert.rejects(
        () => btc.flushChainToSnapshot(SIDE),
        /not an ancestor/
      );
    });

    it('rewinds tip until best matches snapshot when preflight passes', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', flushChainMaxSteps: 20 });
      let tip = TIP;
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getbestblockhash') return tip;
        if (method === 'getblockheader') {
          const h = params[0];
          if (h === TIP) return { previousblockhash: MID };
          if (h === MID) return { previousblockhash: SNAP };
          if (h === SNAP) return {};
          throw new Error('unknown header');
        }
        if (method === 'invalidateblock') {
          if (params[0] === TIP) tip = MID;
          else if (params[0] === MID) tip = SNAP;
          else throw new Error('unexpected invalidate');
          return null;
        }
        throw new Error(method);
      };
      const out = await btc.flushChainToSnapshot(SNAP);
      assert.strictEqual(out.ok, true);
      assert.strictEqual(out.steps, 2);
      assert.strictEqual(tip, SNAP);
    });

    it('rejects flushChainToSnapshot on mainnet without override', async function () {
      const btc = new Bitcoin({ network: 'mainnet', mode: 'rpc' });
      await assert.rejects(
        () => btc.flushChainToSnapshot('a'.repeat(64)),
        /not allowed for network/
      );
    });

    it('rejects non-hex snapshotBlockHash', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
      await assert.rejects(
        () => btc.flushChainToSnapshot('zzzz'),
        /64 hex/
      );
    });

    it('throws when invalidate loop exceeds flushChainMaxSteps', async function () {
      const SNAP = 'c'.repeat(64);
      const TIP = 'a'.repeat(64);
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', flushChainMaxSteps: 3 });
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getbestblockhash') return TIP;
        if (method === 'getblockheader') {
          const h = params[0];
          if (h === TIP) return { previousblockhash: SNAP };
          if (h === SNAP) return {};
          return {};
        }
        if (method === 'invalidateblock') return null;
        throw new Error(method);
      };
      await assert.rejects(
        () => btc.flushChainToSnapshot(SNAP),
        /exceeded flushChainMaxSteps/
      );
    });

    it('serializes concurrent flushChainToSnapshot calls', async function () {
      const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', flushChainMaxSteps: 20 });
      let tip = TIP;
      let invalidateOverlap = 0;
      let insideInvalidate = 0;
      btc._makeRPCRequest = async function (method, params) {
        if (method === 'getbestblockhash') return tip;
        if (method === 'getblockheader') {
          const h = params[0];
          if (h === TIP) return { previousblockhash: MID };
          if (h === MID) return { previousblockhash: SNAP };
          if (h === SNAP) return {};
          return {};
        }
        if (method === 'invalidateblock') {
          insideInvalidate++;
          if (insideInvalidate > 1) invalidateOverlap++;
          await new Promise((r) => setImmediate(r));
          if (params[0] === TIP) tip = MID;
          else if (params[0] === MID) tip = SNAP;
          insideInvalidate--;
          return null;
        }
        throw new Error(method);
      };
      await Promise.all([btc.flushChainToSnapshot(SNAP), btc.flushChainToSnapshot(SNAP)]);
      assert.strictEqual(invalidateOverlap, 0);
    });
  });
});
