'use strict';

/**
 * Phase A durability: ephemeral loopback hub + every playnet chaos condition.
 * Does not dial desktop :7777/:7778 or public hubs.
 */

const assert = require('assert');
const crypto = require('crypto');

const Key = require('../../types/key');
const Message = require('../../types/message');
const Peer = require('../../types/peer');
const {
  listPlaynetChaosConditions,
  planPlaynetChaosBlast,
  emptyChaosCrashReport,
  classifyChaosPeerError,
  chaosMessageBody
} = require('../../functions/playnetChaosNeighbors');
const {
  hubBaseSettings,
  waitUntil,
  getFreePort
} = require('../helpers/peer');

function connectionKeys (peer) {
  return Object.keys(peer.connections || {});
}

function hubListening (hub) {
  return !!(hub && hub.server && typeof hub.server.address === 'function' && hub.server.address());
}

function writeFabric (peer, buf, report, type) {
  const keys = connectionKeys(peer);
  if (!keys.length) {
    report.writes.fail += 1;
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
    return false;
  }
}

describe('fuzz: isolated loopback hub chaos', function () {
  this.timeout(180000);

  const peers = [];

  afterEach(async function () {
    for (const p of peers.splice(0)) {
      try {
        if (p && typeof p.stop === 'function') await p.stop();
      } catch (err) {
        console.warn('[FUZZ:ISOLATED_HUB] cleanup stop:', err && err.message);
      }
    }
  });

  it('survives every chaos condition and remains stoppable', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port, {
      debug: false,
      reconnectToKnownPeers: false,
      constraints: { peers: { max: 32, shuffle: 8 } }
    }));
    peers.push(hub);
    await hub.start();
    assert.ok(hubListening(hub), 'isolated hub must listen before the storm');

    const target = `127.0.0.1:${hub.settings.port}`;
    const plan = planPlaynetChaosBlast({
      isolated: true,
      peers: [target],
      neighbors: 2,
      iterations: 16
    });
    assert.strictEqual(plan.isolated, true);
    assert.strictEqual(plan.production, false);
    assert.deepStrictEqual(plan.targets, [target]);

    const report = emptyChaosCrashReport(plan);
    const conditions = listPlaynetChaosConditions();
    assert.ok(conditions.length >= 7, 'expected the full isolated condition set');

    for (const condition of conditions) {
      const neighbors = [];
      const n = condition.concurrent ? plan.neighborCount : 1;
      try {
        for (let i = 0; i < n; i++) {
          const key = new Key();
          const peer = new Peer({
            listen: false,
            networking: true,
            peers: [target],
            key: { xprv: key.xprv },
            peersDb: null,
            reconnectToKnownPeers: false,
            debug: false
          });
          peer.on('error', (err) => {
            const msg = err && err.message ? err.message : String(err);
            const kind = classifyChaosPeerError(msg);
            if (kind === 'reset') report.econnreset += 1;
            else if (kind === 'hard') report.hardErrors.push(msg);
          });
          peers.push(peer);
          neighbors.push(peer);
          await peer.start();
          await waitUntil(() => connectionKeys(peer).length >= 1, 20000);
        }

        const cycles = condition.reconnect ? 2 : 1;
        for (let cycle = 0; cycle < cycles; cycle++) {
          if (condition.reconnect && cycle > 0) {
            for (const p of neighbors.splice(0)) {
              try { await p.stop(); } catch (_) { /* ignore */ }
            }
            report.reconnectCycles += 1;
            const key = new Key();
            const peer = new Peer({
              listen: false,
              networking: true,
              peers: [target],
              key: { xprv: key.xprv },
              peersDb: null,
              reconnectToKnownPeers: false,
              debug: false
            });
            peers.push(peer);
            neighbors.push(peer);
            await peer.start();
            await waitUntil(() => connectionKeys(peer).length >= 1, 20000);
          }

          for (let i = 0; i < plan.iterations; i++) {
            const peer = neighbors[i % neighbors.length];
            if (!peer) break;
            if (condition.rawAmp) {
              const max = 64 + crypto.randomInt(0, 512);
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
      } finally {
        for (const p of neighbors) {
          try { await p.stop(); } catch (_) { /* ignore */ }
        }
      }

      assert.ok(hubListening(hub), `${condition.id}: isolated hub listen dropped`);
    }

    assert.ok(report.writes.ok >= 40, `expected signed writes on isolated hub, got ${report.writes.ok}`);
    assert.strictEqual(report.hardErrors.length, 0, JSON.stringify(report.hardErrors));
    assert.ok(report.writes.types.P2P_INVENTORY_REQUEST >= 1, 'typed storm should use first-class inventory');
    assert.ok(hubListening(hub), 'hub must still listen after every condition');

    await hub.stop();
    assert.ok(!hubListening(hub), 'hub.stop() should close the listen socket');
  });
});
