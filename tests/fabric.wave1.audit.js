'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Identity = require('../types/identity');
const Key = require('../types/key');
const Service = require('../types/service');
const Message = require('../types/message');
const { P2P_CONTRACT_PUBLISH } = require('../constants');

describe('Wave 1 core audit honesty', function () {
  it('Actor.sign requires a Key and points callers at Message.signWithKey', function () {
    const a = new Actor({ hello: true });
    assert.throws(() => a.sign(), /Message\.signWithKey|Key\.sign/);
  });

  it('Actor.sign succeeds when this.key is a Key', function () {
    const key = new Key();
    const a = new Actor({ hello: true });
    a.key = key;
    let seen = null;
    a.on('signature', (sig) => { seen = sig; });
    const out = a.sign();
    assert.strictEqual(out, a);
    assert.ok(a.signature);
    assert.strictEqual(seen, a.signature);
  });

  it('Identity._verifyKeyIsChild matches fabricKey under master', function () {
    const id = new Identity();
    assert.strictEqual(id._verifyKeyIsChild(id.fabricKey, id.master), true);
    assert.strictEqual(id._verifyKeyIsChild(new Key(), id.master), false);
    assert.strictEqual(id._verifyKeyIsChild(null, id.master), false);
    assert.strictEqual(id._verifyKeyIsChild(String(id.fabricKey.pubkey), id.master), true);
    assert.strictEqual(id._verifyKeyIsChild({ publicKey: id.fabricKey.pubkey }, id.master), true);
    assert.strictEqual(id._verifyKeyIsChild(id.fabricKey, id.master, 'm/44\'/0\'/0\'/0/0'), false);
    assert.strictEqual(id._verifyKeyIsChild(id.fabricKey, {}), false);
  });

  it('Service._applyChanges rejects sensitive paths', async function () {
    const service = new Service({ networking: false });
    await service.start();
    const denied = await service._applyChanges([
      { op: 'add', path: '/mnemonic', value: 'abandon abandon' }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(service._state.content.mnemonic, undefined);
    await service.stop();
  });

  it('Service._applyChanges rejects sensitive from pointers on copy/move', async function () {
    const service = new Service({ networking: false });
    await service.start();
    service._state.content.mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const denied = await service._applyChanges([
      { op: 'copy', from: '/mnemonic', path: '/public' }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /sensitive from/);
    assert.strictEqual(service._state.content.public, undefined);
    await service.stop();
  });

  it('Service.requirePatchCapability blocks without patchCapability', async function () {
    const service = new Service({
      networking: false,
      requirePatchCapability: true
    });
    await service.start();
    const denied = await service._applyChanges([
      { op: 'add', path: '/ok', value: 1 }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /requirePatchCapability/);
    await service.stop();
  });

  it('Service.requirePatchCapability allows patches when patchCapability is set', async function () {
    const service = new Service({
      networking: false,
      requirePatchCapability: true,
      patchCapability: { scaffold: true }
    });
    await service.start();
    const ok = await service._applyChanges([
      { op: 'add', path: '/wave1Flag', value: true }
    ]);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(service._state.content.wave1Flag, true);
    await service.stop();
  });

  it('registers CONTRACT_* body schemas while still accepting JSON', function () {
    assert.ok(Message.getBodySchema('CONTRACT_PUBLISH'));
    assert.ok(Message.getBodySchema('CONTRACT_MESSAGE'));
    assert.ok(Message.getBodySchema(P2P_CONTRACT_PUBLISH));
    const json = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'aa'.repeat(32),
      payload: { hi: 1 }
    })]);
    const parsed = Message.tryParseMessageBody(json);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.encoding, 'json');
  });

  it('CONTRACT_* fromFields encode/decode via tryParseMessageBody', function () {
    const definition = JSON.stringify({
      name: 'wave1-fields',
      members: { signers: ['aa'.repeat(32)], threshold: 1 }
    });
    const pub = Message.fromFields('CONTRACT_PUBLISH', { definition });
    const pubParsed = Message.tryParseMessageBody(pub);
    assert.strictEqual(pubParsed.ok, true);
    assert.strictEqual(pubParsed.encoding, 'fields');
    assert.strictEqual(pubParsed.value.definition, definition);

    const cm = Message.fromFields('CONTRACT_MESSAGE', {
      contract: 'bb'.repeat(32),
      payload: JSON.stringify({ type: 'GroupChange', object: { action: 'noop' } })
    });
    const cmParsed = Message.tryParseMessageBody(cm);
    assert.strictEqual(cmParsed.ok, true);
    assert.strictEqual(cmParsed.encoding, 'fields');
    assert.strictEqual(cmParsed.value.contract, 'bb'.repeat(32));
  });

  it('Service._applyChanges emits error and refuses sensitive from pointers', async function () {
    const service = new Service({ networking: false, requirePatchCapability: true });
    let err = null;
    service.on('error', (e) => { err = e; });
    const blocked = await service._applyChanges([{ op: 'add', path: '/ok', value: 1 }]);
    assert.strictEqual(blocked.ok, false);
    assert.ok(err instanceof Error);

    const withCap = new Service({
      networking: false,
      requirePatchCapability: true,
      patchCapability: { scaffold: true }
    });
    await withCap.start();
    const leaked = await withCap._applyChanges([
      { op: 'move', from: '/mnemonic/seed', path: '/public' }
    ]);
    assert.strictEqual(leaked.ok, false);
    assert.ok(/sensitive from/.test(leaked.error));
    let applyErr = null;
    withCap.on('error', (e) => { applyErr = e; });
    const bad = await withCap._applyChanges([{ op: 'totally-invalid', path: '/x', value: 1 }]);
    assert.strictEqual(bad.ok, false);
    assert.ok(applyErr instanceof Error || typeof bad.error === 'string');
    await withCap.stop();
  });

  it('Identity._verifyKeyIsChild returns false when derive throws', function () {
    const id = new Identity();
    const parent = {
      derive () { throw new Error('bad path'); }
    };
    assert.strictEqual(id._verifyKeyIsChild(id.fabricKey, parent, 'm/bad'), false);
  });
});

