'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const crypto = require('crypto');
const Fabric = require('../types/fabric');
const State = require('../types/state');

describe('@fabric/core/types/fabric', function () {
  it('constructs with defaults', function () {
    const f = new Fabric({ persistent: false });
    assert.ok(f);
    assert.strictEqual(f._state.status, 'PAUSED');
    assert.ok(f.chain);
    assert.ok(f.machine);
    assert.ok(f.store);
  });

  it('exposes static type getters', function () {
    assert.strictEqual(Fabric.Peer, require('../types/peer'));
    assert.strictEqual(Fabric.Message, require('../types/message'));
    assert.strictEqual(Fabric.Hash256, require('../types/hash256'));
    assert.strictEqual(Fabric.Wallet, require('../types/wallet'));
    assert.strictEqual(Fabric.Bond, require('../types/bond'));
    assert.strictEqual(Fabric.Contract, require('../types/contract'));
    assert.strictEqual(Fabric.Text, require('../services/text'));
    assert.strictEqual(Fabric.RoundRobin, require('../types/roundRobin'));
  });

  it('Fabric.sha256 matches crypto', function () {
    const buf = Buffer.from('abc');
    const expected = crypto.createHash('sha256').update(buf).digest('hex');
    assert.strictEqual(Fabric.sha256(buf), expected);
  });

  it('Fabric.random returns a number', function () {
    const r = Fabric.random();
    assert.strictEqual(typeof r, 'number');
  });

  it('registry exposes local service', function () {
    assert.ok(Fabric.registry.local);
  });

  it('register rejects null service', async function () {
    const f = new Fabric({ persistent: false });
    const out = await f.register(null);
    assert.ok(out instanceof Error);
  });

  it('register stores module and emits', async function () {
    const f = new Fabric({ persistent: false });
    let saw = false;
    f.on('message', (msg) => {
      if (msg['@type'] === 'ServiceRegistration') saw = true;
    });
    class DummyService {}
    await f.register(DummyService);
    assert.ok(f.modules.dummyservice);
    assert.strictEqual(saw, true);
  });

  it('append delegates to chain', function () {
    const f = new Fabric({ persistent: false });
    const v = new State({ test: 1 });
    assert.doesNotThrow(() => f.append(v));
  });

  it('send emits message', function () {
    const f = new Fabric({ persistent: false });
    let msgs = 0;
    f.on('message', () => { msgs++; });
    f.send('t', { x: 1 });
    assert.strictEqual(msgs, 1);
  });

  it('broadcast emits named event', function () {
    const f = new Fabric({ persistent: false });
    let got = 0;
    f.on('ping', () => { got++; });
    f.broadcast('ping', { y: 2 });
    assert.strictEqual(got, 1);
  });

  it('compute returns self', function () {
    const f = new Fabric({ persistent: false });
    assert.strictEqual(f.compute(), f);
  });

  it('render returns integrity shell', function () {
    const f = new Fabric({ persistent: false });
    const html = f.render();
    assert.ok(html.includes('Fabric'));
    assert.ok(html.includes('sha256:'));
  });

  it('trust binds source events', function () {
    const f = new Fabric({ persistent: false });
    const src = new EventEmitter();
    src.name = 'testsrc';
    assert.strictEqual(f.trust(src), f);
  });

  it('delegates store I/O to this.store', async function () {
    const f = new Fabric({ persistent: false });
    const calls = [];
    f.store = {
      _GET: async (k) => { calls.push(['GET', k]); return 'got'; },
      _SET: async (k, v) => { calls.push(['SET', k, v]); },
      _POST: async (c, v) => { calls.push(['POST', c, v]); },
      _PATCH: async (k, o) => { calls.push(['PATCH', k, o]); },
      _DELETE: async (k) => { calls.push(['DELETE', k]); }
    };
    assert.strictEqual(await f._GET('k'), 'got');
    await f._SET('a', 1);
    await f._PUT('b', 2);
    await f._POST('actors', { id: 1 });
    await f._PATCH('c', { x: 1 });
    await f._DELETE('d');
    assert.ok(calls.some((c) => c[0] === 'GET'));
    assert.ok(calls.some((c) => c[0] === 'SET'));
    assert.ok(calls.some((c) => c[0] === 'POST'));
    assert.ok(calls.some((c) => c[0] === 'PATCH'));
    assert.ok(calls.some((c) => c[0] === 'DELETE'));
  });

  it('push coerces non-State input and updates machine script', function () {
    const f = new Fabric({ persistent: false });
    const stack = f.push({ op: 'noop' });
    assert.ok(stack);
  });

  it('push leaves bare Vector (EventEmitter) instances unwrapped', function () {
    const f = new Fabric({ persistent: false });
    const v = new Fabric.Vector();
    const stack = f.push(v);
    assert.strictEqual(stack[stack.length - 1], v);
  });

  it('inherits default opcode registry families from Service', function () {
    const f = new Fabric({ persistent: false });
    const opcodes = f.listOpcodes();
    assert.ok(opcodes.length > 0);
    assert.ok(opcodes.some((entry) => entry.family === 'bitcoin'));
    assert.ok(opcodes.some((entry) => entry.family === 'fabric'));
  });

  it('use registers function opcodes in machine and metadata registry', function () {
    const f = new Fabric({ persistent: false });
    const name = 'P2P_TEST_OPCODE';

    f.use(name, function testOpcode () {
      return 1;
    });

    assert.strictEqual(typeof f.machine.known[name], 'function');
    const entry = f.listOpcodes().find((op) => op.name === name);
    assert.ok(entry, 'opcode metadata should be registered');
    assert.strictEqual(entry.implementation, true);
    assert.strictEqual(entry.family, 'fabric');
  });
});
