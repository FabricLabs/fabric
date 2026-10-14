'use strict';

const assert = require('assert');
const crypto = require('crypto');

const Market = require('../services/market');
const Document = require('../types/document');
const Peer = require('../types/peer');
const Message = require('../types/message');
const { DocumentOfferBook } = require('../types/offerBook');

/**
 * Minimal two-seller market: sellers hold the same sealed document; the
 * buyer's Peer is wired so `requestDocument(id, seller)` makes that seller
 * deliver the requested blob (frames + per-blob key reveal) through the
 * buyer's real ingest path.
 */
function buildMarket (opts = {}) {
  const plain = crypto.randomBytes(4000);
  const doc = Document.seal(plain, { chunkBytes: 2048 });
  const buyer = new Peer({ listen: false });
  const sellers = {};
  const book = new DocumentOfferBook();
  const deliveries = [];
  let documentId = null;

  for (const name of ['alpha', 'beta']) {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const pub = seller.publishSealedDocument(doc, { rateSats: opts.rateSats != null ? opts.rateSats : 0, documentId: documentId || undefined });
    documentId = pub.documentId;
    sellers[name] = seller;
    buyer.connections[name] = { _writeFabric: () => {} };
    // Offers as the buyer's book would hold them after inventory ingest.
    book.ingestInventoryResponse({
      origin: name,
      items: [doc.inventoryItem({ rateSats: opts.rateSats != null ? opts.rateSats : 0, documentId })],
      latencyMs: name === 'alpha' ? 20 : 200
    });
  }

  // Intercept DocumentRequest → simulate the chosen seller's delivery.
  buyer.requestDocument = (id, seller, reqOpts = {}) => {
    const s = sellers[seller];
    if (!s) return false;
    deliveries.push({ seller, blobIndex: reqOpts.blobIndex });
    const written = [];
    s.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
    const indexes = reqOpts.blobIndex != null ? [reqOpts.blobIndex] : undefined;
    s._sendSealedBlobsToPeer(s._getSealedBlobDocument(id), id, 'buyer', { revealKey: true, settlementId: 't', indexes });
    for (const buf of written) {
      const m = Message.fromBuffer(buf);
      if (m.type === 'P2P_FILE_SEND') buyer._ingestP2pFileSend({ object: JSON.parse(m.body) }, { name: seller });
      else buyer._handleDocumentContentKeyReveal(JSON.parse(m.body).object, { name: seller });
    }
    return true;
  };

  return { plain, doc, buyer, sellers, book, deliveries, documentId };
}

describe('services/market (consumer budget agent)', function () {
  it('maps proximityWeight onto offer-book weights', function () {
    assert.deepStrictEqual(Market.weightsForProximity(0), { price: 0.6, latency: 0.1, peerScore: 0.2, completeness: 0.1 });
    const near = Market.weightsForProximity(1);
    assert.ok(near.latency > near.price);
    const sum = Object.values(near).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it('acquires a free sealed document across sellers and completes the want', async function () {
    const m = buildMarket({ rateSats: 0 });
    const market = new Market({ budgetSats: 0, tickMs: 0, book: m.book });
    market.attach({ peer: m.buyer });
    market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });

    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });
    const summary = await market.tick();
    assert.strictEqual(summary.opened, 2);
    assert.ok(received && received.buffer.equals(m.plain));
    const st = market.status();
    assert.strictEqual(st.wants[0].status, 'complete');
    assert.ok(st.sessions.every((s) => s.status === 'complete'));
    assert.strictEqual(st.spentSats, 0);
    // Delivery telemetry landed in the local book (never gossiped).
    const tel = m.book.exportTelemetry();
    assert.ok(tel.providers.some((p) => p.deliveries >= 1));
  });

  it('refuses plans over the cap and spends within budget using pay/verify', async function () {
    const m = buildMarket({ rateSats: 5 });
    // HTLC construction needs seller keys + locktime; the pay/verify path is
    // exercised with a plain payment address (hosts inject real funding).
    const market = new Market({ budgetSats: 8, perPlanMaxSats: 100, tickMs: 0, book: m.book });
    market.attach({ peer: m.buyer, pay: async () => 'ff'.repeat(32), verify: async () => true });
    market.want(m.documentId, { blobTotal: m.doc.blobTotal });

    const first = await market.tick();
    assert.strictEqual(first.opened, 0, 'two blobs at 5 sats each exceed the 8 sat budget');
    assert.ok(/cap/.test(market.status().wants[0].lastError));

    market.setBudget(10);
    // Offers without a seller pubkey cannot build a buyer-bound HTLC: the
    // agent must refuse to fund rather than pay a bare address.
    const second = await market.tick();
    assert.strictEqual(second.opened, 0);
    assert.ok(/buyer refund key|seller pubkey|HTLC/.test(market.status().wants[0].lastError));
    assert.strictEqual(market.spentSats, 0);
    assert.strictEqual(market.reservedSats, 0);
  });

  it('exports and imports agent state with telemetry', async function () {
    const m = buildMarket({ rateSats: 0 });
    const market = new Market({ budgetSats: 42, tickMs: 0, book: m.book });
    market.attach({ peer: m.buyer });
    market.want(m.documentId, { blobTotal: m.doc.blobTotal });
    await market.tick();
    const snap = JSON.parse(JSON.stringify(market.export()));
    assert.strictEqual(snap.type, 'MarketAgentState');
    const fresh = new Market({ tickMs: 0 });
    fresh.import(snap);
    assert.strictEqual(fresh.budgetSats, 42);
    assert.strictEqual(fresh.status().wants[0].status, 'complete');
    assert.strictEqual(fresh.reservedSats, 0);
    assert.ok(fresh.book.exportTelemetry().providers.length >= 1);
  });

  it('start/stop are idempotent and detach peer listeners', async function () {
    const m = buildMarket();
    const market = new Market({ tickMs: 0, book: m.book });
    market.attach({ peer: m.buyer });
    const before = m.buyer.listenerCount('documentReceived');
    await market.start();
    await market.start();
    assert.strictEqual(market.status().status, 'running');
    await market.stop();
    await market.stop();
    assert.strictEqual(m.buyer.listenerCount('documentReceived'), before - 1);
    assert.strictEqual(market.status().status, 'stopped');
  });
});

