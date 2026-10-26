'use strict';

const ChannelBook = require('../types/channelBook');
const assert = require('assert');
const crypto = require('crypto');

const Market = require('../services/market');
const Document = require('../types/document');
const Peer = require('../types/peer');
const Message = require('../types/message');
const DocumentBook = require('../types/documentBook');
const { HTLC_MINIMUM_SATS } = require('../constants');
const { createBlobQuote } = require('../functions/documentSealedExchange');

// Smallest per-blob price that settles with an enforceable HTLC.
const P = HTLC_MINIMUM_SATS;

/**
 * Minimal two-seller market: sellers hold the same sealed document; the
 * buyer's Peer is wired so `requestDocument(id, seller)` makes that seller
 * deliver the requested blob (frames + per-blob key reveal) through the
 * buyer's real ingest path.
 */
function buildMarket (opts = {}) {
  const plain = crypto.randomBytes(opts.bytes || 4000);
  const doc = Document.seal(plain, { chunkBytes: 2048 });
  const buyer = new Peer({ listen: false });
  const sellers = {};
  const book = new DocumentBook();
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

  // Intercept DocumentRequest → simulate the chosen seller's delivery: a
  // `quote` (verify-before-pay) request gets the per-buyer quote when the
  // seller quotes, then ciphertext only; a paid request also gets the key.
  // `ctl` lets a test make the seller silent, withhold keys on paid requests,
  // or rewrite what it sends (lying quotes, bad key reveals). With
  // `ctl.market` set, a request for a blob whose session has not paid yet is
  // a verify-before-pay request and gets ciphertext only.
  const ctl = { silent: false, reveal: true, mutateQuote: null, mutateReveal: null, market: null };
  const prepay = (seller, id, reqOpts) => reqOpts.quote === true || (!!ctl.market && ctl.market.listSessions().some((x) =>
    x.documentId === id && x.seller === seller && Number(x.blobIndex) === Number(reqOpts.blobIndex) && ['open', 'quote_pending'].includes(x.status)));
  buyer.requestDocument = (id, seller, reqOpts = {}) => {
    const s = sellers[seller];
    if (!s) return false;
    deliveries.push({ seller, blobIndex: reqOpts.blobIndex, quote: reqOpts.quote === true });
    if (typeof ctl.silent === 'function' ? ctl.silent(seller) : ctl.silent) return true;
    const reveal = typeof ctl.reveal === 'function' ? ctl.reveal(seller) : ctl.reveal;
    deliver(s, seller, id, reqOpts, { revealKey: !prepay(seller, id, reqOpts) && reveal });
    return true;
  };

  function deliver (s, seller, id, reqOpts, sendOpts) {
    const written = [];
    s.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
    if (reqOpts.quote === true && s.settings.sealedBlobPaymentMode === 'perBuyer') {
      s._sendSealedBlobQuote(id, Number(reqOpts.blobIndex), 'buyer');
    }
    s._sendSealedBlobsToPeer(s._getSealedBlobDocument(id), id, 'buyer', Object.assign({ settlementId: 't', blobIndex: reqOpts.blobIndex }, sendOpts));
    ingest(written, seller);
  }

  function ingest (written, seller) {
    for (const buf of written) {
      const m = Message.fromBuffer(buf);
      const body = JSON.parse(m.body);
      if (m.type === 'P2P_FILE_SEND') buyer._ingestP2pFileSend({ object: body }, { name: seller }, m);
      else if (body.type === 'DocumentBlobQuote') buyer._ingestSealedBlobQuote(ctl.mutateQuote ? ctl.mutateQuote(body.object) : body.object, { name: seller }, m);
      else buyer._handleDocumentContentKeyReveal(ctl.mutateReveal ? ctl.mutateReveal(body.object) : body.object, { name: seller });
    }
  }

  return { plain, doc, buyer, sellers, book, deliveries, documentId, deliver, ingest, ctl };
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
    // Confirming blob 1 kept blob 0's pins (merged, not replaced).
    const [expected] = m.buyer.blobTransfers.expectedFor(m.documentId);
    assert.deepStrictEqual(expected.expectedHashes, [m.doc.blob(0).blobHashHex, m.doc.blob(1).blobHashHex]);
    assert.deepStrictEqual(expected.expectedPaymentHashes, [m.doc.paymentHashFor(0), m.doc.paymentHashFor(1)]);
    assert.deepStrictEqual(expected.expectedIvs, [m.doc.blob(0).iv, m.doc.blob(1).iv]);
    assert.strictEqual(expected.expectedOrigins.length, 2);
    assert.ok(expected.expectedOrigins.every((o) => o === 'alpha' || o === 'beta'));
    const st = market.status();
    assert.strictEqual(st.wants[0].status, 'complete');
    assert.ok(st.sessions.every((s) => s.status === 'complete'));
    assert.strictEqual(st.spentSats, 0);
    // Delivery telemetry landed in the local book (never gossiped).
    const tel = m.book.exportTelemetry();
    assert.ok(tel.providers.some((p) => p.deliveries >= 1));
  });

  it('refuses plans over the cap and spends within budget using pay/verify', async function () {
    const m = buildMarket({ rateSats: P });
    // HTLC construction needs seller keys + locktime; the pay/verify path is
    // exercised with a plain payment address (hosts inject real funding).
    const market = new Market({ budgetSats: P + 1, perPlanMaxSats: 10 * P, tickMs: 0, book: m.book });
    market.attach({ peer: m.buyer, pay: async () => 'ff'.repeat(32), verify: async () => true });
    market.want(m.documentId, { blobTotal: m.doc.blobTotal });

    const first = await market.tick();
    assert.strictEqual(first.opened, 0, 'two blobs at P sats each exceed a budget of P + 1');
    assert.ok(/cap/.test(market.status().wants[0].lastError));

    market.setBudget(2 * P);
    // Offers without a seller pubkey cannot build a buyer-bound HTLC: the
    // agent must refuse to fund rather than pay a bare address.
    const second = await market.tick();
    assert.strictEqual(second.opened, 0);
    assert.ok(/buyer refund key|seller pubkey|HTLC/.test(market.status().wants[0].lastError));
    assert.strictEqual(market.spentSats, 0);
    assert.strictEqual(market.reservedSats, 0);
  });

  it('never plans a paid blob below the HTLC minimum (no enforceable settlement)', function () {
    const doc = Document.seal(crypto.randomBytes(4000), { chunkBytes: 2048 });
    const book = new DocumentBook();
    book.ingestInventoryResponse({ origin: 'cheap', items: [doc.inventoryItem({ rateSats: P - 1, documentId: 'd' })] });
    const market = new Market({ budgetSats: 10 * P, tickMs: 0, book });
    const want = { documentId: 'd', blobTotal: doc.blobTotal, merkleRootHex: doc.merkleRootHex };
    assert.strictEqual(market.planFor(want).ok, false);
    book.ingestInventoryResponse({ origin: 'fair', items: [doc.inventoryItem({ rateSats: P, documentId: 'd' })] });
    const planned = market.planFor(want);
    assert.ok(planned.ok, planned.error);
    assert.ok([...planned.plan.values()].every((o) => o.sellerAddress === 'fair'));
    assert.strictEqual(market.openSession(want, Object.assign({}, planned.plan.get(0), { rateSats: P - 1 }), 0, doc.blobTotal), null);
  });

  it('never pays for an unsealed blob (the seller could claim without delivering)', function () {
    const ad = Document.advertise(crypto.randomBytes(4000), { documentId: 'plain', chunkBytes: 2048, rateSats: P });
    const book = new DocumentBook();
    const item = (rateSats) => ({ id: 'plain', rateSats, merkleRootHex: ad.merkleRootHex, blobs: ad.itemBlobs.map((b) => Object.assign({}, b, { rateSats })) });
    book.ingestInventoryResponse({ origin: 'paid', sellerPubkey: '02' + 'ab'.repeat(32), items: [item(P)] });
    const market = new Market({ budgetSats: 10 * P, tickMs: 0, book });
    const want = { documentId: 'plain', blobTotal: ad.itemBlobs.length, merkleRootHex: ad.merkleRootHex };
    assert.strictEqual(market.planFor(want).ok, false);
    const offer = book.listOffers({ documentId: 'plain', blobIndex: 0 })[0];
    assert.strictEqual(market.openSession(want, offer, 0, want.blobTotal), null);
    assert.ok(/unsealed/.test(want.lastError));

    book.ingestInventoryResponse({ origin: 'mirror', items: [item(0)] });
    const planned = market.planFor(want);
    assert.ok(planned.ok, planned.error);
    assert.ok([...planned.plan.values()].every((o) => o.sellerAddress === 'mirror'));
    assert.strictEqual(planned.costSats, 0);
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
  const { signerFromPriv32 } = require('../types/htlc');
  const NET = bitcoin.networks.regtest;

  function party () {
    const priv = crypto.randomBytes(32);
    const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
    return { priv, pub, address: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address };
  }

  it('pays per chunk over an open channel and settles each HTLC with the revealed K_i', async function () {
    const m = buildMarket({ rateSats: P });
    const buyerKey = party();
    const sellerKey = party();
    const fundingBuyer = Channel.buildFunding({ network: 'regtest', localPubkey: buyerKey.pub, remotePubkey: sellerKey.pub, expireAfter: 5000 });
    const fundingSeller = Channel.buildFunding({ network: 'regtest', localPubkey: sellerKey.pub, remotePubkey: buyerKey.pub, expireAfter: 5000, funder: 'remote' });
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(fundingBuyer.address, NET), BigInt(50000));
    const fundedTxHex = tx.toHex();
    const opening = 50000 - 500 - 2 * Channel.DEFAULTS.anchorSats;
    const tipHeight = () => 100;
    const buyerChan = new Channel.Session({ funding: fundingBuyer, fundedTxHex, localPrivateKey: buyerKey.priv, localSats: opening, remoteSats: 0, localAddress: buyerKey.address, remoteAddress: sellerKey.address, tipHeight });
    const sellerChan = new Channel.Session({ funding: fundingSeller, fundedTxHex, localPrivateKey: sellerKey.priv, localSats: 0, remoteSats: opening, localAddress: sellerKey.address, remoteAddress: buyerKey.address, tipHeight, fundingConfirmed: true });
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
    const market = new Market({ budgetSats: 10 * P, perPlanMaxSats: 10 * P, tickMs: 0, book: m.book, proximityWeight: 1 });
    m.ctl.market = market;
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
    // Seller got paid off-chain: P sats per channel-settled chunk.
    assert.strictEqual(sellerChan.balances.localSats, viaChannel.length * P);
    assert.strictEqual(buyerChan.state.htlcs.length, 0);
    assert.strictEqual(buyerChan.fullySigned, true);
    assert.ok(published.includes('ChannelHtlcFulfill'));
    assert.strictEqual(buyerChan.busy, false);
    assert.ok(Object.keys(sellerChan.state.revoked).length >= 2, 'every superseded state is revoked');
    assert.strictEqual(market.spentSats, viaChannel.length * P + (sessions.length - viaChannel.length) * P);
  });

  it('seller-fulfils over ChannelBook: no key reveal on the wire, buyer opens blobs with the HTLC preimage, busy rounds defer', async function () {
    const m = buildMarket({ rateSats: P });
    // The channel seller never reveals keys over P2P_FILE_SEND: ciphertext only.
    const sellerPeer = m.sellers.alpha;
    const origRequest = m.buyer.requestDocument;
    m.buyer.requestDocument = (id, seller, reqOpts = {}) => {
      if (seller !== 'alpha') return origRequest(id, seller, reqOpts);
      const written = [];
      sellerPeer.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
      sellerPeer._sendSealedBlobsToPeer(sellerPeer._getSealedBlobDocument(id), id, 'buyer', { revealKey: false, settlementId: 't', blobIndex: reqOpts.blobIndex });
      for (const buf of written) {
        const msg = Message.fromBuffer(buf);
        assert.strictEqual(msg.type, 'P2P_FILE_SEND');
        m.buyer._ingestP2pFileSend({ object: JSON.parse(msg.body) }, { name: 'alpha' }, msg);
      }
      return true;
    };
    // Make the channel seller the only seller the book knows.
    const only = new DocumentBook();
    only.ingestInventoryResponse({ origin: 'alpha', items: [m.doc.inventoryItem({ rateSats: P, documentId: m.documentId })], latencyMs: 20 });

    const buyerKey = party();
    const sellerKey = party();
    const wire = { toSeller: [], toBuyer: [] };
    const buyerBook = new ChannelBook({ localPrivateKey: buyerKey.priv, network: 'regtest', tipHeight: () => 100, publish: (body) => wire.toSeller.push(body) });
    const sellerBook = new ChannelBook({
      localPrivateKey: sellerKey.priv,
      network: 'regtest',
      tipHeight: () => 100,
      confirmations: () => 6,
      publish: (body) => wire.toBuyer.push(body),
      // Seller-fulfils: the preimage for a blob this Peer sells, only when the HTLC pays its price.
      preimageFor: (h, htlc) => sellerPeer.sealedBlobPreimageForPaymentHash(h, htlc)
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: buyerKey.pub, remotePubkey: sellerKey.pub, expireAfter: 5000 });
    tx.addOutput(bitcoin.address.toOutputScript(funding.address, NET), BigInt(50000));
    const opened = buyerBook.open({ remotePubkey: sellerKey.pub, fundedTxHex: tx.toHex(), capacitySats: 50000, expireAfter: 5000, localAddress: buyerKey.address, remoteAddress: sellerKey.address, aliases: ['alpha'] });
    const step = () => {
      if (wire.toSeller.length) { sellerBook.ingest(wire.toSeller.shift(), { sellerId: 'buyer' }); return true; }
      if (wire.toBuyer.length) { buyerBook.ingest(wire.toBuyer.shift(), { sellerId: 'alpha' }); return true; }
      return false;
    };
    const pump = () => { while (step()); };
    pump();
    assert.strictEqual(opened.session.status, 'open');

    const market = new Market({ budgetSats: 10 * P, perPlanMaxSats: 10 * P, tickMs: 0, book: only, proximityWeight: 1 });
    market.attach({ peer: m.buyer, channels: buyerBook });
    const deferred = [];
    market.on('sessionDeferred', (s) => deferred.push(s));
    market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });

    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });

    // Gossip is not pumped during the tick: the first HTLC leaves the channel
    // busy, so the second chunk is deferred instead of being confirmed unpaid.
    const first = await market.tick();
    assert.ok(first.opened >= 1);
    const afterFirst = market.listSessions().filter((s) => s.rail === 'channel');
    assert.ok(afterFirst.some((s) => s.status === 'channel_pending'), 'second chunk waits for the round to finish');
    assert.ok(deferred.length >= 1);
    assert.ok(!afterFirst.some((s) => s.status === 'complete'), 'nothing completes before the HTLC settles');
    assert.strictEqual(market.spentSats, 0, 'nothing is counted as spent until the HTLC is fulfilled');

    // Finish the round: the seller fulfils with K_i, the buyer opens the blob with the preimage.
    pump();
    assert.ok(received === null || received.buffer.length > 0);
    // Retry deferred chunks until everything is bought and opened.
    for (let i = 0; i < 6 && !(received && received.buffer.equals(m.plain)); i++) {
      await market.tick();
      pump();
    }
    assert.ok(received && received.buffer.equals(m.plain), 'document reassembled from HTLC preimages alone');
    const done = market.listSessions().filter((s) => s.rail === 'channel');
    assert.ok(done.length >= m.doc.blobTotal);
    assert.ok(done.every((s) => s.status === 'complete'), JSON.stringify(done.map((s) => s.status)));
    assert.strictEqual(opened.session.state.htlcs.length, 0);
    assert.strictEqual(opened.session.busy, false);
    assert.strictEqual(sellerBook.get(opened.session.channelId).balances.localSats, m.doc.blobTotal * P);
    assert.strictEqual(market.spentSats, m.doc.blobTotal * P);
  });

  it('a channel HTLC fulfilled after the delivery timeout is still counted as spent', function () {
    const EventEmitter = require('events');
    const channels = Object.assign(new EventEmitter(), { sessionFor: () => null });
    const market = new Market({ budgetSats: 100, deliveryTimeoutMs: 1000 }).attach({ channels });
    const c = market._state.content;
    c.wants.doc = { documentId: 'doc', status: 'buying' };
    const session = { settlementId: 's1', documentId: 'doc', sellerId: 'alpha', rail: 'channel', channelId: 'ch', channelHtlcId: 'h1', amountSats: 7, status: 'delivery_pending', confirmedAt: Date.now() - 5000 };
    c.sessions.s1 = session;
    market._moveBudget(session, 'locked');
    market._sweepTimeouts();
    assert.strictEqual(session.status, 'delivery_pending', 'an open HTLC is not timed out — it ends through htlcSettled');
    assert.strictEqual(c.wants.doc.status, 'buying');
    assert.strictEqual(market.lockedSats, 7, 'the HTLC keeps its sats locked');
    assert.strictEqual(market.remainingSats, 93);
    // Even if the session had already failed, a late fulfil moves sats and must be booked.
    session.status = 'failed';
    channels.emit('htlcSettled', { channelId: 'ch', htlcId: 'h1', outcome: 'fulfilled', preimageHex: '11'.repeat(32) });
    assert.strictEqual(market.spentSats, 7);
    assert.strictEqual(market.lockedSats, 0);
    assert.strictEqual(market.reservedSats, 0);
    channels.emit('htlcSettled', { channelId: 'ch', htlcId: 'h1', outcome: 'fulfilled', preimageHex: '11'.repeat(32) });
    assert.strictEqual(market.spentSats, 7, 'counted once');
    assert.ok(market.audit().ok);
  });
});

