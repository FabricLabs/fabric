'use strict';

/**
 * Live P2P chaos: two Fabric peers over TCP + NOISE, each sends adversarial / random
 * traffic to the other (hub listener + dialing member, same pattern as
 * tests/fabric.hub.mesh.integration.js).
 */

const assert = require('assert');
const crypto = require('crypto');

const Message = require('../../types/message');
const Peer = require('../../types/peer');
const {
  fuzzPeerChaosIterations,
  randomAcyclicObject,
  randomAmpFrame,
  randomUtf8String
} = require('./helpers');
const {
  NODEB,
  hubBaseSettings,
  memberBaseSettings,
  waitUntil,
  getFreePort
} = require('../helpers/peer');

function connectionKeys (peer) {
  return Object.keys(peer.connections || {});
}

function writeFabric (peer, label, buf) {
  const keys = connectionKeys(peer);
  assert.ok(keys.length >= 1, `${label}: expected an open Fabric connection`);
  const conn = peer.connections[keys[0]];
  assert.ok(conn && typeof conn._writeFabric === 'function', `${label}: missing _writeFabric`);
  conn._writeFabric(buf);
}

function randomGenericPayload (sender) {
  const roll = crypto.randomInt(0, 8);
  const types = [
    'INVENTORY_REQUEST',
    'INVENTORY_RESPONSE',
    'P2P_PING',
    'P2P_PEERING_OFFER',
    'P2P_GOSSIP',
    'P2P_FLUSH_CHAIN',
    'CHAT',
    'UNKNOWN_CHAOS'
  ];
  const t = types[roll % types.length];
  const base = {
    type: t,
    object: randomAcyclicObject(4, 35),
    note: randomUtf8String(64)
  };
  if (sender && sender.identity && sender.identity.id) {
    base.actor = { id: sender.identity.id };
  }
  return base;
}

describe('fuzz: live peer chaos (TCP + NOISE)', function () {
  this.timeout(180000);

  const peers = [];

  afterEach(async function () {
    for (const p of peers.splice(0)) {
      try {
        if (p && typeof p.stop === 'function') await p.stop();
      } catch (err) {
        console.warn('[FUZZ:CHAOS_PEERS] cleanup stop:', err && err.message);
      }
    }
  });

  it('bidirectional signed P2P_BASE_MESSAGE storm (session stays up)', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port, { debug: false, reconnectToKnownPeers: false }));
    const client = new Peer(memberBaseSettings(hub, NODEB, { debug: false, reconnectToKnownPeers: false }));
    peers.push(hub, client);

    const hardErrors = [];
    const onHard = (name) => (err) => {
      const msg = err && (err.message || String(err));
      if (msg && /Attempted to write to a closed|ECONNRESET|EPIPE/i.test(msg)) return;
      hardErrors.push({ name, msg });
    };
    hub.on('error', onHard('hub'));
    client.on('error', onHard('client'));

    await hub.start();
    await client.start();

    await waitUntil(
      () => connectionKeys(hub).length >= 1 && connectionKeys(client).length >= 1,
      30000
    );

    const n = fuzzPeerChaosIterations(100);
    for (let i = 0; i < n; i++) {
      const sender = (i % 2 === 0) ? hub : client;
      const label = sender === hub ? 'hub' : 'client';
      const body = randomGenericPayload(sender);
      const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(body)]);
      msg.signWithKey(sender.key);
      writeFabric(sender, label, msg.toBuffer());
      if ((i & 7) === 7) await new Promise((r) => setImmediate(r));
    }

    assert.strictEqual(hardErrors.length, 0, `unexpected peer errors: ${JSON.stringify(hardErrors)}`);
    assert.ok(connectionKeys(hub).length >= 1, 'hub connection dropped during valid storm');
    assert.ok(connectionKeys(client).length >= 1, 'client connection dropped during valid storm');

    await hub.stop();
    await client.stop();
  });

  it('mixed valid AMP and random payloads; processes remain stoppable', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port, { debug: false, reconnectToKnownPeers: false }));
    const client = new Peer(memberBaseSettings(hub, NODEB, { debug: false, reconnectToKnownPeers: false }));
    peers.push(hub, client);

    await hub.start();
    await client.start();

    await waitUntil(
      () => connectionKeys(hub).length >= 1 && connectionKeys(client).length >= 1,
      30000
    );

    const n = Math.max(24, Math.min(fuzzPeerChaosIterations(60), 120));
    let exchanges = 0;

    for (let i = 0; i < n; i++) {
      const prefer = (i % 2 === 0) ? hub : client;
      const sender = connectionKeys(prefer).length
        ? prefer
        : (connectionKeys(hub).length ? hub : (connectionKeys(client).length ? client : null));
      if (!sender) break;
      const label = sender === hub ? 'hub' : 'client';

      const roll = crypto.randomInt(0, 10);
      let buf;
      // Land a dozen signed frames first so a hostile random AMP that
      // tears the session cannot fail the storm before it starts.
      if (exchanges < 12 || roll < 6) {
        const body = randomGenericPayload(sender);
        const msg = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify(body)]);
        msg.signWithKey(sender.key);
        buf = msg.toBuffer();
      } else if (roll < 8) {
        const msg = Message.fromVector(['Ping', JSON.stringify({ chaos: randomUtf8String(48) })]);
        msg.signWithKey(sender.key);
        buf = msg.toBuffer();
      } else {
        buf = randomAmpFrame();
      }

      try {
        writeFabric(sender, label, buf);
        exchanges++;
      } catch (e) {
        assert.fail(`${label} _writeFabric threw: ${e && e.stack}`);
      }

      if ((i & 3) === 3) await new Promise((r) => setImmediate(r));
    }

    assert.ok(exchanges >= 12, `expected at least 12 writes, got ${exchanges}`);

    await hub.stop();
    await client.stop();
  });
});