describe('services/market (Phase 4 channel rail)', function () {
  const bitcoin = require('bitcoinjs-lib');
  const Channel = require('../types/channel');
  const { signerFromPriv32 } = require('../functions/inventoryHtlc');
  const NET = bitcoin.networks.regtest;

  function party () {
    const priv = crypto.randomBytes(32);
    const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
    return { priv, pub, address: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address };
  }

  it('pays per chunk over an open channel and settles each HTLC with the revealed K_i', async function () {
    const m = buildMarket({ rateSats: 5 });
    const buyerKey = party();
    const sellerKey = party();
    const fundingBuyer = Channel.buildFunding({ network: 'regtest', localPubkey: buyerKey.pub, remotePubkey: sellerKey.pub, expireAfter: 5000 });
    const fundingSeller = Channel.buildFunding({ network: 'regtest', localPubkey: sellerKey.pub, remotePubkey: buyerKey.pub, expireAfter: 5000, funder: 'remote' });
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(fundingBuyer.address, NET), BigInt(50000));
    const fundedTxHex = tx.toHex();
    const opening = 50000 - 500 - 2 * Channel.DEFAULTS.anchorSats;
    const buyerChan = new Channel.Session({ funding: fundingBuyer, fundedTxHex, localPrivateKey: buyerKey.priv, localSats: opening, remoteSats: 0, localAddress: buyerKey.address, remoteAddress: sellerKey.address });
    const sellerChan = new Channel.Session({ funding: fundingSeller, fundedTxHex, localPrivateKey: sellerKey.priv, localSats: 0, remoteSats: opening, localAddress: sellerKey.address, remoteAddress: buyerKey.address });
    Channel.exchange(buyerChan, sellerChan, buyerChan.open());
    assert.strictEqual(buyerChan.status, 'open');

    // Only "alpha" has a channel; the seller mirrors every body it is sent.
    const published = [];
    const channels = {
      sessionFor: (sellerId) => (sellerId === 'alpha' ? buyerChan : null),
      tipHeight: () => 100,
      publish: (body) => {
        published.push(body.type);
        // Full round trip (proposal → reply + revoke → ChannelRevoke) on every body.
        Channel.exchange(buyerChan, sellerChan, body);
      }
    };
    const market = new Market({ budgetSats: 100, perPlanMaxSats: 100, tickMs: 0, book: m.book, proximityWeight: 1 });
    market.attach({ peer: m.buyer, channels });
    market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });

    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });
    const summary = await market.tick();
    assert.ok(summary.opened >= 1, 'at least one chunk bought over the channel');
    const sessions = market.listSessions();
    const viaChannel = sessions.filter((s) => s.rail === 'channel');
    assert.ok(viaChannel.length >= 1);
    assert.ok(viaChannel.every((s) => s.status === "complete" && s.channelHtlcId), JSON.stringify(viaChannel.map((s) => ({ status: s.status, htlc: s.channelHtlcId, err: s.error, amount: s.amountSats })), null, 1));
    assert.ok(received && received.buffer.equals(m.plain));
    // Seller got paid off-chain: 5 sats per channel-settled chunk.
    assert.strictEqual(sellerChan.balances.localSats, viaChannel.length * 5);
    assert.strictEqual(buyerChan.state.htlcs.length, 0);
    assert.strictEqual(buyerChan.fullySigned, true);
    assert.ok(published.includes('ChannelHtlcFulfill'));
    assert.strictEqual(buyerChan.busy, false);
    assert.ok(Object.keys(sellerChan.state.revoked).length >= 2, 'every superseded state is revoked');
    assert.strictEqual(market.spentSats, viaChannel.length * 5 + (sessions.length - viaChannel.length) * 5);
  });
});
