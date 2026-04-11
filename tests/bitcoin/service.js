'use strict';

// Dependencies
const assert = require('assert');
const EventEmitter = require('events');
const jayson = require('jayson/lib/client');

// Fabric Types
const Bitcoin = require('../../services/bitcoin');
const Key = require('../../types/key');

describe('@fabric/core/services/bitcoin', function () {
  describe('Bitcoin', function () {
    it('should expose a constructor', function () {
      assert.equal(Bitcoin.constructor instanceof Function, true);
    });

    describe('createRPCAuth', function () {
      it('throws if username is missing', function () {
        const btc = new Bitcoin({ network: 'regtest' });
        assert.throws(() => btc.createRPCAuth({}), /Username is required/);
      });

      it('creates deterministic structure with provided password', function () {
        const btc = new Bitcoin({ network: 'regtest' });
        const auth = btc.createRPCAuth({ username: 'alice', password: 's3cret' });

        // Basic shape
        assert.ok(auth);
        assert.strictEqual(auth.username, 'alice');
        assert.strictEqual(typeof auth.password, 'string');
        assert.strictEqual(typeof auth.content, 'string');

        // Format: username:salt$hash
        const parts = auth.content.split(':');
        assert.strictEqual(parts[0], 'alice');
        const [salt, hash] = parts[1].split('$');
        assert.strictEqual(salt.length, 32); // 16 bytes hex
        assert.strictEqual(hash.length, 64); // sha256 hex
      });
    });

    describe('network default listen and ports', function () {
      it('uses standard regtest P2P/RPC and listen when only network is set', function () {
        const btc = new Bitcoin({ network: 'regtest' });
        assert.strictEqual(btc.settings.listen, true);
        assert.strictEqual(btc.settings.port, 18444);
        assert.strictEqual(btc.settings.rpcport, 18443);
      });

      it('keeps mainnet defaults on mainnet', function () {
        const btc = new Bitcoin({ network: 'mainnet' });
        assert.strictEqual(btc.settings.listen, true);
        assert.strictEqual(btc.settings.port, 8333);
        assert.strictEqual(btc.settings.rpcport, 8332);
      });

      it('allows explicit regtest ports without replacement', function () {
        const btc = new Bitcoin({ network: 'regtest', port: 19500, rpcport: 19501 });
        assert.strictEqual(btc.settings.port, 19500);
        assert.strictEqual(btc.settings.rpcport, 19501);
      });
    });

    describe('validateAddress', function () {
      // Key/network init can exceed default timeout under full-suite load.
      this.timeout(30000);

      it('accepts a known-valid regtest address in fabric mode', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });

        // Known-good regtest bech32 address from integration tests
        const address = 'bcrt1pr4wctwfz0uznz86ash62jret9gq8ysg82zlzl9kdmuvq066pjcmsa0plmz';

        assert.ok(address);
        assert.strictEqual(btc.validateAddress(address), true);
      });

      it('rejects clearly invalid addresses', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        assert.strictEqual(btc.validateAddress('not-an-address'), false);
        assert.strictEqual(btc.validateAddress(''), false);
      });

      it('fails closed set of networks safely', function () {
        const btc = new Bitcoin({ network: 'invalidnet', mode: 'fabric' });
        // Should not throw, but must return false on validation
        const result = btc.validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080');
        assert.strictEqual(result, false);
      });
    });

    describe('RPC detection and degraded mode', function () {
      it('normalizes chain names from RPC responses', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        assert.strictEqual(btc._normalizeChainName('main'), 'mainnet');
        assert.strictEqual(btc._normalizeChainName('test'), 'testnet');
        assert.strictEqual(btc._normalizeChainName('regtest'), 'regtest');
        assert.strictEqual(btc._normalizeChainName('signet'), 'signet');
        assert.strictEqual(btc._normalizeChainName('testnet4'), 'testnet4');
        assert.strictEqual(btc._normalizeChainName('unknown-custom'), 'unknown-custom');
      });

      it('normalizes RPC host values safely', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        assert.strictEqual(btc._normalizeRPCHost('localhost:18443'), 'localhost');
        assert.strictEqual(btc._normalizeRPCHost('127.0.0.1:18443'), '127.0.0.1');
        assert.strictEqual(btc._normalizeRPCHost('127.0.0.1'), '127.0.0.1');
        assert.strictEqual(btc._normalizeRPCHost('::1'), '::1');
        assert.strictEqual(btc._normalizeRPCHost('  localhost  '), 'localhost');
        assert.strictEqual(btc._normalizeRPCHost(''), '127.0.0.1');
        assert.strictEqual(btc._normalizeRPCHost(null), '127.0.0.1');
      });

      it('maps default RPC and P2P ports by network', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        const expected = {
          mainnet: { rpc: 8332, p2p: 8333 },
          testnet: { rpc: 18332, p2p: 18333 },
          regtest: { rpc: 18443, p2p: 18444 },
          signet: { rpc: 38332, p2p: 38333 },
          testnet4: { rpc: 48332, p2p: 48333 }
        };

        for (const [network, ports] of Object.entries(expected)) {
          assert.strictEqual(btc._getDefaultRPCPort(network), ports.rpc, `rpc port mismatch for ${network}`);
          assert.strictEqual(btc._getDefaultP2PPort(network), ports.p2p, `p2p port mismatch for ${network}`);
        }
      });

      it('normalizes host:port values in explicit probe candidates', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          rpcProbeCandidates: [
            { host: 'localhost:18443', rpcport: 18443, network: 'regtest' }
          ]
        });

        const candidates = await btc._buildRPCProbeCandidates();
        const explicit = candidates.find((c) => c.source === undefined && c.network === 'regtest' && c.rpcport === 18443);
        assert.ok(explicit, 'expected explicit probe candidate to exist');
        assert.strictEqual(explicit.host, 'localhost');
      });

      it('prefers configured probe candidates and deduplicates', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          rpcProbeCandidates: [
            { host: '127.0.0.1', rpcport: 18443, network: 'regtest', username: 'a', password: 'b' },
            { host: '127.0.0.1', rpcport: 18443, network: 'regtest', username: 'a', password: 'b' } // duplicate
          ]
        });

        const candidates = await btc._buildRPCProbeCandidates();
        const same = candidates.filter((c) => c.host === '127.0.0.1' && c.rpcport === 18443 && c.network === 'regtest');
        assert.ok(same.length >= 1, 'expected at least one regtest probe candidate');

        const explicit = same.filter((c) => c.username === 'a' && c.password === 'b');
        const dedupeKey = new Set(explicit.map((c) => `${c.host}:${c.rpcport}:${c.username || ''}:${c.password || ''}`));
        assert.strictEqual(dedupeKey.size, 1, 'expected duplicate explicit candidates to collapse');
      });

      it('adopts detected RPC endpoint and marks external node usage', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', host: '127.0.0.1', rpcport: 18443 });
        const fakeClient = {};

        btc._buildRPCProbeCandidates = () => ([
          {
            source: 'test',
            host: '127.0.0.1',
            rpcport: 18443,
            network: 'regtest',
            username: 'alice',
            password: 'secret',
            secure: false
          }
        ]);
        btc._createRPCClientForCandidate = () => fakeClient;
        btc._requestWithRPCClient = async (client, method) => {
          if (method === 'getblockchaininfo') return { chain: 'regtest' };
          if (method === 'getnetworkinfo') return { version: 260000 };
          throw new Error(`unexpected method ${method}`);
        };

        const found = await btc._detectExistingBitcoind();
        assert.strictEqual(found, true);
        assert.strictEqual(btc.rpc, fakeClient);
        assert.strictEqual(btc._usingExternalNode, true);
        assert.strictEqual(btc.settings.network, 'regtest');
        assert.strictEqual(btc.settings.rpcport, 18443);
        assert.strictEqual(btc.settings.username, 'alice');
      });

      it('returns false when no probe candidate is reachable', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443
        });
        const original = {
          host: btc.settings.host,
          rpcport: btc.settings.rpcport,
          network: btc.settings.network
        };

        btc._buildRPCProbeCandidates = () => ([
          { source: 'fail-1', host: '127.0.0.1', rpcport: 18443, network: 'regtest' },
          { source: 'fail-2', host: '127.0.0.1', rpcport: 8332, network: 'mainnet' }
        ]);
        btc._createRPCClientForCandidate = () => ({});
        btc._requestWithRPCClient = async () => { throw new Error('ECONNREFUSED'); };

        const found = await btc._detectExistingBitcoind();
        assert.strictEqual(found, false);
        assert.strictEqual(btc._usingExternalNode, undefined);
        assert.strictEqual(btc.settings.host, original.host);
        assert.strictEqual(btc.settings.rpcport, original.rpcport);
        assert.strictEqual(btc.settings.network, original.network);
      });

      it('tries later probe candidates after earlier failures', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', host: '127.0.0.1', rpcport: 18443 });
        let callCount = 0;
        const clients = [{ id: 'first' }, { id: 'second' }];

        btc._buildRPCProbeCandidates = () => ([
          { source: 'fail-first', host: '127.0.0.1', rpcport: 18443, network: 'regtest' },
          { source: 'succeed-second', host: '127.0.0.1', rpcport: 18443, network: 'regtest', username: 'u', password: 'p' }
        ]);
        btc._createRPCClientForCandidate = (candidate) => {
          callCount++;
          return clients[callCount - 1];
        };
        btc._requestWithRPCClient = async (client, method) => {
          if (client.id === 'first') throw new Error('ECONNREFUSED');
          if (method === 'getblockchaininfo') return { chain: 'regtest' };
          if (method === 'getnetworkinfo') return { version: 260000 };
          throw new Error(`unexpected method ${method}`);
        };

        const found = await btc._detectExistingBitcoind();
        assert.strictEqual(found, true);
        assert.strictEqual(callCount, 2, 'expected fallback to second candidate');
        assert.strictEqual(btc.settings.network, 'regtest');
        assert.strictEqual(btc.settings.port, 18444);
      });

      it('ignores reachable daemon when chain does not match target network', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', host: '127.0.0.1', rpcport: 18443 });

        btc._buildRPCProbeCandidates = () => ([
          { source: 'mainnet-daemon', host: '127.0.0.1', rpcport: 8332, network: 'mainnet' }
        ]);
        btc._createRPCClientForCandidate = () => ({ id: 'mainnet' });
        btc._requestWithRPCClient = async (_client, method) => {
          if (method === 'getblockchaininfo') return { chain: 'main' };
          if (method === 'getnetworkinfo') return { version: 260000 };
          throw new Error(`unexpected method ${method}`);
        };

        const found = await btc._detectExistingBitcoind();
        assert.strictEqual(found, false);
        assert.strictEqual(btc._usingExternalNode, undefined);
        assert.strictEqual(btc.settings.network, 'regtest');
      });

      it('adds default network fallback probe candidates', async function () {
        const btc = new Bitcoin({
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          network: 'regtest'
        });

        const candidates = await btc._buildRPCProbeCandidates();
        const keys = new Set(candidates.map((c) => `${c.network}:${c.rpcport}`));

        assert.ok(keys.has('regtest:18443'));
        assert.ok(keys.has('mainnet:8332'));
        assert.ok(keys.has('testnet:18332'));
        assert.ok(keys.has('signet:38332'));
      });

      it('filters invalid probe candidate entries', async function () {
        const btc = new Bitcoin({
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          rpcProbeCandidates: [
            { host: '', rpcport: 18443, network: 'regtest' },
            { host: 'localhost', rpcport: 'not-a-number', network: 'regtest' },
            { host: 'localhost', rpcport: 18443, network: 'regtest' }
          ]
        });

        const candidates = await btc._buildRPCProbeCandidates();
        const explicitValid = candidates.filter((c) => c.host === 'localhost' && c.rpcport === 18443 && c.network === 'regtest');
        assert.strictEqual(explicitValid.length, 1, 'expected only valid explicit candidate to survive');
      });

      it('handles request client response edge cases', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });

        const okClient = {
          request: (method, params, cb) => cb(null, { result: { ok: true } })
        };
        const errClient = {
          request: (method, params, cb) => cb(new Error('transport error'))
        };
        const emptyClient = {
          request: (method, params, cb) => cb(null, null)
        };
        const rpcErrorClient = {
          request: (method, params, cb) => cb(null, { error: { code: -1, message: 'bad rpc' } })
        };

        const ok = await btc._requestWithRPCClient(okClient, 'getblockchaininfo', []);
        assert.deepStrictEqual(ok, { ok: true });
        await assert.rejects(() => btc._requestWithRPCClient(errClient, 'x', []), /transport error/);
        await assert.rejects(() => btc._requestWithRPCClient(emptyClient, 'x', []), /No response from RPC call/);
        await assert.rejects(() => btc._requestWithRPCClient(rpcErrorClient, 'x', []));
      });

      it('skips tick sync work while rpc is degraded', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._rpcReady = false;
        let synced = false;
        let balances = false;
        btc._syncBestBlock = async () => { synced = true; };
        btc._checkAllTargetBalances = async () => { balances = true; };

        await btc.tick();
        assert.strictEqual(synced, false);
        assert.strictEqual(balances, false);
      });
    });

    describe('get/set, ZMQ and RPC helpers', function () {
      it('updates tip via best setter and emits tip event only on changes', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        let tipEvents = 0;
        btc.on('tip', () => { tipEvents++; });

        btc.best = 'abc';
        btc.best = 'abc'; // no-op
        btc.best = 'def';

        assert.strictEqual(btc.best, 'def');
        assert.strictEqual(tipEvents, 2);
      });

      it('parses height values and commits through height setter', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        let commits = 0;
        btc.commit = () => { commits++; };

        btc.height = '42';
        assert.strictEqual(btc.height, 42);
        assert.strictEqual(commits, 1);
      });

      it('wires and starts ZMQ listeners', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
        const fakeZmq = new EventEmitter();
        let started = 0;
        fakeZmq.start = async () => { started++; };
        btc.zmq = fakeZmq;

        await btc._startZMQ();

        assert.strictEqual(started, 1);
        assert.ok(fakeZmq.listenerCount('message') >= 1);
        assert.ok(fakeZmq.listenerCount('error') >= 1);
        assert.ok(fakeZmq.listenerCount('connect') >= 1);
        assert.ok(fakeZmq.listenerCount('disconnect') >= 1);
      });

      it('handles _makeRPCRequest success and error branches', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });

        await assert.rejects(() => btc._makeRPCRequest('getblockcount', []), /RPC manager does not exist/);

        btc.rpc = {
          request: (method, params, cb) => cb(null, { result: 123 })
        };
        const ok = await btc._makeRPCRequest('getblockcount', []);
        assert.strictEqual(ok, 123);

        btc.rpc = {
          request: (method, params, cb) => cb(new Error('transport fail'))
        };
        await assert.rejects(() => btc._makeRPCRequest('getblockcount', []), /transport fail/);

        btc.rpc = {
          request: (method, params, cb) => cb(null, null)
        };
        await assert.rejects(() => btc._makeRPCRequest('getblockcount', []), /No response from RPC call getblockcount/);

        btc.rpc = {
          request: (method, params, cb) => cb(null, { error: { code: -1, message: 'rpc fail' } })
        };
        await assert.rejects(() => btc._makeRPCRequest('getblockcount', []));
      });

      it('handles _makeWalletRequest routing, success and error branches', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          username: 'alice',
          password: 'secret',
          secure: false
        });
        btc.rpc = {}; // satisfy existence check

        await assert.rejects(() => btc._makeWalletRequest('getbalance', []), /Wallet name is required/);

        const originalHttp = jayson.http;
        const originalHttps = jayson.https;
        try {
          let observedConfig = null;
          jayson.http = (config) => {
            observedConfig = config;
            return {
              request: (method, params, cb) => cb(null, { result: 7 })
            };
          };

          const result = await btc._makeWalletRequest('getbalance', [], 'walletA');
          assert.strictEqual(result, 7);
          assert.strictEqual(observedConfig.path, '/wallet/walletA');
          assert.ok(observedConfig.headers && observedConfig.headers.Authorization);

          jayson.http = () => ({
            request: (method, params, cb) => cb(new Error('wallet transport fail'))
          });
          await assert.rejects(() => btc._makeWalletRequest('getbalance', [], 'walletA'), /wallet transport fail/);

          jayson.http = () => ({
            request: (method, params, cb) => cb(null, null)
          });
          await assert.rejects(
            () => btc._makeWalletRequest('getbalance', [], 'walletA'),
            /No response from wallet RPC call getbalance on wallet walletA/
          );

          jayson.http = () => ({
            request: (method, params, cb) => cb(null, { error: { code: -1, message: 'wallet rpc fail' } })
          });
          await assert.rejects(() => btc._makeWalletRequest('getbalance', [], 'walletA'));

          btc.settings.secure = true;
          let httpsUsed = false;
          jayson.https = () => {
            httpsUsed = true;
            return {
              request: (method, params, cb) => cb(null, { result: 11 })
            };
          };
          const secureResult = await btc._makeWalletRequest('getbalance', [], 'walletB');
          assert.strictEqual(secureResult, 11);
          assert.strictEqual(httpsUsed, true);
        } finally {
          jayson.http = originalHttp;
          jayson.https = originalHttps;
        }
      });

      it('handles BitcoinBlockHash ZMQ topic and updates chain state', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let committed = 0;
        btc.commit = () => { committed++; };
        btc._makeRPCRequest = async (method) => {
          if (method === 'gettxoutsetinfo') {
            return { height: 321, total_amount: 123.45 };
          }
          throw new Error(`unexpected method ${method}`);
        };

        const payload = Buffer.from(JSON.stringify({ content: 'abc123tip' }), 'utf8');
        await btc._handleZMQMessage({
          type: 'BitcoinBlockHash',
          data: payload
        });

        assert.strictEqual(btc._state.content.height, 321);
        assert.strictEqual(btc._state.content.tip, 'abc123tip');
        assert.strictEqual(btc._state.content.supply, 123.45);
        assert.strictEqual(committed, 1);
      });

      it('handles BitcoinTransaction ZMQ topic and commits balances', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let committed = 0;
        btc.commit = () => { committed++; };
        btc._makeRPCRequest = async (method) => {
          if (method === 'getbalances') return { trusted: 10.5 };
          throw new Error(`unexpected method ${method}`);
        };

        await btc._handleZMQMessage({
          type: 'BitcoinTransaction',
          data: Buffer.from('{}', 'utf8')
        });

        assert.deepStrictEqual(btc._state.balances.mine.trusted, { trusted: 10.5 });
        assert.strictEqual(committed, 1);
      });

      it('handles raw array ZMQ message format', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let committed = 0;
        btc.commit = () => { committed++; };
        btc._makeRPCRequest = async (method) => {
          if (method === 'gettxoutsetinfo') return { height: 9, total_amount: 50 };
          throw new Error(`unexpected method ${method}`);
        };

        const raw = [
          Buffer.from('BitcoinBlockHash', 'utf8'),
          Buffer.from(JSON.stringify({ content: 'tip-raw-array' }), 'utf8')
        ];
        await btc._handleZMQMessage(raw);

        assert.strictEqual(btc._state.content.height, 9);
        assert.strictEqual(btc._state.content.tip, 'tip-raw-array');
        assert.strictEqual(btc._state.content.supply, 50);
        assert.strictEqual(committed, 1);
      });

      it('treats BitcoinBlock and BitcoinTransactionHash topics as no-op', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let committed = 0;
        let rpcCalls = 0;
        btc.commit = () => { committed++; };
        btc._makeRPCRequest = async () => {
          rpcCalls++;
          return {};
        };

        await btc._handleZMQMessage({ type: 'BitcoinBlock', data: Buffer.from('{}', 'utf8') });
        await btc._handleZMQMessage({ type: 'BitcoinTransactionHash', data: Buffer.from('{}', 'utf8') });

        assert.strictEqual(committed, 0);
        assert.strictEqual(rpcCalls, 0);
      });

      it('emits debug for unknown topics when verbosity is high', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', verbosity: 5 });
        const debugLogs = [];
        btc.on('debug', (msg) => debugLogs.push(String(msg)));

        await btc._handleZMQMessage({ type: 'SomethingElse', data: Buffer.from('{}', 'utf8') });

        assert.ok(debugLogs.some((msg) => msg.includes('Unknown ZMQ topic: SomethingElse')));
      });

      it('emits error for malformed ZMQ messages and ignores unknown topics', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        const errors = [];
        btc.on('error', (msg) => errors.push(String(msg)));

        await btc._handleZMQMessage({ type: 'UnknownTopic', data: Buffer.from('{}', 'utf8') });
        await btc._handleZMQMessage('invalid-message-shape');

        assert.strictEqual(errors.length, 1);
        assert.ok(errors[0].includes('Invalid message format'));
      });

      it('tolerates malformed BitcoinBlockHash payload content', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        // Should be ignored by internal try/catch.
        await btc._handleZMQMessage({
          type: 'BitcoinBlockHash',
          data: Buffer.from('not-json', 'utf8')
        });
        assert.ok(true);
      });

      it('swallows internal RPC failures while processing known ZMQ topics', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let committed = 0;
        btc.commit = () => { committed++; };
        btc._makeRPCRequest = async () => {
          throw new Error('simulated RPC failure');
        };

        await btc._handleZMQMessage({
          type: 'BitcoinTransaction',
          data: Buffer.from('{}', 'utf8')
        });

        assert.strictEqual(committed, 0);
      });

      it('forwards ZMQ lifecycle events through bitcoin emitters', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc', debug: true });
        const fakeZmq = new EventEmitter();
        fakeZmq.start = async () => {};
        btc.zmq = fakeZmq;

        const debugLogs = [];
        const errors = [];
        btc.on('debug', (msg) => debugLogs.push(String(msg)));
        btc.on('error', (msg) => errors.push(String(msg)));

        await btc._startZMQ();
        fakeZmq.emit('log', 'hello-log');
        fakeZmq.emit('connect');
        fakeZmq.emit('disconnect');
        fakeZmq.emit('error', new Error('boom'));

        assert.ok(debugLogs.some((msg) => msg.includes('[ZMQ] hello-log')));
        assert.ok(debugLogs.some((msg) => msg.includes('Connected to Bitcoin node')));
        assert.ok(debugLogs.some((msg) => msg.includes('Disconnected from Bitcoin node')));
        assert.ok(errors.some((msg) => msg.includes('[ZMQ] Error: boom')));
      });
    });

    describe('lifecycle and local node orchestration', function () {
      it('createLocalNode configures auth/datadir and returns null when unmanaged', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          managed: false,
          host: '127.0.0.1',
          rpcport: 18443
        });

        const result = await btc.createLocalNode();
        assert.strictEqual(result, null);
        assert.strictEqual(btc.settings.datadir, './stores/bitcoin-regtest');
        assert.ok(btc.settings.username, 'expected generated rpc username');
        assert.ok(btc.settings.password, 'expected generated rpc password');
        assert.strictEqual(btc.settings.authority, 'http://127.0.0.1:18443');
      });

      it('createLocalNode respects custom datadir when unmanaged', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          managed: false,
          datadir: './stores/custom-btc-regtest',
          username: 'alice',
          password: 'secret'
        });

        await btc.createLocalNode();
        assert.strictEqual(btc.settings.datadir, './stores/custom-btc-regtest');
      });

      it('start skips managed spawn when existing bitcoind is detected', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'fabric',
          managed: true
        });

        let createLocalNodeCalls = 0;
        let startedZmq = 0;
        btc._detectExistingBitcoind = async () => true;
        btc.createLocalNode = async () => {
          createLocalNodeCalls++;
          return { pid: 123 };
        };
        btc._startZMQ = async () => { startedZmq++; };

        await btc.start();

        assert.strictEqual(btc.settings.managed, false);
        assert.strictEqual(createLocalNodeCalls, 0);
        assert.strictEqual(startedZmq, 1);
      });

      it('start in rpc mode skips sync/heartbeat when rpc is degraded', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          managed: false
        });

        let syncCalls = 0;
        let startedZmq = 0;
        const warnings = [];

        btc.on('warning', (msg) => warnings.push(String(msg)));
        btc._detectExistingBitcoind = async () => false;
        btc._waitForBitcoind = async () => false;
        btc._startZMQ = async () => { startedZmq++; };
        btc._syncWithRPC = async () => { syncCalls++; };

        await btc.start();

        assert.strictEqual(syncCalls, 0);
        assert.strictEqual(startedZmq, 1);
        assert.strictEqual(btc._heart, undefined);
        assert.ok(warnings.some((msg) => msg.includes('running in degraded mode')));
        assert.ok(warnings.some((msg) => msg.includes('Skipping RPC sync/heartbeat')));
      });

      it('redacts rpc credentials in bitcoind debug parameters', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          managed: false,
          debug: true,
          username: 'alice',
          password: 'supersecret'
        });
        const debugLogs = [];
        btc.on('debug', (msg) => debugLogs.push(String(msg)));

        await btc.createLocalNode();

        const paramLog = debugLogs.find((msg) => msg.includes('Bitcoind parameters:'));
        assert.ok(paramLog, 'expected bitcoind parameter debug log');
        assert.ok(!paramLog.includes('supersecret'));
        assert.ok(paramLog.includes('-rpcpassword=[REDACTED]'));
      });

      it('stop gracefully shuts down child process and clears heartbeat', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        let walletStops = 0;
        let zmqStops = 0;
        btc.wallet = { stop: async () => { walletStops++; } };
        btc.zmq = { stop: async () => { zmqStops++; } };
        btc._heart = setInterval(() => {}, 1000);

        const fakeProc = new EventEmitter();
        fakeProc.exitCode = null;
        fakeProc.killed = false;
        fakeProc.kill = function (signal = 'SIGTERM') {
          this.killed = true;
          this.exitCode = signal === 'SIGKILL' ? 137 : 0;
          setImmediate(() => this.emit('exit'));
        };
        btc._nodeProcess = fakeProc;

        await btc.stop();

        assert.strictEqual(walletStops, 1);
        assert.strictEqual(zmqStops, 1);
        assert.strictEqual(btc._heart, undefined);
        assert.strictEqual(btc._nodeProcess, null);
      });
    });

    describe('getters, walletName, and entity preparation', function () {
      it('exposes tip, supply, height, balance, lib, networks, and UAString', function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        assert.strictEqual(btc.tip, null);
        assert.strictEqual(btc.supply, 0);
        assert.strictEqual(btc.height, 0);
        assert.strictEqual(btc.balance, 0);
        assert.ok(btc.lib);
        assert.ok(btc.networks.regtest);
        assert.ok(btc.networks.mainnet);
        assert.ok(String(btc.UAString).includes('Fabric'));
      });

      it('walletName is stable double-sha256 of xpub when unset', function () {
        const btc = new Bitcoin({ network: 'regtest' });
        assert.strictEqual(btc.walletName, btc.walletName);
        assert.strictEqual(btc.walletName.length, 64);
        assert.ok(/^[0-9a-f]+$/.test(btc.walletName));
      });

      it('walletName honors explicit settings.walletName', function () {
        const btc = new Bitcoin({ network: 'regtest', walletName: 'integration-wallet' });
        assert.strictEqual(btc.walletName, 'integration-wallet');
      });

      it('headers round-trips through getter and setter', function () {
        const btc = new Bitcoin({ network: 'regtest' });
        assert.deepStrictEqual(btc.headers, []);
        btc.headers = [{ height: 1 }];
        assert.deepStrictEqual(btc.headers, [{ height: 1 }]);
      });

      it('_prepareTransaction merges Entity id onto payload', async function () {
        const btc = new Bitcoin({ network: 'regtest' });
        const out = await btc._prepareTransaction({ label: 'x' });
        assert.ok(out.id);
        assert.strictEqual(out.label, 'x');
      });

      it('_prepareBlock requires transactions as an array', async function () {
        const btc = new Bitcoin({ network: 'regtest' });
        await assert.rejects(async () => btc._prepareBlock({}), /transactions.*property/);
        await assert.rejects(async () => btc._prepareBlock({ transactions: {} }), /Array/);
      });

      it('_handleCommittedTransaction emits a transaction event', function (done) {
        const btc = new Bitcoin({ network: 'regtest' });
        btc.once('transaction', (tx) => {
          assert.strictEqual(tx.txid, 'aa');
          done();
        });
        btc._handleCommittedTransaction({ txid: 'aa' });
      });

      it('_registerAddress emits address', function (done) {
        const btc = new Bitcoin({ network: 'regtest' });
        btc.once('address', (addr) => {
          assert.strictEqual(addr, 'bcrt1qaddr');
          done();
        });
        btc._registerAddress('bcrt1qaddr');
      });

      it('_handlePeerError emits a service-scoped error string', function (done) {
        const btc = new Bitcoin({ network: 'regtest' });
        btc.once('error', (msg) => {
          assert.ok(String(msg).includes('Peer'));
          assert.ok(String(msg).includes('offline'));
          done();
        });
        btc._handlePeerError(new Error('offline'));
      });
    });

    describe('explorer REST, chain queries, and helpers', function () {
      const crossFetchPath = require.resolve('cross-fetch');
      let origCrossFetch;
      let BitcoinMod;

      before(function () {
        origCrossFetch = require.cache[crossFetchPath].exports;
        require.cache[crossFetchPath].exports = async (url) => {
          const u = String(url);
          if (u.includes('/blocks/height/')) {
            return {
              ok: true,
              json: async () => ({
                hash: 'from-height',
                height: 7,
                time: 100,
                tx: [],
                size: 1,
                strippedsize: 1,
                weight: 4,
                mediantime: 100,
                difficulty: 1,
                chainwork: '00',
                previousblockhash: null,
                nextblockhash: null
              })
            };
          }
          if (u.includes('/blocks/')) {
            return {
              ok: true,
              json: async () => ({
                hash: 'deadbeef',
                height: 2,
                time: 0,
                tx: ['a'],
                size: 10,
                strippedsize: 9,
                weight: 40,
                mediantime: 0,
                difficulty: 1,
                previousblockhash: null,
                nextblockhash: null
              })
            };
          }
          if (u.includes('/transactions/')) {
            return {
              ok: true,
              json: async () => ({
                txid: 'tx1',
                hash: 'tx1',
                version: 2,
                vin: [],
                vout: []
              })
            };
          }
          if (u.includes('/addresses/')) {
            return {
              ok: true,
              json: async () => ({
                address: 'bc1qex',
                chain_stats: { tx_count: 1 },
                mempool_stats: { tx_count: 0 },
                recent_txs: []
              })
            };
          }
          return { ok: false, status: 404 };
        };
        delete require.cache[require.resolve('../../services/bitcoin')];
        BitcoinMod = require('../../services/bitcoin');
      });

      after(function () {
        require.cache[crossFetchPath].exports = origCrossFetch;
        delete require.cache[require.resolve('../../services/bitcoin')];
      });

      it('_explorerRestBase returns null for missing or blank explorer URL', function () {
        assert.strictEqual(new BitcoinMod({ explorerBaseUrl: null })._explorerRestBase(), null);
        assert.strictEqual(new BitcoinMod({ explorerBaseUrl: '   ' })._explorerRestBase(), null);
      });

      it('_explorerRestBase trims slashes and appends /services/bitcoin', function () {
        const btc = new BitcoinMod({ explorerBaseUrl: ' https://hub.example/foo/// ' });
        assert.strictEqual(btc._explorerRestBase(), 'https://hub.example/foo/services/bitcoin');
      });

      it('getBlockInfo uses RPC when _rpcReady and returns normalized fields', async function () {
        const btc = new BitcoinMod({ network: 'regtest', mode: 'rpc' });
        btc._rpcReady = true;
        btc.rpc = {};
        btc._makeRPCRequest = async (method, params) => {
          if (method === 'getblockhash') return 'abc';
          if (method === 'getblock') {
            return {
              hash: 'abc',
              height: 5,
              time: 1,
              tx: ['t1'],
              size: 100,
              strippedsize: 90,
              weight: 400,
              mediantime: 1,
              difficulty: 1,
              chainwork: 'x',
              previousblockhash: 'p',
              nextblockhash: 'n'
            };
          }
          throw new Error(`unexpected ${method}`);
        };
        const byHeight = await btc.getBlockInfo(10);
        assert.strictEqual(byHeight.height, 5);
        assert.strictEqual(byHeight.txcount, 1);

        const byHash = await btc.getBlockInfo('deadbeef');
        assert.strictEqual(byHash.hash, 'abc');
      });

      it('getBlockInfo falls back to explorer when RPC throws', async function () {
        const btc = new BitcoinMod({
          network: 'regtest',
          mode: 'rpc',
          explorerBaseUrl: 'https://hub.example',
          debug: true
        });
        btc._rpcReady = true;
        btc.rpc = {};
        const debugLogs = [];
        btc.on('debug', (m) => debugLogs.push(String(m)));
        btc._makeRPCRequest = async () => {
          throw new Error('rpc down');
        };
        const info = await btc.getBlockInfo(7);
        assert.strictEqual(info.height, 7);
        assert.strictEqual(info.hash, 'from-height');
        assert.ok(debugLogs.some((x) => x.includes('RPC getBlockInfo failed')));
      });

      it('getBlockInfo uses explorer by hash path when RPC unavailable', async function () {
        const btc = new BitcoinMod({
          network: 'regtest',
          explorerBaseUrl: 'https://hub.example'
        });
        btc._rpcReady = false;
        const info = await btc.getBlockInfo('00'.repeat(32));
        assert.strictEqual(info.hash, 'deadbeef');
        assert.strictEqual(info.txcount, 1);
      });

      it('getTransactionInfo uses RPC path and explorer fallback', async function () {
        const btcRpc = new BitcoinMod({ network: 'regtest', mode: 'rpc' });
        btcRpc._rpcReady = true;
        btcRpc.rpc = {};
        btcRpc._makeRPCRequest = async (method, params) => {
          assert.strictEqual(method, 'getrawtransaction');
          return {
            txid: 'aa',
            hash: 'aa',
            version: 2,
            size: 100,
            vsize: 100,
            weight: 400,
            locktime: 0,
            vin: [],
            vout: [],
            blockhash: 'bb',
            confirmations: 3,
            time: 1,
            blocktime: 2
          };
        };
        const t1 = await btcRpc.getTransactionInfo('aa');
        assert.strictEqual(t1.txid, 'aa');
        assert.strictEqual(t1.confirmations, 3);

        const btcHttp = new BitcoinMod({
          network: 'regtest',
          explorerBaseUrl: 'https://hub.example',
          debug: true
        });
        btcHttp._rpcReady = true;
        btcHttp.rpc = {};
        const logs = [];
        btcHttp.on('debug', (m) => logs.push(String(m)));
        btcHttp._makeRPCRequest = async () => {
          throw new Error('no rpc');
        };
        const t2 = await btcHttp.getTransactionInfo('tx1');
        assert.strictEqual(t2.txid, 'tx1');
        assert.ok(logs.some((x) => x.includes('RPC getTransactionInfo failed')));
      });

      it('getAddressInfo requires explorer base URL', async function () {
        const btc = new BitcoinMod({ network: 'regtest' });
        await assert.rejects(
          () => btc.getAddressInfo('bc1q'),
          /explorerBaseUrl/
        );
      });

      it('getAddressInfo returns normalized payload from explorer', async function () {
        const btc = new BitcoinMod({ explorerBaseUrl: 'https://hub.example' });
        const info = await btc.getAddressInfo('bc1qex');
        assert.strictEqual(info.address, 'bc1qex');
        assert.deepStrictEqual(info.chain_stats, { tx_count: 1 });
        assert.deepStrictEqual(info.recent_txs, []);
      });

      it('getBlockInfo and getTransactionInfo error when no RPC and no explorer', async function () {
        const btc = new BitcoinMod({ network: 'regtest' });
        btc._rpcReady = false;
        await assert.rejects(() => btc.getBlockInfo(0), /explorerBaseUrl/);
        await assert.rejects(() => btc.getTransactionInfo('aa'), /explorerBaseUrl/);
      });
    });

    describe('RPC retries, chain sync, fabric generation, and spend helpers', function () {
      it('_makeRPCRequest retries on work queue depth exceeded', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let n = 0;
        btc._makeRPCRequestOnce = async function () {
          n++;
          if (n < 3) throw new Error('Work queue depth exceeded');
          return 42;
        };
        const result = await btc._makeRPCRequest('getblockcount', [], { retries: 5 });
        assert.strictEqual(result, 42);
        assert.strictEqual(n, 3);
      });

      it('_makeRPCRequest stops retrying after maxRetries', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._makeRPCRequestOnce = async function () {
          throw new Error('Work queue depth exceeded');
        };
        await assert.rejects(
          () => btc._makeRPCRequest('x', [], { retries: 2 }),
          /Work queue depth exceeded/
        );
      });

      it('getChainHeight and getBalances delegate to RPC', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._makeRPCRequest = async (method) => {
          if (method === 'getblockchaininfo') return { blocks: 99 };
          if (method === 'getbalances') return { mine: { trusted: 1.5 } };
          throw new Error(method);
        };
        assert.strictEqual(await btc.getChainHeight(), 99);
        assert.deepStrictEqual(await btc.getBalances(), { trusted: 1.5 });
      });

      it('_listAddresses calls listreceivedbyaddress', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._makeRPCRequest = async (method, params) => {
          assert.strictEqual(method, 'listreceivedbyaddress');
          assert.deepStrictEqual(params, [1, true]);
          return [{ address: 'a' }];
        };
        const rows = await btc._listAddresses();
        assert.deepStrictEqual(rows, [{ address: 'a' }]);
      });

      it('tick runs sync hooks when RPC is ready', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._rpcReady = true;
        let synced = 0;
        let balances = 0;
        btc._syncBestBlock = async () => { synced++; };
        btc._checkAllTargetBalances = async () => { balances++; };
        const done = new Promise((resolve) => btc.once('beat', resolve));
        await btc.tick();
        await done;
        assert.strictEqual(synced, 1);
        assert.strictEqual(balances, 1);
      });

      it('connect emits when peer.connect throws', function (done) {
        const btc = new Bitcoin({ network: 'regtest' });
        btc.peer = { connect: () => { throw new Error('econn'); } };
        btc.once('error', (msg) => {
          assert.ok(String(msg).includes('SERVICES:BITCOIN'));
          assert.ok(String(msg).includes('econn'));
          done();
        });
        btc.connect('127.0.0.1:8333');
      });

      it('generateBlock and generateBlocks in fabric mode update tip', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        const h1 = await btc.generateBlock('bcrt1q000000000000000000000000000000000000000000000000000000000000000000');
        const h2 = await btc.generateBlocks(2, 'bcrt1q000000000000000000000000000000000000000000000000000000000000000000');
        assert.strictEqual(h2.length, 2);
        assert.strictEqual(btc.settings.state.tip, h2[1]);
        assert.ok(h1 && h2[0] && h2[1]);
      });

      it('generateBlock rejects invalid mode', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'nosuch' });
        await assert.rejects(() => btc.generateBlock('addr'), /Invalid mode/);
      });

      it('getUnusedAddress derives sequential addresses in fabric mode', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        const a = await btc.getUnusedAddress();
        const b = await btc.getUnusedAddress();
        assert.notStrictEqual(a, b);
        assert.ok(btc.settings.state.addresses[a]);
        assert.ok(btc.settings.state.addresses[b]);
      });

      it('_processSpendMessage sends via wallet RPC', async function () {
        const btc = new Bitcoin({
          network: 'regtest',
          mode: 'rpc',
          host: '127.0.0.1',
          rpcport: 18443,
          username: 'u',
          password: 'p'
        });
        btc._loadWallet = async () => {};
        btc._makeWalletRequest = async (method, params, walletName) => {
          assert.strictEqual(method, 'sendtoaddress');
          assert.strictEqual(params[0], 'bcrt1qdest');
          assert.strictEqual(params[1], '0.01000000');
          assert.ok(walletName);
          return 'txidhex';
        };
        const txid = await btc._processSpendMessage({
          amount: 0.01,
          destination: 'bcrt1qdest'
        });
        assert.strictEqual(txid, 'txidhex');
      });

      it('_processSpendMessage emits error when wallet returns error object', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._loadWallet = async () => {};
        btc._makeWalletRequest = async () => ({ error: 'bad' });
        const errors = [];
        btc.on('error', (e) => errors.push(e));
        const ok = await btc._processSpendMessage({
          amount: 1,
          destination: 'bcrt1qdest'
        });
        assert.strictEqual(ok, false);
        assert.ok(errors.length >= 1);
      });

      it('_encodeSequenceForNBlocks and _encodeSequenceTargetBlock return encodings', async function () {
        const btc = new Bitcoin({ network: 'regtest' });
        const seq = await btc._encodeSequenceForNBlocks(3);
        assert.ok(Number.isFinite(seq));
        const lt = await btc._encodeSequenceTargetBlock(50);
        assert.ok(typeof lt === 'string');
        assert.ok(lt.length > 0);
      });

      it('_estimateFeeRate reads estimatesmartfee feerate', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        btc._makeRPCRequest = async (method, params) => {
          assert.strictEqual(method, 'estimatesmartfee');
          assert.deepStrictEqual(params, [6]);
          return { feerate: 0.00002 };
        };
        const rate = await btc._estimateFeeRate(6);
        assert.strictEqual(rate, 0.00002);
      });

      it('_requestBestBlockHash and _syncChainHeight use RPC', async function () {
        const btc = new Bitcoin({ network: 'regtest', mode: 'rpc' });
        let bestCalls = 0;
        btc._makeRPCRequest = async (method) => {
          if (method === 'getbestblockhash') {
            bestCalls++;
            return 'tip-hash';
          }
          if (method === 'getblockcount') return 55;
          throw new Error(method);
        };
        btc.commit = () => {};
        const tip = await btc._requestBestBlockHash();
        assert.strictEqual(tip, 'tip-hash');
        assert.strictEqual(btc.best, 'tip-hash');
        assert.strictEqual(bestCalls, 1);
        const h = await btc._syncChainHeight();
        assert.strictEqual(h, 55);
        assert.strictEqual(btc.height, 55);
      });

      it('_prepareBlock commits transactions through collection', async function () {
        const btc = new Bitcoin({ network: 'regtest' });
        let created = 0;
        btc.transactions.create = async (tx) => {
          created++;
          return tx;
        };
        const out = await btc._prepareBlock({
          transactions: [{ label: 'coinbase' }]
        });
        assert.strictEqual(created, 1);
        assert.ok(out.id);
      });

      it('_handleCommittedBlock expands tx hashes into transaction creates', async function () {
        const btc = new Bitcoin({ network: 'regtest' });
        const seen = [];
        btc.transactions.create = async (tx) => {
          seen.push(tx.hash);
          return tx;
        };
        await btc._handleCommittedBlock({
          transactions: [Buffer.from('aa', 'hex')]
        });
        assert.deepStrictEqual(seen, ['aa']);
      });

      it('_createPayment builds p2wpkh payment for network', function () {
        const Key = require('../../types/key');
        const k = new Key({ network: 'regtest' });
        const pubkey = Buffer.from(k.public.encodeCompressed('hex'), 'hex');
        const btc = new Bitcoin({ network: 'regtest', mode: 'fabric' });
        const pay = btc._createPayment({ pubkey });
        assert.ok(pay.output && pay.output.length > 0);
      });
    });
  });
});

