'use strict';

/**
 * L1 document publish & distribution: priced gossip over Fabric P2P, plus
 * deterministic purchase hashes used for HTLC / on-chain settlement (see
 * `functions/publishedDocumentEnvelope.js`).
 */

const assert = require('assert');
const crypto = require('crypto');
const net = require('net');

const Message = require('../types/message');
const Peer = require('../types/peer');
const {
  purchaseContentHashHex,
  documentPublishEnvelopeBuffer
} = require('../functions/publishedDocumentEnvelope');

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

function sendInventoryRequest (fromPeer, remoteKey, object) {
  const conn = fromPeer.connections[remoteKey];
  if (!conn || !conn._writeFabric) {
    throw new Error(`No Fabric connection to ${remoteKey}`);
  }
  const msg = Message.fromVector(['P2P_INVENTORY_REQUEST', JSON.stringify(object || {})]);
  msg.signWithKey(fromPeer.key);
  conn._writeFabric(msg.toBuffer());
}

async function waitForConnections (peer, n, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (Object.keys(peer.connections).length >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Expected ${n} connections on peer, got ${Object.keys(peer.connections).length}`);
}

async function waitFor (predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('@fabric/core L1 document publish & distribution', function () {
  this.timeout(30000);

  const peers = [];

  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') await peer.stop();
      } catch (err) {
        console.warn('[TEST:L1DOC] cleanup stop:', err && err.message);
      }
    }
    peers.length = 0;
  });

  it('purchaseContentHashHex is stable for a given document (L1 settlement visibility)', function () {
    const docId = 'manifesto-' + crypto.randomBytes(4).toString('hex');
    const payload = Buffer.from('Proactive publishers price rare bytes.', 'utf8');
    const parsed = {
      id: docId,
      name: 'ProfitPaper',
      mime: 'text/plain',
      revision: 1,
      contentBase64: payload.toString('base64'),
      size: payload.length,
      sha256: crypto.createHash('sha256').update(payload).digest('hex')
    };
    const h1 = purchaseContentHashHex(docId, parsed);
    const h2 = purchaseContentHashHex(docId, parsed);
    assert.strictEqual(h1, h2);
    assert.ok(/^[0-9a-f]{64}$/.test(h1));
    const buf = documentPublishEnvelopeBuffer(docId, parsed);
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
  });

  it('networked peers receive priced documentPublish (publisher can quote sats)', async function () {
    const port = await getFreePort();
    const server = new Peer(Object.assign(
      { verbosity: 1 },
      NODEA,
      {
        listen: true,
        port,
        upnp: false,
        peers: [],
        networking: false,
        peersDb: null
      }
    ));
    const client = new Peer(Object.assign(
      { verbosity: 1 },
      NODEB,
      {
        listen: false,
        port: 0,
        upnp: false,
        peersDb: null,
        peers: [`${server.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    peers.push(server, client);

    const offers = [];
    client.on('documentPublish', (ev) => {
      offers.push(ev);
    });

    await server.start();

    const peerReady = new Promise((resolve) => {
      server.once('peer', resolve);
    });

    await client.start();
    await peerReady;

    const askSats = 123_456;
    const docKey = 'whitepaper/v1';
    const body = 'Fee market for bytes: pay to propagate.';
    server._publishDocument(docKey, body, askSats);

    await new Promise((r) => setTimeout(r, 400));

    const canonical = offers.filter((e) => e.source === 'canonical');
    const pricing = offers.filter((e) => e.source === 'pricing');
    assert.strictEqual(canonical.length, 1, 'buyer should observe canonical DOCUMENT_PUBLISH');
    assert.strictEqual(pricing.length, 1, 'buyer should observe pricing gossip when rateSats > 0');
    assert.strictEqual(canonical[0].documentId, docKey);
    assert.strictEqual(pricing[0].documentId, docKey);
    assert.strictEqual(pricing[0].rateSats, askSats);
    assert.strictEqual(server._state.content.documents[docKey], body);

    await server.stop();
    await client.stop();
  });

  it('DOCUMENT_REQUEST to a peer that holds the document yields file bytes on the wire', async function () {
    const port = await getFreePort();
    const server = new Peer(Object.assign(
      { verbosity: 1 },
      NODEA,
      {
        listen: true,
        port,
        upnp: false,
        peers: [],
        networking: false,
        peersDb: null
      }
    ));
    const client = new Peer(Object.assign(
      { verbosity: 1 },
      NODEB,
      {
        listen: false,
        port: 0,
        upnp: false,
        peersDb: null,
        peers: [`${server.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    peers.push(server, client);

    const files = [];
    client.on('file', (ev) => files.push(ev));

    await server.start();
    const peerReady = new Promise((resolve) => server.once('peer', resolve));
    await client.start();
    await peerReady;

    const docKey = 'l1-request-roundtrip';
    const body = 'verified by hash before spend.';
    server._state.content.documents = server._state.content.documents || {};
    server._state.content.documents[docKey] = body;
    server.commit();

    const req = Message.fromVector(['DocumentRequest', JSON.stringify({ document: docKey })]);
    req.signWithKey(client.key);
    client.broadcast(req.toBuffer());

    await new Promise((r) => setTimeout(r, 500));

    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].message.object.name, docKey);
    assert.strictEqual(Buffer.from(files[0].message.object.body, 'base64').toString('utf8'), body);

    await server.stop();
    await client.stop();
  });

  it('serveLocalDocumentInventory answers INVENTORY_REQUEST with L1 contentHash and rate', async function () {
    const port = await getFreePort();
    const server = new Peer(Object.assign(
      { verbosity: 1, serveLocalDocumentInventory: true },
      NODEA,
      {
        listen: true,
        port,
        upnp: false,
        peers: [],
        networking: false,
        peersDb: null
      }
    ));
    const client = new Peer(Object.assign(
      { verbosity: 1 },
      NODEB,
      {
        listen: false,
        port: 0,
        upnp: false,
        peersDb: null,
        peers: [`${server.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    peers.push(server, client);

    const inv = [];
    client.on('inventoryResponse', (ev) => inv.push(ev));

    await server.start();
    const peerReady = new Promise((resolve) => server.once('peer', resolve));
    await client.start();
    await peerReady;

    const docKey = 'auto-inv-item';
    const body = 'listed from peer state.';
    const askSats = 42_000;
    server._publishDocument(docKey, body, askSats);
    const expectHash = purchaseContentHashHex(docKey, server._buildDocumentParsedForPublish(docKey, body));

    await new Promise((r) => setTimeout(r, 300));

    const serverAddr = Object.keys(client.connections)[0];
    sendInventoryRequest(client, serverAddr, { offerBtc: true, maxSats: 500_000, reason: 'verify_l1_hash_before_spend' });

    await new Promise((r) => setTimeout(r, 500));

    assert.strictEqual(inv.length, 1);
    assert.strictEqual(inv[0].message.object.items[0].contentHash, expectHash);
    assert.strictEqual(inv[0].message.object.items[0].rateSats, askSats);

    await server.stop();
    await client.stop();
  });

  it('star router relays INVENTORY_REQUEST and INVENTORY_RESPONSE (offerBtc)', async function () {
    const port = await getFreePort();
    const router = new Peer(Object.assign(
      {
        verbosity: 1,
        serveLocalDocumentInventory: true,
        relayInventoryRequest: true,
        relayInventoryResponse: true
      },
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
    ));
    const holder = new Peer(Object.assign(
      { verbosity: 1, serveLocalDocumentInventory: true },
      NODEB,
      {
        listen: false,
        port: 0,
        upnp: false,
        peersDb: null,
        networking: true,
        peers: [`${router.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    const buyer = new Peer(Object.assign(
      { verbosity: 1 },
      { key: {} },
      {
        listen: false,
        port: 0,
        upnp: false,
        peersDb: null,
        networking: true,
        peers: [`${router.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    peers.push(router, holder, buyer);

    const inv = [];
    buyer.on('inventoryResponse', (ev) => inv.push(ev));

    await router.start();
    await holder.start();
    await waitForConnections(router, 1);
    await buyer.start();
    await waitForConnections(router, 2);

    const docKey = 'relay-star/catalog-item';
    const body = 'inventory via relaying router';
    holder._publishDocument(docKey, body, 33_000);
    const expectHash = purchaseContentHashHex(docKey, holder._buildDocumentParsedForPublish(docKey, body));

    await new Promise((r) => setTimeout(r, 400));

    const toRouter = Object.keys(buyer.connections)[0];
    sendInventoryRequest(buyer, toRouter, { offerBtc: true, maxSats: 500_000, reason: 'relay_star' });

    const gotInventory = await waitFor(() => inv.length >= 1, 5000);

    assert.ok(gotInventory, 'buyer should receive relayed INVENTORY_RESPONSE');
    assert.strictEqual(inv[0].message.object.items[0].id, docKey);
    assert.strictEqual(inv[0].message.object.items[0].contentHash, expectHash);

    await router.stop();
    await holder.stop();
    await buyer.stop();
  });

  it('buyer can derive the same L1 hash as the hub before paying the proactive publisher', function () {
    const docId = 'aligned-offer';
    const content = Buffer.from('Early publisher sets terms; buyer verifies hash before spend.', 'utf8');
    const parsed = {
      id: docId,
      contentBase64: content.toString('base64'),
      size: content.length,
      mime: 'text/plain',
      name: 'terms.txt',
      revision: 1,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
    const hash = purchaseContentHashHex(docId, parsed);
    const hashAgain = purchaseContentHashHex(docId, parsed);
    assert.strictEqual(hash, hashAgain);
    assert.ok(/^([0-9a-f]{64})$/.test(hash));
  });
});