describe('ESM Fabric facade (types/fabric.mjs)', function () {
  it('exposes DistributedExecution and random via the ESM entry', async function () {
    const mod = await import('../types/fabric.mjs');
    const Fabric = mod.default;
    assert.strictEqual(typeof Fabric.random, 'function');
    const u = Fabric.random();
    assert.ok(typeof u === 'number' && u >= 0 && u < 1);
    assert.strictEqual(typeof Fabric.DistributedExecution, 'object');
    assert.ok(Fabric.DistributedExecution);
    assert.strictEqual(Fabric.Actor, require('../types/actor'));
    assert.strictEqual(Fabric.sha256('abc').length, 64);
  });
});

describe('Datastore entropy + Turntable autobop', function () {
  it('Datastore.ping stamps entropy via randomUnit', function () {
    const Datastore = require('../types/datastore');
    const Transaction = require('../types/transaction');
    // Avoid Datastore constructor (observe() needs a live object); call ping on a stub.
    const ds = Object.create(Datastore.prototype);
    ds.identity = new Key();
    ds['@data'] = {
      '/pings': {
        ledger: {
          append (row) { this._last = row; }
        }
      }
    };
    ds.log = function () {};
    // Datastore.ping historically called Transaction#_sign (State-style);
    // Actor exposes #sign — stub so we still exercise randomUnit on the ping.
    const hadSign = Object.prototype.hasOwnProperty.call(Transaction.prototype, '_sign');
    const prevSign = Transaction.prototype._sign;
    Transaction.prototype._sign = function () { return this; };
    try {
      Datastore.prototype.ping.call(ds);
    } finally {
      if (hadSign) Transaction.prototype._sign = prevSign;
      else delete Transaction.prototype._sign;
    }
    const ping = ds['@data']['/pings'].ledger._last;
    assert.ok(ping);
    const entropy = ping.settings && ping.settings.entropy;
    assert.ok(typeof entropy === 'number');
    assert.ok(entropy >= 0 && entropy < 1);
  });

  it('Turntable._handleNewSong defers upvote when autobop is enabled', async function () {
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'ttfm') {
        return {
          TtfmApi: {
            connect: async () => ({
              onUserJoin () {},
              onUserLeave () {},
              onAddDj () {},
              onSpeak () {},
              onNewSong () {},
              joinRoom: async () => ({ say: async () => {}, upvote: async () => true })
            })
          }
        };
      }
      return origLoad.apply(this, arguments);
    };
    const turntablePath = require.resolve('../services/turntable');
    try {
      delete require.cache[turntablePath];
      const Turntable = require('../services/turntable');
      const tt = new Turntable({ autobop: true, rooms: ['room-1'], networking: false });
      let seenDelay = null;
      tt._defer = async function (method, params, delay) {
        seenDelay = delay;
        assert.strictEqual(method, tt._upvoteCurrentTrack);
        return null;
      };
      await tt._handleNewSong({ name: 'song' });
      assert.ok(typeof seenDelay === 'number');
      assert.ok(seenDelay > 0 && seenDelay <= 60000);
    } finally {
      Module._load = origLoad;
      delete require.cache[turntablePath];
    }
  });
});