describe('@fabric/core/services/bitcoin real-world RPC command parity', function () {
  if (!process.env.FABRIC_E2E_RPC_COMMANDS) {
    console.log('[SKIP] Set FABRIC_E2E_RPC_COMMANDS=1 to run real-world RPC command tests');
    return;
  }
  this.timeout(120000);

  const enabledCommands = [
    'getaddednodeinfo',
    'getchaintxstats',
    'getdeploymentinfo',
    'getindexinfo',
    'getmemoryinfo',
    'getnetworkhashps',
    'getnodeaddresses',
    'getrawmempool',
    'gettxoutsetinfo',
    'help',
    'logging',
    'verifychain'
  ];

  const rpcHost = process.env.BITCOIN_RPC_HOST || '127.0.0.1';
  const rpcPort = Number(process.env.BITCOIN_RPC_PORT || 18443);
  const rpcUser = process.env.BITCOIN_RPC_USER || 'polaruser';
  const rpcPass = process.env.BITCOIN_RPC_PASS || 'polarpass';
  let btc;

  before(async function () {
    btc = new Bitcoin({
      mode: 'rpc',
      network: 'regtest',
      host: rpcHost,
      rpcport: rpcPort,
      username: rpcUser,
      password: rpcPass,
      secure: false
    });

    const config = {
      host: rpcHost,
      port: rpcPort,
      timeout: 15000
    };
    const auth = `${rpcUser}:${rpcPass}`;
    config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };
    btc.rpc = require('jayson/lib/client').http(config);

    // Connectivity sanity check.
    await btc._makeRPCRequest('getblockchaininfo');
  });

  enabledCommands.forEach((command) => {
    it(`supports RPC command: ${command}`, async function () {
      const result = await btc._makeRPCRequest(command, []);
      // Real-world parity assertion: command should execute successfully.
      assert.notStrictEqual(result, undefined);
    });
  });
});

