'use strict';

const assert = require('assert');
const Machine = require('../types/machine');

function run (payload, host) {
  return Machine.runPayload(payload, host);
}

describe('Machine.runPayload isolate interpreter', function () {
  it('runs every execution step and reports the failures', function () {
    const ok = run({
      steps: [
        { op: ' push ', value: 2 },
        { op: 'PUSH', value: 3 },
        { op: 'add' },
        { op: 'dup' },
        { op: 'POP' },
        { op: 'Push', value: null },
        { op: 'Push', value: true },
        { op: 'Push', value: 'x' },
        { op: 'Push', value: [] },
        { op: 'Push', value: {} },
        { op: 'Push', value: Object.create(null) }
      ]
    });
    assert.strictEqual(ok.ok, true, ok.error);
    assert.ok(ok.stack.includes(5));
    assert.strictEqual(ok.stack.includes(null), true);
    assert.strictEqual(ok.tip && typeof ok.tip, 'object');

    const seeded = run({
      steps: [{ op: 'Pop' }],
      options: { seedValue: 9, maxSteps: 0, maxStack: 0, maxTrace: 0, maxDepth: 0 }
    });
    assert.strictEqual(seeded.ok, true, seeded.error);
    assert.strictEqual(seeded.tip, null);

    const empty = run({ program: { steps: [] } });
    assert.strictEqual(empty.ok, true);
    assert.strictEqual(empty.tip, null);

    assert.match(run(null).error, /program\.steps must be an array/);
    assert.match(run({ steps: 'no' }).error, /program\.steps must be an array/);
    assert.match(run({
      steps: [{ op: 'Push', value: 1 }, { op: 'Push', value: 2 }],
      options: { maxSteps: 1 }
    }).error, /maxSteps/);
    assert.match(run({ steps: [null] }).error, /invalid step/);
    assert.match(run({ steps: [{ op: 'Push' }] }).error, /Push requires value/);
    assert.match(run({ steps: [{ op: 'Push', value: undefined }] }).error, /unsupported value type/);
    assert.match(run({ steps: [{ op: 'Push', value: Symbol('s') }] }).error, /unsupported value type/);
    assert.match(run({ steps: [{ op: 'Push', value: function () {} }] }).error, /unsupported value type/);
    assert.match(run({ steps: [{ op: 'Push', value: 1n }] }).error, /unsupported value type/);
    assert.match(run({ steps: [{ op: 'Push', value: Infinity }] }).error, /non-finite/);
    assert.match(run({ steps: [{ op: 'Push', value: new Date() }] }).error, /non-plain/);
    assert.match(run({
      steps: [{ op: 'Push', value: { a: { b: 1 } } }],
      options: { maxDepth: 1 }
    }).error, /max nesting depth/);
    assert.match(run({ steps: [{ op: 'Push', value: [Infinity] }] }).error, /non-finite/);
    assert.match(run({ steps: [{ op: 'Pop' }] }).error, /stack underflow/);
    assert.match(run({ steps: [{ op: 'Dup' }] }).error, /stack underflow/);
    assert.match(run({ steps: [{ op: 'ADD' }] }).error, /stack underflow/);
    assert.match(run({
      steps: [
        { op: 'Push', value: 'a' },
        { op: 'Push', value: 1 },
        { op: 'ADD' }
      ]
    }).error, /ADD requires two finite numbers/);
    assert.match(run({ steps: [{ op: 'Nope' }] }).error, /unknown op/);
    assert.match(run({
      steps: [{ op: 'Push', value: 1 }, { op: 'Push', value: 2 }],
      options: { maxStack: 1 }
    }).error, /stack overflow/);

    const truncated = run({
      steps: [
        { op: 'Push', value: 1 },
        { op: 'Push', value: 2 },
        { op: 'Push', value: 3 }
      ],
      options: { maxTrace: 1 }
    });
    assert.strictEqual(truncated.ok, true, truncated.error);
    assert.ok(truncated.trace.some((row) => row.truncated));
  });

  it('resolves FabricOpcode and DelegationSignRequest', function () {
    const plain = run({
      steps: [{ op: 'FabricOpcode', fabricType: '  Chat  ', fabricOpcode: 12 }]
    });
    assert.strictEqual(plain.ok, true, plain.error);
    assert.strictEqual(plain.tip.name, 'Chat');
    assert.strictEqual(plain.tip.opcodeDec, 12);

    const unknown = run({ steps: [{ op: 'fabricopcode', fabricType: '   ', fabricOpcode: 'nope' }] });
    assert.strictEqual(unknown.ok, true, unknown.error);
    assert.strictEqual(unknown.tip.name, 'Unknown');
    assert.strictEqual(unknown.tip.opcodeDec, null);

    const resolved = run({
      steps: [{
        op: 'FabricOpcode',
        resolved: { name: 'Chat', opcodeDec: 4, stability: 'stable', encoding: 'raw', notes: 'n' }
      }],
      options: { useResolvedEntries: true, allowedOpcodes: ['Chat'] }
    });
    assert.strictEqual(resolved.ok, true, resolved.error);
    assert.strictEqual(resolved.tip.stability, 'stable');

    const hosted = run({
      steps: [{ op: 'FabricOpcode', fabricType: 'Chat' }]
    }, {
      resolveFabricEntry () {
        return { name: 'Chat', opcodeDec: 8, stability: null, encoding: null, notes: null };
      }
    });
    assert.strictEqual(hosted.tip.opcodeDec, 8);

    assert.match(run({
      steps: [{ op: 'FabricOpcode', resolved: { name: 'Ping' } }],
      options: { useResolvedEntries: true }
    }).error, /keepalive/);
    assert.match(run({
      steps: [{ op: 'FabricOpcode', resolved: { name: 'Pong' } }],
      options: { useResolvedEntries: true }
    }).error, /keepalive/);
    assert.match(run({
      steps: [{ op: 'FabricOpcode', fabricType: 'Chat' }],
      options: { allowedOpcodes: ['Other'] }
    }).error, /allow-list/);
    assert.match(run({
      steps: [{ op: 'FabricOpcode' }]
    }, { resolveFabricEntry () { return null; } }).error, /unresolved/);
    assert.match(run({ steps: [{ op: 'FabricOpcode', resolved: 'nope' }] }, {
      resolveFabricEntry () { return 'nope'; }
    }).error, /unresolved/);

    const signed = run({
      steps: [{ op: 'delegationsignrequest', envelope: { purpose: 'sign', n: 1 } }]
    });
    assert.strictEqual(signed.ok, true, signed.error);
    assert.strictEqual(signed.tip.kind, 'DelegationSignRequest');
    assert.match(run({ steps: [{ op: 'DelegationSignRequest' }] }).error, /requires envelope/);
    assert.match(run({
      steps: [{ op: 'DelegationSignRequest', envelope: new Date() }]
    }).error, /non-plain/);
  });

  it('runs opcode scripts only when they are empty or refused', function () {
    const empty = run({ kind: 'fabric-opcodes', steps: [], seedValue: 1 });
    assert.strictEqual(empty.ok, true, empty.error);
    assert.strictEqual(empty.tip, 1);

    assert.match(run({ kind: 'fabric-opcodes', steps: ['A', 'B'], maxSteps: 1 }).error, /maxSteps/);
    assert.match(run({
      kind: 'fabric-opcodes',
      steps: ['OP_TRUE'],
      allowedOpcodes: ['NOPE']
    }).error, /allow-list/);
    assert.match(run({
      kind: 'fabric-opcodes',
      steps: ['OP_TRUE'],
      allowedOpcodes: ['OP_TRUE']
    }).error, /not defined \(fail closed/);
    assert.match(run({ kind: 'fabric-opcodes', steps: ['OP_TRUE'] }).error, /opcode not defined: OP_TRUE/);
    const bare = run({ kind: 'fabric-opcodes' });
    assert.strictEqual(bare.ok, true, bare.error);
    assert.strictEqual(bare.tip, null);
  });

  it('answers isolate messages and attaches a port', function () {
    const posted = [];
    Machine._isolateReplyTo({
      port: { postMessage (msg) { posted.push(['port', msg.tip]); } }
    }, { tip: 1 });
    Machine._isolateReplyTo({
      reply (msg) { posted.push(['reply', msg.tip]); }
    }, { tip: 2 });
    Machine._isolateReplyTo(null, { tip: 3 });
    assert.deepStrictEqual(posted, [['port', 1], ['reply', 2]]);

    const direct = [];
    Machine._isolateOnMessage({ steps: [{ op: 'Push', value: 4 }] }, (result) => {
      direct.push(result.tip);
    });
    const replied = [];
    Machine._isolateOnMessage({
      payload: { steps: [] },
      reply (result) { replied.push(result.ok); }
    });
    const thrown = [];
    const bad = {};
    Object.defineProperty(bad, 'steps', { get () { throw new Error('boom'); } });
    Machine._isolateOnMessage(bad, (result) => thrown.push(result.error));
    assert.deepStrictEqual(direct, [4]);
    assert.deepStrictEqual(replied, [true]);
    assert.match(thrown[0], /boom/);

    const scopeMessages = [];
    const previous = global.self;
    global.self = {
      postMessage (msg) { scopeMessages.push(msg.tip); }
    };
    try {
      Machine._isolateAttachPort();
      assert.strictEqual(typeof global.self.onmessage, 'function');
      global.self.onmessage({ data: { steps: [{ op: 'Push', value: 6 }] } });
    } finally {
      if (previous === undefined) delete global.self;
      else global.self = previous;
    }
    assert.deepStrictEqual(scopeMessages, [6]);

    const resolved = require.resolve('worker_threads');
    const cached = require.cache[resolved];
    const parentPosts = [];
    const listeners = [];
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: {
        parentPort: {
          on (event, fn) { listeners.push({ event, fn }); },
          postMessage (msg) { parentPosts.push(msg); }
        }
      }
    };
    try {
      Machine._isolateAttachPort();
      assert.strictEqual(listeners[0].event, 'message');
      listeners[0].fn({ payload: { steps: [{ op: 'Push', value: 7 }] } });
      listeners[0].fn({
        port: { postMessage (msg) { parentPosts.push(['via-port', msg.tip]); } },
        payload: { steps: [{ op: 'Push', value: 8 }] }
      });
      require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        get exports () { throw new Error('worker_threads unavailable'); }
      };
      Machine._isolateAttachPort();
    } finally {
      if (cached) require.cache[resolved] = cached;
      else delete require.cache[resolved];
    }
    assert.strictEqual(parentPosts[0].tip, 7);
    assert.deepStrictEqual(parentPosts[1], ['via-port', 8]);
    assert.strictEqual(parentPosts.length, 2);
  });

  it('rejects non-finite numbers before an isolate payload is built', function () {
    const program = { steps: [{ op: 'Push', value: 1 }] };
    const finite = Machine._prepareExecutionIsolate({
      steps: [{ op: 'Push', value: 1 }],
      bag: { n: 2, arr: [3, { z: 4 }] }
    }, { seedValue: 1, maxSteps: 4, allowedOpcodes: ['OP_TRUE'] });
    assert.strictEqual(finite.failure, null);
    assert.strictEqual(finite.payload.options.seedValue, 1);

    const nan = Machine._prepareExecutionIsolate(Object.assign({}, program, { note: NaN }));
    assert.match(nan.failure.error, /non-finite/);
    const seeded = Machine._prepareExecutionIsolate(program, { seedValue: Infinity });
    assert.match(seeded.failure.error, /non-finite/);
    const nested = Machine._prepareExecutionIsolate(Object.assign({}, program, { bag: { arr: [NaN] } }));
    assert.match(nested.failure.error, /non-finite/);
  });
});
