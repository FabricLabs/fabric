'use strict';

/**
 * End-to-end mesh scenarios: hub (listener) startup → member peering →
 * priced document publish → inventory (BTC offers) → file bytes on the wire.
 *
 * Hub uses `networking: false` (listen-only seed). Members use `networking: true`
 * so {@link Peer#start} dials `pubkey@127.0.0.1:port` (see types/peer.js).
 */

const assert = require('assert');
const crypto = require('crypto');
const net = require('net');

const Message = require('../types/message');
const Peer = require('../types/peer');
const { purchaseContentHashHex } = require('../functions/publishedDocumentEnvelope');

let NODEA;
let NODEB;
try {
  NODEA = require('../settings/node-a');
} catch (e) {
  NODEA = { key: {} };
}
try {
  NODEB = require('../settings/node-b');
} catch (e) {
  NODEB = { key: {} };
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
      peers: [`${hub.key.pubkey}@127.0.0.1:${hub.settings.port}`]
    }
  );
}

function sendGeneric (fromPeer, remoteKey, payload) {
  const conn = fromPeer.connections[remoteKey];
  if (!conn || !conn._writeFabric) {
    throw new Error(`No Fabric connection to ${remoteKey} (have: ${Object.keys(fromPeer.connections).join(',')})`);
  }
  const msg = Message.fromVector(['GenericMessage', JSON.stringify(payload)]);
  msg.signWithKey(fromPeer.key);
  conn._writeFabric(msg.toBuffer());
}