describe('@fabric/core/services/bitcoin', function () {
  if (!process.env.FABRIC_E2E_REGTEST) {
    console.log('[SKIP] Set FABRIC_E2E_REGTEST=1 to run bitcoin service tests');
    return;
  }
  this.timeout(120000);

  let defaults = {
    network: 'regtest',
    mode: 'fabric',
    port: 18444,
    rpcport: 18443,
    zmqport: 18445,
    zmq: {
      host: '127.0.0.1',
      port: 18445
    },
    managed: true,
    listen: 0,
    debug: false,
    username: 'bitcoinrpc',
    password: 'password',
    datadir: './stores/bitcoin-regtest-test'
  };

  let bitcoin;
  let key;

  async function resetChain (chain) {
    const height = await chain._makeRPCRequest('getblockcount', []);
    if (height > 0) {
      const secondblock = await chain._makeRPCRequest('getblockhash', [1]);
      await chain._makeRPCRequest('invalidateblock', [secondblock]);
      const after = await chain._makeRPCRequest('getblockcount', []);
    }
  }

  before(async function () {
    this.timeout(180000); // 3 minutes for setup

    const seed = process.pid % 10000;
    const basePort = 30000 + ((seed * 3) % 20000);
    const p2pPort = basePort;
    const rpcPort = basePort + 1;
    const zmqPort = basePort + 2;
    defaults = {
      ...defaults,
      port: p2pPort,
      rpcport: rpcPort,
      zmqport: zmqPort,
      zmq: {
        host: '127.0.0.1',
        port: zmqPort
      },
      datadir: `./stores/bitcoin-regtest-test-${process.pid}-${Date.now()}`
    };

    // Initialize Bitcoin service first
    bitcoin = new Bitcoin(defaults);

    // Now create the key with the correct network configuration
    key = new Key({
      network: 'regtest',
      purpose: 44,
      account: 0,
      index: 0
    });

    // Set the key on the Bitcoin service
    bitcoin.settings.key = { xpub: key.xpub };

    // Initialize RPC client
    const config = {
      host: '127.0.0.1',
      port: defaults.rpcport,
      timeout: 300000
    };

    const auth = `${bitcoin.settings.username}:${bitcoin.settings.password}`;
    config.headers = { Authorization: `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` };

    bitcoin.rpc = require('jayson/lib/client').http(config);
  });

  describe('Bitcoin', function () {
    afterEach(async function() {
      await bitcoin.stop();

      // Ensure any local bitcoin instance is stopped
      if (this.currentTest.ctx.local) {
        try {
          await this.currentTest.ctx.local.stop();
        } catch (e) {
          console.warn('Cleanup error:', e);
        }
      }
    });

    it('is available from @fabric/core', function () {
      assert.equal(Bitcoin instanceof Function, true);
    });

    it('provides reasonable defaults', function () {
      const local = new Bitcoin();
      assert.equal(local.UAString, 'Fabric Core 0.1.0 (@fabric/core#v0.1.0-RC1)');
      assert.equal(local.supply, 0);
      assert.equal(local.network, 'mainnet');
      // assert.equal(local.addresses, []);
      assert.equal(local.balance, 0);
      assert.equal(local.height, 0);
      assert.equal(local.best, '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
      // assert.equal(local.headers, []);
    });

    it('provides createRPCAuth method', function () {
      const auth = bitcoin.createRPCAuth({
        username: 'bitcoinrpc',
        password: 'password'
      });

      assert.ok(auth);
      assert.ok(auth.username);
      assert.ok(auth.password);
      assert.ok(auth.content);
    });

    it('can start and stop smoothly', async function () {
      await bitcoin.start();
      await bitcoin.stop();
      assert.ok(bitcoin);
      assert.equal(bitcoin.settings.network, 'regtest');
      assert.equal(bitcoin.settings.port, defaults.port);
      assert.equal(bitcoin.settings.rpcport, defaults.rpcport);
    });

    it('can generate addresses', async function () {
      await bitcoin.start();
      await bitcoin._loadWallet();
      const address = await bitcoin.getUnusedAddress();
      if (!address) throw new Error('No address returned from getnewaddress');
      await bitcoin.stop();
      assert.ok(address);
    });

    it('can validate an address', async function () {
      await bitcoin.start();
      await bitcoin._loadWallet();
      const address = await bitcoin.getUnusedAddress();
      const valid = bitcoin.validateAddress(address);
      await bitcoin.stop();
      assert.ok(valid);
    });

    it('can generate blocks', async function () {
      await bitcoin.start();
      await bitcoin._loadWallet();
      const address = await bitcoin.getUnusedAddress();
      const blocks = await bitcoin.generateBlocks(1, address);
      await bitcoin.stop();
      assert.equal(blocks.length, 1);
    });

    it('can manage a local bitcoind instance', async function () {
      const local = new Bitcoin({
        ...defaults,  // Use the same defaults as other tests
        debug: false,
        listen: 0
      });

      this.test.ctx.local = local;
      await local.start();
      await local.stop();
      assert.ok(local);
    });

    it('can generate regtest balances', async function () {
      const local = new Bitcoin(defaults);
      this.test.ctx.local = local;
      await local.start();
      await resetChain(local);

      const created = await local._loadWallet('testwallet');
      const address = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, address]);
      const wallet = await local._makeRPCRequest('getwalletinfo', []);
      const balance = await local._makeRPCRequest('getbalance', []);
      const blockchain = await local._makeRPCRequest('getblockchaininfo', []);

      // Sync the supply after generating blocks
      await local._syncSupply();

      await local.stop();

      assert.ok(local);
      assert.equal(local.supply, 5050);
      assert.ok(balance);
      assert.equal(balance, 50);
    });

    it('can create unsigned transactions', async function () {
      const local = new Bitcoin(defaults);
      this.test.ctx.local = local;

      await local.start();
      await local._loadWallet('testwallet');
      const address = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, address]);
      const utxos = await local._makeRPCRequest('listunspent', []);
      assert.ok(utxos.length > 0, 'No UTXOs available to spend');

      const inputs = [{
        txid: utxos[0].txid,
        vout: utxos[0].vout
      }];

      const outputs = { [address]: 1 };
      const transaction = await local._makeRPCRequest('createrawtransaction', [inputs, outputs]);
      const decoded = await local._makeRPCRequest('decoderawtransaction', [transaction]);

      await local.stop();

      assert.ok(transaction);
      assert.ok(transaction.length > 0);
      assert.ok(decoded.vin.length > 0, "Transaction should have at least one input");
      assert.ok(decoded.vout.length > 0, "Transaction should have at least one output");
    });

    it('can sign and broadcast transactions', async function () {
      const local = new Bitcoin(defaults);
      this.test.ctx.local = local;

      await local.start();
      await local._loadWallet('testwallet');
      const address = await local._makeRPCRequest('getnewaddress', []);
      await local._makeRPCRequest('generatetoaddress', [101, address]);
      const utxos = await local._makeRPCRequest('listunspent', []);
      assert.ok(utxos.length > 0, 'No UTXOs available to spend');
      const inputs = [{
        txid: utxos[0].txid,
        vout: utxos[0].vout
      }];

      // Calculate amount minus fee
      const inputAmount = utxos[0].amount;
      const fee = 0.00001; // 0.00001 BTC fee
      const sendAmount = inputAmount - fee;
      const outputs = { [address]: sendAmount };
      const transaction = await local._makeRPCRequest('createrawtransaction', [inputs, outputs]);
      const decoded = await local._makeRPCRequest('decoderawtransaction', [transaction]);
      const signed = await local._makeRPCRequest('signrawtransactionwithwallet', [transaction]);
      const broadcast = await local._makeRPCRequest('sendrawtransaction', [signed.hex]);
      const confirmation = await local._makeRPCRequest('generatetoaddress', [1, address]);

      await local.stop();

      assert.ok(transaction);
      assert.ok(transaction.length > 0);
      assert.ok(decoded.vin.length > 0, "Transaction should have at least one input");
      assert.ok(decoded.vout.length > 0, "Transaction should have at least one output");
    });

    it('can complete a payment', async function () {
      const local = new Bitcoin(defaults);
      this.test.ctx.local = local;

      await local.start();

      // Create a descriptor wallet
      const wallet1 = await local._loadWallet('testwallet1');
      const miner = await local._makeRPCRequest('getnewaddress', []);
      const generated = await local._makeRPCRequest('generatetoaddress', [101, miner]);
      await local._unloadWallet('testwallet1');

      // Send a payment from wallet1 to wallet2
      const wallet2 = await local._loadWallet('testwallet2');
      const destination = await local._makeRPCRequest('getnewaddress', []);
      await local._unloadWallet('testwallet2');

      await local._loadWallet('testwallet1');
      const payment = await local._makeRPCRequest('sendtoaddress', [destination, 1]);
      const confirmation = await local._makeRPCRequest('generatetoaddress', [1, miner]);
      await local._unloadWallet('testwallet1');

      await local._loadWallet('testwallet2');
      const wallet = await local._makeRPCRequest('getwalletinfo', []);
      const balance = await local._makeRPCRequest('getbalance', []);
      await local._unloadWallet('testwallet2');

      await local.stop();

      assert.ok(local);
      assert.ok(balance);
      assert.equal(balance, 1);
    });

    it('can create PSBTs', async function () {
      await bitcoin.start();
      await bitcoin._loadWallet();
      const address = await bitcoin.getUnusedAddress();
      const psbt = await bitcoin._buildPSBT({
        inputs: [],
        outputs: [{
          address: address,
          value: 10000
        }]
      });
      await bitcoin.stop();
      assert.ok(psbt);
    });
  });
});
