'use strict';

/**
 * Micro-benchmarks aligned with fuzz surfaces (P2P wire, JSON, UI attrs, canonical JSON, Peer handler).
 * Used by {@link scripts/benchmark-report.js} and {@link tests/benchmark/benchmark.smoke.js}.
 */

const { performance } = require('perf_hooks');
const { HEADER_SIZE } = require('../constants');
const Message = require('../types/message');
const Hash256 = require('../types/hash256');
const {
  tryParseWireJson,
  tryParseWireJsonBody,
  tryParsePersistedJson,
  blessedParamsFromJadeAttrs
} = require('../functions/wireJson');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const Peer = require('../types/peer');
const Collection = require('../types/collection');
const Machine = require('../types/machine');

/** Deterministic wire buffer: full header slice + body; body hash will not match → fast reject in Peer. */
function makeWireBuffer () {
  const header = Buffer.alloc(HEADER_SIZE);
  for (let i = 0; i < HEADER_SIZE; i++) header[i] = (i * 17 + 3) & 0xff;
  const body = Buffer.from('{"type":"GENERIC_MESSAGE","object":{"x":1}}', 'utf8');
  return Buffer.concat([header, body]);
}

const WIRE_BUF = makeWireBuffer();
/** Monotonic counter written into the last 4 header bytes so each wire buffer has a unique full-buffer SHA-256 (see {@link Peer#_handleFabricMessage} dedup + body-hash mismatch path). */
let _peerBenchWireSeq = 0;
const WIRE_JSON_OK = '{"type":"PING","object":{}}';
const PERSISTED_JSON_OK = JSON.stringify({ peers: { a: { score: 900, host: '127.0.0.1' } } });
const CANONICAL_OBJ = { z: 1, a: { b: 2, c: [3, 4] }, m: 'hello' };
const JADE_ATTRS = [
  { name: 'class', val: '\'{"fg":"green"}\'' },
  { name: 'tags', val: '["a","b"]' },
  { name: 'label', val: "'plain'" }
];

let _peer;
function peerSingleton () {
  if (!_peer) {
    _peer = new Peer({
      listen: false,
      networking: false,
      peersDb: null,
      debug: false,
      reconnectToKnownPeers: false
    });
  }
  return _peer;
}

let _collection;
let _machine;
function collectionMachine () {
  if (!_collection) {
    _collection = new Collection();
    _machine = new Machine();
  }
  return { collection: _collection, machine: _machine };
}

function getScenarios () {
  return [
    {
      name: 'message.fromRaw + wireType + data',
      baseIterations: 12000,
      fn () {
        const m = Message.fromRaw(WIRE_BUF);
        void m.wireType;
        void m.data;
      }
    },
    {
      name: 'message.toObject (decoded frame)',
      baseIterations: 8000,
      fn () {
        void Message.fromRaw(WIRE_BUF).toObject();
      }
    },
    {
      name: 'tryParseWireJson (valid small)',
      baseIterations: 25000,
      fn () {
        void tryParseWireJson(WIRE_JSON_OK);
      }
    },
    {
      name: 'tryParseWireJsonBody (empty → {})',
      baseIterations: 25000,
      fn () {
        void tryParseWireJsonBody('');
      }
    },
    {
      name: 'tryParsePersistedJson (1KB object)',
      baseIterations: 8000,
      fn () {
        void tryParsePersistedJson(PERSISTED_JSON_OK);
      }
    },
    {
      name: 'blessedParamsFromJadeAttrs (3 attrs)',
      baseIterations: 15000,
      fn () {
        void blessedParamsFromJadeAttrs(JADE_ATTRS);
      }
    },
    {
      name: 'fabricCanonicalJson (nested object)',
      baseIterations: 12000,
      fn () {
        void fabricCanonicalJson(CANONICAL_OBJ);
      }
    },
    {
      name: 'Hash256.doubleDigest (64B)',
      baseIterations: 20000,
      fn () {
        void Hash256.doubleDigest(WIRE_BUF.subarray(0, 64));
      }
    },
    {
      name: 'peer._handleFabricMessage (hash mismatch exit)',
      baseIterations: 4000,
      fn () {
        const peer = peerSingleton();
        while (peer._wireHashOrder.length) {
          const h = peer._wireHashOrder.shift();
          delete peer.messages[h];
        }
        const buf = Buffer.from(WIRE_BUF);
        _peerBenchWireSeq = (_peerBenchWireSeq + 1) >>> 0;
        buf.writeUInt32LE(_peerBenchWireSeq, HEADER_SIZE - 4);
        peer._handleFabricMessage(buf, { name: '127.0.0.1:19999' }, null);
      }
    },
    {
      name: 'collection.create (Machine sip row)',
      baseIterations: 400,
      async: true,
      asyncFn: async function collectionCreateRow () {
        const { collection, machine } = collectionMachine();
        await collection.create({ name: machine.sip() });
      }
    }
  ];
}