async function waitForHubConnections (hub, n, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (Object.keys(hub.connections).length >= n) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Hub expected ${n} inbound connections, got ${Object.keys(hub.connections).length}`);
}

function remoteHubAddress (member) {
  const keys = Object.keys(member.connections);
  assert.ok(keys.length >= 1, 'member must have an outbound connection to the hub');
  return keys[0];
}

describe('@fabric/core Hub mesh integration', function () {
  this.timeout(30000);

  const peers = [];

  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') await peer.stop();
      } catch (err) {
        console.warn('[TEST:HUB_MESH] cleanup stop:', err && err.message);
      }
    }
    peers.length = 0;
  });

  it('hub starts (listener) and mesh members establish peer connections', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port));
    peers.push(hub);

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);

    await hub.start();
    await alice.start();

    await waitForHubConnections(hub, 1);
    assert.ok(Object.keys(alice.connections).length >= 1);

    await hub.stop();
    await alice.stop();
  });

  it('full flow: publish → priced gossip → inventory with BTC offer → file retrieval (early + late joiners)', async function () {
    const port = await getFreePort();
    const hub = new Peer(hubBaseSettings(port));
    peers.push(hub);

    const docId = 'catalog/mesh-asset/v2';
    const body = Buffer.from('Mesh settlement: offer sats, verify contentHash, receive bytes.', 'utf8');
    const parsed = {
      id: docId,
      name: 'mesh-asset.txt',
      mime: 'text/plain',
      revision: 1,
      contentBase64: body.toString('base64'),
      size: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex')
    };
    const contentHash = purchaseContentHashHex(docId, parsed);
    const askSats = 75_000;

    hub.on('inventory', ({ origin }) => {
      const addr = origin.name;
      const sock = hub.connections[addr];
      if (!sock || !sock._writeFabric) return;

      const reply = (obj) => {
        const m = Message.fromVector(['GenericMessage', JSON.stringify(obj)]);
        m.signWithKey(hub.key);
        sock._writeFabric(m.toBuffer());
      };

      reply({
        type: 'INVENTORY_RESPONSE',
        object: {
          items: [{ id: docId, rateSats: askSats, contentHash, network: 'bitcoin' }]
        }
      });

      reply({
        type: 'P2P_FILE_SEND',
        object: {
          name: docId,
          body: body.toString('base64')
        }
      });
    });

    await hub.start();

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);

    const alicePublishes = [];
    const aliceInventory = [];
    const aliceFiles = [];

    alice.on('documentPublish', (ev) => alicePublishes.push(ev));
    alice.on('inventoryResponse', (ev) => aliceInventory.push(ev));
    alice.on('file', (ev) => aliceFiles.push(ev));

    await alice.start();
    await waitForHubConnections(hub, 1);

    hub._publishDocument(docId, body.toString('utf8'), askSats);
    await new Promise((r) => setTimeout(r, 350));

    const aliceCanonical = alicePublishes.filter((e) => e.source === 'canonical');
    const alicePricing = alicePublishes.filter((e) => e.source === 'pricing');
    assert.strictEqual(aliceCanonical.length, 1);
    assert.strictEqual(alicePricing.length, 1);
    assert.strictEqual(aliceCanonical[0].documentId, docId);
    assert.strictEqual(alicePricing[0].documentId, docId);
    assert.strictEqual(alicePricing[0].rateSats, askSats);

    const hubAddrAlice = remoteHubAddress(alice);
    sendGeneric(alice, hubAddrAlice, {
      type: 'INVENTORY_REQUEST',
      object: { offerBtc: true, maxSats: 500_000, reason: 'verify_l1_hash_before_spend' }
    });
    await new Promise((r) => setTimeout(r, 400));

    assert.strictEqual(aliceInventory.length, 1);
    assert.strictEqual(aliceInventory[0].message.object.items[0].contentHash, contentHash);
    assert.strictEqual(aliceInventory[0].message.object.items[0].rateSats, askSats);

    assert.strictEqual(aliceFiles.length, 1);
    assert.strictEqual(aliceFiles[0].message.object.name, docId);
    assert.strictEqual(Buffer.from(aliceFiles[0].message.object.body, 'base64').toString('utf8'), body.toString('utf8'));

    const bob = new Peer(memberBaseSettings(hub, { key: {} }));
    peers.push(bob);

    const bobPublishes = [];
    const bobInventory = [];
    const bobFiles = [];

    bob.on('documentPublish', (ev) => bobPublishes.push(ev));
    bob.on('inventoryResponse', (ev) => bobInventory.push(ev));
    bob.on('file', (ev) => bobFiles.push(ev));

    await bob.start();
    await waitForHubConnections(hub, 2);

    assert.strictEqual(bobPublishes.length, 0, 'late joiner should not receive earlier broadcast');

    const hubAddrBob = remoteHubAddress(bob);
    sendGeneric(bob, hubAddrBob, {
      type: 'INVENTORY_REQUEST',
      object: { offerBtc: true, maxSats: 1_000_000, joiner: 'late' }
    });
    await new Promise((r) => setTimeout(r, 400));

    assert.strictEqual(bobInventory.length, 1);
    assert.strictEqual(bobInventory[0].message.object.items[0].contentHash, contentHash);
    assert.strictEqual(bobFiles.length, 1);
    assert.strictEqual(Buffer.from(bobFiles[0].message.object.body, 'base64').toString('utf8'), body.toString('utf8'));

    await hub.stop();
    await alice.stop();
    await bob.stop();
  });

  it('announceDocumentsOnPeerConnect replays document gossip to late joiners after session open', async function () {
    const port = await getFreePort();
    const hub = new Peer(Object.assign(hubBaseSettings(port), {
      announceDocumentsOnPeerConnect: true
    }));
    peers.push(hub);

    const docId = 'catalog/late-join/v1';
    const body = 'Late joiners see re-announced publishes after P2P_SESSION_OPEN.';
    const askSats = 12_000;

    await hub.start();

    const alice = new Peer(memberBaseSettings(hub, NODEB));
    peers.push(alice);
    await alice.start();
    await waitForHubConnections(hub, 1);

    hub._publishDocument(docId, body, askSats);
    await new Promise((r) => setTimeout(r, 350));

    const bob = new Peer(memberBaseSettings(hub, { key: {} }));
    peers.push(bob);
    const bobPublishes = [];
    bob.on('documentPublish', (ev) => bobPublishes.push(ev));

    await bob.start();
    await waitForHubConnections(hub, 2);
    await new Promise((r) => setTimeout(r, 600));

    const bobCanonical = bobPublishes.filter((e) => e.source === 'canonical');
    const bobPricing = bobPublishes.filter((e) => e.source === 'pricing');
    assert.strictEqual(bobCanonical.length, 1);
    assert.strictEqual(bobPricing.length, 1);
    assert.strictEqual(bobCanonical[0].documentId, docId);
    assert.strictEqual(bobPricing[0].documentId, docId);
    assert.strictEqual(bobPricing[0].rateSats, askSats);

    await hub.stop();
    await alice.stop();
    await bob.stop();
  });
});
