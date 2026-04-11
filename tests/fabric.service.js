'use strict';

// Testing
const assert = require('assert');
const EventEmitter = require('events');
const Service = require('../types/service');

/** Skip real networking and heartbeat ticks during short unit tests. */
const FAST_SERVICE = Object.freeze({ networking: false, interval: 86400000 });

describe('@fabric/core/types/service', function () {
  describe('Service', function () {
    it('is available from @fabric/core', function () {
      assert.strictEqual(Service instanceof Function, true);
    });

    it('can create an instance', async function provenance () {
      const service = new Service({
        ...FAST_SERVICE,
        name: 'Test'
      });

      assert.ok(service);
    });

    it('can start offering service', async function () {
      const service = new Service({
        ...FAST_SERVICE,
        name: 'fun'
      });

      try {
        await service.start();
      } catch (E) {
        console.error('Exception starting:', E);
      }

      try {
        await service.stop();
      } catch (E) {
        console.error('Exception stopping:', E);
      }

      assert.ok(service);
    });

    it('can run for 10 beats', function (done) {
      async function test () {
        const service = new Service({
          ...FAST_SERVICE,
          name: 'fun',
          interval: 0
        });

        for (let i = 0; i < 10; i++) {
          service.beat();
        }

        assert.ok(service);
        assert.strictEqual(service.clock, 10);
        done();
      }

      test();
    });

    it('can run in persistent mode', async function provenance () {
      const service = new Service({
        ...FAST_SERVICE,
        name: 'Test',
        persistent: true
      });

      assert.ok(service);
    });
  });

  describe('_registerActor()', function () {
    it('can register an actor successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const registration = await service._registerActor({ name: 'Sally' });
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
    });

    it('emits the "actor" event', function (done) {
      async function test () {
        const service = new Service(FAST_SERVICE);

        service.on('actor', async function (actor) {
          if (actor.name && actor.name === 'Sally') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor({ name: 'Sally' });
      }

      test();
    });

    it('create an empty actor', function (done) {
      async function test () {
        const service = new Service(FAST_SERVICE);

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor();
      }

      test();
    });

    it('create an actor from an object', function (done) {
      async function test () {
        const service = new Service(FAST_SERVICE);

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor({});
      }

      test();
    });

    it('create an actor from an array', function (done) {
      async function test () {
        const service = new Service(FAST_SERVICE);

        service.on('actor', async function (actor) {
          if (actor.id && actor.id === 'a5b08f19adfd2918e354af8c11e1b4efd963b5f5a525900d63a01cd2fd28176f') {
            await service.stop();
            done();
          }
        });

        await service.start();
        await service._registerActor([]);
      }

      test();
    });
  });

  describe('sync()', function () {
    it('can run sync successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      service.sync();
      await service.stop();
      assert.ok(service);
    });
  });

  describe('_defineResource()', function () {
    it('can define a resoure successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const resource = await service._defineResource('Test', {});
      await service.stop();
      assert.ok(service);
      assert.ok(resource);
      assert.strictEqual(resource.name, 'Test');
    });
  });

  describe('_registerChannel()', function () {
    it('can register a channel successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const registration = await service._registerChannel({ name: 'Chat of Chad' });
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
    });

    it('persists a channel when an id is provided', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const registration = await service._registerChannel({ id: 'chad-chat', name: 'Chat of Chad' });
      const fetched = await service._getChannel('chad-chat');
      await service.stop();
      assert.ok(registration && registration.id);
      assert.ok(fetched);
      assert.strictEqual(fetched.id, registration.id);
    });
  });

  describe('_listChannels()', function () {
    it('can list channels successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      await service._registerChannel({ id: 'list-ch', name: 'Chat of Chad' });
      const result = await service._listChannels();
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.length, 1);
    });
  });

  describe('_listActors()', function () {
    it('can list channels successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const registration = await service._registerActor({ name: 'Chad' });
      const result = await service._listActors();
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.strictEqual(result.length, 1);
    });
  });

  describe('_addMemberToChannel()', function () {
    it('can add a member to a channel successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const channel = await service._registerChannel({ id: 'join-ch', name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const join = await service._addMemberToChannel(registration.id, channel.id);
      const after = await service._getChannel(channel.id);

      await service.stop();

      assert.ok(service);
      assert.ok(registration);
      assert.ok(join);
      assert.ok(after);
      assert.ok(after.members);

      assert.strictEqual(after.members.length, 1);
    });
  });

  describe('_getSubscriptions()', function () {
    it('can retrieve actor subscriptions successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const channel = await service._registerChannel({ id: 'sub-ch', name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const join = await service._addMemberToChannel(registration.id, channel.id);
      const subs = await service._getSubscriptions(registration.id);
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.ok(join);
      assert.ok(Array.isArray(subs));
      assert.strictEqual(subs.length, 1);
    });
  });

  describe('_getMembers()', function () {
    it('can retrieve channel members successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const channel = await service._registerChannel({ id: 'mem-ch', name: 'Chat of Chad' });
      const registration = await service._registerActor({ name: 'Chad' });
      const before = await service._getMembers(channel.id);
      const join = await service._addMemberToChannel(registration.id, channel.id);
      const after = await service._getMembers(channel.id);
      await service.stop();
      assert.ok(service);
      assert.ok(registration);
      assert.ok(Array.isArray(before));
      assert.ok(join);
      assert.ok(Array.isArray(after));
      assert.strictEqual(after.length, 1);
    });
  });

  describe('_POST()', function () {
    it('can call _POST successfully', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      await service.stop();
      assert.strictEqual(link, '/examples/e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });

    it('provides a valid collection index', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET('/examples');
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.length, 1);
      assert.ok(service);
      assert.ok(link);
      assert.ok(result);
      assert.ok(result.length, 1);
    });

    it('provides the posted document in the expected location', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const link = await service._POST('/examples', { content: 'Hello, world!' });
      const result = await service._GET(link);
      await service.stop();
      assert.ok(result);
      assert.strictEqual(result.address, 'e3e7b6becc03c8a11a95bcbf6a4827bd9978c894d721b375bb8d9b0ba8a794ea');
      assert.ok(service);
    });
  });

  describe('on-chain visibility', function () {
    it('commit emits a stable commitment id after state mutation', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const commits = [];
      service.on('commit', (c) => commits.push(c));
      service.set('/visibilityProbe', { seq: 1 });
      await service.stop();
      assert.strictEqual(commits.length, 1);
      assert.ok(commits[0].id && typeof commits[0].id === 'string');
      assert.ok(commits[0].id.length > 0);
    });

    it('patches and history expose RFC6902 deltas for audits', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const patchBatches = [];
      service.on('patches', (p) => patchBatches.push(p));
      service.set('/auditA', 1);
      service.set('/auditB', 2);
      await service.stop();
      assert.strictEqual(patchBatches.length, 2);
      assert.ok(patchBatches.every((batch) => Array.isArray(batch) && batch.length > 0));
      assert.ok(patchBatches[0].some((op) => op.path && op.path.includes('auditA')));
      assert.strictEqual(service.history.length, 2);
    });

    it('beat carries monotonic clock and state snapshot for observers', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      let seen = null;
      service.on('beat', (beat) => {
        const payload = JSON.parse(beat.data);
        seen = payload;
      });
      service.beat();
      await service.stop();
      assert.ok(seen);
      assert.strictEqual(seen.clock, service.clock);
      assert.ok(seen.created);
      assert.ok(seen.state && typeof seen.state === 'object');
    });

    it('trust forwards tip hashes to subservices via alert', function () {
      const alerts = [];
      class ChainPeer extends Service {
        alert (msg) {
          alerts.push(msg);
        }
      }
      const parent = new Service({ ...FAST_SERVICE, services: ['peer'] });
      parent.services.peer = new ChainPeer(FAST_SERVICE);
      const src = new EventEmitter();
      src.settings = { debug: false, verbosity: -1 };
      parent.trust(src, 'btc');
      src.emit('tip', 'faded00beef');
      assert.ok(alerts.some((a) => String(a).includes('faded00beef') && String(a).includes('chaintip')));
    });

    it('trust re-emits peer patches at the service boundary', async function () {
      const parent = new Service(FAST_SERVICE);
      await parent.start();
      const src = new EventEmitter();
      src.settings = { debug: false, verbosity: -1 };
      parent.trust(src, 'peer');
      const forwarded = [];
      parent.on('patches', (p) => forwarded.push(p));
      const sample = [{ op: 'add', path: '/x', value: 1 }];
      src.emit('patches', sample);
      await parent.stop();
      assert.strictEqual(forwarded.length, 1);
      assert.deepStrictEqual(forwarded[0], sample);
    });

    it('route with high verbosity emits routing and commit diagnostics', async function () {
      const service = new Service({ ...FAST_SERVICE, verbosity: 4 });
      await service.start();
      const lines = [];
      service.on('debug', (m) => lines.push(String(m)));
      service.define('VisibleRoute', {
        handler: function () {
          return { ok: true };
        }
      });
      await service.route({ type: 'VisibleRoute', data: {} });
      await service.stop();
      assert.ok(lines.some((x) => x.includes('routing message')));
      assert.ok(lines.some((x) => x.includes('route commit')));
    });
  });

  describe('edge branches', function () {
    it('trust rejects non-EventEmitter sources', function () {
      const service = new Service(FAST_SERVICE);
      assert.throws(() => service.trust({}), /EventEmitter/);
    });

    it('broadcast enforces @type and @data', async function () {
      const service = new Service(FAST_SERVICE);
      await assert.rejects(() => service.broadcast({}), /@type/);
      await assert.rejects(() => service.broadcast({ '@type': 'X' }), /@data/);
    });

    it('_GET returns null for non-string path', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const value = await service._GET(123);
      await service.stop();
      assert.strictEqual(value, null);
    });

    it('_PUT root path stores object on internal state container', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      await service._PUT('/', { actors: {}, channels: {}, messages: {}, services: {}, custom: 1 });
      const state = service._state;
      await service.stop();
      assert.strictEqual(state.custom, 1);
    });

    it('connect emits warning when store restore payload is invalid JSON', async function () {
      const service = new Service(FAST_SERVICE);
      const warnings = [];
      service.on('warning', (msg) => warnings.push(String(msg)));
      service.store = {
        get: async () => 'not-json'
      };
      await service.connect(false);
      await service.disconnect();
      assert.ok(warnings.some((x) => x.includes('Could not restore state')));
    });

    it('_POST throws when path or data is missing', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      await assert.rejects(() => service._POST('', { x: 1 }), /Path must be provided/);
      await assert.rejects(() => service._POST('/a', null), /Data must be provided/);
      await service.stop();
    });

    it('_PUT with invalid pointer path emits error (does not throw)', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const errors = [];
      service.on('error', (e) => errors.push(String(e)));
      await service._PUT('', { x: 1 }, false);
      await service.stop();
      assert.ok(errors.some((x) => x.includes('Could not _PUT()')));
    });

    it('handler emits error for malformed message shapes', async function () {
      const service = new Service(FAST_SERVICE);
      const errors = [];
      service.on('error', (e) => errors.push(String(e)));
      service.handler(null);
      assert.ok(errors.some((x) => x.includes('Malformed message')));
    });

    it('lock returns false while already LOCKED', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      assert.strictEqual(service.lock(20), true);
      assert.strictEqual(service.lock(20), false);
      await new Promise((r) => setTimeout(r, 35));
      assert.strictEqual(service.lock(2), true);
      await service.stop();
    });

    it('route runs definition handler and returns handler result', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      service.define('EdgeOp', {
        handler: function (msg) {
          return { sum: (msg.data && msg.data.a) + (msg.data && msg.data.b) };
        }
      });
      const out = await service.route({ type: 'EdgeOp', data: { a: 2, b: 3 } });
      await service.stop();
      assert.deepStrictEqual(out, { sum: 5 });
    });

    it('replay invokes route for each item', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      let n = 0;
      service.route = async function routedStub (msg) {
        n += 1;
        return msg;
      };
      const chain = service.replay([{ type: 'a' }, { type: 'b' }]);
      assert.strictEqual(chain, service);
      assert.strictEqual(n, 2);
      await service.stop();
    });

    it('trust forwards source message events through _handleTrustedMessage', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const src = new EventEmitter();
      src.settings = { debug: false, verbosity: 0 };
      const received = [];
      service.on('message', (m) => received.push(m));
      service.trust(src, 'TestSource');
      const payload = { type: 'Fabric', body: 1 };
      src.emit('message', payload);
      await service.stop();
      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0], payload);
    });

    it('_startAllServices warns when services map was cleared', async function () {
      const service = new Service(FAST_SERVICE);
      const warnings = [];
      service.on('warning', (w) => warnings.push(String(w)));
      service.services = null;
      await service._startAllServices();
      assert.ok(warnings.some((x) => x.includes('subservices')));
    });

    it('subscribe validates actor and channel ids', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      await assert.rejects(() => service.subscribe('', 'ch'), /actor/i);
      await assert.rejects(() => service.subscribe('a', ''), /channel/i);
      await assert.rejects(() => service.subscribe('missing-actor', 'missing-ch'), /exist|Actor/);
      await service.stop();
    });

    it('send writes a framed block to fabric after connect', async function () {
      const service = new Service(FAST_SERVICE);
      await service.connect(false);
      const chunks = [];
      service.fabric.on('data', (buf) => chunks.push(buf));
      await service.send('chan', 'hi');
      await service.disconnect();
      assert.strictEqual(chunks.length, 1);
      assert.ok(chunks[0].length > 0);
    });

    it('identify emits auth with service public key', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      let seen = null;
      service.on('auth', (k) => { seen = k; });
      const pk = service.identify();
      await service.stop();
      assert.ok(pk);
      assert.strictEqual(seen, pk);
    });

    it('cache.get drops entries after TTL', async function () {
      const service = new Service(FAST_SERVICE);
      await service.cache.set('ttl-key', 99, 2);
      assert.strictEqual(await service.cache.get('ttl-key'), 99);
      await new Promise((r) => setTimeout(r, 25));
      assert.strictEqual(await service.cache.get('ttl-key'), null);
    });

    it('toString exposes entity serialization of state', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const s = service.toString();
      await service.stop();
      assert.ok(typeof s === 'string');
      assert.ok(s.length > 0);
    });

    it('_getActor and _getChannel return null and emit when id missing', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const errors = [];
      service.on('error', (e) => errors.push(String(e)));
      assert.strictEqual(await service._getActor(''), null);
      assert.strictEqual(await service._getChannel(''), null);
      await service.stop();
      assert.ok(errors.length >= 2);
      assert.ok(errors.every((x) => x.includes('Parameter "id" is required')));
    });

    it('route returns null when no definition matches message type', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const out = await service.route({ type: 'NoSuchHandler' });
      await service.stop();
      assert.strictEqual(out, null);
    });

    it('ready emits a ready event', function (done) {
      const service = new Service(FAST_SERVICE);
      service.on('ready', () => done());
      service.ready();
    });

    it('init seeds Web Components map', function () {
      const service = new Service(FAST_SERVICE);
      service.components = { x: 1 };
      service.init();
      assert.deepStrictEqual(service.components, {});
    });

    it('sync ensures _sources is an array', function () {
      const service = new Service(FAST_SERVICE);
      delete service._sources;
      service.sync();
      assert.ok(Array.isArray(service._sources));
      assert.strictEqual(service.sync(), service);
    });

    it('alert forwards to subservices listed in settings.services', function () {
      const received = [];
      class Child extends Service {
        alert (m) {
          received.push(m);
        }
      }
      const parent = new Service({ ...FAST_SERVICE, services: ['child'] });
      parent.services.child = new Child(FAST_SERVICE);
      parent.alert('broadcast-body');
      assert.deepStrictEqual(received, ['broadcast-body']);
    });

    it('_registerService warns on duplicate registration', async function () {
      const parent = new Service(FAST_SERVICE);
      await parent.start();
      const warnings = [];
      parent.on('warning', (w) => warnings.push(String(w)));
      class Sub extends Service {}
      await parent._registerService('dup', Sub);
      await parent._registerService('dup', Sub);
      await parent.stop();
      assert.ok(warnings.some((x) => x.includes('already registered')));
    });

    it('_applyChanges catches invalid JSON Patch operations', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const stderr = [];
      const orig = console.error;
      console.error = (...args) => stderr.push(args.join(' '));
      try {
        await service._applyChanges([{
          op: 'add',
          path: '/constraints/memory/max/__invalid_child__',
          value: 1
        }]);
      } finally {
        console.error = orig;
      }
      await service.stop();
      assert.ok(stderr.some((s) => s.includes('Could not apply changes')));
    });

    it('_send persists message entity and returns id', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const id = await service._send({ hello: 'world' });
      const doc = await service._GET(`/messages/${id}`);
      await service.stop();
      assert.ok(id && typeof id === 'string');
      assert.ok(doc);
      assert.strictEqual(doc.hello, 'world');
    });

    it('process emits debug when settings.debug is true', async function () {
      const service = new Service({ ...FAST_SERVICE, debug: true });
      const lines = [];
      service.on('debug', (m) => lines.push(String(m)));
      await service.process();
      assert.ok(lines.some((x) => x.includes('process()')));
    });

    it('trust binds debug listener when source.settings.debug', function () {
      const service = new Service(FAST_SERVICE);
      const src = new EventEmitter();
      src.settings = { debug: true, verbosity: 0 };
      const dbg = [];
      service.on('debug', (m) => dbg.push(String(m)));
      service.trust(src, 'Dbg');
      src.emit('debug', 'ping');
      assert.ok(dbg.some((x) => x.includes('Trusted Source emitted debug')));
    });

    it('define default handler returns null from route', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      service.define('OnlyDefault');
      const out = await service.route({ type: 'OnlyDefault', data: {} });
      await service.stop();
      assert.strictEqual(out, null);
    });
  });
});