function iterationCount (scenario, multiplier) {
  const m = Number(multiplier);
  const mult = Number.isFinite(m) && m > 0 ? m : 1;
  return Math.max(30, Math.floor(scenario.baseIterations * mult));
}

function warmupCount (iterations) {
  return Math.min(200, Math.max(20, Math.floor(iterations / 20)));
}

/**
 * @param {object} scenario
 * @param {number} iterations
 * @returns {{ name: string, iterations: number, ms: number, opsPerSec: number, nsPerOp: number, async?: boolean }}
 */
function runSyncScenario (scenario, iterations) {
  const w = warmupCount(iterations);
  const fn = scenario.fn;
  for (let i = 0; i < w; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const t1 = performance.now();
  const ms = t1 - t0;
  const opsPerSec = (iterations / ms) * 1000;
  return {
    name: scenario.name,
    iterations,
    ms,
    opsPerSec,
    nsPerOp: (ms / iterations) * 1e6,
    async: false
  };
}

/**
 * @param {object} scenario
 * @param {number} iterations
 * @returns {Promise<object>}
 */
async function runAsyncScenario (scenario, iterations) {
  const w = warmupCount(iterations);
  const fn = scenario.asyncFn;
  for (let i = 0; i < w; i++) await fn();
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const t1 = performance.now();
  const ms = t1 - t0;
  const opsPerSec = (iterations / ms) * 1000;
  return {
    name: scenario.name,
    iterations,
    ms,
    opsPerSec,
    nsPerOp: (ms / iterations) * 1e6,
    async: true
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.multiplier=1] — scales each scenario’s baseIterations (use &lt;1 for quick smoke)
 * @returns {Promise<object[]>}
 */
async function runAll (opts = {}) {
  const multiplier = opts.multiplier != null ? opts.multiplier : (Number(process.env.BENCHMARK_MULTIPLIER) || 1);
  const scenarios = getScenarios();
  const results = [];
  for (const s of scenarios) {
    const n = iterationCount(s, multiplier);
    if (s.async) {
      results.push(await runAsyncScenario(s, n));
    } else {
      results.push(runSyncScenario(s, n));
    }
  }
  return results;
}

function formatConsoleTable (rows) {
  const nameW = Math.min(56, Math.max(36, ...rows.map((r) => r.name.length)));
  const lines = [
    '',
    '─'.repeat(nameW + 52),
    `${'scenario'.padEnd(nameW)}  iters      ms    ops/s        ns/op`,
    '─'.repeat(nameW + 52)
  ];
  for (const r of rows) {
    const ops = r.opsPerSec >= 1e6
      ? `${(r.opsPerSec / 1e6).toFixed(2)}M`
      : r.opsPerSec >= 1e3
        ? `${(r.opsPerSec / 1e3).toFixed(1)}k`
        : r.opsPerSec.toFixed(0);
    lines.push(
      `${r.name.slice(0, nameW).padEnd(nameW)}  ${String(r.iterations).padStart(6)}  ${r.ms.toFixed(1).padStart(7)}  ${ops.padStart(10)}  ${r.nsPerOp.toFixed(1).padStart(10)}`
    );
  }
  lines.push('─'.repeat(nameW + 52), '');
  return lines.join('\n');
}

function buildReportPayload (rows, meta = {}) {
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    multiplier: meta.multiplier != null ? meta.multiplier : (Number(process.env.BENCHMARK_MULTIPLIER) || 1),
    rows
  };
}

module.exports = {
  getScenarios,
  runAll,
  runSyncScenario,
  runAsyncScenario,
  iterationCount,
  formatConsoleTable,
  buildReportPayload,
  makeWireBuffer
};
