'use strict';

/**
 * Blast playnet / local Fabric peers with noisy-neighbor chaos conditions and
 * write crash / disconnect reports under reports/.
 *
 * Operator Hub + GoonCitizen desktops remain dominant (FABRIC_XPRV). This
 * script always mints ephemeral neighbor keys.
 *
 * Usage:
 *   node scripts/playnet-chaos-neighbors.js [--production] [--local] [--isolated] [--neighbors N] [--iterations N]
 *   FABRIC_PLAYNET_CHAOS=1 npm run playnet:chaos
 *   npm run playnet:chaos:isolated   # ephemeral loopback hub (Phase A; no public dial)
 *
 * Forbidden on the wire: P2P_FILE_SEND, GHSA advisory dumps.
 *
 * Required as a module, it exports the planning and crash-report helpers
 * (no network, no env loading).
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const Peer = require('../types/peer');
const Message = require('../types/message');
const Key = require('../types/key');
const { MAX_MESSAGE_SIZE } = require('../constants');

const DEFAULT_PLAYNET_PEERS = Object.freeze([
  'hub.fabric.pub:7777',
  'relay.goon.vc:7777'
]);

const DEFAULT_LOCAL_PEERS = Object.freeze([
  '127.0.0.1:7777',
  '127.0.0.1:7778'
]);

/**
 * Network conditions blasted at outdated / unupgraded peers.
 * Each condition is a signed or raw wire pattern intended to stress parsers
 * and session handling so crash / disconnect reports can be captured.
 *
 * @returns {Array<object>}
 */
function listPlaynetChaosConditions () {
  return [
    {
      id: 'signed-typed-storm',
      description: 'Signed first-class opcodes (ping, chat, gossip, alias, peering offer, inventory, base)',
      types: [
        'P2P_PING',
        'P2P_CHAT_MESSAGE',
        'P2P_PEER_GOSSIP',
        'P2P_PEERING_OFFER',
        'P2P_PEER_ALIAS',
        'P2P_INVENTORY_REQUEST',
        'P2P_BASE_MESSAGE'
      ],
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'oversized-chat-burst',
      description: 'Large UTF-8 P2P_CHAT_MESSAGE bodies to stress chat ingest',
      types: ['P2P_CHAT_MESSAGE'],
      chatBytes: MAX_MESSAGE_SIZE,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'unknown-opcode-spray',
      description: 'Signed unknown / generic chaos type labels via P2P_BASE_MESSAGE',
      types: ['P2P_BASE_MESSAGE'],
      unknownLabels: true,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'raw-amp-noise',
      description: 'Unparsed AMP-sized random frames (parser crash surface)',
      types: [],
      rawAmp: true,
      reconnect: false
    },
    {
      id: 'concurrent-noisy-neighbors',
      description: 'N ephemeral peers dialing the same target and writing in parallel',
      types: ['P2P_PING', 'P2P_CHAT_MESSAGE', 'P2P_PEER_GOSSIP'],
      concurrent: true,
      rawAmp: false,
      reconnect: false
    },
    {
      id: 'reconnect-flap',
      description: 'Connect → short storm → stop → re-dial (session flap)',
      types: ['P2P_PING', 'P2P_CHAT_MESSAGE'],
      rawAmp: false,
      reconnect: true
    },
    {
      id: 'inventory-shape-noise',
      description: 'Signed inventory-shaped BASE messages (no file bytes)',
      types: ['P2P_BASE_MESSAGE'],
      inventoryShape: true,
      rawAmp: false,
      reconnect: false
    }
  ];
}