describe('services/market (Phase 5 hardening)', function () {
  const bitcoin = require('bitcoinjs-lib');
  const Channel = require('../types/channel');
  const { signerFromPriv32 } = require('../types/htlc');
  const NET = bitcoin.networks.regtest;

  function fundingTx (address, sats) {
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(address, NET), BigInt(sats));
    return tx;
  }

  /**
   * L1 market: offers carry the sellers' AMP signer keys (HTLCs bind to
   * them), the buyer's Peer key is the refund key, and the clock and tip are
   * driven by the test. `chain.funded` is what is really on chain.
   */
  function buildL1 (opts = {}) {
    const m = buildMarket({ rateSats: P, bytes: opts.bytes });
    const book = new DocumentBook();
    for (const name of opts.sellers || ['alpha']) {
      book.ingestInventoryResponse({
        origin: name,
        signerPubkeyHex: m.sellers[name].key.pubkey,
        items: [m.doc.inventoryItem({ rateSats: P, documentId: m.documentId })],
        latencyMs: name === 'alpha' ? 20 : 200
      });
    }
    const chain = { tip: 1000, funded: new Map() };
    const clock = { t: 1e9 };
    m.buyer.settings.inventoryHtlcLocktimeHeight = opts.lock != null ? opts.lock : chain.tip + 100;
    const refundAddress = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(m.buyer.key.pubkey, 'hex'), network: NET }).address;
    const market = new Market(Object.assign({
      budgetSats: 10 * P,
      perPlanMaxSats: 10 * P,
      tickMs: 0,
      book,
      proximityWeight: 1,
      network: 'regtest',
      tipHeight: () => chain.tip,
      now: () => clock.t,
      refundAddress
    }, opts.market));
    m.ctl.market = market;
    return Object.assign(m, { book, chain, clock, market, refundAddress });
  }

  /** `pay` that funds the HTLC on `chain` ('ok'), fails before broadcasting ('throw'), or after ('lost') */
  function payer (m, calls, mode = () => 'ok') {
    return async (session) => {
      calls.push(session.paymentAddress);
      const how = mode(session);
      if (how === 'throw') throw new Error('wallet locked');
      const tx = fundingTx(session.paymentAddress, session.amountSats);
      m.chain.funded.set(session.paymentAddress, { txid: tx.getId(), txHex: tx.toHex() });
      if (how === 'lost') throw new Error('socket hang up');
      return { txid: tx.getId(), txHex: tx.toHex() };
    };
  }

  /** truthful `addressFunded` oracle that answers "unknown" while `unknown()` */
  function oracle (m, unknown = () => false) {
    return async (address) => {
      if (unknown()) return null;
      const hit = m.chain.funded.get(address);
      return hit ? Object.assign({ funded: true }, hit) : { funded: false };
    };
  }

  function want (m) {
    m.market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
  }

  it('refuses mainnet in the constructor and on start', async function () {
    for (const network of ['mainnet', 'bitcoin', 'main', 'nonsense']) {
      assert.throws(() => new Market({ network }), /refused/);
    }
    const market = new Market({ tickMs: 0, network: 'testnet' });
    market.settings.network = 'mainnet';
    await assert.rejects(market.start(), /refused/);
    assert.notStrictEqual(market.status().status, 'running');
  });

  it('a pay that fails after broadcasting keeps the reservation and never pays the address twice (also across a restart)', async function () {
    const m = buildL1();
    const { market } = m;
    const calls = [];
    let unknown = true;
    let snap = null;
    const pay = payer(m, calls, () => 'lost');
    const unknownEvents = [];
    market.on('sessionFundingUnknown', (s) => unknownEvents.push(s.settlementId));
    market.attach({
      peer: m.buyer,
      pay: (s) => {
        // A crash inside `pay`: the dedupe key must already be persisted.
        if (!snap) snap = JSON.parse(JSON.stringify(market.export()));
        return pay(s);
      },
      addressFunded: oracle(m, () => unknown)
    });
    want(m);
    await market.tick();
    const sessions = market.listSessions();
    assert.strictEqual(sessions.length, m.doc.blobTotal);
    assert.ok(sessions.every((s) => s.status === 'funding_unknown'), JSON.stringify(sessions.map((s) => [s.status, s.error, s.lastError])));
    assert.strictEqual(calls.length, m.doc.blobTotal);
    assert.strictEqual(unknownEvents.length, m.doc.blobTotal);
    assert.strictEqual(market.reservedSats, m.doc.blobTotal * P, 'reservation kept while the funding is unknown');
    assert.ok(snap.paidSettlements.some(([, id]) => id === sessions[0].settlementId), 'dedupe key written before pay');

    // Unknown for longer than the safety window: still no second pay.
    for (let i = 0; i < 3; i++) {
      m.clock.t += 2 * 60 * 60 * 1000;
      await market.tick();
    }
    assert.strictEqual(calls.length, m.doc.blobTotal);
    assert.strictEqual(market.listSessions().length, m.doc.blobTotal, 'no replacement session while the funding is unknown');

    // The chain answers: funded → delivery, no new pay.
    unknown = false;
    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });
    await market.tick();
    assert.strictEqual(calls.length, m.doc.blobTotal);
    assert.ok(received && received.buffer.equals(m.plain));
    assert.ok(market.listSessions().every((s) => s.status === 'complete'));
    assert.strictEqual(market.spentSats, m.doc.blobTotal * P);
    assert.strictEqual(market.reservedSats + market.lockedSats, 0);
    await market.stop();

    // Restart from the snapshot taken inside the first pay: the session
    // caught mid-pay is `funding_unknown`, and no address is paid again.
    const calls2 = [];
    const fresh = new Market({ tickMs: 0, network: 'regtest', book: m.book, tipHeight: () => m.chain.tip, now: () => m.clock.t, proximityWeight: 1 });
    fresh.import(snap);
    const first = fresh.listSessions().find((s) => s.settlementId === sessions[0].settlementId);
    assert.strictEqual(first.status, 'funding_unknown');
    fresh.attach({ peer: m.buyer, pay: payer(m, calls2), addressFunded: oracle(m) });
    await fresh.tick();
    await fresh.tick();
    assert.strictEqual(calls2.length, 0, 'funded addresses are never paid again');
    assert.ok(fresh.audit().ok);
  });

  it('a definitively unfunded HTLC is released only after the safety window, then re-planned', async function () {
    const m = buildL1({ market: { fundingSafetyMs: 10000 } });
    const { market } = m;
    const calls = [];
    market.attach({ peer: m.buyer, pay: payer(m, calls, () => 'throw'), addressFunded: oracle(m) });
    want(m);
    await market.tick();
    assert.strictEqual(calls.length, m.doc.blobTotal);
    m.clock.t += 5000;
    await market.tick();
    assert.strictEqual(calls.length, m.doc.blobTotal, 'inside the window nothing is released or re-paid');
    assert.strictEqual(market.reservedSats, m.doc.blobTotal * P);
    m.clock.t += 6000;
    await market.tick();
    const failed = market.listSessions().filter((s) => s.status === 'failed');
    assert.strictEqual(failed.length, m.doc.blobTotal);
    assert.ok(failed.every((s) => s.budget === 'released'));
    // Re-planned in the same tick: each new session checked the address before paying.
    assert.strictEqual(calls.length, 2 * m.doc.blobTotal);
    assert.strictEqual(market.reservedSats, m.doc.blobTotal * P, 'only the new sessions are reserved');
    assert.ok(market.audit().ok);
  });

  it('funded HTLCs stay locked through a delivery timeout; a late claim is spent, a confirmed refund is released', async function () {
    const m = buildL1({ market: { budgetSats: 3 * P, deliveryTimeoutMs: 1000 } });
    const { market } = m;
    const calls = [];
    m.ctl.reveal = false;
    market.attach({ peer: m.buyer, pay: payer(m, calls), verify: async () => true });
    want(m);
    await market.tick();
    assert.ok(market.listSessions().every((s) => s.status === 'delivery_pending'));
    assert.strictEqual(market.lockedSats, 2 * P);
    assert.strictEqual(market.reservedSats, 0);

    const timedOut = [];
    market.on('sessionTimedOut', (s) => timedOut.push(s.settlementId));
    m.clock.t += 2000;
    await market.tick();
    const [s0, s1] = market.listSessions().sort((a, b) => a.blobIndex - b.blobIndex);
    assert.strictEqual(timedOut.length, 2);
    assert.strictEqual(s0.status, 'refund_pending');
    assert.strictEqual(s1.status, 'refund_pending');
    assert.strictEqual(market.lockedSats, 2 * P, 'a timeout never releases funded sats');
    assert.strictEqual(market.remainingSats, P);
    assert.strictEqual(market.listSessions().length, 2, 'the same seller is not paid again for those blobs');
    assert.strictEqual(calls.length, 2);

    // The seller claims blob 0 late: the witness preimage is K_0.
    market.claimObserved(s1.settlementId, { preimageHex: crypto.randomBytes(32).toString('hex') });
    assert.strictEqual(market.spentSats, 0, 'a preimage that does not hash to the payment hash is ignored');
    market.claimObserved(s0.settlementId, { preimageHex: m.doc.keyFor(0), txid: 'aa'.repeat(32) });
    assert.strictEqual(market.spentSats, P);
    assert.strictEqual(market.lockedSats, P);
    assert.ok(['claimed', 'complete'].includes(s0.status));

    // Blob 1 is refunded once the locktime is reached.
    const ready = [];
    market.on('refundReady', (ev) => ready.push(ev));
    await market.tick();
    assert.strictEqual(ready.length, 0, 'no refund before the locktime');
    const lock = s1.htlc.refundLocktimeHeight;
    m.chain.tip = lock;
    await market.tick();
    assert.strictEqual(ready.length, 1);
    assert.strictEqual(ready[0].session.settlementId, s1.settlementId);
    assert.ok(ready[0].psbtBase64 && ready[0].txHex, 'signed with the buyer refund key');
    const refund = bitcoin.Transaction.fromHex(ready[0].txHex);
    assert.strictEqual(refund.locktime, lock);
    assert.strictEqual(Buffer.from(refund.ins[0].hash).reverse().toString('hex'), s1.txid);
    assert.strictEqual(bitcoin.address.fromOutputScript(refund.outs[0].script, NET), m.refundAddress);

    // Seen in the mempool: still locked. Confirmed: released.
    assert.deepStrictEqual(market.observeTransaction(ready[0].txHex).map((o) => o.kind), ['refund']);
    assert.strictEqual(market.lockedSats, P);
    const refunded = [];
    market.on('sessionRefunded', (s) => refunded.push(s.settlementId));
    market.onBlock({ height: lock + 1, txHexes: [ready[0].txHex] });
    assert.deepStrictEqual(refunded, [s1.settlementId]);
    assert.strictEqual(s1.status, 'refunded');
    assert.strictEqual(market.lockedSats, 0);
    assert.strictEqual(market.spentSats, P);
    assert.ok(market.audit().ok);
  });

  it('property: spent + reserved + locked stays within budget and no address is paid twice under random failures', async function () {
    this.timeout(240000);
    const seen = new Set();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let x = (seed * 2654435761) >>> 0;
      const rnd = () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x / 4294967296;
      };
      // Five blobs, two sellers, a budget for seven: re-plans are squeezed.
      const m = buildL1({ bytes: 10000, sellers: ['alpha', 'beta'], market: { budgetSats: 7 * P, fundingSafetyMs: 5000, deliveryTimeoutMs: 3000, prepayTimeoutMs: 2000 } });
      const { market } = m;
      const doublePays = [];
      let unknown = false;
      let exceeded = 0;
      market.on('budgetExceeded', () => exceeded++);
      market.attach({
        peer: m.buyer,
        pay: async (s) => {
          if (m.chain.funded.has(s.paymentAddress)) doublePays.push(s.paymentAddress);
          const r = rnd();
          if (r < 0.25) throw new Error('wallet locked');
          const tx = fundingTx(s.paymentAddress, s.amountSats);
          m.chain.funded.set(s.paymentAddress, { txid: tx.getId(), txHex: tx.toHex() });
          if (r < 0.5) throw new Error('timeout after broadcast');
          if (r < 0.6) return null;
          return { txid: tx.getId(), txHex: tx.toHex() };
        },
        verify: async () => rnd() < 0.7,
        addressFunded: oracle(m, () => unknown)
      });
      want(m);
      for (let step = 0; step < 50; step++) {
        const r = rnd();
        m.ctl.reveal = rnd() < 0.3;
        m.ctl.silent = rnd() < 0.15;
        unknown = rnd() < 0.3;
        if (r < 0.45) {
          await market.tick();
        } else if (r < 0.6) {
          m.clock.t += Math.floor(rnd() * 6000);
        } else if (r < 0.7) {
          m.chain.tip += Math.floor(rnd() * 80);
        } else if (r < 0.85) {
          // The seller claims a funded HTLC late.
          const s = market.listSessions().find((y) => market._bucketOf(y) === 'locked');
          if (s) market.claimObserved(s.settlementId, { preimageHex: m.doc.keyFor(s.blobIndex) });
        } else {
          // A built refund confirms.
          const s = market.listSessions().find((y) => y.status === 'refund_pending' && y.refund && y.refund.txHex);
          if (s) market.onBlock({ height: m.chain.tip, txHexes: [s.refund.txHex] });
        }
        for (const s of market.listSessions()) seen.add(s.status);
        const audit = market.audit();
        assert.ok(audit.ok, `seed ${seed} step ${step}: ${JSON.stringify(audit)}`);
        assert.ok(market.committedSats <= market.budgetSats, `seed ${seed} step ${step}`);
      }
      assert.deepStrictEqual(doublePays, [], `seed ${seed}: an address was paid twice`);
      assert.strictEqual(exceeded, 0);
    }
    // The sequences reach the interesting states, not just the happy path.
    for (const status of ['funding_unknown', 'refund_pending', 'complete']) {
      assert.ok(seen.has(status), `never reached ${status}: ${[...seen].join(', ')}`);
    }
  });

  it('refuses an HTLC refund locktime that is past, too close, or too far from the tip (no seller penalty)', async function () {
    for (const [lock, re] of [[990, /already past/], [1005, /too close/], [1000 + 5000, /locks funds/]]) {
      const m = buildL1({ lock });
      const calls = [];
      m.market.attach({ peer: m.buyer, pay: payer(m, calls) });
      want(m);
      await m.market.tick();
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(m.market.listSessions().length, 0);
      assert.ok(re.test(m.market.status().wants[0].lastError), m.market.status().wants[0].lastError);
      const tel = m.book.exportTelemetry().providers.find((p) => p.sellerId === 'alpha' || p.id === 'alpha');
      assert.ok(!tel || !(tel.failures > 0), 'our locktime is not the seller\'s fault');
    }
    const unknownTip = buildL1({ market: { tipHeight: () => null } });
    unknownTip.market.attach({ peer: unknownTip.buyer, pay: payer(unknownTip, []) });
    want(unknownTip);
    await unknownTip.market.tick();
    assert.ok(/tip unknown/.test(unknownTip.market.status().wants[0].lastError));
  });

  it('dedupe is per seller: a timed-out seller is not paid again, another seller is bought from', async function () {
    const m = buildL1({ sellers: ['alpha', 'beta'], market: { budgetSats: 4 * P, deliveryTimeoutMs: 1000 } });
    const { market } = m;
    const calls = [];
    m.ctl.reveal = (seller) => seller !== 'alpha';
    market.attach({ peer: m.buyer, pay: payer(m, calls), verify: async () => true });
    want(m);
    await market.tick();
    assert.ok(market.listSessions().every((s) => s.sellerId === 'alpha' && s.status === 'delivery_pending'));
    m.clock.t += 2000;
    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });
    await market.tick();
    const bySeller = (name) => market.listSessions().filter((s) => s.sellerId === name);
    assert.strictEqual(bySeller('alpha').length, m.doc.blobTotal, 'alpha is never asked again for those blobs');
    assert.ok(bySeller('alpha').every((s) => s.status === 'refund_pending'));
    assert.strictEqual(bySeller('beta').length, m.doc.blobTotal);
    assert.ok(bySeller('beta').every((s) => s.status === 'complete'));
    assert.ok(received && received.buffer.equals(m.plain));
    assert.strictEqual(market.lockedSats, 2 * P);
    assert.strictEqual(market.spentSats, 2 * P);
    const keys = [...market.paidSettlements.keys()];
    assert.ok(keys.some((k) => k.endsWith('|alpha')) && keys.some((k) => k.endsWith('|beta')));
    assert.notStrictEqual(Market.sellerDedupeKey(bySeller('alpha')[0]), Market.sellerDedupeKey(bySeller('beta')[0]));
    assert.ok(market.audit().ok);
  });

  it('a whole-document delivery completes only its own seller\'s locked purchase, never a timed-out one', function () {
    const market = new Market({ budgetSats: 4 * P, tickMs: 0, book: new DocumentBook() });
    const documentId = 'ab'.repeat(32);
    const session = (id, seller, status) => ({ settlementId: id, documentId, seller, sellerId: seller, status, amountSats: P, budget: 'locked', confirmedAt: 1 });
    const sessions = {
      timedOut: session('timed-out', 'alpha', 'refund_pending'),
      other: session('other', 'gamma', 'delivery_pending'),
      own: session('own', 'beta', 'delivery_pending')
    };
    Object.assign(market._state.content.sessions, sessions);
    market._state.content.lockedSats = 3 * P;
    market._onDocumentReceived({ documentId, origin: { name: 'beta' }, buffer: Buffer.from('doc') });
    assert.strictEqual(sessions.timedOut.status, 'refund_pending', 'the timed-out seller is still refunded');
    assert.strictEqual(sessions.timedOut.budget, 'locked');
    assert.strictEqual(sessions.other.status, 'refund_pending', 'another seller was not paid by this delivery');
    assert.strictEqual(sessions.other.error, 'document delivered by another seller');
    assert.strictEqual(sessions.own.status, 'complete');
    assert.strictEqual(market.lockedSats, 2 * P);
    assert.strictEqual(market.spentSats, P);
    market._onDocumentReceived({ documentId, origin: { name: 'alpha' }, buffer: Buffer.from('doc') });
    assert.strictEqual(sessions.timedOut.status, 'refund_pending', 'a late delivery from the timed-out seller does not cancel its refund');
  });

  it('a delivery without an origin completes no locked purchase', function () {
    const market = new Market({ budgetSats: 4 * P, tickMs: 0, book: new DocumentBook() });
    const documentId = 'cd'.repeat(32);
    const session = (id, seller) => ({ settlementId: id, documentId, seller, sellerId: seller, status: 'delivery_pending', amountSats: P, budget: 'locked', confirmedAt: 1 });
    const sessions = { alpha: session('a', 'alpha'), beta: session('b', 'beta') };
    Object.assign(market._state.content.sessions, sessions);
    market._state.content.lockedSats = 2 * P;
    market._onDocumentReceived({ documentId, buffer: Buffer.from('doc') });
    assert.strictEqual(sessions.alpha.status, 'delivery_pending');
    assert.strictEqual(sessions.beta.status, 'delivery_pending');
    assert.strictEqual(market.lockedSats, 2 * P);
    // Opening one session's key attributes the delivery to that session.
    market._opening = 'b';
    market._onDocumentReceived({ documentId, buffer: Buffer.from('doc') });
    market._opening = null;
    assert.strictEqual(sessions.beta.status, 'complete');
    assert.strictEqual(sessions.alpha.status, 'refund_pending');
    assert.strictEqual(sessions.alpha.error, 'document delivered by another seller');
  });

  it('the session whose key is opening wins over a conflicting origin', function () {
    const market = new Market({ budgetSats: 4 * P, tickMs: 0, book: new DocumentBook() });
    const documentId = 'ce'.repeat(32);
    const session = (id, seller) => ({ settlementId: id, documentId, seller, sellerId: seller, status: 'delivery_pending', amountSats: P, budget: 'locked', confirmedAt: 1 });
    const sessions = { alpha: session('a', 'alpha'), beta: session('b', 'beta') };
    Object.assign(market._state.content.sessions, sessions);
    market._state.content.lockedSats = 2 * P;
    market._opening = 'b';
    market._onDocumentReceived({ documentId, origin: { name: 'alpha' }, buffer: Buffer.from('doc') });
    market._opening = null;
    assert.strictEqual(sessions.beta.status, 'complete');
    assert.strictEqual(sessions.alpha.status, 'refund_pending');
    assert.strictEqual(sessions.alpha.error, 'document delivered by another seller');
    assert.strictEqual(market.spentSats, P, 'one delivery pays one purchase');
    assert.strictEqual(market.lockedSats, P);
  });

  it('a blob opened with one session\'s key completes only that session', function () {
    const market = new Market({ budgetSats: 4 * P, tickMs: 0, book: new DocumentBook() });
    const documentId = 'cf'.repeat(32);
    const session = (id, seller) => ({ settlementId: id, documentId, seller, sellerId: seller, blobIndex: 0, status: 'delivery_pending', amountSats: P, budget: 'locked', confirmedAt: 1 });
    const sessions = { alpha: session('a', 'alpha'), beta: session('b', 'beta') };
    Object.assign(market._state.content.sessions, sessions);
    market._state.content.lockedSats = 2 * P;
    market._opening = 'b';
    market._onBlobOpened({ documentId, blobIndex: 0, origin: { name: 'alpha' } });
    market._opening = null;
    assert.strictEqual(sessions.beta.status, 'complete');
    assert.strictEqual(sessions.alpha.status, 'refund_pending');
    assert.strictEqual(sessions.alpha.error, 'blob delivered by another seller');
    assert.strictEqual(market.spentSats, P);
  });

  it('a whole-document delivery from a per-blob purchase\'s own seller leaves it to its blob', function () {
    const market = new Market({ budgetSats: 4 * P, tickMs: 0, book: new DocumentBook() });
    const documentId = 'ef'.repeat(32);
    const own = { settlementId: 'own', documentId, seller: 'beta', sellerId: 'beta', blobIndex: 1, status: 'delivery_pending', amountSats: P, budget: 'locked', confirmedAt: 1 };
    const other = Object.assign({}, own, { settlementId: 'other', seller: 'gamma', sellerId: 'gamma' });
    Object.assign(market._state.content.sessions, { own, other });
    market._state.content.lockedSats = 2 * P;
    market._onDocumentReceived({ documentId, origin: { name: 'beta' }, buffer: Buffer.from('doc') });
    assert.strictEqual(own.status, 'delivery_pending', 'its blob has not opened yet');
    assert.strictEqual(other.status, 'refund_pending');
  });

  it('forget releases never-paid sessions and keeps the budget of ones that may have paid', async function () {
    const m = buildL1();
    m.ctl.silent = true;
    m.market.attach({ peer: m.buyer, pay: payer(m, []) });
    want(m);
    await m.market.tick();
    assert.ok(m.market.listSessions().every((s) => s.status === 'quote_pending'));
    assert.strictEqual(m.market.reservedSats, 2 * P);
    m.market.forget(m.documentId);
    assert.ok(m.market.listSessions().every((s) => s.status === 'cancelled' && s.budget === 'released'));
    assert.strictEqual(m.market.reservedSats, 0);
    assert.strictEqual(m.market.paidSettlements.size, 0);

    const n = buildL1();
    let unknown = true;
    n.market.attach({ peer: n.buyer, pay: payer(n, [], () => 'lost'), addressFunded: oracle(n, () => unknown) });
    want(n);
    await n.market.tick();
    n.market.forget(n.documentId);
    assert.ok(n.market.listSessions().every((s) => s.status === 'funding_unknown' && s.forgotten));
    assert.strictEqual(n.market.reservedSats, 2 * P, 'maybe-paid sessions keep their reservation');
    unknown = false;
    await n.market.tick();
    assert.strictEqual(n.market.reservedSats, 0);
    assert.strictEqual(n.market.spentSats, 2 * P, 'the funded HTLCs still complete');
    assert.ok(n.market.audit().ok);
  });

  it('a revealed key that is not the committed preimage is bad-key fraud, not a delivery', async function () {
    const m = buildL1({ market: { deliveryTimeoutMs: 0 } });
    m.ctl.mutateReveal = (reveal) => Object.assign({}, reveal, { keyHex: crypto.randomBytes(32).toString('hex') });
    const frauds = [];
    m.market.on('sessionFraud', (ev) => frauds.push(ev));
    m.market.attach({ peer: m.buyer, pay: payer(m, []), verify: async () => true });
    let received = null;
    m.buyer.on('documentReceived', (ev) => { received = ev; });
    want(m);
    await m.market.tick();
    assert.strictEqual(received, null);
    assert.strictEqual(frauds.length, m.doc.blobTotal);
    assert.ok(frauds.every((f) => f.kind === 'bad-key'));
    assert.ok(m.market.listSessions().every((s) => s.status === 'refund_pending' && s.budget === 'locked'), 'funded HTLCs wait for their refund');
    const penalties = m.book.exportTelemetry().providers.find((p) => (p.sellerId || p.id) === 'alpha');
    assert.ok(penalties, 'penalty recorded for the seller');
  });

  it('per-buyer quotes: pays the quoted hash after verifying ciphertext; the claim preimage opens the blob, a lying quote is bad-key fraud', async function () {
    for (const lie of [false, true]) {
      const m = buildL1({ market: { quotes: true } });
      m.sellers.alpha.settings.sealedBlobPaymentMode = 'perBuyer';
      m.ctl.reveal = false;
      if (lie) m.ctl.mutateQuote = (q) => Object.assign({}, q, { wrappedKeyHex: crypto.randomBytes(32).toString('hex') });
      const paid = [];
      const quoted = [];
      const verified = [];
      const frauds = [];
      m.market.on('sessionQuoted', (ev) => quoted.push(ev.quote));
      m.market.on('sessionVerified', (s) => verified.push(s.settlementId));
      m.market.on('sessionFraud', (ev) => frauds.push(ev));
      m.market.attach({
        peer: m.buyer,
        pay: async (s) => {
          paid.push({ hash: s.htlc.paymentHashHex, verified: verified.includes(s.settlementId) });
          return payer(m, [])(s);
        },
        verify: async () => true
      });
      let received = null;
      m.buyer.on('documentReceived', (ev) => { received = ev; });
      want(m);
      await m.market.tick();
      const sessions = m.market.listSessions().sort((a, b) => a.blobIndex - b.blobIndex);
      assert.strictEqual(quoted.length, m.doc.blobTotal);
      assert.strictEqual(paid.length, m.doc.blobTotal);
      assert.ok(paid.every((p) => p.verified), 'ciphertext verified before pay');
      for (let i = 0; i < sessions.length; i++) {
        assert.strictEqual(sessions[i].paymentHashHex, quoted.find((q) => q.blobIndex === i).paymentHashHex);
        assert.notStrictEqual(sessions[i].paymentHashHex, m.doc.paymentHashFor(i), 'the HTLC pays the per-buyer hash, not the static one');
        assert.strictEqual(paid[i].hash, sessions[i].paymentHashHex);
        assert.strictEqual(sessions[i].status, 'delivery_pending');
      }
      // The seller claims each HTLC on chain with s; the buyer unwraps K_i.
      for (const s of sessions) {
        const secret = m.sellers.alpha.sealedBlobPreimageForPaymentHash(s.paymentHashHex, { amountSats: s.amountSats }).preimageHex;
        m.market.claimObserved(s.settlementId, { preimageHex: secret });
      }
      assert.strictEqual(m.market.spentSats, m.doc.blobTotal * P);
      if (lie) {
        assert.strictEqual(received, null);
        assert.strictEqual(frauds.length, m.doc.blobTotal);
        assert.ok(frauds.every((f) => f.kind === 'bad-key'));
        assert.ok(sessions.every((s) => s.status === 'fraud'));
      } else {
        assert.ok(received && received.buffer.equals(m.plain));
        assert.ok(sessions.every((s) => s.status === 'complete'));
        assert.strictEqual(frauds.length, 0);
      }
      assert.ok(m.market.audit().ok);
    }
  });

  it('per-buyer quotes are opt-in: a default market pays only the committed static hash', async function () {
    const m = buildL1();
    m.sellers.alpha.settings.sealedBlobPaymentMode = 'perBuyer';
    m.ctl.reveal = false;
    const paid = [];
    const quoted = [];
    m.market.on('sessionQuoted', (ev) => quoted.push(ev.quote));
    m.market.attach({
      peer: m.buyer,
      pay: async (s) => { paid.push(s.htlc.paymentHashHex); return payer(m, [])(s); },
      verify: async () => true
    });
    want(m);
    await m.market.tick();
    assert.strictEqual(m.market.settings.quotes, false);
    assert.strictEqual(quoted.length, 0, 'no quote requested');
    const forged = createBlobQuote({ documentId: m.documentId, blobIndex: 0, keyHex: crypto.randomBytes(32).toString('hex'), amountSats: P }).quote;
    m.market._onBlobQuote({ quote: Object.assign({}, forged, { keyHashHex: m.doc.paymentHashFor(0) }), origin: 'alpha' });
    assert.strictEqual(quoted.length, 0, 'an unsolicited quote is ignored');
    const sessions = m.market.listSessions();
    assert.strictEqual(sessions.length, m.doc.blobTotal);
    for (const s of sessions) assert.strictEqual(s.paymentHashHex, m.doc.paymentHashFor(s.blobIndex));
    assert.strictEqual(paid.length, m.doc.blobTotal, 'default market pays every blob');
    assert.ok(paid.every((h, i) => h === m.doc.paymentHashFor(i)));
  });

  it('a quote-enabled session waits for the quote even when the ciphertext came first', async function () {
    for (const late of [true, false]) {
      const m = buildL1({ market: { quotes: true, prepayTimeoutMs: 60000 } });
      m.ctl.reveal = false;
      const paid = [];
      m.market.attach({
        peer: m.buyer,
        pay: async (s) => { paid.push(s.htlc.paymentHashHex); return payer(m, [])(s); },
        verify: async () => true
      });
      want(m);
      // The seller sends ciphertext but (not yet) a quote.
      await m.market.tick();
      const sessions = m.market.listSessions();
      assert.strictEqual(sessions.length, m.doc.blobTotal);
      assert.strictEqual(paid.length, 0, 'never the static hash while a quote was asked for');
      assert.ok(sessions.every((s) => s.status === 'quote_pending'));
      if (late) {
        const seller = m.sellers.alpha;
        seller.settings.sealedBlobPaymentMode = 'perBuyer';
        for (const s of sessions) {
          const written = [];
          seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
          seller._sendSealedBlobQuote(m.documentId, s.blobIndex, 'buyer');
          m.ingest(written, 'alpha');
        }
        await m.market.tick();
        assert.strictEqual(paid.length, m.doc.blobTotal);
        for (const s of m.market.listSessions()) {
          assert.notStrictEqual(s.paymentHashHex, m.doc.paymentHashFor(s.blobIndex));
          assert.ok(paid.includes(s.paymentHashHex));
        }
      } else {
        m.clock.t += 60000;
        await m.market.tick();
        assert.strictEqual(paid.length, 0);
        assert.ok(sessions.every((s) => s.status === 'failed' && /no quote/.test(s.error)), JSON.stringify(sessions.map((s) => [s.status, s.error])));
      }
    }
  });

  describe('channel rail', function () {
    function party () {
      const priv = crypto.randomBytes(32);
      const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
      return { priv, pub, address: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address };
    }

    function bookPair (m, chain, opts = {}) {
      const sellerPeer = m.sellers.alpha;
      const buyerKey = party();
      const sellerKey = party();
      const wire = { toSeller: [], toBuyer: [] };
      const buyerBook = new ChannelBook({ localPrivateKey: buyerKey.priv, network: 'regtest', tipHeight: () => chain.tip, publish: (body) => wire.toSeller.push(body) });
      const sellerBook = new ChannelBook({
        localPrivateKey: sellerKey.priv,
        network: 'regtest',
        tipHeight: () => chain.tip,
        confirmations: () => 6,
        publish: (body) => wire.toBuyer.push(body),
        preimageFor: opts.preimageFor || ((h, htlc) => sellerPeer.sealedBlobPreimageForPaymentHash(h, htlc))
      });
      const tx = new bitcoin.Transaction();
      tx.addInput(crypto.randomBytes(32), 0);
      const funding = Channel.buildFunding({ network: 'regtest', localPubkey: buyerKey.pub, remotePubkey: sellerKey.pub, expireAfter: 5000 });
      tx.addOutput(bitcoin.address.toOutputScript(funding.address, NET), BigInt(50000));
      const opened = buyerBook.open({ remotePubkey: sellerKey.pub, fundedTxHex: tx.toHex(), capacitySats: 50000, expireAfter: 5000, localAddress: buyerKey.address, remoteAddress: sellerKey.address, aliases: ['alpha'] });
      const step = () => {
        if (wire.toSeller.length) { sellerBook.ingest(wire.toSeller.shift(), { sellerId: 'buyer' }); return true; }
        if (wire.toBuyer.length) { buyerBook.ingest(wire.toBuyer.shift(), { sellerId: 'alpha' }); return true; }
        return false;
      };
      const pump = () => { while (step()); };
      pump();
      assert.strictEqual(opened.session.status, 'open');
      return { buyerBook, sellerBook, channel: opened.session, pump };
    }

    function alphaOnly (m) {
      const only = new DocumentBook();
      only.ingestInventoryResponse({ origin: 'alpha', items: [m.doc.inventoryItem({ rateSats: P, documentId: m.documentId })], latencyMs: 20 });
      return only;
    }

    it('a lost htlcSettled event is recovered from the channel\'s settled rows on tick', async function () {
      const m = buildMarket({ rateSats: P });
      m.ctl.reveal = false;
      const chain = { tip: 100 };
      const { buyerBook, sellerBook, channel, pump } = bookPair(m, chain);
      // The host's adapter forwards calls but drops every event.
      const channels = {
        sessionFor: (id, pk) => buyerBook.sessionFor(id, pk),
        get: (channelId) => buyerBook.get(channelId),
        tipHeight: () => buyerBook.tipHeight(),
        publish: (body, s) => buyerBook.publish(body, s)
      };
      const market = new Market({ budgetSats: 10 * P, perPlanMaxSats: 10 * P, tickMs: 0, book: alphaOnly(m), proximityWeight: 1 });
      market.attach({ peer: m.buyer, channels });
      market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
      let received = null;
      m.buyer.on('documentReceived', (ev) => { received = ev; });
      for (let i = 0; i < 8 && !(received && received.buffer.equals(m.plain)); i++) {
        await market.tick();
        pump();
      }
      await market.tick();
      assert.ok(received && received.buffer.equals(m.plain), 'opened from the preimages found on reconcile');
      const sessions = market.listSessions();
      assert.ok(sessions.every((s) => s.rail === 'channel' && s.status === 'complete' && s.htlcOutcome === 'fulfilled'), JSON.stringify(sessions.map((s) => [s.status, s.htlcOutcome])));
      assert.strictEqual(market.spentSats, m.doc.blobTotal * P);
      assert.strictEqual(market.lockedSats + market.reservedSats, 0);
      assert.strictEqual(channel.state.htlcs.length, 0);
      assert.strictEqual(sellerBook.get(channel.channelId).balances.localSats, m.doc.blobTotal * P);
      assert.ok(market.audit().ok);
    });

    it('an unfulfilled channel HTLC stays locked past the delivery timeout and is failed back at its expiry', async function () {
      const m = buildMarket({ rateSats: P });
      const chain = { tip: 100 };
      const clock = { t: 1e9 };
      // The seller never fulfils: its preimage source knows nothing.
      const { buyerBook, channel, pump } = bookPair(m, chain, { preimageFor: () => null });
      m.ctl.reveal = false;
      const opening = channel.balances.localSats;
      const market = new Market({ budgetSats: 10 * P, perPlanMaxSats: 10 * P, tickMs: 0, book: alphaOnly(m), proximityWeight: 1, deliveryTimeoutMs: 1000, now: () => clock.t });
      market.attach({ peer: m.buyer, channels: buyerBook });
      market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
      for (let i = 0; i < 4; i++) {
        await market.tick();
        pump();
      }
      const offered = market.listSessions().filter((s) => s.channelHtlcId);
      assert.strictEqual(offered.length, m.doc.blobTotal, JSON.stringify(market.listSessions().map((s) => [s.status, s.error])));
      assert.strictEqual(market.lockedSats, m.doc.blobTotal * P);
      clock.t += 5000;
      await market.tick();
      pump();
      assert.ok(offered.every((s) => s.status === 'delivery_pending'), 'an open HTLC is not timed out');
      assert.strictEqual(market.lockedSats, m.doc.blobTotal * P);

      market.forget(m.documentId);
      chain.tip = Math.max(...offered.map((s) => s.channelExpireAfter));
      for (let i = 0; i < 4 && market.lockedSats > 0; i++) {
        await market.tick();
        pump();
      }
      assert.ok(offered.every((s) => s.htlcOutcome === 'failed' && s.budget === 'released'), JSON.stringify(offered.map((s) => [s.status, s.htlcOutcome, s.budget])));
      assert.strictEqual(market.lockedSats, 0);
      assert.strictEqual(market.spentSats, 0);
      assert.strictEqual(channel.state.htlcs.length, 0);
      assert.strictEqual(channel.balances.localSats, opening);
      assert.ok(market.audit().ok);
    });
  });
});

