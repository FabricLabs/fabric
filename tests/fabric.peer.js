'use strict';

// Dependencies
const crypto = require('crypto');
const Peer = require('../types/peer');
const Message = require('../types/message');
const Key = require('../types/key');
const Actor = require('../types/actor');
const assert = require('assert');
const net = require('net');
const { EventEmitter } = require('events');

// Node configs may be JSON (node-a.json) or JS; resolve accordingly
let NODEA, NODEB;
try {
  NODEA = require('../settings/node-a');
} catch (e) {
  NODEA = { key: {} };
}
try {
  NODEB = require('../settings/node-b');
} catch (e) {
  NODEB = { key: {} };
}

// Settings
const settings = {
  debug: process.env.DEBUG || false,
  // Avoid fixed ports in tests (can conflict with dev machines/CI).
  port: 0
};

async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      s.close(() => {
        if (!port) return reject(new Error('Could not allocate a free port'));
        resolve(port);
      });
    });
  });
}

describe('@fabric/core/types/peer', function () {
  this.timeout(30000);

  // Track all peers created during tests for cleanup
  const peers = [];

  // Cleanup hook to ensure all peers are stopped even if tests fail
  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') {
          await peer.stop();
        }
      } catch (error) {
        // Ignore cleanup errors to avoid masking test failures
        console.warn('[TEST:CLEANUP] Error stopping peer:', error.message);
      }
    }
    peers.length = 0; // Clear the array
  });

  describe('Peer', function () {
    it('is a constructor', function () {
      assert.equal(Peer instanceof Function, true);
    });

    it('can cleanly start and stop', async function () {
      const port = await getFreePort();
      const peer = new Peer({ ...settings, port, peers: [], upnp: false, networking: false, peersDb: null });
      peers.push(peer);

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    it('provides documentation', function () {
      const peer = new Peer({ listen: false, peersDb: null });
      assert.ok(peer.documentation);
      assert.strictEqual(peer.documentation.name, 'Fabric');
    });

    describe('getters', function () {
      it('exposes id from key.pubkey', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        assert.strictEqual(peer.id, peer.key.pubkey);
      });
      it('exposes pubkeyhash from key', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        assert.ok(peer.pubkeyhash);
      });
      it('exposes deprecated address from settings.interface or settings.address', function () {
        const peer = new Peer({ listen: false, peersDb: null, interface: '127.0.0.1' });
        assert.strictEqual(peer.address, '127.0.0.1');
      });
      it('exposes interface from settings', function () {
        const peer = new Peer({ listen: false, peersDb: null, interface: '0.0.0.0' });
        assert.strictEqual(peer.interface, '0.0.0.0');
      });
      it('exposes port from settings or 7777', function () {
        const peer = new Peer({ listen: false, peersDb: null, port: 9999 });
        assert.strictEqual(peer.port, 9999);
      });
      it('publicPeers returns empty when no connections', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const list = peer.publicPeers;
        assert.ok(Array.isArray(list));
      });
      it('knownPeers returns registry and connection overlay', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer._state.peers = { id1: { id: 'id1', address: '127.0.0.1:7777', score: 0 } };
        const list = peer.knownPeers;
        assert.ok(Array.isArray(list));
        assert.ok(list.length >= 1);
      });
    });

    describe('_resolveToAddress', function () {
      it('returns null for null or non-string', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        assert.strictEqual(peer._resolveToAddress(null), null);
        assert.strictEqual(peer._resolveToAddress(123), null);
      });
      it('returns address when connection exists by address', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['127.0.0.1:9999'] = { _writeFabric: function () {} };
        assert.strictEqual(peer._resolveToAddress('127.0.0.1:9999'), '127.0.0.1:9999');
      });
      it('returns address when resolved via _addressToId', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['127.0.0.1:9999'] = { _writeFabric: function () {} };
        peer._addressToId = { '127.0.0.1:9999': 'somePeerId' };
        assert.strictEqual(peer._resolveToAddress('somePeerId'), '127.0.0.1:9999');
      });
      it('returns address when resolved via _state.peers', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['127.0.0.1:9999'] = { _writeFabric: function () {} };
        peer._state.peers = { someId: { id: 'someId', address: '127.0.0.1:9999' } };
        assert.strictEqual(peer._resolveToAddress('someId'), '127.0.0.1:9999');
      });
    });

    describe('beat', function () {
      it('emits beat and returns this', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('beat', (ev) => {
          assert.ok(ev.created);
          assert.ok(ev.initial);
          assert.ok(ev.state);
          done();
        });
        const out = peer.beat();
        assert.strictEqual(out, peer);
      });
    });

    describe('broadcast', function () {
      it('sends message to all connections except origin', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const buf = Buffer.from('hello');
        let writtenA = false;
        let writtenB = false;
        peer.connections['a'] = { _writeFabric: (m) => { writtenA = true; } };
        peer.connections['b'] = { _writeFabric: (m) => { writtenB = true; } };
        peer.broadcast(buf, 'a');
        assert.strictEqual(writtenA, false);
        assert.strictEqual(writtenB, true);
      });

      it('returns the number of edges written', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const buf = Buffer.from('count');
        peer.connections['a'] = { _writeFabric: () => {} };
        peer.connections['b'] = { _writeFabric: () => {} };
        assert.strictEqual(peer.broadcast(buf, 'a'), 1);
        assert.strictEqual(peer.broadcast(buf), 2);
      });
    });

    describe('connectTo', function () {
      it('calls _connect and returns this', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const out = peer.connectTo('127.0.0.1:9'); // invalid port, will fail but we only assert chain
        assert.strictEqual(out, peer);
      });
    });

    describe('relayFrom', function () {
      it('writes message to all connections except origin', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const msg = Message.fromVector(['P2P_PONG', JSON.stringify({ created: new Date().toISOString() })]);
        let written = false;
        peer.connections['b'] = { _writeFabric: (m) => { written = true; } };
        peer.relayFrom('a', msg);
        assert.strictEqual(written, true);
      });
    });

    describe('subscribe', function () {
      it('is a no-op', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        assert.doesNotThrow(() => peer.subscribe('/some/path'));
      });
    });

    describe('_connect', function () {
      it('emits error when target is empty or not a string', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('error', (msg) => {
          assert.ok(/target must be a non-empty string/.test(msg));
          done();
        });
        peer._connect('');
        peer._connect(null);
        peer._connect(123);
      });
      it('skips when already connected to target', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['127.0.0.1:9999'] = {};
        peer.once('debug', (msg) => {
          assert.ok(/Already connected/.test(msg));
          done();
        });
        peer._connect('127.0.0.1:9999');
      });

      it('skips overlapping outbound dials before connections[target] is set', function () {
        const originalCreateConnection = net.createConnection;
        const peer = new Peer({ listen: false, peersDb: null });
        let created = 0;
        let createdSocket = null;
        net.createConnection = function () {
          created += 1;
          const sock = new EventEmitter();
          sock.destroyed = false;
          sock.setTimeout = function () {};
          sock.unref = function () {};
          sock.destroy = function () {
            sock.destroyed = true;
            sock.emit('close');
          };
          createdSocket = sock;
          return sock;
        };
        try {
          peer._connect('127.0.0.1:9');
          peer._connect('127.0.0.1:9');
          assert.strictEqual(created, 1);
          assert.strictEqual(peer._outboundDialTargets.has('127.0.0.1:9'), true);
        } finally {
          net.createConnection = originalCreateConnection;
          if (createdSocket && typeof createdSocket.destroy === 'function') createdSocket.destroy();
          if (typeof peer._destroyFabric === 'function') {
            try { peer._destroyFabric(createdSocket || {}, '127.0.0.1:9'); } catch (_) { /* ignore */ }
          }
        }
      });

      it('canonicalizes pubkey@host:port onto the same outbound dial slot', function () {
        const originalCreateConnection = net.createConnection;
        const peer = new Peer({ listen: false, peersDb: null });
        let created = 0;
        let createdSocket = null;
        net.createConnection = function () {
          created += 1;
          const sock = new EventEmitter();
          sock.destroyed = false;
          sock.setTimeout = function () {};
          sock.unref = function () {};
          sock.destroy = function () {
            sock.destroyed = true;
            sock.emit('close');
          };
          createdSocket = sock;
          return sock;
        };
        try {
          peer._connect('aa'.repeat(32) + '@127.0.0.1:9');
          peer._connect('127.0.0.1:9');
          assert.strictEqual(created, 1);
          assert.strictEqual(peer._outboundDialTargets.has('127.0.0.1:9'), true);
        } finally {
          net.createConnection = originalCreateConnection;
          if (createdSocket && typeof createdSocket.destroy === 'function') createdSocket.destroy();
          if (typeof peer._destroyFabric === 'function') {
            try { peer._destroyFabric(createdSocket || {}, '127.0.0.1:9'); } catch (_) { /* ignore */ }
          }
        }
      });

      it('emits derived key debug summaries for missing/short/long public keys', function () {
        const originalCreateConnection = net.createConnection;
        net.createConnection = function () {
          throw new Error('stop-after-debug');
        };

        const peer = new Peer({ listen: false, peersDb: null, debug: true });
        const seen = [];
        peer.on('debug', (msg) => {
          if (String(msg).includes('Local derived key')) seen.push(String(msg));
        });

        const cases = [
          null,
          { settings: {} },
          { settings: { public: 'abcd' } },
          { settings: { public: 'a'.repeat(66) } }
        ];

        try {
          for (const derived of cases) {
            peer.identity.key.derive = () => derived;
            try {
              peer._connect('127.0.0.1:9001');
            } catch (e) {
              assert.ok(/stop-after-debug/.test(e.message));
            }
          }
        } finally {
          net.createConnection = originalCreateConnection;
        }

        assert.ok(seen.some((m) => m.includes('(unavailable)')));
        assert.ok(seen.some((m) => m.includes('(no public key)')));
        assert.ok(seen.some((m) => m.includes('abcd')));
        assert.ok(seen.some((m) => m.includes('…')));
      });
    });

    describe('_disconnect', function () {
      it('returns false when no socket for address', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        assert.strictEqual(peer._disconnect('nonexistent'), false);
      });
      it('removes connection and emits connections:close', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const fakeSocket = { destroy: () => {}, _keepalive: null, heartbeat: null };
        peer.connections['addr'] = fakeSocket;
        peer.peers['addr'] = {};
        peer.once('connections:close', (ev) => {
          assert.strictEqual(ev.address, 'addr');
          assert.strictEqual(peer.connections['addr'], undefined);
          done();
        });
        assert.strictEqual(peer._disconnect('addr'), true);
      });
    });

    describe('_maintainConnection', function () {
      it('returns Error when connection does not exist', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const out = peer._maintainConnection('nonexistent');
        assert.ok(out instanceof Error);
        assert.ok(/does not exist/.test(out.message));
      });
    });

    describe('_updateLiveness', function () {
      it('returns Error and emits error when no connection', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('error', (msg) => {
          assert.ok(/No connection/.test(msg));
          done();
        });
        const out = peer._updateLiveness('nonexistent');
        assert.ok(out instanceof Error);
      });
      it('sets _lastMessage and returns this when connection exists', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['addr'] = {};
        const out = peer._updateLiveness('addr');
        assert.strictEqual(out, peer);
        assert.ok(peer.connections['addr']._lastMessage);
      });
    });

    describe('_registerHandler', function () {
      it('registers handler and returns it', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const fn = function () { return 1; };
        const out = peer._registerHandler('testType', fn);
        assert.strictEqual(peer.handlers['testType'], out);
      });
      it('returns Error when handler already registered', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer._registerHandler('dup', function () {});
        const out = peer._registerHandler('dup', function () {});
        assert.ok(out instanceof Error);
        assert.ok(/already registered/.test(out.message));
      });
    });

    describe('_setState', async function () {
      it('returns Error when value is falsy', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const out = await peer._setState(null);
        assert.ok(out instanceof Error);
      });
      it('sets _state.content and returns state when value provided', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const value = { foo: 'bar' };
        const out = await peer._setState(value);
        assert.ok(peer._state.content && peer._state.content.foo === 'bar');
        assert.ok(out && out.foo === 'bar');
      });
    });

    describe('_requestStateFromAllPeers', function () {
      it('broadcasts StateRequest message', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let broadcasted = false;
        peer.broadcast = (msg) => { broadcasted = true; };
        return peer._requestStateFromAllPeers().then(() => {
          assert.strictEqual(broadcasted, true);
        });
      });
    });

    describe('_scheduleReconnect', function () {
      it('schedules _connect after delay', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const orig = peer._connect;
        peer._connect = (target) => {
          assert.strictEqual(target, '127.0.0.1:7777');
          done();
        };
        peer._scheduleReconnect('127.0.0.1:7777', 10);
      });
    });

    describe('_selectBestPeerCandidate', function () {
      it('returns first candidate when peers exist', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.peers = { a: { score: 1 }, b: { score: 2 } };
        const out = peer._selectBestPeerCandidate();
        assert.ok(Array.isArray(out) || out === null);
      });
    });

    describe('_announceAlias', function () {
      it('broadcasts P2P_PEER_ALIAS', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let broadcasted = false;
        peer.broadcast = (buf, origin) => { broadcasted = true; };
        peer._announceAlias('myalias', { name: 'origin' }, null);
        assert.strictEqual(broadcasted, true);
      });

      it('receives UTF-8 P2P_PEER_ALIAS and relays bit-identical', function () {
        const Message = require('../types/message');
        const Key = require('../types/key');
        const hub = new Peer({ listen: false, peersDb: null });
        const author = new Key();
        const origin = '127.0.0.1:7700';
        const relayWrites = [];
        hub.connections[origin] = { _writeFabric: () => {}, destroy: () => {} };
        hub.connections['127.0.0.1:7701'] = {
          _writeFabric: (buf) => relayWrites.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)),
          destroy: () => {}
        };
        hub.peers[origin] = { id: 'relay-peer', publicKey: hub.key.pubkey };

        const msg = Message.fromVector(['P2P_PEER_ALIAS', 'Neorion']);
        msg.signWithKey(author);
        const original = msg.toBuffer();

        let ev = null;
        hub.once('peerAlias', (e) => { ev = e; });
        hub._handleFabricMessage(original, { name: origin }, null);

        assert.ok(ev);
        assert.strictEqual(ev.alias, 'Neorion');
        assert.ok(relayWrites.length >= 1);
        assert.ok(relayWrites[0].equals(original));
      });
    });

    describe('_fillPeerSlots', function () {
      it('does nothing when constraints.peers.max is 0', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.candidates = [{ object: { host: '127.0.0.1', port: 9999 } }];
        peer._fillPeerSlots();
        assert.strictEqual(peer.candidates.length, 1);
      });

      it('does not immediately redial the same candidate', function () {
        const peer = new Peer({ listen: false, peersDb: null, networking: false });
        peer.settings.constraints.peers.max = 8;
        peer.settings.peering = { candidateRetryMs: 60000 };
        let dials = 0;
        peer._connect = () => { dials += 1; };
        peer._enqueuePeeringCandidate('192.0.2.77', 7778);
        peer._fillPeerSlots();
        peer._fillPeerSlots();
        assert.strictEqual(dials, 1);
        assert.strictEqual(peer.candidates.length, 1);
      });
    });

    describe('_registerContract', function () {
      it('registers contract and emits contractset', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('contractset', (contracts) => {
          assert.ok(contracts[peer.contracts[Object.keys(peer.contracts)[0]].id]);
          done();
        });
        peer._registerContract({ id: 'c1', state: {} });
      });
    });

    describe('listen', function () {
      async function assertListenRejectsQuickly (peer, timeoutMs = 1500) {
        return Promise.race([
          peer.listen().then(() => {
            throw new Error('listen should reject');
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('listen timeout')), timeoutMs))
        ]);
      }

      it('start() rejects on non-EADDRINUSE listen failures', async function () {
        const peer = new Peer({
          ...settings,
          port: await getFreePort(),
          interface: '127.0.0.1',
          listen: true,
          peers: [],
          networking: false,
          peersDb: null
        });
        peers.push(peer);

        peer.listen = async function () {
          const err = new Error('synthetic listen failure');
          err.code = 'ECONNRESET';
          throw err;
        };

        let warningSeen = false;
        peer.on('warning', (msg) => {
          if (String(msg).includes('Could not listen')) warningSeen = true;
        });

        await assert.rejects(
          peer.start(),
          /Peer failed to listen: synthetic listen failure/
        );
        assert.strictEqual(warningSeen, true, 'expected warning on non-EADDRINUSE listen failure');
      });

      it('start() registers actor when listen is disabled', async function () {
        const port = await getFreePort();
        const peer = new Peer({
          ...settings,
          interface: '127.0.0.1',
          port,
          listen: false,
          peers: [],
          networking: false,
          peersDb: null
        });
        peers.push(peer);

        let actorName = null;
        const originalRegisterActor = peer._registerActor.bind(peer);
        peer._registerActor = function (actor) {
          actorName = actor && actor.name;
          return originalRegisterActor(actor);
        };

        await peer.start();
        assert.strictEqual(actorName, `127.0.0.1:${port}`);
      });

      it('start() retries with default attempts when listenPortAttempts is invalid', async function () {
        let port = null;
        for (let i = 0; i < 40 && port == null; i++) {
          const candidate = await getFreePort();
          const probe = net.createServer();
          try {
            await new Promise((resolve, reject) => {
              probe.once('error', reject);
              probe.listen(candidate + 1, '127.0.0.1', resolve);
            });
            await new Promise((resolve) => probe.close(resolve));
            port = candidate;
          } catch (_) {
            probe.close();
          }
        }
        assert.ok(port != null, 'could not find a free basePort with free basePort+1');

        const blocker = net.createServer();
        await new Promise((resolve, reject) => {
          blocker.once('error', reject);
          blocker.listen(port, '127.0.0.1', resolve);
        });

        const peer = new Peer({
          ...settings,
          port,
          interface: '127.0.0.1',
          listen: true,
          peers: [],
          networking: false,
          peersDb: null,
          listenPortAttempts: 0 // invalid -> should fall back to default (20)
        });
        peers.push(peer);

        try {
          await peer.start();
          assert.ok(
            peer.settings.port > port && peer.settings.port <= port + 19,
            `should leave busy basePort ${port}; got ${peer.settings.port}`
          );
        } finally {
          await peer.stop().catch(() => {});
          await new Promise((resolve) => blocker.close(resolve));
        }
      });

      it('rejects when port in use (EADDRINUSE)', async function () {
        const port = await getFreePort();
        const other = net.createServer();
        await new Promise((resolve) => other.listen(port, '127.0.0.1', resolve));
        const peer = new Peer({ ...settings, port, listen: true, peers: [], networking: false, peersDb: null });
        peers.push(peer);
        peer.on('error', () => {}); // Prevent unhandled error when Peer emits on EADDRINUSE
        try {
          await peer.listen();
          assert.fail('expected listen to reject');
        } catch (e) {
          assert.ok(e, 'listen should reject when port is in use');
        } finally {
          other.close();
        }
      });

      it('rejects on invalid listen interface instead of hanging', async function () {
        const peer = new Peer({
          ...settings,
          port: await getFreePort(),
          interface: '203.0.113.250',
          listen: true,
          peers: [],
          networking: false,
          peersDb: null
        });
        peers.push(peer);

        let rejected = false;
        try {
          await assertListenRejectsQuickly(peer);
        } catch (error) {
          rejected = true;
          assert.notStrictEqual(error.message, 'listen timeout', 'listen should reject quickly on startup socket errors');
        }

        assert.strictEqual(rejected, true, 'listen should reject on invalid interface');
      });

      it('emits exactly one startup error event for invalid interface when listener exists', async function () {
        const peer = new Peer({
          ...settings,
          port: await getFreePort(),
          interface: '203.0.113.251',
          listen: true,
          peers: [],
          networking: false,
          peersDb: null
        });
        peers.push(peer);

        let errorsSeen = 0;
        peer.on('error', () => { errorsSeen++; });

        try {
          await assertListenRejectsQuickly(peer);
          assert.fail('listen should reject');
        } catch (error) {
          assert.notStrictEqual(error.message, 'listen timeout', 'listen should reject quickly on startup socket errors');
        }

        assert.strictEqual(errorsSeen, 1, 'expected exactly one startup error event');
      });

      it('start() binds the next port when the configured port is in use', async function () {
        const maxAttempts = 20;
        // Prefer a base where base+1 is also free so the happy path is +1; if the
        // suite has occupied neighbors, still accept any successful bump within
        // listenPortAttempts (that is the production contract).
        let port = null;
        for (let i = 0; i < 40 && port == null; i++) {
          const candidate = await getFreePort();
          const probe = net.createServer();
          try {
            await new Promise((resolve, reject) => {
              probe.once('error', reject);
              probe.listen(candidate + 1, '127.0.0.1', resolve);
            });
            await new Promise((resolve) => probe.close(resolve));
            port = candidate;
          } catch (_) {
            probe.close();
          }
        }
        assert.ok(port != null, 'could not find a free basePort with free basePort+1');

        const blocker = net.createServer();
        await new Promise((resolve, reject) => {
          blocker.once('error', reject);
          blocker.listen(port, '127.0.0.1', resolve);
        });

        const peer = new Peer({
          ...settings,
          port,
          interface: '127.0.0.1',
          listen: true,
          peers: [],
          networking: false,
          peersDb: null,
          listenPortAttempts: maxAttempts
        });
        peers.push(peer);

        try {
          await peer.start();
          assert.ok(
            peer.settings.port > port && peer.settings.port <= port + maxAttempts - 1,
            `should leave busy basePort ${port}; got ${peer.settings.port}`
          );
          // With +1 probed free and listen() recreating the server after EADDRINUSE,
          // the common case is exact +1; allow a higher bump only if another test
          // raced onto +1 between probe and start().
          assert.ok(
            peer.listenAddress && String(peer.listenAddress).includes(`:${peer.settings.port}`),
            `listenAddress should include :${peer.settings.port}, got ${peer.listenAddress}`
          );
        } finally {
          await peer.stop().catch(() => {});
          await new Promise((resolve) => blocker.close(resolve));
        }
      });
    });

    describe('_handleFabricMessage', function () {
      it('ignores duplicate message (same hash)', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const content = { type: 'INVENTORY_REQUEST', object: {} };
        const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(content)]);
        msg.signWithKey(peer.key);
        const buf = msg.toBuffer();
        peer._handleFabricMessage(buf, { name: 'o' });
        peer._handleFabricMessage(buf, { name: 'o' });
        assert.ok(peer.messages[crypto.createHash('sha256').update(buf).digest('hex')]);
      });
      it('drops on incorrect body hash (wire integrity)', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({ type: 'INVENTORY_REQUEST', object: {} })]);
        msg.signWithKey(peer.key);
        const buf = msg.toBuffer();
        const origFromBuffer = Message.fromBuffer;
        Message.fromBuffer = (b) => {
          const m = origFromBuffer(b);
          m.raw.hash = Buffer.alloc(32, 0);
          return m;
        };
        try {
          let warned = false;
          peer.once('warning', (w) => {
            if (/body hash mismatch/i.test(String(w))) warned = true;
          });
          peer._handleFabricMessage(buf, { name: 'o' });
          assert.ok(warned, 'expected warning when body hash does not match payload');
        } finally {
          Message.fromBuffer = origFromBuffer;
        }
      });
      it('emits warning when inbound signature does not match stored peer public key', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const expectedSigner = new Key();
        const other = new Key();
        peer.peers.o = { publicKey: expectedSigner.public.encodeCompressed('hex') };
        // Use a non-relay-as-is type so TCP peer pin still applies (inventory is mesh-relayable).
        const msg = Message.fromVector(['P2P_DOCUMENT_PUBLISH', JSON.stringify({ id: 'x', content: 'y' })]);
        msg.signWithKey(other);
        let warned = false;
        let errored = false;
        peer.once('warning', (w) => {
          if (/Signer mismatch/.test(String(w))) warned = true;
        });
        peer.once('error', () => { errored = true; });
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
        assert.ok(warned);
        assert.ok(!errored);
      });
      it('emits debug for unhandled message type', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const msg = Message.fromVector(['IdentityRequest', JSON.stringify({})]);
        msg.signWithKey(peer.key);
        const buf = msg.toBuffer();
        peer.once('debug', (m) => {
          assert.ok(/Unhandled message type/.test(m));
          done();
        });
        peer._handleFabricMessage(buf, { name: 'o' });
      });
      it('does not escalate INVENTORY_REQUEST from P2P_BASE_MESSAGE (generic carrier)', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.on('inventory', () => done(new Error('generic carrier must not emit inventory')));
        peer.on('warning', (w) => {
          if (/Ignoring INVENTORY_REQUEST via generic carrier/.test(String(w))) done();
        });
        const content = { type: 'INVENTORY_REQUEST', object: {}, message: {}, origin: {} };
        const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(content)]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
      });
      it('does not escalate INVENTORY_REQUEST from outer GENERIC_MESSAGE (15103)', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.on('inventory', () => done(new Error('generic carrier must not emit inventory')));
        peer.on('warning', (w) => {
          if (/Ignoring INVENTORY_REQUEST via generic carrier/.test(String(w))) done();
        });
        const content = { type: 'INVENTORY_REQUEST', object: {}, message: {}, origin: {} };
        const msg = Message.fromVector(['GenericMessage', JSON.stringify(content)]);
        assert.strictEqual(msg.type, 'GENERIC_MESSAGE');
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
      });
      it('dispatches first-class P2P_INVENTORY_REQUEST to inventory', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('inventory', (ev) => {
          assert.strictEqual(ev.message.type, 'INVENTORY_REQUEST');
          done();
        });
        const msg = Message.fromVector(['P2P_INVENTORY_REQUEST', JSON.stringify({ offerBtc: true })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
      });
      it('warns and skips _handleGenericMessage when GenericMessage JSON is not an object', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let warned = 0;
        let inventory = 0;
        peer.on('warning', (w) => {
          if (/Generic message body must be a JSON object/.test(String(w))) warned++;
        });
        peer.on('inventory', () => { inventory++; });
        for (const body of [ '[]', '"x"', 'null', '1', 'true' ]) {
          const msg = Message.fromVector(['P2P_BASE_MESSAGE', body]);
          msg.signWithKey(peer.key);
          peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
        }
        assert.strictEqual(warned, 5);
        assert.strictEqual(inventory, 0);
      });
      it('emits lightning for Lightning type with non-JSON body', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const msg = Message.fromVector(['LightningInit', 'x']);
        msg.signWithKey(peer.key);
        peer.once('lightning', (ev) => {
          assert.strictEqual(ev.type, 'LIGHTNING_INIT');
          assert.ok(ev.raw !== undefined);
          done();
        });
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
      });
      it('emits documentRequest and DocumentRequest for DOCUMENT_REQUEST', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let n = 0;
        peer.on('documentRequest', (ev) => {
          assert.strictEqual(ev.documentId, 'doc-wire-x');
          assert.strictEqual(ev.source, 'canonical');
          n++;
        });
        peer.on('DocumentRequest', (ev) => {
          assert.strictEqual(ev.documentId, 'doc-wire-x');
          n++;
        });
        peer.relayFrom = () => {};
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({ document: 'doc-wire-x' })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' }, null);
        assert.strictEqual(n, 2);
      });
      it('DOCUMENT_REQUEST is relayed when document is not held locally', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let relayed = 0;
        peer.relayFrom = () => { relayed++; };
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({ document: 'missing-doc' })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'requester:9' }, null);
        assert.strictEqual(relayed, 1);
      });
      it('DOCUMENT_REQUEST is answered with P2P_FILE_SEND when document is held', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          // Opt in: default is consent-queue (autoFulfillDocumentRequests: false).
          autoFulfillDocumentRequests: true
        });
        peer._state.content.documents = { 'doc-held': 'payload-bytes' };
        let written = null;
        peer.connections['requester:8'] = {
          _writeFabric: (buf) => { written = buf; }
        };
        let relayed = 0;
        peer.relayFrom = () => { relayed++; };
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({ document: 'doc-held' })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'requester:8' }, null);
        assert.strictEqual(relayed, 0);
        assert.ok(written && written.length);
        const back = Message.fromBuffer(written);
        const body = JSON.parse(back.data);
        assert.strictEqual(back.type, 'P2P_FILE_SEND');
        assert.strictEqual(body.name, 'doc-held');
        assert.strictEqual(Buffer.from(body.body, 'base64').toString('utf8'), 'payload-bytes');
        assert.strictEqual(body.blobIndex, 0);
        assert.strictEqual(body.blobTotal, 1);
        assert.ok(/^[0-9a-f]{64}$/.test(body.blobHashHex));
        assert.ok(/^[0-9a-f]{64}$/.test(body.merkleRootHex));
      });
      it('multi-blob P2P_FILE_SEND reassembles and rejects wrong bytes', function () {
        const seller = new Peer({ listen: false, peersDb: null, sealPricedDocuments: false });
        const buyer = new Peer({ listen: false, peersDb: null });
        const payload = Buffer.alloc(5000, 0x7a).toString('utf8');
        seller._state.content.documents = { 'doc-xl': payload };
        seller.settings.inventoryBlobChunkBytes = 1200;
        const frames = [];
        seller.connections['buyer:1'] = {
          _writeFabric: (buf) => {
            frames.push(buf);
            buyer._handleFabricMessage(buf, { name: 'seller:1' }, null);
          }
        };
        let received = null;
        let rejected = null;
        buyer.on('documentReceived', (ev) => { received = ev; });
        buyer.on('documentBlobRejected', (ev) => { rejected = ev; });
        assert.ok(seller._sendP2pFileSendToPeer('doc-xl', 'buyer:1'));
        assert.ok(frames.length > 1);
        assert.ok(received && received.verified);
        assert.strictEqual(received.buffer.toString('utf8'), payload);

        // Tamper one frame after the fact: direct ingest of wrong body.
        const badMsg = Message.fromVector(['P2P_FILE_SEND', JSON.stringify({
          name: 'doc-evil',
          body: Buffer.alloc(1200, 1).toString('base64'),
          blobIndex: 0,
          blobTotal: 2,
          blobHashHex: '11'.repeat(32),
          merkleRootHex: '22'.repeat(32)
        })]);
        badMsg.signWithKey(seller.key);
        buyer._handleFabricMessage(badMsg.toBuffer(), { name: 'seller:1' }, null);
        assert.ok(rejected && /hash mismatch|rejected/i.test(String(rejected.error || 'rejected')));
      });
      it('sealed priced doc: ciphertext without key; open only after settlement authorize', function () {
        const seller = new Peer({
          listen: false,
          peersDb: null,
          sealPricedDocuments: true,
          // Exercise settlement → DOCUMENT_REQUEST auto-fulfill path (off by default).
          autoFulfillDocumentRequests: true
        });
        const buyer = new Peer({ listen: false, peersDb: null });
        const secret = 'sealed-secret-' + 'Z'.repeat(3000);
        seller._publishDocument('doc-seal', secret, 250);
        const meta = seller._getDocumentSealedMeta('doc-seal');
        assert.ok(meta && meta.paymentHashHex);

        let opened = null;
        let cipher = null;
        buyer.on('documentCiphertextReceived', (ev) => { cipher = ev; });
        buyer.on('documentReceived', (ev) => { opened = ev; });

        seller.connections['buyer:2'] = {
          _writeFabric: (buf) => buyer._handleFabricMessage(buf, { name: 'seller:2' }, null)
        };

        // Unpaid request path: ciphertext only.
        assert.ok(seller._sendP2pFileSendToPeer('doc-seal', 'buyer:2', { revealKey: false }));
        assert.ok(cipher && cipher.verified);
        assert.strictEqual(opened, null);
        assert.ok(!buyer._state.content.documents['doc-seal']);

        // Explicit revealKey (seller-side after settlement) unlocks.
        assert.ok(seller._sendP2pFileSendToPeer('doc-seal', 'buyer:2', { revealKey: true }));
        assert.ok(opened && opened.opened && opened.verified);
        assert.strictEqual(opened.buffer.toString('utf8'), secret);

        // DocumentRequest echoing public paymentHash alone must not unlock.
        const buyer2 = new Peer({ listen: false, peersDb: null });
        let opened2 = null;
        buyer2.on('documentReceived', (ev) => { opened2 = ev; });
        seller.connections['buyer:3'] = {
          _writeFabric: (buf) => buyer2._handleFabricMessage(buf, { name: 'seller:3' }, null)
        };
        const echoReq = Message.fromVector(['DocumentRequest', JSON.stringify({
          document: 'doc-seal',
          contentHashHex: meta.paymentHashHex
        })]);
        echoReq.signWithKey(buyer2.key);
        seller._handleFabricMessage(echoReq.toBuffer(), { name: 'buyer:3' }, null);
        assert.strictEqual(opened2, null);

        // After authorizeDocumentKeyReveal, matching request unlocks via auto-fulfill.
        const buyer3 = new Peer({ listen: false, peersDb: null });
        let opened3 = null;
        buyer3.on('documentReceived', (ev) => { opened3 = ev; });
        seller.connections['buyer:4'] = {
          _writeFabric: (buf) => buyer3._handleFabricMessage(buf, { name: 'seller:4' }, null)
        };
        const auth = seller.authorizeDocumentKeyReveal({
          documentId: 'doc-seal',
          contentHashHex: meta.paymentHashHex,
          settlementId: 'test-settlement'
        });
        assert.ok(auth.ok, auth.error);
        const okReq = Message.fromVector(['DocumentRequest', JSON.stringify({
          document: 'doc-seal',
          contentHashHex: meta.paymentHashHex
        })]);
        okReq.signWithKey(buyer3.key);
        seller._handleFabricMessage(okReq.toBuffer(), { name: 'buyer:4' }, null);
        assert.ok(opened3 && opened3.opened);
        assert.strictEqual(opened3.buffer.toString('utf8'), secret);
      });
      it('junk DocumentContentKeyReveal cannot burn sealed open slot', function () {
        const {
          prepareSealedSale,
          buildKeyRevealMessage,
          KEY_REVEAL_TYPE
        } = require('../functions/documentSealedExchange');
        const buyer = new Peer({ listen: false, peersDb: null });
        const attacker = new Key();
        const seller = new Key();
        const sale = prepareSealedSale(Buffer.from('cooperative-secret', 'utf8'));
        const docId = 'doc-reveal-dos';
        buyer.pendingSealedDeliveries[docId] = {
          ciphertext: sale.ciphertext,
          merkleRootHex: 'aa'.repeat(32),
          paymentHashHex: sale.paymentHashHex,
          iv: sale.encryption.iv,
          plaintextSha256: sale.plaintextSha256,
          origin: { name: 'seller' },
          updated: Date.now()
        };

        let opened = null;
        let warned = 0;
        buyer.on('documentReceived', (ev) => { opened = ev; });
        buyer.on('warning', (msg) => {
          if (/DocumentContentKeyReveal rejected/i.test(String(msg))) warned++;
        });

        // Attacker echoes public paymentHash with a wrong key — must not claim the slot.
        const junkBody = {
          type: KEY_REVEAL_TYPE,
          object: {
            documentId: docId,
            keyHex: '00'.repeat(32),
            paymentHashHex: sale.paymentHashHex
          }
        };
        const junkMsg = Message.fromVector(['GenericMessage', JSON.stringify(junkBody)]).signWithKey(attacker);
        buyer._handleFabricMessage(junkMsg.toBuffer(), { name: 'attacker:1' }, null);
        assert.ok(warned >= 1);
        assert.strictEqual(opened, null);
        assert.ok(buyer.pendingSealedDeliveries[docId]);
        const logicKey = buyer._logicalRegistrationKey('DocumentContentKeyReveal', junkBody.object);
        assert.strictEqual(logicKey, null);

        // Seller's real reveal still opens.
        const good = buildKeyRevealMessage({
          documentId: docId,
          keyHex: sale.keyHex,
          paymentHashHex: sale.paymentHashHex,
          iv: sale.encryption.iv,
          plaintextSha256: sale.plaintextSha256
        });
        const goodMsg = Message.fromVector(['GenericMessage', JSON.stringify(good)]).signWithKey(seller);
        buyer._handleFabricMessage(goodMsg.toBuffer(), { name: 'seller:1' }, null);
        assert.ok(opened && opened.opened);
        assert.strictEqual(opened.buffer.toString('utf8'), 'cooperative-secret');
        assert.ok(!buyer.pendingSealedDeliveries[docId]);
      });
      it('DOCUMENT_REQUEST queues pending when autoFulfillDocumentRequests is false', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          autoFulfillDocumentRequests: false
        });
        peer._state.content.documents = { 'doc-consent': 'secret' };
        let written = null;
        let pending = null;
        peer.connections['buyer:1'] = {
          _writeFabric: (buf) => { written = buf; }
        };
        peer.on('documentRequestPending', (row) => { pending = row; });
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({ document: 'doc-consent' })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'buyer:1' }, null);
        assert.strictEqual(written, null);
        assert.ok(pending && pending.key);
        assert.strictEqual(pending.documentId, 'doc-consent');
        assert.strictEqual(peer.listPendingDocumentRequests().length, 1);

        const approved = peer.approveDocumentRequest(pending.key);
        assert.strictEqual(approved.ok, true);
        assert.ok(written && written.length);
        const back = Message.fromBuffer(written);
        assert.strictEqual(back.type, 'P2P_FILE_SEND');
        assert.strictEqual(peer.listPendingDocumentRequests().length, 0);
      });
      it('denyDocumentRequest drops pending without sending file', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          autoFulfillDocumentRequests: false
        });
        peer._state.content.documents = { 'doc-deny': 'x' };
        let writes = 0;
        peer.connections['buyer:2'] = {
          _writeFabric: () => { writes++; }
        };
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({ document: 'doc-deny' })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'buyer:2' }, null);
        const key = peer.listPendingDocumentRequests()[0].key;
        const denied = peer.denyDocumentRequest(key);
        assert.strictEqual(denied.ok, true);
        assert.strictEqual(writes, 0);
        assert.strictEqual(peer.listPendingDocumentRequests().length, 0);
      });
      it('requestPeerInventory writes P2P_INVENTORY_REQUEST', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let written = null;
        peer.connections['seller:7'] = {
          _writeFabric: (buf) => { written = buf; }
        };
        assert.strictEqual(peer.requestPeerInventory('seller:7', { kind: 'documents' }), true);
        const back = Message.fromBuffer(written);
        assert.strictEqual(back.type, 'P2P_INVENTORY_REQUEST');
        const body = JSON.parse(back.data);
        assert.strictEqual(body.kind, 'documents');
      });
      it('requestDocument directs DocumentRequest to one peer', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let written = null;
        peer.connections['seller:3'] = {
          _writeFabric: (buf) => { written = buf; }
        };
        assert.strictEqual(peer.requestDocument('abc', 'seller:3'), true);
        const back = Message.fromBuffer(written);
        assert.ok(back.type === 'DocumentRequest' || back.type === 'DOCUMENT_REQUEST');
        assert.strictEqual(JSON.parse(back.data).document, 'abc');
      });
      it('private relay rewrites budgeted DocumentRequest instead of bit-identical forward', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          relayPrivateDocumentRequests: true,
          documentRelayFeeSats: 10,
          documentRelayMaxHops: 4
        });
        let relayedIdentical = 0;
        let broadcastCalls = 0;
        peer.relayFrom = () => { relayedIdentical++; };
        peer.broadcast = () => { broadcastCalls++; };
        const outs = [];
        peer.connections['seller:next'] = {
          _writeFabric: (buf) => { outs.push(buf); }
        };
        peer.connections['buyer:1'] = {
          _writeFabric: () => { throw new Error('must not bounce rewrite to origin'); }
        };
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({
          document: 'missing-doc',
          maxSats: 100,
          relayHop: 3,
          routeId: 'aabbccdd'
        })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'buyer:1' }, null);
        assert.strictEqual(relayedIdentical, 0);
        assert.strictEqual(broadcastCalls, 0, 'private relay must not mesh-broadcast');
        assert.strictEqual(outs.length, 1);
        const body = JSON.parse(Message.fromBuffer(outs[0]).data);
        assert.strictEqual(body.document, 'missing-doc');
        assert.strictEqual(body.maxSats, 90);
        assert.strictEqual(body.relayHop, 2);
        assert.ok(body.routeId);
        assert.notStrictEqual(body.routeId, 'aabbccdd');
      });
      it('private relay honors nextPeer for a single directed hop', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          relayPrivateDocumentRequests: true,
          documentRelayFeeSats: 5,
          documentRelayMaxHops: 4
        });
        const outs = { a: 0, b: 0 };
        peer.connections['peer:a'] = { _writeFabric: () => { outs.a++; } };
        peer.connections['peer:b'] = { _writeFabric: () => { outs.b++; } };
        const msg = Message.fromVector(['DocumentRequest', JSON.stringify({
          document: 'missing-doc',
          maxSats: 50,
          relayHop: 2,
          nextPeer: 'peer:b'
        })]);
        msg.signWithKey(peer.key);
        peer._handleFabricMessage(msg.toBuffer(), { name: 'buyer:9' }, null);
        assert.strictEqual(outs.a, 0);
        assert.strictEqual(outs.b, 1);
      });
      it('authorizeDocumentKeyReveal requires settlementId or txid', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const missing = peer.authorizeDocumentKeyReveal({
          documentId: 'd1',
          contentHashHex: 'ab'.repeat(32)
        });
        assert.strictEqual(missing.ok, false);
        assert.match(missing.error, /settlementId or txid/);
        const ok = peer.authorizeDocumentKeyReveal({
          documentId: 'd1',
          contentHashHex: 'ab'.repeat(32),
          settlementId: 's1'
        });
        assert.strictEqual(ok.ok, true);
      });
      it('forceReveal is ignored unless allowForceDocumentKeyReveal is set', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          autoFulfillDocumentRequests: false,
          allowForceDocumentKeyReveal: false,
          sealPricedDocuments: true
        });
        peer._publishDocument('doc-force', 'secret-force', 50);
        const meta = peer._getDocumentSealedMeta('doc-force');
        assert.ok(meta && meta.paymentHashHex);
        const pending = peer._queuePendingDocumentRequest('doc-force', { name: 'buyer:f' }, {
          document: 'doc-force',
          contentHashHex: meta.paymentHashHex
        });
        peer.connections['buyer:f'] = { _writeFabric: () => {} };
        assert.strictEqual(
          peer._mayRevealDocumentContentKey('doc-force', meta.paymentHashHex, {
            contentHashHex: meta.paymentHashHex
          }, { forceReveal: true }),
          false
        );
        peer.settings.allowForceDocumentKeyReveal = true;
        assert.strictEqual(
          peer._mayRevealDocumentContentKey('doc-force', meta.paymentHashHex, {
            contentHashHex: meta.paymentHashHex
          }, { forceReveal: true }),
          true
        );
        assert.ok(pending.key);
      });
    });

    describe('_handleGenericMessage', function () {
      it('emits debug for unhandled generic type', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('debug', (m) => {
          assert.ok(/Unhandled Generic Message/.test(m));
          done();
        });
        peer._handleGenericMessage({ type: 'UNKNOWN_TYPE', object: {} }, { name: 'o' });
      });
      it('emits warning on broken JSON body in Fabric message path', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const msg = Message.fromVector(['P2P_BASE_MESSAGE', 'not json']);
        msg.signWithKey(peer.key);
        peer.once('warning', (m) => {
          assert.ok(/Generic message parse failed/.test(m));
          done();
        });
        peer._handleFabricMessage(msg.toBuffer(), { name: 'o' });
      });
      it('emits inventory for INVENTORY_REQUEST', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('inventory', (ev) => {
          assert.ok(ev.message);
          assert.ok(ev.origin);
          done();
        });
        peer._handleGenericMessage({ type: 'INVENTORY_REQUEST', object: {}, message: {}, origin: {} }, { name: 'o' });
      });
      it('normalizes FABRIC_DOCUMENT_OFFER envelope to INVENTORY_REQUEST', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('inventory', (ev) => {
          assert.strictEqual(ev.message.type, 'INVENTORY_REQUEST');
          done();
        });
        peer._handleGenericMessage({ type: 'FABRIC_DOCUMENT_OFFER', object: {}, message: {}, origin: {} }, { name: 'o' });
      });
      it('normalizes FABRIC_DOCUMENT_OFFER_RESPONSE envelope to INVENTORY_RESPONSE', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('inventoryResponse', (ev) => {
          assert.strictEqual(ev.message.type, 'INVENTORY_RESPONSE');
          done();
        });
        peer._handleGenericMessage({ type: 'FABRIC_DOCUMENT_OFFER_RESPONSE', object: { kind: 'documents', items: [] } }, { name: 'o' });
      });
      it('serveLocalDocumentInventory sends INVENTORY_RESPONSE for offerBtc requests', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true });
        peer._state.content.documents = { doca: 'hello' };
        peer._state.content.documentRates = { doca: 1000 };
        let written = null;
        peer.connections['127.0.0.1:11'] = {
          _writeFabric: (b) => { written = b; }
        };
        peer._handleGenericMessage({
          type: 'INVENTORY_REQUEST',
          object: { offerBtc: true, maxSats: 500_000 }
        }, { name: '127.0.0.1:11' });
        assert.ok(written && written.length);
        const back = Message.fromBuffer(written);
        const inner = JSON.parse(back.data);
        assert.strictEqual(back.type, 'P2P_INVENTORY_RESPONSE');
        assert.strictEqual(inner.kind, 'documents');
        assert.strictEqual(inner.items.length, 1);
        assert.strictEqual(inner.items[0].id, 'doca');
        assert.strictEqual(inner.items[0].rateSats, 1000);
        assert.ok(/^[0-9a-f]{64}$/.test(inner.items[0].contentHash));
      });
      it('serveLocalDocumentInventory skips items above maxSats', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true });
        peer._state.content.documents = { cheap: 'a', pricey: 'b' };
        peer._state.content.documentRates = { cheap: 100, pricey: 999_999 };
        const items = [];
        peer.connections['127.0.0.1:12'] = {
          _writeFabric: (b) => {
            const inner = JSON.parse(Message.fromBuffer(b).data);
            items.push(...(inner.items || []));
          }
        };
        peer._handleGenericMessage({
          type: 'INVENTORY_REQUEST',
          object: { offerBtc: true, maxSats: 500 }
        }, { name: '127.0.0.1:12' });
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].id, 'cheap');
      });
      it('serveLocalDocumentInventory does not respond without offerBtc', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true });
        peer._state.content.documents = { x: 'y' };
        let writes = 0;
        peer.connections['127.0.0.1:13'] = {
          _writeFabric: () => { writes++; }
        };
        peer._handleGenericMessage({
          type: 'INVENTORY_REQUEST',
          object: {}
        }, { name: '127.0.0.1:13' });
        assert.strictEqual(writes, 0);
      });
      it('serveLocalDocumentInventory responds to Hub-style kind:documents catalog requests', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true });
        peer._state.content.documents = { catdoc: 'hello catalog' };
        let written = null;
        peer.connections['127.0.0.1:14'] = {
          _writeFabric: (b) => { written = b; }
        };
        peer._handleGenericMessage({
          type: 'INVENTORY_REQUEST',
          object: { kind: 'documents', created: Date.now() }
        }, { name: '127.0.0.1:14' });
        assert.ok(written && written.length);
        const back = Message.fromBuffer(written);
        const inner = JSON.parse(back.data);
        assert.strictEqual(inner.kind, 'documents');
        assert.strictEqual(inner.items.length, 1);
        assert.strictEqual(inner.items[0].id, 'catdoc');
        assert.strictEqual(inner.items[0].published, true);
      });
      it('relayInventoryRequest relays offerBtc INVENTORY_REQUEST when no local items', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true, relayInventoryRequest: true });
        peer._state.content.documents = {};
        let relayed = null;
        peer.relayFrom = function (_origin, message) { relayed = message; };
        const payload = { type: 'INVENTORY_REQUEST', object: { offerBtc: true, maxSats: 1e6 } };
        const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(payload)]);
        wire.signWithKey(peer.key);
        const originalInner = wire.toBuffer();
        peer._handleGenericMessage(payload, { name: 'req:1' }, null, wire);
        assert.ok(relayed);
        // Forward original AMP bytes bit-identical (no hop re-sign / P2P_RELAY wrap).
        assert.ok(relayed.toBuffer().equals(originalInner));
        assert.strictEqual(relayed.type, 'P2P_BASE_MESSAGE');
      });
      it('relayInventoryRequest does not relay when local inventory responds', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true, relayInventoryRequest: true });
        peer._state.content.documents = { a: 'x' };
        peer._state.content.documentRates = { a: 1 };
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const payload = { type: 'INVENTORY_REQUEST', object: { offerBtc: true, maxSats: 1e6 } };
        const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(payload)]);
        wire.signWithKey(peer.key);
        peer.connections['req:2'] = { _writeFabric: () => {} };
        peer._handleGenericMessage(payload, { name: 'req:2' }, null, wire);
        assert.strictEqual(relays, 0);
      });
      it('relayInventoryRequest does not relay INVENTORY_REQUEST without offerBtc', function () {
        const peer = new Peer({ listen: false, peersDb: null, serveLocalDocumentInventory: true, relayInventoryRequest: true });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const payload = { type: 'INVENTORY_REQUEST', object: { maxSats: 1 } };
        const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(payload)]);
        wire.signWithKey(peer.key);
        peer._handleGenericMessage(payload, { name: 'req:3' }, null, wire);
        assert.strictEqual(relays, 0);
      });
      it('relayInventoryResponse relays INVENTORY_RESPONSE wire to other peers', function () {
        const peer = new Peer({ listen: false, peersDb: null, relayInventoryResponse: true });
        let relayed = null;
        peer.relayFrom = function (_origin, message) { relayed = message; };
        const payload = {
          type: 'INVENTORY_RESPONSE',
          object: { items: [{ id: 'd', rateSats: 0, contentHash: 'a'.repeat(64), network: 'bitcoin' }] }
        };
        const wire = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(payload)]);
        wire.signWithKey(peer.key);
        const originalInner = wire.toBuffer();
        peer._handleGenericMessage(payload, { name: 'from:peer' }, null, wire);
        assert.ok(relayed);
        assert.ok(relayed.toBuffer().equals(originalInner));
        assert.strictEqual(relayed.type, 'P2P_BASE_MESSAGE');
      });
      it('sendDocumentFileToPeer sends P2P_FILE_SEND when document is held', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer._state.content.documents = { d1: 'zz' };
        let written = null;
        peer.connections['p1'] = {
          _writeFabric: (b) => { written = b; }
        };
        assert.strictEqual(peer.sendDocumentFileToPeer('d1', 'p1'), true);
        const wire = Message.fromBuffer(written);
        const inner = JSON.parse(wire.data);
        assert.strictEqual(wire.type, 'P2P_FILE_SEND');
        assert.strictEqual(inner.name, 'd1');
        assert.strictEqual(Buffer.from(inner.body, 'base64').toString('utf8'), 'zz');
      });
      it('_announceLocalDocumentsToPeer writes canonical + pricing buffers per document', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer._state.content.documents = { doc1: 'a', doc2: 'bb' };
        peer._state.content.documentRates = { doc1: 500, doc2: 0 };
        const writes = [];
        peer.connections['peerZ'] = {
          _writeFabric: (b) => writes.push(b)
        };
        peer._announceLocalDocumentsToPeer('peerZ');
        assert.strictEqual(writes.length, 3);
        assert.strictEqual(Message.fromBuffer(writes[0]).type, 'DOCUMENT_PUBLISH');
        assert.strictEqual(Message.fromBuffer(writes[1]).type, 'P2P_DOCUMENT_PUBLISH');
        assert.strictEqual(Message.fromBuffer(writes[2]).type, 'DOCUMENT_PUBLISH');
      });
      it('handles P2P_STATE_ANNOUNCE', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('debug', (m) => {
          assert.ok(/state_announce/.test(m));
          done();
        });
        peer._handleGenericMessage({ type: 'P2P_STATE_ANNOUNCE', object: { state: {} } }, { name: 'o' });
      });
      it('handles P2P_PEER_ANNOUNCE and pushes candidate', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('debug', () => done());
        peer._handleGenericMessage({ type: 'P2P_PEER_ANNOUNCE', object: { host: '127.0.0.1', port: 7777 } }, { name: 'o' });
        assert.ok(peer.candidates.length >= 1);
      });
      it('P2P_PEER_GOSSIP dedupes logical payload (no relay amplification)', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:1' };
        const body = { type: 'P2P_PEER_GOSSIP', object: { host: '1.2.3.4', port: 9000 } };
        const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(body.object)]).signWithKey(peer.key);
        peer._handleGenericMessage(body, origin, null, wire);
        peer._handleGenericMessage({ ...body, object: { ...body.object } }, origin, null, wire);
        assert.strictEqual(relays, 1);
      });
      it('P2P_PEER_GOSSIP does not relay when gossipHop is 0', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:2' };
        const object = { host: '5.6.7.8', port: 1, gossipHop: 0 };
        const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({
          type: 'P2P_PEER_GOSSIP',
          object
        }, origin, null, wire);
        assert.strictEqual(relays, 0);
      });
      it('P2P_PEER_GOSSIP rate-limits relays per origin', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          gossip: { maxRelaysPerOriginPerMinute: 2 }
        });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:3' };
        for (let i = 0; i < 4; i++) {
          const object = { host: '9.8.7.6', port: 7000 + i };
          const wire = Message.fromVector(['P2P_PEER_GOSSIP', JSON.stringify(object)]).signWithKey(peer.key);
          peer._handleGenericMessage({
            type: 'P2P_PEER_GOSSIP',
            object
          }, origin, null, wire);
        }
        assert.strictEqual(relays, 2);
      });
      it('P2P_PEERING_OFFER dedupes logical payload (no relay amplification)', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:4' };
        const body = {
          type: 'P2P_PEERING_OFFER',
          object: { host: '1.2.3.4', port: 9000, transport: 'fabric' }
        };
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(body.object)]).signWithKey(peer.key);
        peer._handleGenericMessage(body, origin, null, wire);
        peer._handleGenericMessage({ ...body, object: { ...body.object } }, origin, null, wire);
        assert.strictEqual(relays, 1);
      });
      it('P2P_PEERING_OFFER does not relay when peeringHop is 0', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:5' };
        const object = { host: '5.6.7.8', port: 1, transport: 'fabric', peeringHop: 0 };
        const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
        peer._handleGenericMessage({
          type: 'P2P_PEERING_OFFER',
          object
        }, origin, null, wire);
        assert.strictEqual(relays, 0);
      });
      it('P2P_PEERING_OFFER rate-limits relays per origin', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          peering: { maxRelaysPerOriginPerMinute: 2 }
        });
        let relays = 0;
        peer.relayFrom = function () { relays++; };
        const origin = { name: '127.0.0.1:6' };
        for (let i = 0; i < 4; i++) {
          const object = { host: '9.8.7.6', port: 7000 + i, transport: 'fabric' };
          const wire = Message.fromVector(['P2P_PEERING_OFFER', JSON.stringify(object)]).signWithKey(peer.key);
          peer._handleGenericMessage({
            type: 'P2P_PEERING_OFFER',
            object
          }, origin, null, wire);
        }
        assert.strictEqual(relays, 2);
      });
      it('P2P_PEERING_OFFER caps and dedupes candidate queue', function () {
        const peer = new Peer({
          listen: false,
          peersDb: null,
          constraints: { peers: { max: 32 } },
          peering: { maxCandidates: 2 }
        });
        peer._handleGenericMessage({
          type: 'P2P_PEERING_OFFER',
          object: { host: '10.0.0.1', port: 1, transport: 'fabric' }
        }, { name: '127.0.0.1:7' });
        peer._handleGenericMessage({
          type: 'P2P_PEERING_OFFER',
          object: { host: '10.0.0.2', port: 2, transport: 'fabric' }
        }, { name: '127.0.0.1:8' });
        peer._handleGenericMessage({
          type: 'P2P_PEERING_OFFER',
          object: { host: '10.0.0.3', port: 3, transport: 'fabric' }
        }, { name: '127.0.0.1:9' });
        assert.strictEqual(peer.candidates.length, 2);
        assert.ok(peer.candidates.some((c) => c.host === '10.0.0.2'));
        assert.ok(peer.candidates.some((c) => c.host === '10.0.0.3'));
        peer._handleGenericMessage({
          type: 'P2P_PEERING_OFFER',
          object: { host: '10.0.0.2', port: 2, transport: 'fabric' }
        }, { name: '127.0.0.1:10' });
        assert.strictEqual(peer.candidates.length, 2);
      });
      it('emits file for P2P_FILE_SEND', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('file', (ev) => {
          assert.ok(ev.message);
          assert.strictEqual(ev.origin.name, 'o');
          done();
        });
        peer._handleGenericMessage({ type: 'P2P_FILE_SEND', object: {} }, { name: 'o' });
      });
      it('registers contract on CONTRACT_PUBLISH', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('contractset', () => done());
        peer._handleGenericMessage({ type: 'CONTRACT_PUBLISH', object: { id: 'c1', state: {} } }, { name: 'o' });
      });
      it('applies patch on CONTRACT_MESSAGE', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const publisher = new Key();
        const pub = String(publisher.pubkey).toLowerCase();
        peer._state.content.contracts = { c1: { value: 1 } };
        peer._mergeContractPatchAllowList('c1', { parties: [pub] }, pub);
        peer.once('commit', () => {
          assert.strictEqual(peer._state.content.contracts.c1.value, 2);
          done();
        });
        peer._handleGenericMessage({
          type: 'CONTRACT_MESSAGE',
          actor: { publicKey: pub },
          object: { contract: 'c1', ops: [{ op: 'replace', path: '/value', value: 2 }] }
        }, { name: 'o' });
      });
      it('rejects CONTRACT_MESSAGE ops from non-party signers', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const owner = new Key();
        const attacker = new Key();
        const ownerPub = String(owner.pubkey).toLowerCase();
        peer._state.content.contracts = { c1: { value: 1 } };
        peer._mergeContractPatchAllowList('c1', { parties: [ownerPub] }, ownerPub);
        peer.once('warning', (msg) => {
          assert.ok(String(msg).includes('allow-list'));
          assert.strictEqual(peer._state.content.contracts.c1.value, 1);
          done();
        });
        peer._handleGenericMessage({
          type: 'CONTRACT_MESSAGE',
          actor: { publicKey: String(attacker.pubkey).toLowerCase() },
          object: { contract: 'c1', ops: [{ op: 'replace', path: '/value', value: 99 }] }
        }, { name: 'o' });
      });
      it('CONTRACT_PUBLISH republish does not merge attacker into patch allow-list', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const owner = new Key();
        const attacker = new Key();
        const ownerPub = String(owner.pubkey).toLowerCase();
        const attackerPub = String(attacker.pubkey).toLowerCase();
        // Identical body required so Actor.id matches (content-addressed).
        const definition = {
          id: 'republish-contract',
          state: { value: 1 },
          parties: [ownerPub]
        };

        peer._registerContract(definition, ownerPub);
        const contractId = Object.keys(peer.contracts)[0];
        assert.ok(contractId);
        assert.ok(peer._signerMayPatchContract(contractId, ownerPub));
        assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);

        // Replay identical body with attacker as wire signer only.
        assert.strictEqual(peer._registerContract(definition, attackerPub), true);

        assert.strictEqual(
          peer._signerMayPatchContract(contractId, attackerPub),
          false,
          'republish must not grant patch rights to a new wire signer'
        );
        assert.ok(peer._signerMayPatchContract(contractId, ownerPub));

        // CONTRACT_MESSAGE from attacker must still be rejected.
        let warned = false;
        peer.once('warning', (msg) => {
          warned = /allow-list/i.test(String(msg));
        });
        peer._handleGenericMessage({
          type: 'CONTRACT_MESSAGE',
          actor: { publicKey: attackerPub },
          object: {
            contract: contractId,
            ops: [{ op: 'replace', path: '/value', value: 99 }]
          }
        }, { name: 'attacker' });
        assert.ok(warned);
        assert.strictEqual(peer._state.content.contracts[contractId].value, 1);
      });
      it('CONTRACT_PUBLISH Beacon/ARC members.signers rejects non-validator front-run', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const { beaconContractDefinition } = require('../functions/beaconContractDefinition');
        const owner = new Key();
        const attacker = new Key();
        const ownerPub = String(owner.pubkey).toLowerCase();
        const attackerPub = String(attacker.pubkey).toLowerCase();
        const definition = beaconContractDefinition({
          validators: [ownerPub],
          threshold: 1,
          publisher: ownerPub
        });

        assert.strictEqual(peer._registerContract(definition, attackerPub), false);
        assert.strictEqual(Object.keys(peer.contracts).length, 0);
        assert.strictEqual(peer._registerContract(definition, ownerPub), true);
        const contractId = Object.keys(peer.contracts)[0];
        assert.ok(peer._signerMayPatchContract(contractId, ownerPub));
        assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);
      });

      it('CONTRACT_PUBLISH front-run by non-party does not register or burn logical slot', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const Message = require('../types/message');
        const owner = new Key();
        const attacker = new Key();
        const ownerPub = String(owner.pubkey).toLowerCase();
        const attackerPub = String(attacker.pubkey).toLowerCase();
        const definition = {
          id: 'front-run-contract',
          state: { value: 1 },
          parties: [ownerPub]
        };

        // Attacker broadcasts identical body first — must be rejected.
        assert.strictEqual(peer._registerContract(definition, attackerPub), false);
        assert.strictEqual(Object.keys(peer.contracts).length, 0);

        const wireAttacker = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)])
          .signWithKey(attacker);
        let publishes = 0;
        peer.on('contract:publish', () => { publishes++; });
        peer._handleGenericMessage({
          type: 'CONTRACT_PUBLISH',
          actor: { publicKey: attackerPub },
          object: definition
        }, { name: 'attacker' }, null, wireAttacker);
        assert.strictEqual(publishes, 0);
        assert.strictEqual(Object.keys(peer.contracts).length, 0);

        // Victim still wins first registration (logical slot not burned).
        const wireOwner = Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)])
          .signWithKey(owner);
        peer._handleGenericMessage({
          type: 'CONTRACT_PUBLISH',
          actor: { publicKey: ownerPub },
          object: definition
        }, { name: 'owner' }, null, wireOwner);
        assert.strictEqual(publishes, 1);
        const contractId = Object.keys(peer.contracts)[0];
        assert.ok(contractId);
        assert.ok(peer._signerMayPatchContract(contractId, ownerPub));
        assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);

        // Wire signer alone (no parties) never grants patch rights.
        const orphan = { id: 'orphan-no-parties', state: { n: 0 } };
        assert.strictEqual(peer._registerContract(orphan, attackerPub), true);
        const orphanId = (new Actor(orphan)).id;
        assert.strictEqual(peer._signerMayPatchContract(orphanId, attackerPub), false);
      });
      it('CONTRACT_PUBLISH republish via generic handler keeps original allow-list', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const Key = require('../types/key');
        const owner = new Key();
        const attacker = new Key();
        const ownerPub = String(owner.pubkey).toLowerCase();
        const attackerPub = String(attacker.pubkey).toLowerCase();
        const definition = { id: 'republish-generic', state: { n: 0 }, parties: [ownerPub] };

        peer._handleGenericMessage({
          type: 'CONTRACT_PUBLISH',
          actor: { publicKey: ownerPub },
          object: definition
        }, { name: 'owner' });
        const contractId = Object.keys(peer.contracts)[0];
        const beforeSize = peer._contractPatchAllowList[contractId].size;

        peer._handleGenericMessage({
          type: 'CONTRACT_PUBLISH',
          actor: { publicKey: attackerPub },
          object: definition
        }, { name: 'attacker' });

        assert.strictEqual(peer._contractPatchAllowList[contractId].size, beforeSize);
        assert.strictEqual(peer._signerMayPatchContract(contractId, attackerPub), false);
        assert.ok(peer._signerMayPatchContract(contractId, ownerPub));
      });
    });

    describe('P2P handshake (SESSION_OFFER / SESSION_OPEN)', function () {
      it('on P2P_SESSION_OFFER from own Fabric key aborts without SESSION_OPEN', function () {
        const server = new Peer({ listen: false, peersDb: null });
        const connAddress = '127.0.0.1:9999';
        let replyBuffer = null;
        let selfEv = null;
        server.connections[connAddress] = {
          _writeFabric: (buf) => { replyBuffer = buf; },
          destroy: () => {}
        };
        server.on('peer:self', (ev) => { selfEv = ev; });

        const peerId = server.identity.id;
        const proof = server._sessionKeyProofMessage(peerId, server.key.pubkey, server.key.pubkey);
        const content = {
          type: 'P2P_SESSION_OFFER',
          actor: {
            id: peerId,
            pubkey: server.key.pubkey,
            parentPubkey: server.key.pubkey,
            parentSignature: server.key.signSchnorr(proof).toString('hex')
          },
          object: { challenge: 'selfloop' }
        };
        const msg = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify(content)]);
        msg.signWithKey(server.key);
        server._handleFabricMessage(msg.toBuffer(), { name: connAddress }, null);

        assert.strictEqual(replyBuffer, null, 'must not reply SESSION_OPEN to self');
        assert.ok(selfEv, 'emits peer:self');
        assert.strictEqual(selfEv.address, connAddress);
        assert.ok(!server.connections[connAddress], 'connection torn down');
        assert.ok(server._isSelfDialSuppressed(connAddress));
      });

      it('rejects malformed peering candidates and normalizes self-suppress to host:port', function () {
        const server = new Peer({ listen: false, peersDb: null });
        server._enqueuePeeringCandidate('', 7777);
        server._enqueuePeeringCandidate('127.0.0.1', NaN);
        server._enqueuePeeringCandidate('127.0.0.1', 0);
        server._enqueuePeeringCandidate('127.0.0.1', 70000);
        assert.strictEqual(server.candidates.length, 0);

        server._enqueuePeeringCandidate(' 127.0.0.1 ', 7777);
        assert.strictEqual(server.candidates.length, 1);
        assert.deepStrictEqual(server.candidates[0], { host: '127.0.0.1', port: 7777 });

        const ownHex = server._localFabricPubkeyHex();
        server._connect(`${ownHex}@192.0.2.10`);
        assert.ok(server._isSelfDialSuppressed('192.0.2.10:7777'));
        assert.ok(!server._isSelfDialSuppressed('192.0.2.10'));
      });

      it('does not self-suppress from an unverified advertised pubkey', function () {
        const server = new Peer({ listen: false, peersDb: null });
        const own = server._localFabricPubkeyHex();
        const attacker = new Key();
        server._enqueuePeeringCandidate('192.0.2.55', 7777, {
          pubkey: own,
          verifiedPubkey: attacker.pubkey
        });
        assert.strictEqual(server.candidates.length, 1);
        assert.ok(!server._isSelfDialSuppressed('192.0.2.55:7777'));

        server._enqueuePeeringCandidate('192.0.2.57', 7777, { pubkey: own });
        assert.ok(server.candidates.some((c) => c && c.host === '192.0.2.57'));
        assert.ok(!server._isSelfDialSuppressed('192.0.2.57:7777'));

        server._enqueuePeeringCandidate('192.0.2.56', 7777, {
          pubkey: own,
          verifiedPubkey: own
        });
        assert.ok(server._isSelfDialSuppressed('192.0.2.56:7777'));
        assert.ok(!server.candidates.some((c) => c && c.host === '192.0.2.56'));
      });

      it('_fillPeerSlots does not suppress from an advertised own pubkey', function () {
        const server = new Peer({ listen: false, peersDb: null, networking: false });
        const own = server._localFabricPubkeyHex();
        server.settings.constraints.peers.max = 8;
        server._enqueuePeeringCandidate('192.0.2.88', 7777, { pubkey: own });
        assert.strictEqual(server.candidates.length, 1);
        server._connect = () => {};
        server._fillPeerSlots();
        assert.ok(!server._isSelfDialSuppressed('192.0.2.88:7777'));
      });

      it('_fillPeerSlots suppresses when candidate.verifiedPubkey is our own', function () {
        const server = new Peer({ listen: false, peersDb: null, networking: false });
        const own = server._localFabricPubkeyHex();
        server.settings.constraints.peers.max = 8;
        server.candidates.push({
          host: '192.0.2.91',
          port: 7777,
          pubkey: own,
          verifiedPubkey: own
        });
        server._connect = () => {};
        server._fillPeerSlots();
        assert.ok(server._isSelfDialSuppressed('192.0.2.91:7777'));
      });

      it('_isTransientSocketError matches ECONNREFUSED without error.code', function () {
        const peer = new Peer({ listen: false, peersDb: null, networking: false });
        assert.strictEqual(peer._isTransientSocketError({ code: 'ECONNREFUSED' }), true);
        assert.strictEqual(peer._isTransientSocketError(new Error('connect ECONNREFUSED 65.21.231.149:7778')), true);
        assert.strictEqual(peer._isTransientSocketError(new Error('application protocol failure')), false);
      });

      it('records verifiedPubkey on queued third-party candidates', function () {
        const server = new Peer({ listen: false, peersDb: null });
        const attacker = new Key();
        server._enqueuePeeringCandidate('192.0.2.92', 7777, {
          pubkey: attacker.pubkey,
          verifiedPubkey: attacker.pubkey
        });
        assert.strictEqual(server.candidates.length, 1);
        assert.ok(/^[0-9a-f]{64}$/.test(server.candidates[0].verifiedPubkey));
        assert.ok(!server._isSelfDialSuppressed('192.0.2.92:7777'));
      });

      it('_verifyNOISE rejects when self-key normalization throws', function (done) {
        const server = new Peer({ listen: false, peersDb: null });
        const orig = server._isOwnFabricPubkey.bind(server);
        server._isOwnFabricPubkey = () => { throw new Error('boom'); };
        server._verifyNOISE(Buffer.alloc(32), Buffer.alloc(33, 1), Buffer.alloc(33, 2), (err, ok) => {
          server._isOwnFabricPubkey = orig;
          assert.ifError(err);
          assert.strictEqual(ok, false);
          done();
        });
      });

      it('on P2P_SESSION_OFFER registers peer, sets _addressToId, emits peer, and sends P2P_SESSION_OPEN via _writeFabric', function (done) {
        const server = new Peer({ listen: false, peersDb: null });
        const connAddress = '127.0.0.1:9999';
        const remotePeerId = 'remote-peer-id-abc';
        const remoteKey = new Key();
        const remoteProof = server._sessionKeyProofMessage(remotePeerId, remoteKey.pubkey, remoteKey.pubkey);
        let replyBuffer = null;
        server.connections[connAddress] = {
          _writeFabric: (buf, socket) => { replyBuffer = buf; }
        };

        const content = {
          type: 'P2P_SESSION_OFFER',
          actor: {
            id: remotePeerId,
            pubkey: remoteKey.pubkey,
            parentPubkey: remoteKey.pubkey,
            parentSignature: remoteKey.signSchnorr(remoteProof).toString('hex')
          },
          object: { challenge: 'cafebabe' }
        };
        const msg = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify(content)]);
        msg.signWithKey(remoteKey);
        const buf = msg.toBuffer();

        server.once('peer', (peer) => {
          assert.strictEqual(server._addressToId[connAddress], remotePeerId);
          assert.ok(server.peers[connAddress]);
          assert.ok(peer === server.peers[connAddress]);
          setImmediate(() => {
            assert.ok(Buffer.isBuffer(replyBuffer));
            const reply = Message.fromBuffer(replyBuffer);
            const replyContent = JSON.parse(reply.data);
            assert.strictEqual(replyContent.type, 'P2P_SESSION_OPEN');
            assert.strictEqual(replyContent.object.initiator, remotePeerId);
            assert.strictEqual(replyContent.object.counterparty, server.identity.id);
            assert.strictEqual(replyContent.object.solution, 'cafebabe');
            done();
          });
        });

        server._handleFabricMessage(buf, { name: connAddress }, null);
      });

      it('on P2P_SESSION_OFFER from same peerId at new address closes old connection and sends OPEN to new', function (done) {
        const server = new Peer({ listen: false, peersDb: null });
        const oldAddr = '127.0.0.1:8888';
        const newAddr = '127.0.0.1:9999';
        const remotePeerId = 'same-peer-id';
        const remoteKey = new Key();
        const remoteProof = server._sessionKeyProofMessage(remotePeerId, remoteKey.pubkey, remoteKey.pubkey);
        let oldDestroyCalled = false;
        let replyBuffer = null;

        server.connections[oldAddr] = {
          _writeFabric: () => {},
          _keepalive: null,
          destroy: () => { oldDestroyCalled = true; }
        };
        server.peers[oldAddr] = { id: remotePeerId };
        server._addressToId = { [oldAddr]: remotePeerId };

        server.connections[newAddr] = {
          _writeFabric: (buf) => { replyBuffer = buf; }
        };

        const content = {
          type: 'P2P_SESSION_OFFER',
          actor: {
            id: remotePeerId,
            pubkey: remoteKey.pubkey,
            parentPubkey: remoteKey.pubkey,
            parentSignature: remoteKey.signSchnorr(remoteProof).toString('hex')
          },
          object: { challenge: 'challenge' }
        };
        const msg = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify(content)]);
        msg.signWithKey(remoteKey);

        server.once('peer', () => {
          assert.strictEqual(oldDestroyCalled, true);
          assert.strictEqual(server.connections[oldAddr], undefined);
          assert.strictEqual(server._addressToId[newAddr], remotePeerId);
          setImmediate(() => {
            assert.ok(Buffer.isBuffer(replyBuffer), '_writeFabric should have been called with reply');
            done();
          });
        });

        server._handleFabricMessage(msg.toBuffer(), { name: newAddr }, null);
      });

      it('on P2P_SESSION_OPEN updates peers and _addressToId', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const connAddress = '127.0.0.1:9999';
        const serverId = 'server-identity-id';
        const serverKey = new Key();
        const serverProof = peer._sessionKeyProofMessage(serverId, serverKey.pubkey, serverKey.pubkey);
        peer.connections[connAddress] = { _writeFabric: () => {} };

        const content = {
          type: 'P2P_SESSION_OPEN',
          actor: {
            id: serverId,
            pubkey: serverKey.pubkey,
            parentPubkey: serverKey.pubkey,
            parentSignature: serverKey.signSchnorr(serverProof).toString('hex')
          },
          object: {
            initiator: peer.identity.id,
            counterparty: serverId,
            solution: 'challenge'
          }
        };
        const msg = Message.fromVector(['P2P_SESSION_OPEN', JSON.stringify(content)]);
        msg.signWithKey(peer.key);

        peer._handleGenericMessage(content, { name: connAddress }, null);

        assert.ok(peer.peers[connAddress]);
        assert.strictEqual(peer.peers[connAddress].id, serverId);
        assert.strictEqual(peer._addressToId[connAddress], serverId);
      });

      it('P2P_SESSION_OPEN via _handleFabricMessage updates peers and _addressToId', function () {
        const peer = new Peer({ listen: false, peersDb: null });
        const connAddress = '127.0.0.1:9999';
        const serverId = 'server-identity-id';
        const serverKey = new Key();
        const serverProof = peer._sessionKeyProofMessage(serverId, serverKey.pubkey, serverKey.pubkey);
        peer.connections[connAddress] = { _writeFabric: () => {} };

        const content = {
          type: 'P2P_SESSION_OPEN',
          actor: {
            id: serverId,
            pubkey: serverKey.pubkey,
            parentPubkey: serverKey.pubkey,
            parentSignature: serverKey.signSchnorr(serverProof).toString('hex')
          },
          object: {
            initiator: peer.identity.id,
            counterparty: serverId,
            solution: 'challenge'
          }
        };
        const msg = Message.fromVector(['P2P_SESSION_OPEN', JSON.stringify(content)]);
        msg.signWithKey(serverKey);

        peer._handleFabricMessage(msg.toBuffer(), { name: connAddress }, null);

        assert.strictEqual(peer.peers[connAddress].id, serverId);
        assert.strictEqual(peer._addressToId[connAddress], serverId);
      });

      it('rejects and de-ranks P2P_SESSION_OFFER when key claim is unsigned', function () {
        const server = new Peer({ listen: false, peersDb: null });
        const connAddress = '127.0.0.1:9001';
        const remotePeerId = 'unsigned-offer-peer';
        const remoteKey = new Key();
        const warnings = [];
        server.on('warning', (w) => warnings.push(String(w)));
        server.connections[connAddress] = { _writeFabric: () => {} };
        server._state.peers = {
          [connAddress]: { id: connAddress, address: connAddress, score: 500 }
        };

        const content = {
          type: 'P2P_SESSION_OFFER',
          actor: {
            id: remotePeerId,
            pubkey: remoteKey.pubkey,
            parentPubkey: remoteKey.pubkey
            // parentSignature omitted on purpose (protocol violation)
          },
          object: { challenge: 'cafef00d' }
        };
        const msg = Message.fromVector(['P2P_SESSION_OFFER', JSON.stringify(content)]);
        msg.signWithKey(remoteKey);
        server._handleFabricMessage(msg.toBuffer(), { name: connAddress }, null);

        assert.strictEqual(server._addressToId[connAddress], undefined);
        // Unified misbehavior path: session-key:* reason (was a dedicated "Session key violation" string).
        assert.ok(
          warnings.some((w) => /Misbehavior \(session-key:/i.test(w) || /session-key:missing/i.test(w)),
          `expected session-key misbehavior warning, got: ${JSON.stringify(warnings)}`
        );
        assert.ok((server._state.peers[connAddress] || {}).score < 500);
      });
    });

    describe('_writeFabric', function () {
      it('emits warning when stream closed or destroyed', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.once('warning', (m) => {
          assert.ok(/closed or destroyed/.test(m));
          done();
        });
        const fakeStream = { encrypt: { writable: false, write: () => {} } };
        peer._writeFabric(Buffer.from('x'), fakeStream);
      });
    });

    describe('_pingConnection', function () {
      it('emits error when sendToSocket fails', function (done) {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.connections['addr'] = {};
        peer.once('error', (m) => {
          assert.ok(/Couldn't deliver message/.test(m));
          done();
        });
        peer._pingConnection('addr');
      });
    });

    describe('stop', function () {
      it('handles server with address() null', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        await peer.stop();
        assert.strictEqual(peer._state.status, 'STOPPED');
      });
      it('rejects when server.close reports non-ERR_SERVER_NOT_RUNNING error', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.server.address = () => ({ address: '0.0.0.0', port: 7777 });
        peer.server.close = (cb) => cb(Object.assign(new Error('close failed'), { code: 'CUSTOM' }));
        await assert.rejects(() => peer.stop(), /close failed/);
      });
    });

    it('can receive a connection', function (done) {
      async function test () {
        const port = await getFreePort();
        const server = new Peer(Object.assign(
          { verbosity: 2 },
          NODEA,
          { listen: true, port, upnp: false, peers: [], networking: false, peersDb: null }
        ));
        const client = new Peer(Object.assign(
          { verbosity: 2 },
          NODEB,
          {
            listen: false,
            port: 0,
            upnp: false,
            peersDb: null,
            peers: [`${server.key.pubkey}@localhost:${port}`]
          }
        ));

        // Track peers for cleanup
        peers.push(server, client);

        async function handleClientMessage (msg) {
          console.log(`[TEST:SERVER] event "message" - <${typeof msg}>`, msg);
        }

        async function handleClientWarning (msg) {
          console.warn(`[TEST:SERVER] event "warning" - <${typeof msg}>`, msg);
        }

        async function handleClientError (msg) {
          console.error(`[TEST:SERVER] event "error" - <${typeof msg}>`, msg);
        }

        async function handleMessage (msg) {
          console.log(`[TEST:SERVER] event "message" - <${typeof msg}>`, msg);
        }

        async function handleWarning (msg) {
          console.warn(`[TEST:SERVER] event "warning" - <${typeof msg}>`, msg);
        }

        async function handleError (msg) {
          console.error(`[TEST:SERVER] event "error" - <${typeof msg}>`, msg);
        }

        if (settings.debug) {
          client.on('message', handleClientMessage);
          client.on('warning', handleClientWarning);
          client.on('error', handleClientError);
          server.on('message', handleMessage);
          server.on('warning', handleWarning);
          server.on('error', handleError);
        }

        server.on('peer', async function handlePeer (peer) {
          await client.stop();
          await server.stop();

          assert.ok(server);
          assert.ok(client);

          done();
        });

        await server.start();
        await client.start();
      }

      test();
    });

    it('can recover a message', async function () {
      const port = await getFreePort();
      const peer = new Peer({ ...settings, port, peers: [], upnp: false, networking: false, peersDb: null });
      peers.push(peer);

      await peer.start();
      await peer.stop();

      assert.ok(peer);
    });

    describe('_loadPeerRegistry', function () {
      it('does nothing when peersDb is null', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        await peer._loadPeerRegistry();
        assert.ok(!peer._peersDb);
      });
      it('loads and migrates peer registry from db', async function () {
        const peer = new Peer({ listen: false, peersDb: null });
        peer.settings.peersDb = 'stores/test-peer-registry-load';
        peer._peersDb = {
          get: async (key) => key === 'peers' ? JSON.stringify({ '127.0.0.1:7777': { id: 'abc', address: '127.0.0.1:7777' } }) : null
        };
        await peer._loadPeerRegistry();
        assert.ok(peer._state.peers && (peer._state.peers.abc || peer._state.peers['127.0.0.1:7777']));
      });
    });

    describe('peer registry persistence guards', function () {
      it('skips scheduling registry save when stopping', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-1', networking: false, listen: false });
        peer._state.status = 'STOPPING';
        peer._state.peers = { a: { id: 'a' } };

        let putCalls = 0;
        peer._peersDb = {
          status: 'open',
          put: async () => { putCalls++; }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(putCalls, 0);
      });

      it('does not write when registry DB is not open', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-2', networking: false, listen: false });
        peer._state.status = 'STARTED';
        peer._state.peers = { a: { id: 'a' } };

        let putCalls = 0;
        peer._peersDb = {
          status: 'closed',
          put: async () => { putCalls++; }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(putCalls, 0);
      });

      it('suppresses transient "Database is not open" registry save errors', async function () {
        const peer = new Peer({ ...settings, peersDb: 'stores/test-peers-guard-3', networking: false, listen: false });
        peer._state.status = 'STARTED';
        peer._state.peers = { a: { id: 'a' } };

        const emittedErrors = [];
        peer.on('error', (msg) => emittedErrors.push(String(msg)));

        peer._peersDb = {
          status: 'open',
          put: async () => { throw new Error('Database is not open'); }
        };

        peer._savePeerRegistry();
        await new Promise(resolve => setTimeout(resolve, 650));

        assert.strictEqual(emittedErrors.length, 0);
      });
    });
  });
});