/**
 * Local Hub desktop + GoonCitizen desktop as dominant playnet clients.
 * Chaos never uses the operator FABRIC_XPRV.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function planDominantDesktopClients (opts = {}) {
  const hubHttp = String(opts.hubHttp || process.env.FABRIC_HUB_RPC_URL || 'http://127.0.0.1:8080')
    .trim().replace(/\/$/, '');
  const hubPeer = String(opts.hubPeer || process.env.FABRIC_LOCAL_HUB_PEER || '127.0.0.1:7777').trim();
  const gcHttp = String(opts.goonCitizenHttp || process.env.SC_HTTP || 'http://127.0.0.1:3041')
    .trim().replace(/\/$/, '');
  const gcPeer = String(opts.goonCitizenPeer || process.env.SC_FABRIC_PEER || '127.0.0.1:7778').trim();
  const playnetPeers = Array.isArray(opts.playnetPeers) && opts.playnetPeers.length
    ? opts.playnetPeers.slice()
    : DEFAULT_PLAYNET_PEERS.slice();

  return {
    role: 'dominant-desktop-clients',
    operatorKeySource: 'FABRIC_XPRV',
    sharedIdentity: true,
    // A Fabric network always exists: local desktop mesh and/or public playnet.
    networkAlwaysExists: true,
    management: {
      shortTerm: 'local-lead',
      longTerm: 'hub.fabric.pub',
      shortTermRegistry: hubPeer,
      longTermRegistry: 'hub.fabric.pub:7777',
      longTermHttp: 'https://hub.fabric.pub'
    },
    note: 'Hub desktop and GoonCitizen desktop must load the same suite FABRIC_XPRV; chaos peers use ephemeral keys only. Short-term playnet lead = local Hub; long-term management = hub.fabric.pub.',
    hubDesktop: {
      app: '@fabric/hub',
      role: 'playnet-registry',
      http: hubHttp,
      fabricPeer: hubPeer,
      acceptMethod: 'AcceptTrackedApplicationContract',
      readiness: [
        'GetNetworkStatus',
        'ListTrackedApplicationContracts',
        '/services/peering',
        '/services/distributed/epoch'
      ]
    },
    goonCitizenDesktop: {
      app: 'GoonCitizen',
      role: 'application-publisher',
      http: gcHttp,
      fabricPeer: gcPeer,
      dial: [hubPeer].concat(playnetPeers.filter((p) => p !== hubPeer)),
      publish: 'CONTRACT_PUBLISH',
      deployFlags: ['--local-registry', '--accept']
    },
    noisyNeighbors: {
      keySource: 'ephemeral',
      neverOperatorKey: true,
      conditions: listPlaynetChaosConditions().map((c) => c.id),
      crashReportFields: [
        'disconnects',
        'hardErrors',
        'econnreset',
        'writes',
        'reconnectCycles',
        'targets'
      ]
    },
    playnetPeers,
    safe: true
  };
}

/**
 * Playnet lead capture: short-term local Hub registry, long-term hub.fabric.pub.
 * Tests and deploy scripts assume a Fabric network always exists (local and/or global).
 *
 * @param {object} [opts]
 * @param {'local-lead'|'hub.fabric.pub'} [opts.horizon]
 * @returns {object}
 */
function planPlaynetLeadCapture (opts = {}) {
  const horizon = opts.horizon === 'hub.fabric.pub' ? 'hub.fabric.pub' : 'local-lead';
  const dominant = planDominantDesktopClients(opts);
  const local = {
    horizon: 'local-lead',
    registryHttp: dominant.hubDesktop.http,
    registryPeer: dominant.hubDesktop.fabricPeer,
    omitProductionHubPeer: true,
    acceptOn: 'loopback',
    deployFlags: ['--local-registry', '--accept'],
    steps: [
      'start-local-hub-desktop-with-FABRIC_XPRV',
      'confirm-fabric-beacon-accepted',
      'point-gooncitizen-peers-at-local-hub-first',
      'CONTRACT_PUBLISH-and-Accept-on-loopback',
      'optional-dial-relay-for-mesh-visibility'
    ]
  };
  const longTerm = {
    horizon: 'hub.fabric.pub',
    registryHttp: 'https://hub.fabric.pub',
    registryPeer: 'hub.fabric.pub:7777',
    omitProductionHubPeer: false,
    acceptOn: 'hub.fabric.pub',
    deployFlags: ['--production', '--accept'],
    steps: [
      'align-FABRIC_XPRV-with-hub.fabric.pub-_rootKey',
      'publish-CONTRACT_PUBLISH-to-hub.fabric.pub:7777',
      'AcceptTracked-on-https://hub.fabric.pub',
      'repoint-client-seeds-to-hub.fabric.pub',
      'retire-local-lead-as-authoritative-registry'
    ]
  };
  const active = horizon === 'hub.fabric.pub' ? longTerm : local;
  return {
    role: 'playnet-lead-capture',
    networkAlwaysExists: true,
    horizon: active.horizon,
    active,
    shortTerm: local,
    longTerm,
    dominant,
    safe: horizon === 'local-lead'
      ? !/hub\.fabric\.pub/i.test(active.registryHttp)
      : /hub\.fabric\.pub/i.test(active.registryHttp)
  };
}