describe('services/market (convergent de-dup)', function () {
  // Plaintext bytes per 2048-byte sealed blob (the GCM tag takes 16).
  const CHUNK = 2048 - Document.GCM_TAG_BYTES;

  // One seller of every document; a free request delivers the blob and its key.
  function wire (docs) {
    const buyer = new Peer({ listen: false });
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const book = new DocumentBook();
    const requested = [];
    for (const doc of docs) {
      const pub = seller.publishSealedDocument(doc, { rateSats: 0 });
      assert.ok(pub.ok, pub.error);
      book.ingestInventoryResponse({ origin: 'alpha', items: [doc.inventoryItem({ rateSats: 0, documentId: pub.documentId })] });
    }
    buyer.connections.alpha = { _writeFabric: () => {} };
    buyer.requestDocument = (id, name, reqOpts = {}) => {
      requested.push({ id, blobIndex: reqOpts.blobIndex });
      const written = [];
      seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
      seller._sendSealedBlobsToPeer(seller._getSealedBlobDocument(id), id, 'buyer', { settlementId: 't', blobIndex: reqOpts.blobIndex, revealKey: true });
      for (const buf of written) {
        const m = Message.fromBuffer(buf);
        const body = JSON.parse(m.body);
        if (m.type === 'P2P_FILE_SEND') buyer._ingestP2pFileSend({ object: body }, { name: 'alpha' }, m);
        else buyer._handleDocumentContentKeyReveal(body.object, { name: 'alpha' });
      }
      return true;
    };
    const market = new Market({ budgetSats: 0, tickMs: 0, book });
    market.attach({ peer: buyer });
    const received = {};
    buyer.on('documentReceived', (ev) => { received[ev.documentId] = ev.buffer; });
    return { buyer, seller, book, market, requested, received };
  }

  it('publishes a convergent document under its root and keeps a custom id as a label', function () {
    const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048, documentId: 'my-file' });
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const pub = seller.publishSealedDocument(doc, { rateSats: 0 });
    assert.strictEqual(pub.documentId, doc.merkleRootHex);
    assert.strictEqual(pub.label, 'my-file');
    const priv = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048, documentId: 'secret', private: true });
    assert.strictEqual(seller.publishSealedDocument(priv, { rateSats: 0 }).documentId, 'secret');
  });

  it('opens a chunk shared with a document already received instead of buying it again', async function () {
    const shared = crypto.randomBytes(CHUNK);
    const aPlain = Buffer.concat([shared, crypto.randomBytes(CHUNK)]);
    const bPlain = Buffer.concat([crypto.randomBytes(CHUNK), shared]);
    const a = Document.seal(aPlain, { chunkBytes: 2048 });
    const b = Document.seal(bPlain, { chunkBytes: 2048 });
    assert.strictEqual(a.blob(0).blobHashHex, b.blob(1).blobHashHex);
    const m = wire([a, b]);

    m.market.want(a.merkleRootHex, { blobTotal: a.blobTotal, merkleRootHex: a.merkleRootHex });
    await m.market.tick();
    assert.ok(m.received[a.merkleRootHex] && m.received[a.merkleRootHex].equals(aPlain));
    assert.ok(m.buyer.heldChunk(a.blob(0).blobHashHex, a.paymentHashFor(0)));

    m.requested.length = 0;
    m.market.want(b.merkleRootHex, { blobTotal: b.blobTotal, merkleRootHex: b.merkleRootHex });
    await m.market.tick();
    assert.deepStrictEqual(m.requested, [{ id: b.merkleRootHex, blobIndex: 0 }], 'only the new chunk is requested');
    const got = m.received[b.merkleRootHex];
    assert.ok(got && got.equals(bPlain));
    const heldSession = m.market.listSessions().find((s) => s.documentId === b.merkleRootHex && Number(s.blobIndex) === 1);
    assert.strictEqual(heldSession.held, true);
    assert.strictEqual(heldSession.status, 'complete');
    assert.strictEqual(m.market.status().wants.find((w) => w.documentId === b.merkleRootHex).status, 'complete');
    assert.ok(m.market.audit().ok);
  });

  it('buys a chunk repeated inside one document once', async function () {
    const block = crypto.randomBytes(CHUNK);
    const doc = Document.seal(Buffer.concat([block, block, block]), { chunkBytes: 2048 });
    const m = wire([doc]);
    m.market.want(doc.merkleRootHex, { blobTotal: doc.blobTotal, merkleRootHex: doc.merkleRootHex });
    await m.market.tick();
    await m.market.tick();
    assert.deepStrictEqual(m.requested.map((r) => r.blobIndex), [0]);
    assert.ok(m.received[doc.merkleRootHex].equals(Buffer.concat([block, block, block])));
  });

  it('a held chunk must match the advertised IV', function () {
    const doc = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
    const peer = new Peer({ listen: false, sealPricedDocuments: true });
    peer.publishSealedDocument(doc, { rateSats: 0 });
    const leaf = doc.blob(0);
    const opts = {
      documentId: doc.merkleRootHex,
      merkleRootHex: doc.merkleRootHex,
      blobTotal: doc.blobTotal,
      blobIndex: 0,
      blobHashHex: leaf.blobHashHex,
      paymentHashHex: leaf.paymentHashHex
    };
    assert.match(peer.adoptHeldChunk(Object.assign({}, opts, { iv: doc.blob(1).iv })).error, /iv differs/);
    assert.match(peer.adoptHeldChunk(Object.assign({}, opts, { paymentHashHex: 'ab'.repeat(32) })).error, /not held/);
    const opened = peer.adoptHeldChunk(Object.assign({}, opts, { iv: leaf.iv, proof: doc.proofFor(0) }));
    assert.ok(opened.ok, opened.error);
  });
});

