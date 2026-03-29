'use strict';

/**
 * Complete L1 document flow: TCP peering → canonical DOCUMENT_PUBLISH →
 * purchaseContentHashHex agreement → optional pricing gossip (rateSats).
 * @see docs/L1_DOCUMENT_EXCHANGE.md
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

describe('L1 document exchange complete flow', function () {
  this.timeout(30000);

  const peers = [];

  after(async function () {
    for (const peer of peers) {
      try {
        if (peer && typeof peer.stop === 'function') await peer.stop();
      } catch (err) {
        console.warn('[TEST:L1FLOW] cleanup:', err && err.message);
      }
    }
    peers.length = 0;
  });

  it('publisher and subscriber agree on purchaseContentHashHex over the network', async function () {
    const port = await getFreePort();
    const hub = new Peer(Object.assign(
      { verbosity: 1 },
      NODEA,
      {
        listen: true,
        port,
        interface: '127.0.0.1',
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
        networking: true,
        peers: [`${hub.key.pubkey}@127.0.0.1:${port}`]
      }
    ));
    peers.push(hub, client);

    const docId = 'flow/catalog/item-1';
    const body = 'Paywalled knowledge: verify hash, then spend.';
    const buf = Buffer.from(body, 'utf8');
    const parsed = {
      id: docId,
      name: 'item-1',
      mime: 'text/plain',
      revision: 1,
      contentBase64: buf.toString('base64'),
      size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex')
    };
    const expectedHash = purchaseContentHashHex(docId, parsed);
    const expectedEnvelope = documentPublishEnvelopeBuffer(docId, parsed);

    const events = [];
    const docPub = [];
    client.on('documentPublish', (ev) => events.push(ev));
    client.on('DocumentPublish', (ev) => docPub.push(ev));

    await hub.start();
    const peerReady = new Promise((resolve) => hub.once('peer', resolve));
    await client.start();
    await peerReady;

    const askSats = 21_000;
    hub._publishDocument(docId, body, askSats);

    await new Promise((r) => setTimeout(r, 500));

    const canonical = events.filter((e) => e.source === 'canonical');
    const pricing = events.filter((e) => e.source === 'pricing');

    assert.strictEqual(canonical.length, 1, 'one canonical DOCUMENT_PUBLISH');
    assert.strictEqual(pricing.length, 1, 'one pricing gossip when rateSats > 0');
    assert.strictEqual(canonical[0].purchaseContentHashHex, expectedHash);
    assert.strictEqual(pricing[0].rateSats, askSats);
    assert.strictEqual(pricing[0].contentHash, expectedHash);

    assert.strictEqual(docPub.length, 1);
    assert.strictEqual(docPub[0].purchaseContentHashHex, expectedHash);

    const envMsg = Message.fromBuffer(Buffer.from(expectedEnvelope));
    assert.strictEqual(
      canonical[0].purchaseContentHashHex,
      purchaseContentHashHex(docId, JSON.parse(envMsg.data.toString('utf8')))
    );

    await hub.stop();
    await client.stop();
  });
});