/**
 * Opt-in public playnet neighbor storm (signed Ping / BASE / chat / unknown).
 * Does not send P2P_FLUSH_CHAIN, P2P_FILE_SEND, or GHSA advisory documents.
 *
 *   FABRIC_PLAYNET_CHAOS=1 FABRIC_PLAYNET_PEERS=hub.fabric.pub:7777,relay.goon.vc:7777 \
 *     npm test -- tests/fuzz/p2p.chaosPeers.fuzz.js
 */
describe('fuzz: playnet neighbor chaos', function () {
  const runLive = process.env.FABRIC_PLAYNET_CHAOS === '1' ||
    process.env.FABRIC_PLAYNET_CHAOS === 'true';
  const fs = require('fs');
  const path = require('path');

  (runLive ? it : it.skip)('dials playnet peers and sends a signed neighbor storm', async function () {
    this.timeout(120000);
    try {
      require('../../functions/fabricHomeEnv').loadFabricHomeEnv();
    } catch (_) { /* older pin */ }

    const xprv = String(process.env.FABRIC_XPRV || '').trim();
    const mnemonic = String(process.env.FABRIC_MNEMONIC || '').trim();
    const seed = String(process.env.FABRIC_SEED || '').trim();
    const key = xprv.startsWith('xprv') || xprv.startsWith('tprv')
      ? { xprv }
      : (seed.startsWith('xprv') || seed.startsWith('tprv')
        ? { xprv: seed }
        : (mnemonic ? { mnemonic } : (seed ? { seed } : null)));
    if (!key) {
      this.skip();
      return;
    }

    const targets = String(process.env.FABRIC_PLAYNET_PEERS ||
      'hub.fabric.pub:7777,relay.goon.vc:7777')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const client = new Peer({
      listen: false,
      networking: true,
      peers: targets,
      key,
      peersDb: null,
      reconnectToKnownPeers: false
    });
    const stopClient = async () => {
      try { await client.stop(); } catch (_) { /* ignore */ }
    };

    const hardErrors = [];
    const writes = { ok: 0, fail: 0, types: {} };
    client.on('error', (err) => {
      const msg = err && (err.message || String(err));
      if (msg && /Attempted to write to a closed|ECONNRESET|EPIPE/i.test(msg)) return;
      hardErrors.push(msg);
    });

    try {
    await client.start();
    await waitUntil(() => connectionKeys(client).length >= 1, 25000);
    const conns = connectionKeys(client);
    assert.ok(conns.length >= 1, `expected a connection to ${targets.join(',')}`);

    const n = Math.max(16, Math.min(fuzzPeerChaosIterations(48), 80));
    const stormTypes = [
      'P2P_PING',
      'P2P_CHAT_MESSAGE',
      'P2P_PEER_GOSSIP',
      'P2P_PEERING_OFFER',
      'P2P_PEER_ALIAS',
      'P2P_BASE_MESSAGE'
    ];
    for (let i = 0; i < n; i++) {
      const keys = connectionKeys(client);
      if (!keys.length) break;
      const t = stormTypes[i % stormTypes.length];
      let body;
      if (t === 'P2P_CHAT_MESSAGE') {
        body = `playnet-chaos-${i}-${Date.now()}`;
      } else if (t === 'P2P_PEER_ALIAS') {
        body = `chaos-${i}`.slice(0, 24);
      } else {
        body = JSON.stringify({
          type: t,
          nonce: `playnet-chaos-${i}`,
          created: new Date().toISOString()
        });
      }
      const msg = Message.fromVector([t, body]);
      msg.signWithKey(client.key);
      try {
        writeFabric(client, 'playnet', msg.toBuffer());
        writes.ok += 1;
        writes.types[t] = (writes.types[t] || 0) + 1;
      } catch (_) {
        writes.fail += 1;
      }
      if ((i & 3) === 3) await new Promise((r) => setImmediate(r));
    }

    await new Promise((r) => setTimeout(r, 2000));

    const report = {
      at: new Date().toISOString(),
      targets,
      connections: connectionKeys(client),
      writes,
      hardErrors,
      pubkey: client.key && client.key.pubkey
        ? String(client.key.pubkey).slice(0, 16) + '…'
        : null
    };
    const outDir = path.join(__dirname, '..', '..', 'reports');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { /* ignore */ }
    fs.writeFileSync(path.join(outDir, 'playnet-chaos-neighbors.json'), JSON.stringify(report, null, 2));

    // writes.ok is invocations after `_writeFabric` returned; a closed stream
    // skips without throwing. Fail on unexpected peer errors instead.
    assert.ok(writes.ok >= 8, `expected signed write attempts, got ${writes.ok}`);
    assert.strictEqual(hardErrors.length, 0, `unexpected peer errors: ${JSON.stringify(hardErrors)}`);
    } finally {
      await stopClient();
    }
  });
});