describe('services/market (credit rail: pay after verify)', function () {
  const bitcoin = require('bitcoinjs-lib');
  const Channel = require('../types/channel');
  const { signerFromPriv32 } = require('../types/htlc');
  const NET = bitcoin.networks.regtest;
  const CREDIT = 50;

  function party () {
    const priv = crypto.randomBytes(32);
    const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
    return { priv, pub, address: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address };
  }

  /**
   * One seller ("alpha") selling a convergent document at P (HTLC) or CREDIT
   * (pay after verify), a channel buyer → seller, and the seller's credit
   * decided by its ChannelBook. `ctl.badKey(blobIndex)` makes the seller
   * reveal a wrong key for that blob.
   */
  function build (opts = {}) {
    const plain = crypto.randomBytes(4000);
    const doc = Document.seal(plain, { chunkBytes: 2048 });
    const buyerKey = party();
    const sellerKey = party();
    const wire = { toSeller: [], toBuyer: [] };
    const buyerBook = new ChannelBook({ localPrivateKey: buyerKey.priv, network: 'regtest', tipHeight: () => 100, publish: (body) => wire.toSeller.push(body) });
    const sellerBook = new ChannelBook({ localPrivateKey: sellerKey.priv, network: 'regtest', tipHeight: () => 100, confirmations: () => 6, publish: (body) => wire.toBuyer.push(body), creditLimitSats: opts.creditLimitSats != null ? opts.creditLimitSats : 1000 });
    const seller = new Peer({ listen: false, sealPricedDocuments: true, sealedBlobCredit: (r) => sellerBook.extendCredit(r) });
    const pub = seller.publishSealedDocument(doc, { rateSats: P, creditRateSats: CREDIT });
    assert.ok(pub.ok, pub.error);
    const buyer = new Peer(Object.assign({ listen: false }, opts.buyer || {}));
    buyer.connections.alpha = { _writeFabric: () => {} };
    const book = new DocumentBook();
    book.ingestInventoryResponse({ origin: 'alpha', items: seller._sealedBlobInventoryItems({}), latencyMs: 20 });

    const ctl = { badKey: () => false, revealed: [] };
    buyer.requestDocument = (id, name, reqOpts = {}) => {
      // What the seller's DocumentRequest handler decides for this request.
      const parsed = { document: id, blobIndex: reqOpts.blobIndex, contentHashHex: reqOpts.contentHashHex };
      if (reqOpts.credit) Object.assign(parsed, { credit: true, creditRef: reqOpts.creditRef });
      const revealKey = seller._mayRevealSealedBlobKey(id, parsed, { peerAddress: 'buyer' });
      ctl.revealed.push({ blobIndex: reqOpts.blobIndex, revealKey, credit: !!reqOpts.credit });
      const written = [];
      seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
      seller._sendSealedBlobsToPeer(seller._getSealedBlobDocument(id), id, 'buyer', { settlementId: 't', blobIndex: reqOpts.blobIndex, revealKey });
      for (const buf of written) {
        const m = Message.fromBuffer(buf);
        const body = JSON.parse(m.body);
        if (m.type === 'P2P_FILE_SEND') buyer._ingestP2pFileSend({ object: body }, { name: 'alpha' }, m);
        else {
          const reveal = ctl.badKey(Number(reqOpts.blobIndex)) ? Object.assign({}, body.object, { keyHex: crypto.randomBytes(32).toString('hex') }) : body.object;
          buyer._handleDocumentContentKeyReveal(reveal, { name: 'alpha' });
        }
      }
      return true;
    };

    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: buyerKey.pub, remotePubkey: sellerKey.pub, expireAfter: 5000 });
    tx.addOutput(bitcoin.address.toOutputScript(funding.address, NET), BigInt(50000));
    const opened = buyerBook.open({ remotePubkey: sellerKey.pub, fundedTxHex: tx.toHex(), capacitySats: 50000, expireAfter: 5000, localAddress: buyerKey.address, remoteAddress: sellerKey.address, aliases: ['alpha'] });
    const step = () => {
      if (wire.toSeller.length) { sellerBook.ingest(wire.toSeller.shift(), { sellerId: 'buyer' }); return true; }
      if (wire.toBuyer.length) { buyerBook.ingest(wire.toBuyer.shift(), { sellerId: 'alpha' }); return true; }
      return false;
    };
    const pump = () => { while (step()); };
    pump();
    assert.strictEqual(opened.session.status, 'open');
    const market = new Market({ budgetSats: 10 * P, tickMs: 0, book, proximityWeight: 1, seed: opts.seed });
    market.attach({ peer: buyer, channels: buyerBook });
    const received = [];
    buyer.on('documentReceived', (ev) => received.push(ev.buffer));
    return { plain, doc, buyer, seller, book, market, buyerBook, sellerBook, channel: opened.session, pump, ctl, received, documentId: pub.documentId };
  }

  it('advertises the credit price with paymentModes; private documents cannot take credit', function () {
    const m = build();
    const item = m.seller._sealedBlobInventoryItems({})[0];
    assert.strictEqual(item.creditRateSats, CREDIT);
    assert.deepStrictEqual(item.paymentModes, ['htlc', 'credit']);
    const priv = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048, private: true });
    assert.match(m.seller.publishSealedDocument(priv, { rateSats: P, creditRateSats: CREDIT }).error, /convergent/);
  });

  it('opens each blob on credit, then pays it with a channel transfer the seller ledger settles', async function () {
    const m = build();
    const settled = [];
    m.sellerBook.on('creditSettled', (c) => settled.push(c));
    m.market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
    assert.strictEqual(m.market.planFor(m.market.listWants()[0]).costSats, m.doc.blobTotal * CREDIT);
    for (let i = 0; i < 4 && !m.received.length; i++) {
      await m.market.tick();
      m.pump();
    }
    await m.market.tick();
    m.pump();
    assert.ok(m.received[0] && m.received[0].equals(m.plain));
    assert.ok(m.ctl.revealed.every((r) => r.credit && r.revealKey), 'keys revealed on credit before any payment');
    const sessions = m.market.listSessions();
    assert.strictEqual(sessions.length, m.doc.blobTotal);
    assert.ok(sessions.every((s) => s.rail === 'credit' && s.status === 'complete' && s.creditPaid), JSON.stringify(sessions.map((s) => [s.status, s.lastError])));
    assert.strictEqual(m.market.spentSats, m.doc.blobTotal * CREDIT);
    assert.ok(m.market.audit().ok);
    assert.strictEqual(m.sellerBook.get(m.channel.channelId).balances.localSats, m.doc.blobTotal * CREDIT);
    assert.strictEqual(m.sellerBook.outstanding(m.channel.channelId), 0);
    assert.strictEqual(settled.length, m.doc.blobTotal);
  });

  it('never pays for a blob whose revealed key does not open it, and does not ask that seller again', async function () {
    const m = build();
    m.ctl.badKey = (i) => i === 0;
    m.market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
    await m.market.tick();
    m.pump();
    await m.market.tick();
    m.pump();
    const bad = m.market.listSessions().find((s) => Number(s.blobIndex) === 0);
    assert.strictEqual(bad.status, 'fraud');
    assert.ok(!bad.creditPaid);
    assert.ok(m.market.listSessions().find((s) => Number(s.blobIndex) === 1).creditPaid);
    assert.strictEqual(m.market.spentSats, CREDIT, 'only the good blob is paid');
    assert.strictEqual(m.sellerBook.outstanding(m.channel.channelId), CREDIT, 'the seller carries the unpaid credit');
    // The lying seller is not asked for that blob again: with no other seller the plan stalls.
    assert.strictEqual(m.market.listWants()[0].status, 'wanted');
    assert.ok(m.market.audit().ok);
  });

  it('falls back to the HTLC price without a channel, and the seller refuses credit past its limit', async function () {
    const m = build({ creditLimitSats: CREDIT });
    const noChannels = new Market({ budgetSats: 10 * P, tickMs: 0, book: m.book });
    noChannels.attach({ peer: m.buyer });
    noChannels.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
    assert.strictEqual(noChannels.planFor(noChannels.listWants()[0]).costSats, m.doc.blobTotal * P);
    const refused = [];
    m.seller.on('documentBlobCredit', (ev) => { if (!ev.ok) refused.push(ev.error); });
    m.market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
    await m.market.tick();
    assert.strictEqual(m.ctl.revealed.filter((r) => r.revealKey).length, 1, 'one blob within the limit');
    assert.match(refused[0], /credit limit/);
  });

  async function buyAll (m) {
    m.market.want(m.documentId, { blobTotal: m.doc.blobTotal, merkleRootHex: m.doc.merkleRootHex });
    for (let i = 0; i < 5 && !m.received.length; i++) {
      await m.market.tick();
      m.pump();
    }
    assert.ok(m.received[0] && m.received[0].equals(m.plain));
  }

  it('seeds after download: the buyer sells the same tree from its held chunks, nothing resealed', async function () {
    const m = build({ seed: { rateSats: P, creditRateSats: CREDIT } });
    const seeded = [];
    m.market.on('seeded', (ev) => seeded.push(ev.documentId));
    await buyAll(m);
    assert.deepStrictEqual(seeded, [m.documentId]);
    const mine = m.buyer._sealedBlobInventoryItems({});
    const theirs = m.seller._sealedBlobInventoryItems({});
    assert.strictEqual(mine.length, 1);
    for (const field of ['documentId', 'merkleRootHex', 'blobTotal', 'rateSats', 'creditRateSats']) {
      assert.deepStrictEqual(mine[0][field], theirs[0][field], field);
    }
    assert.deepStrictEqual(mine[0].blobs.map((b) => [b.blobHashHex, b.paymentHashHex]), theirs[0].blobs.map((b) => [b.blobHashHex, b.paymentHashHex]));
    const held = m.buyer._getSealedBlobDocument(m.documentId);
    const sold = m.seller._getSealedBlobDocument(m.documentId);
    for (let i = 0; i < m.doc.blobTotal; i++) {
      assert.ok(held.bytesFor(i).equals(sold.bytesFor(i)));
      assert.strictEqual(held.keyFor(i), sold.keyFor(i));
    }
  });

  it('refuses to seed a tree whose chunks were evicted, and a tree it never received', async function () {
    const m = build({ buyer: { maxHeldChunkBytes: 2048 } });
    await buyAll(m);
    assert.ok(m.buyer.seedableDocument(m.documentId));
    assert.match(m.buyer.seedDocument(m.documentId, { rateSats: P }).error, /no longer held/);
    assert.match(m.buyer.seedDocument('00'.repeat(32)).error, /no convergent document/);
  });
});