/**
 * Plan a chaos / noisy-neighbor blast for crash-report capture.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function planPlaynetChaosBlast (opts = {}) {
  const isolated = opts.isolated === true ||
    process.env.FABRIC_CHAOS_ISOLATED === '1' ||
    process.env.FABRIC_CHAOS_ISOLATED === 'true';
  const production = !isolated && (opts.production === true ||
    process.env.FABRIC_PLAYNET_CHAOS === '1' ||
    process.env.FABRIC_PLAYNET_CHAOS === 'true' ||
    process.env.ADV_PRODUCTION === '1');
  const explicitPeers = Array.isArray(opts.peers) && opts.peers.length
    ? opts.peers.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const envPeers = String(process.env.FABRIC_PLAYNET_PEERS || process.env.ADV_FABRIC || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const peers = explicitPeers.length ? explicitPeers : (isolated ? [] : envPeers);
  const targets = peers.length
    ? peers
    : (isolated ? [] : (production ? DEFAULT_PLAYNET_PEERS.slice() : DEFAULT_LOCAL_PEERS.slice()));

  const conditions = listPlaynetChaosConditions();
  const selected = Array.isArray(opts.conditions) && opts.conditions.length
    ? conditions.filter((c) => opts.conditions.includes(c.id))
    : conditions;

  const neighborCount = Math.max(1, Math.min(Number(opts.neighbors) ||
    Number(process.env.FABRIC_CHAOS_NEIGHBORS) || 3, 16));
  const iterations = Math.max(8, Math.min(Number(opts.iterations) ||
    Number(process.env.FABRIC_FUZZ_PEER_CHAOS_ITERATIONS) || 48, 500));

  return {
    role: 'playnet-chaos-blast',
    production: !!production,
    isolated: !!isolated,
    targets,
    neighborCount,
    iterations,
    conditions: selected,
    useOperatorKey: false,
    forbiddenWire: ['P2P_FILE_SEND'],
    reportName: String(opts.reportName || process.env.FABRIC_CHAOS_REPORT ||
      (isolated
        ? 'playnet-chaos-neighbors-isolated.json'
        : (production ? 'playnet-chaos-neighbors.json' : 'playnet-chaos-neighbors-local.json'))),
    dominant: planDominantDesktopClients(opts.dominant || {})
  };
}

/**
 * Empty crash-report skeleton filled by the runner.
 * @param {object} plan
 * @returns {object}
 */
function emptyChaosCrashReport (plan) {
  return {
    at: new Date().toISOString(),
    role: plan && plan.role,
    production: !!(plan && plan.production),
    isolated: !!(plan && plan.isolated),
    targets: (plan && plan.targets) || [],
    conditions: [],
    disconnects: [],
    hardErrors: [],
    econnreset: 0,
    writes: { ok: 0, fail: 0, types: {} },
    reconnectCycles: 0,
    neighborPubkeys: [],
    operatorKeyUsed: false,
    notes: []
  };
}

/**
 * Classify a peer error string for crash reporting.
 * @param {string} msg
 * @returns {'soft'|'hard'|'reset'}
 */
function classifyChaosPeerError (msg) {
  const s = String(msg || '');
  if (/ECONNRESET|EPIPE|socket hang up/i.test(s)) return 'reset';
  if (/Attempted to write to a closed|write after end|not connected/i.test(s)) return 'soft';
  return 'hard';
}

