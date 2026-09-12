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
 * Forbidden on the wire: P2P_FLUSH_CHAIN, P2P_FILE_SEND, GHSA advisory dumps.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const Peer = require('../types/peer');
const Message = require('../types/message');
const Key = require('../types/key');
const {
  planPlaynetChaosBlast,
  emptyChaosCrashReport,
  classifyChaosPeerError,
  chaosMessageBody,
  listPlaynetChaosConditions
} = require('../functions/playnetChaosNeighbors');

try {
  require('../functions/fabricHomeEnv').loadFabricHomeEnv();
} catch (_) { /* older pin */ }

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
  if (!conn || typeof conn._writeFabric !== 'function') {
    report.writes.fail += 1;
    return false;
  }
  try {
    conn._writeFabric(buf);
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
    if (!argv.peers.length) plan.targets = require('../functions/playnetChaosNeighbors').DEFAULT_LOCAL_PEERS.slice();
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

main().catch((err) => {
  console.error('[playnet:chaos]', err && err.stack ? err.stack : err);
  process.exit(1);
});
