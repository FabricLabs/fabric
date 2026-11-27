'use strict';

// Testing
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const Service = require('../types/service');
const { MAX_MESSAGE_SIZE } = require('../constants');
const { stateDigest } = require('../functions/sidechainState');

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
    it('can list actors successfully', async function () {
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
      assert.strictEqual(commits[0].type, 'Commit');
      assert.ok(commits[0].state === undefined);
    });

    it('does not embed service state in commit actors', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const commits = [];
      service.on('commit', (c) => commits.push(c));
      service.set('/visibilityBlob', { pad: 'z'.repeat(2048) });
      await service.stop();
      assert.ok(commits[0]);
      assert.ok(commits[0].id);
      assert.ok(!('state' in commits[0]));
      assert.ok(typeof commits[0].clock === 'number');
    });

    it('caps patch history at commitHistoryMax', async function () {
      const service = new Service({ ...FAST_SERVICE, commitHistoryMax: 3 });
      await service.start();
      for (let i = 0; i < 8; i++) service.set('/cap' + i, i);
      await service.stop();
      assert.ok(service.history.length <= 3);
      assert.strictEqual(service.history.length, 3);
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

    it('beat carries a monotonic clock and a state digest', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      let seen = null;
      const commits = [];
      service.on('commit', (commit) => commits.push(commit));
      service.on('beat', (beat) => {
        const payload = JSON.parse(beat.data);
        seen = payload;
      });
      const staged = service.staging.length;
      service.beat();
      await service.stop();
      assert.ok(seen);
      assert.strictEqual(seen.clock, service.clock);
      assert.ok(seen.created);
      assert.strictEqual(typeof seen.stateDigest, 'string');
      assert.strictEqual(seen.stateDigest.length, 64);
      assert.ok(!('state' in seen));
      assert.strictEqual(commits.length, 0);
      assert.strictEqual(service.staging.length, staged);
    });

    it('beat appends one unsealed message per transition and does not commit', async function () {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-beat-')));
      const service = new Service({
        ...FAST_SERVICE,
        name: 'beat-delta',
        fs: { path: dir }
      });
      await service.start();
      const errors = [];
      const commits = [];
      const beats = [];
      service.on('error', (error) => errors.push(String(error && error.message ? error.message : error)));
      service.on('commit', (commit) => commits.push(commit));
      service.on('beat', (beat) => beats.push(beat));

      const messages = service._state.content.messages;
      service._state.content.payload = { k0: 'x'.repeat(100), k1: 'y'.repeat(100) };
      service._state.content.note = 'kept';
      const history = service.history.length;
      service.beat();

      assert.ok(!errors.some((error) => error.includes('bounded JSON')));
      assert.strictEqual(errors.length, 0);
      assert.strictEqual(commits.length, 0);
      assert.strictEqual(service.history.length, history);
      assert.deepStrictEqual(service._state.content.messages, messages);
      assert.strictEqual(service._state.content.note, 'kept');
      assert.strictEqual(service.staging.length, 1);
      assert.strictEqual(service.staging[0].seq, 1);
      assert.strictEqual(service.staging[0].sealedBeaconClock, null);
      assert.ok(service.staging[0].patches.some((op) => op.path === '/payload'));
      assert.ok(service.staging[0].patches.some((op) => op.path === '/note'));
      const digest = stateDigest({
        version: 1,
        clock: service._stagedClock,
        content: service._state.content
      });
      assert.strictEqual(service.staging[0].newDigest, digest);
      assert.strictEqual(beats.length, 1);
      assert.ok(beats[0].bodyBuffer.length <= MAX_MESSAGE_SIZE);
      assert.strictEqual(beats[0].type, 'SIDECHAIN_STATE_PATCH');
      const journal = JSON.parse(fs.readFileSync(path.join(dir, 'sidechain', 'JOURNAL'), 'utf8'));
      assert.strictEqual(journal.entries.length, 1);
      assert.strictEqual(journal.entries[0].sealedBeaconClock, null);
      await service.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('beat refuses a transition that does not fit in one message', async function () {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-beat-leaf-')));
      const service = new Service({
        ...FAST_SERVICE,
        name: 'beat-leaf',
        fs: { path: dir }
      });
      await service.start();
      const errors = [];
      const commits = [];
      const beats = [];
      service.on('error', (error) => errors.push(String(error && error.message ? error.message : error)));
      service.on('commit', (commit) => commits.push(commit));
      service.on('beat', (beat) => beats.push(beat));

      const messages = service._state.content.messages;
      service._state.content.leaf = 'y'.repeat(MAX_MESSAGE_SIZE);
      service._state.content.note = 'kept';
      service.beat();

      assert.ok(!errors.some((error) => error.includes('bounded JSON')));
      assert.ok(errors.some((error) => error.includes('transition exceeds max') && error.includes(String(MAX_MESSAGE_SIZE))));
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(commits.length, 0);
      assert.strictEqual(beats.length, 0);
      assert.strictEqual(service.staging.length, 0);
      assert.strictEqual(service._state.content.leaf.length, MAX_MESSAGE_SIZE);
      assert.strictEqual(service._state.content.note, 'kept');
      assert.deepStrictEqual(service._state.content.messages, messages);
      await service.stop();
      fs.rmSync(dir, { recursive: true, force: true });
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

    it('beat reports an observer that cannot be read', function () {
      const service = new Service(FAST_SERVICE);
      const errors = [];
      service.on('error', (error) => errors.push(String(error)));
      service.observer = 1;
      service.beat();
      assert.ok(errors.some((error) => error.includes('Exception staging beat')));
    });

    it('pairs a preceding test op and skips values that are not ops', function () {
      const service = new Service(FAST_SERVICE);
      const ops = service._forwardOps([
        null,
        'nope',
        { op: 'test', path: '/n', value: 1 },
        { op: 'replace', path: '/n', value: 2 },
        { op: 'add', path: '/x', value: true }
      ]);
      assert.strictEqual(ops.length, 2);
      assert.strictEqual(ops[0].old, 1);
      assert.strictEqual(ops[1].old, undefined);
    });

    it('reverts a transition to its basis and refuses one it cannot invert', function () {
      const service = new Service(FAST_SERVICE);
      service._state.content = { n: 2, extra: true };
      const basis = service._revertTransition(service._state.content, [
        { op: { op: 'replace', path: '/n', value: 2 }, old: 1 },
        { op: { op: 'add', path: '/extra', value: true } }
      ]);
      assert.strictEqual(basis.n, 1);
      assert.strictEqual(basis.extra, undefined);
      assert.deepStrictEqual(service._revertTransition({ a: 1 }, []), { a: 1 });
      assert.strictEqual(service._revertTransition({ a: 1 }, [{ op: { op: 'add' } }]), null);
      assert.strictEqual(service._revertTransition({ a: 1 }, [{ op: { op: 'remove', path: '/a' } }]), null);
      const circular = {};
      circular.self = circular;
      assert.strictEqual(service._revertTransition(circular, [{ op: { op: 'add', path: '/x' } }]), null);
      assert.strictEqual(service._revertTransition({ a: 1 }, [{ op: { op: 'add', path: '/a/b' } }]), null);
    });

    it('refuses an empty patch list and a patch that cannot be encoded', function () {
      const service = new Service(FAST_SERVICE);
      const circular = {};
      circular.self = circular;
      assert.strictEqual(service._transitionFits([]), false);
      assert.strictEqual(service._transitionFits([{ op: 'add', path: '/x', value: circular }]), false);
    });

    it('stages nothing from test ops alone and reports a transition it cannot read', function () {
      const service = new Service(FAST_SERVICE);
      const now = new Date().toISOString();
      const testsOnly = service._stageTransition([{ op: 'test', path: '/n', value: 1 }], now);
      assert.strictEqual(testsOnly.row, null);
      assert.deepStrictEqual(testsOnly.errors, []);
      service._state.content.n = 2;
      const unread = service._stageTransition([{ op: 'replace', path: '/n', value: 2 }], now);
      assert.strictEqual(unread.row, null);
      assert.ok(unread.errors[0].includes('could not read the transition'));
    });

    it('reports a message that cannot be built and a transition the sidechain rejects', function () {
      const service = new Service(FAST_SERVICE);
      service._state.content.flag = true;
      const now = new Date().toISOString();
      const raw = [{ op: 'add', path: '/flag', value: true }];
      const fromLegacyBody = Message.fromLegacyBody;
      const apply = sidechain.applyPatchesToState;
      Message.fromLegacyBody = () => { throw new Error('bad body'); };
      try {
        const built = service._stageTransition(raw, now);
        assert.strictEqual(built.row, null);
        assert.ok(built.errors[0].includes('bad body'));
      } finally {
        Message.fromLegacyBody = fromLegacyBody;
      }
      sidechain.applyPatchesToState = () => ({ ok: false, error: 'rejected' });
      try {
        const rejected = service._stageTransition(raw, now);
        assert.strictEqual(rejected.row, null);
        assert.ok(rejected.errors[0].includes('rejected'));
      } finally {
        sidechain.applyPatchesToState = apply;
      }
      sidechain.applyPatchesToState = () => { throw new Error('sidechain down'); };
      try {
        const thrown = service._stageTransition(raw, now);
        assert.ok(thrown.errors[0].includes('sidechain down'));
      } finally {
        sidechain.applyPatchesToState = apply;
      }
    });

    it('idle beat reports a digest failure, a body that will not parse, and a missing message', function () {
      const service = new Service(FAST_SERVICE);
      const errors = [];
      service.on('error', (error) => errors.push(String(error)));
      service.observer = null;
      service.contentDigest = () => { throw new Error('digest down'); };
      service.beat();
      assert.ok(errors.some((error) => error.includes('digest down')));

      const fromVector = Message.fromVector;
      Message.fromVector = () => ({ data: '{' });
      try {
        errors.length = 0;
        service.contentDigest = Service.prototype.contentDigest;
        service._emitIdleBeat(new Date().toISOString());
        assert.ok(errors.some((error) => error.includes('Exception parsing beat')));
      } finally {
        Message.fromVector = fromVector;
      }

      Message.fromVector = () => null;
      try {
        assert.throws(() => service._emitIdleBeat(new Date().toISOString()), /could not construct a Message/);
      } finally {
        Message.fromVector = fromVector;
      }
    });

    it('keeps a staged row when the journal cannot be written', function () {
      const service = new Service(FAST_SERVICE);
      const errors = [];
      service.on('error', (error) => errors.push(String(error)));
      service.fs = null;
      service._appendStagingRow({ basisClock: 0, clock: 1, patches: [] });
      assert.strictEqual(errors.length, 0);
      service.fs = {
        readFile () { return null; },
        writeFile () { throw new Error('disk full'); }
      };
      service._appendStagingRow({ basisClock: 0, clock: 1, patches: [] });
      assert.ok(errors.some((error) => error.includes('disk full')));
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

    it('_registerService keeps actor registration off the log', async function () {
      const parent = new Service({ ...FAST_SERVICE, services: ['child'] });
      await parent.start();
      const logs = [];
      const debug = [];
      parent.on('log', (line) => logs.push(String(line)));
      parent.on('debug', (line) => debug.push(String(line)));
      class Child extends Service {
        async _registerActor (identity) {
          return { id: identity.id, secret: 'do-not-print' };
        }
      }
      await parent._registerService('child', Child);
      parent.emit('identity', { id: 'actor-1', secret: 'do-not-print' });
      await new Promise((resolve) => setImmediate(resolve));
      await parent.stop();
      assert.ok(debug.some((x) => x.includes('Registered actor on "child": actor-1')));
      assert.ok(!debug.some((x) => x.includes('do-not-print')));
      assert.ok(!logs.some((x) => /Registered [Aa]ctor|Registering actor|do-not-print/.test(x)));
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
      const errors = [];
      const orig = console.error;
      console.error = (...args) => stderr.push(args.join(' '));
      service.on('error', (err) => errors.push(err));
      let result;
      try {
        result = await service._applyChanges([{
          op: 'add',
          path: '/constraints/memory/max/__invalid_child__',
          value: 1
        }]);
      } finally {
        console.error = orig;
      }
      await service.stop();
      assert.ok(stderr.some((s) => s.includes('Could not apply changes')));
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
      assert.ok(errors.length >= 1);
    });

    it('_applyChanges applies a valid add and no-ops an empty list', async function () {
      const service = new Service(FAST_SERVICE);
      await service.start();
      const empty = await service._applyChanges([]);
      assert.strictEqual(empty.ok, true);
      const ok = await service._applyChanges([
        { op: 'add', path: '/serviceCoverageFlag', value: 42 }
      ]);
      assert.strictEqual(ok.ok, true);
      assert.strictEqual(service._state.content.serviceCoverageFlag, 42);
      await service.stop();
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

    it('exposes default opcode registry including Bitcoin and Fabric entries', function () {
      const service = new Service(FAST_SERVICE);
      const opcodes = service.listOpcodes();
      assert.ok(Array.isArray(opcodes) && opcodes.length > 0);
      assert.ok(opcodes.some((x) => x.name === 'OP_SHA256' && x.family === 'bitcoin'));
      assert.ok(opcodes.some((x) => x.name === 'P2P_CHAIN_SYNC_REQUEST' && x.family === 'fabric'));
    });

    it('defineOpcodeContract parses newline-delimited contracts for Hub UI', function () {
      const service = new Service(FAST_SERVICE);
      const authorPubkey = service.key.pubkey;
      const contract = service.defineOpcodeContract('ExampleContract', 'OP_DUP\nOP_HASH160\nP2P_CHAIN_SYNC_REQUEST', {
        author: 'id:example-author'
        ,
        authorPubkey
      });
      assert.deepStrictEqual(contract.lines, ['OP_DUP', 'OP_HASH160', 'P2P_CHAIN_SYNC_REQUEST']);
      assert.strictEqual(contract.author, 'id:example-author');
      assert.strictEqual(contract.policy.threshold, 1);
      assert.strictEqual(contract.policy.participants, 1);
      assert.strictEqual(contract.policy.pubkeys[0].length, 64);
      assert.ok(service.definitions.ExampleContract);
    });

    it('defineOpcodeContract rejects unknown opcodes', function () {
      const service = new Service(FAST_SERVICE);
      assert.throws(() => {
        service.defineOpcodeContract('BadContract', 'OP_DUP\nOP_NOT_A_REAL_OPCODE');
      }, /Unknown opcodes/);
    });

    it('defineOpcodeContract enforces taproot 1-of-1 policy bound to author pubkey', function () {
      const service = new Service(FAST_SERVICE);
      const authorPubkey = service.key.pubkey;
      assert.throws(() => {
        service.defineOpcodeContract('BadPolicyContract', 'OP_DUP', {
          author: 'id:example-author',
          authorPubkey,
          policy: { pubkeys: [authorPubkey, authorPubkey], threshold: 2, participants: 2 }
        });
      }, /policy pubkeys must be 1-of-1/);
    });
  });
});

const Chain = require('../types/chain');
const Contract = require('../types/contract');
const Message = require('../types/message');
const sidechain = require('../functions/sidechainState');
const Bitcoin = require('../services/bitcoin');
const State = require('../types/state');
const Store = require('../types/store');

describe('Hub crash-report follow-ups (core)', function () {
  it('State.serialize does not throw on null', function () {
    const state = new State({ ok: true });
    const serialized = state.serialize(null);
    assert.ok(serialized);
    assert.doesNotThrow(() => new State(null));
  });

  it('Store._POST rejects a null body', async function () {
    const store = new Store({ persistent: false });
    await assert.rejects(() => store._POST('/widgets', null), /JSON body/);
  });

  it('applyP2pAddNodes treats RPC -23 already-added as success', async function () {
    const btc = Object.create(Bitcoin.prototype);
    btc.settings = { debug: false, network: 'regtest' };
    btc._normalizeP2pPeerAddress = Bitcoin.prototype._normalizeP2pPeerAddress;
    btc._makeRPCRequest = async function () {
      throw new Error('addnode failed hub.fabric.pub:18444: [-23] Node already added');
    };
    const warnings = [];
    btc.emit = function (ev, msg) {
      if (ev === 'warning') warnings.push(msg);
    };
    const done = await Bitcoin.prototype.applyP2pAddNodes.call(btc, ['hub.fabric.pub:18444']);
    assert.deepStrictEqual(done, ['hub.fabric.pub:18444']);
    assert.strictEqual(warnings.length, 0);
  });
});

describe('state digests on chain blocks and contract commits', function () {
  it('signs a block with a state digest, and null when the digest cannot be built', function () {
    const chain = new Chain();
    const block = chain.createSignedBlock({ actor: 'aa'.repeat(32), changes: [] });
    assert.strictEqual(block.type, 'FabricBlock');
    assert.strictEqual(block.actor, 'aa'.repeat(32));
    assert.strictEqual(typeof block.stateDigest, 'string');
    assert.strictEqual(block.stateDigest.length, 64);
    assert.ok(!('state' in block));
    chain.contentDigest = () => { throw new Error('digest down'); };
    assert.strictEqual(chain.createSignedBlock().stateDigest, null);
  });

  it('commit records a null digest when the content digest cannot be built', function () {
    const contract = new Contract({
      key: { xprv: require('../constants').FIXTURE_XPRV }
    });
    const commits = [];
    const warnings = [];
    contract.on('commit', (commit) => commits.push(commit));
    contract.on('warning', (warning) => warnings.push(String(warning)));
    contract.contentDigest = () => { throw new Error('digest down'); };
    contract.commit();
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].stateDigest, null);
    assert.ok(!('state' in commits[0]));
    assert.ok(warnings.some((warning) => warning.includes('state digest not built')));
  });
});