/**
 * Build a signed message body for a condition + type.
 * @param {object} condition
 * @param {string} type
 * @param {number} i
 * @returns {string}
 */
function chaosMessageBody (condition, type, i) {
  if (type === 'P2P_CHAT_MESSAGE') {
    // `chatBytes` is the total UTF-8 body size (prefix included), capped at the
    // AMP body limit so `oversized-chat-burst` lands exactly on MAX_MESSAGE_SIZE.
    const n = Math.min(MAX_MESSAGE_SIZE, Math.max(16, Number(condition.chatBytes) || 48));
    const prefix = `playnet-chaos-${condition.id}-${i}-`;
    const padLen = Math.max(0, n - Buffer.byteLength(prefix, 'utf8'));
    // base64 yields 4 ASCII bytes per 3 random bytes; over-generate then trim.
    const pad = crypto.randomBytes(Math.ceil(padLen * 3 / 4) + 3).toString('base64').slice(0, padLen);
    return `${prefix}${pad}`;
  }
  if (type === 'P2P_PEER_ALIAS') {
    return `chaos-${i}`.slice(0, 24);
  }
  if (type === 'P2P_INVENTORY_REQUEST') {
    return JSON.stringify({
      type: 'INVENTORY_REQUEST',
      object: {
        kind: 'documents',
        maxSats: 1,
        nonce: `playnet-chaos-${condition.id}-${i}`
      }
    });
  }
  const object = {
    type: condition.unknownLabels ? 'UNKNOWN_CHAOS' : type,
    nonce: `playnet-chaos-${condition.id}-${i}`,
    created: new Date().toISOString()
  };
  if (condition.inventoryShape) {
    object.type = 'INVENTORY_REQUEST';
    object.object = { documents: [], noise: crypto.randomBytes(32).toString('hex') };
  }
  return JSON.stringify(object);
}

