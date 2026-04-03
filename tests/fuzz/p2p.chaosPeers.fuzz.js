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
  getFreePort,
  randomAcyclicObject,
  randomAmpFrame,
  randomUtf8String
} = require('./helpers');

let NODEA;
let NODEB;
try {
  NODEA = require('../../settings/node-a');
} catch (e) {
  NODEA = { key: {} };
}
try {
  NODEB = require('../../settings/node-b');
} catch (e) {
  NODEB = { key: {} };
}

function hubBaseSettings (port) {
  return Object.assign(
    { verbosity: 1 },
    NODEA,
    {
      listen: true,
      port,
      interface: '127.0.0.1',
      upnp: false,
      peers: [],
      networking: false,
      peersDb: null,
      debug: false,
      reconnectToKnownPeers: false,
      constraints: { peers: { max: 32, shuffle: 8 } }
    }
  );
}

function memberBaseSettings (hub, keySettings) {
  return Object.assign(
    { verbosity: 1 },
    keySettings,
    {
      listen: false,
      port: 0,
      upnp: false,
      peersDb: null,
      networking: true,
      debug: false,
      reconnectToKnownPeers: false,
      peers: [`${hub.key.pubkey}@127.0.0.1:${hub.settings.port}`]
    }
  );
}

async function waitUntil (predicate, timeoutMs = 25000, intervalMs = 40) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for condition`);
}

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

  it('bidirectional signed GenericMessage storm (session stays up)', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port));
    const client = new Peer(memberBaseSettings(hub, NODEB));
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
      const msg = Message.fromVector(['GenericMessage', JSON.stringify(body)]);
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
    const hub = new Peer(hubBaseSettings(port));
    const client = new Peer(memberBaseSettings(hub, NODEB));
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
      const sender = (i % 2 === 0) ? hub : client;
      const label = sender === hub ? 'hub' : 'client';
      const keys = connectionKeys(sender);
      if (!keys.length) break;

      const roll = crypto.randomInt(0, 10);
      let buf;
      if (roll < 6) {
        const body = randomGenericPayload(sender);
        const msg = Message.fromVector(['GenericMessage', JSON.stringify(body)]);
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