function parseArgv (argv) {
  const out = {
    production: false,
    local: false,
    isolated: false,
    neighbors: null,
    iterations: null,
    conditions: null,
    peers: [],
    reportName: null,
    holdMs: 2000
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--production') out.production = true;
    else if (a === '--local') out.local = true;
    else if (a === '--isolated') out.isolated = true;
    else if (a === '--neighbors') out.neighbors = Number(argv[++i]);
    else if (a === '--iterations') out.iterations = Number(argv[++i]);
    else if (a === '--hold-ms') out.holdMs = Number(argv[++i]);
    else if (a === '--report') out.reportName = String(argv[++i] || '');
    else if (a === '--condition') {
      out.conditions = out.conditions || [];
      out.conditions.push(String(argv[++i] || '').trim());
    } else if (a === '--peers') {
      out.peers = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

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

async function startIsolatedHub () {
  const port = await getFreePort();
  const hub = new Peer({
    listen: true,
    networking: false,
    port,
    interface: '127.0.0.1',
    upnp: false,
    peers: [],
    peersDb: null,
    reconnectToKnownPeers: false,
    debug: false,
    constraints: { peers: { max: 32, shuffle: 8 } }
  });
  await hub.start();
  return hub;
}

function connectionKeys (peer) {
  return Object.keys(peer.connections || {});
}

function writeFabric (peer, buf, report, type) {
  const keys = connectionKeys(peer);
  if (!keys.length) {
    report.writes.fail += 1;
    report.disconnects.push({ at: new Date().toISOString(), reason: 'no-connection' });
    return false;
  }
  const conn = peer.connections[keys[0]];
  const stream = conn && (conn._noiseHandler || conn._noiseClient);
  if (!stream || typeof peer._writeFabric !== 'function') {
    report.writes.fail += 1;
    return false;
  }
  try {
    if (peer._writeFabric(buf, stream) !== true) {
      report.writes.fail += 1;
      return false;
    }
    report.writes.ok += 1;
    if (type) report.writes.types[type] = (report.writes.types[type] || 0) + 1;
    return true;
  } catch (e) {
    report.writes.fail += 1;
    const msg = e && e.message ? e.message : String(e);
    const kind = classifyChaosPeerError(msg);
    if (kind === 'reset') report.econnreset += 1;
    if (kind === 'hard') report.hardErrors.push(msg);
    report.disconnects.push({ at: new Date().toISOString(), reason: msg, kind });
    return false;
  }
}

async function waitConns (peer, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (connectionKeys(peer).length >= 1) return connectionKeys(peer);
    await new Promise((r) => setTimeout(r, 200));
  }
  return connectionKeys(peer);
}

function attachErrors (peer, report) {
  peer.on('error', (err) => {
    const msg = err && err.message ? err.message : String(err);
    const kind = classifyChaosPeerError(msg);
    if (kind === 'reset') {
      report.econnreset += 1;
      report.disconnects.push({ at: new Date().toISOString(), reason: msg, kind });
      return;
    }
    if (kind === 'soft') return;
    report.hardErrors.push(msg);
  });
}

async function spawnNeighbor (targets, report) {
  const key = new Key();
  const peer = new Peer({
    listen: false,
    networking: true,
    peers: targets,
    key: { xprv: key.xprv },
    peersDb: null,
    reconnectToKnownPeers: false
  });
  attachErrors(peer, report);
  await peer.start();
  await waitConns(peer, 25000);
  report.neighborPubkeys.push(String(key.pubkey || '').slice(0, 16) + '…');
  return peer;
}

async function runCondition (condition, plan, report) {
  const row = {
    id: condition.id,
    startedAt: new Date().toISOString(),
    writesOk: 0,
    writesFail: 0,
    disconnects: 0,
    econnreset: 0,
    ok: false
  };
  const beforeDisc = report.disconnects.length;
  const beforeReset = report.econnreset;
  const beforeOk = report.writes.ok;
  const beforeFail = report.writes.fail;

  const neighbors = [];
  const n = condition.concurrent ? plan.neighborCount : 1;
  try {
    for (let i = 0; i < n; i++) {
      neighbors.push(await spawnNeighbor(plan.targets, report));
    }

    const cycles = condition.reconnect ? 3 : 1;
    for (let cycle = 0; cycle < cycles; cycle++) {
      if (condition.reconnect && cycle > 0) {
        for (const p of neighbors.splice(0)) {
          try { await p.stop(); } catch (_) { /* ignore */ }
        }
        report.reconnectCycles += 1;
        neighbors.push(await spawnNeighbor(plan.targets, report));
      }

      const iters = plan.iterations;
      for (let i = 0; i < iters; i++) {
        const peer = neighbors[i % neighbors.length];
        if (!peer) break;
        if (condition.rawAmp) {
          const max = 64 + crypto.randomInt(0, 2048);
          writeFabric(peer, crypto.randomBytes(max), report, 'RAW_AMP');
        } else {
          const types = condition.types && condition.types.length
            ? condition.types
            : ['P2P_PING'];
          const t = types[i % types.length];
          const body = chaosMessageBody(condition, t, i);
          const msg = Message.fromVector([t, body]);
          msg.signWithKey(peer.key);
          writeFabric(peer, msg.toBuffer(), report, t);
        }
        if ((i & 3) === 3) await new Promise((r) => setImmediate(r));
      }
    }
    row.ok = true;
  } catch (e) {
    row.ok = false;
    row.error = e && e.message ? e.message : String(e);
    report.notes.push(`${condition.id}: ${row.error}`);
  } finally {
    for (const p of neighbors) {
      try { await p.stop(); } catch (_) { /* ignore */ }
    }
  }

  row.writesOk = report.writes.ok - beforeOk;
  row.writesFail = report.writes.fail - beforeFail;
  row.disconnects = report.disconnects.length - beforeDisc;
  row.econnreset = report.econnreset - beforeReset;
  row.finishedAt = new Date().toISOString();
  report.conditions.push(row);
  console.log('[playnet:chaos]', condition.id, {
    ok: row.ok,
    writesOk: row.writesOk,
    writesFail: row.writesFail,
    disconnects: row.disconnects,
    econnreset: row.econnreset
  });
}

async function main () {
  try {
    require('../functions/fabricHomeEnv').loadFabricHomeEnv();
  } catch (_) { /* older pin */ }

  const argv = parseArgv(process.argv.slice(2));
  if (argv.help) {
    console.log(`Usage:
  node scripts/playnet-chaos-neighbors.js [--production|--local|--isolated] [--neighbors N] [--iterations N]
    [--condition <id>]… [--peers host:port,…] [--report name.json] [--hold-ms N]

  --isolated   Spawn an ephemeral loopback hub and blast it (no public / desktop dial)

Conditions:
${listPlaynetChaosConditions().map((c) => `  ${c.id} — ${c.description}`).join('\n')}
`);
    process.exit(0);
  }

  const plan = planPlaynetChaosBlast({
    production: argv.production && !argv.local && !argv.isolated,
    isolated: argv.isolated,
    peers: argv.peers,
    neighbors: argv.neighbors,
    iterations: argv.iterations,
    conditions: argv.conditions,
    reportName: argv.reportName
  });
  if (argv.local && !argv.isolated) {
    plan.production = false;
    plan.isolated = false;
    if (!argv.peers.length) plan.targets = DEFAULT_LOCAL_PEERS.slice();
    plan.reportName = argv.reportName || 'playnet-chaos-neighbors-local.json';
  }

  let isolatedHub = null;
  if (argv.isolated) {
    isolatedHub = await startIsolatedHub();
    const port = isolatedHub.settings && isolatedHub.settings.port;
    plan.production = false;
    plan.isolated = true;
    plan.targets = [`127.0.0.1:${port}`];
    plan.reportName = argv.reportName || 'playnet-chaos-neighbors-isolated.json';
    console.log('[playnet:chaos] isolated hub', plan.targets[0]);
  }

  console.log('[playnet:chaos] plan', {
    production: plan.production,
    isolated: !!plan.isolated,
    targets: plan.targets,
    neighbors: plan.neighborCount,
    iterations: plan.iterations,
    conditions: plan.conditions.map((c) => c.id),
    useOperatorKey: plan.useOperatorKey,
    dominant: {
      hub: plan.dominant.hubDesktop.fabricPeer,
      goonCitizen: plan.dominant.goonCitizenDesktop.fabricPeer,
      operatorKey: plan.dominant.operatorKeySource
    }
  });

  const report = emptyChaosCrashReport(plan);
  report.operatorKeyUsed = false;
  report.dominant = {
    hubPeer: plan.dominant.hubDesktop.fabricPeer,
    goonCitizenPeer: plan.dominant.goonCitizenDesktop.fabricPeer,
    noisyNeverOperatorKey: plan.dominant.noisyNeighbors.neverOperatorKey
  };

  try {
    for (const condition of plan.conditions) {
      await runCondition(condition, plan, report);
      await new Promise((r) => setTimeout(r, argv.holdMs || 500));
    }
  } finally {
    if (isolatedHub && typeof isolatedHub.stop === 'function') {
      try { await isolatedHub.stop(); } catch (_) { /* ignore */ }
    }
  }

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const reportName = path.basename(String(plan.reportName || 'playnet-chaos-neighbors.json'));
  const outPath = path.join(outDir, reportName);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('[playnet:chaos] crash report', outPath);
  console.log('[playnet:chaos] summary', {
    conditions: report.conditions.length,
    writesOk: report.writes.ok,
    writesFail: report.writes.fail,
    disconnects: report.disconnects.length,
    econnreset: report.econnreset,
    hardErrors: report.hardErrors.length
  });

  // Exit 0 even when remote peers drop — that is the crash signal we capture.
  // Non-zero only if we never managed any successful write across all conditions.
  // Peer TCP/NOISE can keep the event loop alive after stop(); force exit.
  process.exit(report.writes.ok < 1 ? 2 : 0);
}

module.exports = {
  DEFAULT_PLAYNET_PEERS,
  DEFAULT_LOCAL_PEERS,
  listPlaynetChaosConditions,
  planDominantDesktopClients,
  planPlaynetLeadCapture,
  planPlaynetChaosBlast,
  emptyChaosCrashReport,
  classifyChaosPeerError,
  chaosMessageBody
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[playnet:chaos]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
