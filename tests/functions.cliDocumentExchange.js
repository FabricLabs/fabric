'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CliDocumentExchange,
  DOCUMENT_EXCHANGE_CLI_PACKS,
  listDocumentExchangeCliContracts,
  listDocumentExchangeCommands
} = require('../functions/cliDocumentExchange');
const { DocumentOfferBook } = require('../functions/documentMarket');
const { createDocumentPurchaseSession } = require('../functions/documentMarket');

describe('functions/cliDocumentExchange (headless CLI surface)', function () {
  it('catalog exposes documents + documents-market packs and commands', function () {
    assert.deepStrictEqual(DOCUMENT_EXCHANGE_CLI_PACKS, ['documents', 'documents-market']);
    const packs = listDocumentExchangeCliContracts();
    assert.strictEqual(packs.length, 2);
    const cmds = listDocumentExchangeCommands();
    for (const required of [
      'import', 'publish', 'inventory',
      'offers', 'buy', 'confirm', 'claimwatch', 'refund', 'refunds'
    ]) {
      assert.ok(cmds.includes(required), `missing command ${required}`);
    }
  });

  it('importFile + publish (rate 0) sync into peer document store', function () {
    const tmp = path.join(os.tmpdir(), `fabric-doc-ex-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'hello fabric document exchange');
    const peerState = { content: { documents: {}, documentRates: {} } };
    const published = [];
    const peer = {
      _state: peerState,
      settings: {},
      _publishDocument (id, body, rate) {
        published.push({ id, body, rate });
      }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => peer,
      getFilesystem: () => null,
      getSettings: () => ({ network: 'regtest' }),
      getNetworkName: () => 'regtest'
    });

    const imported = exchange.importFile(tmp);
    assert.ok(imported.ok, imported.error);
    assert.ok(imported.data.documentId);
    assert.ok(exchange.documents[imported.data.documentId]);
    assert.strictEqual(
      peerState.content.documents[imported.data.documentId],
      'hello fabric document exchange'
    );

    const pub = exchange.publish(imported.data.documentId, 0);
    assert.ok(pub.ok, pub.error);
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].rate, 0);
    fs.unlinkSync(tmp);
  });

  it('importFile rejects empty, missing, and cwd-escaping relative paths', function () {
    const exchange = new CliDocumentExchange({});
    assert.strictEqual(exchange.importFile('').ok, false);
    assert.strictEqual(exchange.importFile(null).ok, false);
    assert.strictEqual(exchange.importFile('/no/such/fabric-import-' + Date.now()).ok, false);
    // Relative escape of cwd (when path would resolve outside).
    const escape = exchange.importFile(path.join('..', '..', 'etc', 'passwd'));
    // On some layouts this may resolve to an absolute path outside cwd → rejected;
    // if the file happens to exist as absolute, still must not throw.
    assert.ok(escape && typeof escape.ok === 'boolean');
    if (!path.isAbsolute(path.join('..', '..', 'etc', 'passwd'))) {
      // relative form under resolveImportFilePath must refuse cwd escape
      assert.strictEqual(escape.ok, false);
    }
  });

  it('publish validates args and peer readiness', function () {
    const exchange = new CliDocumentExchange({
      getPeer: () => null
    });
    assert.ok(!exchange.publish('', 0).ok);
    assert.ok(!exchange.publish('missing-id', null).ok);
    exchange.documents['doc1'] = Buffer.from('x');
    assert.ok(!exchange.publish('doc1', -1).ok);
    assert.ok(!exchange.publish('doc1', 1).ok); // peer not ready
  });

  it('buy opens a session from the offer book without double-pay', function () {
    const Key = require('../types/key');
    const inventoryHtlc = require('../functions/inventoryHtlc');
    const seller = new Key();
    const buyer = new Key();
    const contentHash = 'aa'.repeat(32);
    const lock = 900_000;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: Buffer.from(String(seller.pubkey), 'hex'),
      buyerRefundPubkeyCompressed: Buffer.from(String(buyer.pubkey), 'hex'),
      paymentHash32: Buffer.from(contentHash, 'hex'),
      refundLocktimeHeight: lock
    });
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller1',
      sellerPubkey: String(seller.pubkey).toLowerCase(),
      peerScore: 1,
      latencyMs: 10,
      items: [{
        id: 'doc-a',
        rateSats: 100,
        contentHash,
        sellerPubkey: String(seller.pubkey).toLowerCase(),
        htlc: {
          paymentAddress: built.address,
          paymentHashHex: contentHash
        }
      }]
    });
    const buyerPeerKey = {
      public: {
        encodeCompressed (enc) {
          return enc === 'hex' ? String(buyer.pubkey).toLowerCase() : Buffer.from(String(buyer.pubkey), 'hex');
        }
      }
    };
    const exchange = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({
        settings: { inventoryHtlcLocktimeHeight: lock },
        key: buyerPeerKey,
        peers: {
          seller1: { id: 'seller1', publicKey: String(seller.pubkey).toLowerCase() }
        }
      }),
      getSettings: () => ({ network: 'regtest' }),
      getNetworkName: () => 'regtest',
      getWallet: () => null
    });

    const refuse = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({ settings: {}, key: null }),
      getWallet: () => null,
      getNetworkName: () => 'regtest'
    });
    const poisoned = refuse.buy('doc-a', 'auto');
    assert.ok(!poisoned.ok);
    assert.match(poisoned.error, /buyer-bound HTLC|seller pubkey/i);

    const first = exchange.buy('doc-a', 'auto');
    assert.ok(first.ok, first.error);
    assert.ok(first.session);
    assert.strictEqual(first.session.amountSats, 100);
    assert.strictEqual(first.session.paymentAddress, built.address);
    assert.strictEqual(exchange.purchaseSessions.size, 1);

    const dup = exchange.buy('doc-a', 'auto');
    assert.ok(!dup.ok);
    assert.match(dup.error, /Open session already exists|Already settled/);
  });

  it('buy refuses seller HTLC address that does not match buyer-bound script', function () {
    const Key = require('../types/key');
    const seller = new Key();
    const buyer = new Key();
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller1',
      sellerPubkey: String(seller.pubkey).toLowerCase(),
      items: [{
        id: 'doc-evil',
        rateSats: 50,
        contentHash: 'bb'.repeat(32),
        sellerPubkey: String(seller.pubkey).toLowerCase(),
        htlc: { paymentAddress: 'bcrt1qattackercontrolledxxxxxxxxxxxxxxxxxxxxxxxxx' }
      }]
    });
    const exchange = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({
        settings: { inventoryHtlcLocktimeHeight: 900_000 },
        key: {
          public: {
            encodeCompressed (enc) {
              return enc === 'hex' ? String(buyer.pubkey).toLowerCase() : Buffer.from(String(buyer.pubkey), 'hex');
            }
          }
        },
        peers: { seller1: { id: 'seller1', publicKey: String(seller.pubkey).toLowerCase() } }
      }),
      getNetworkName: () => 'regtest',
      getWallet: () => null
    });
    const bad = exchange.buy('doc-evil', 'auto');
    assert.ok(!bad.ok);
    assert.match(bad.error, /does not match buyer-bound/i);
  });

  it('listOffers ranks ingested inventory rows', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'a',
      peerScore: 2,
      latencyMs: 5,
      items: [{ id: 'd1', rateSats: 50, contentHash: 'bb'.repeat(32) }]
    });
    book.ingestInventoryResponse({
      origin: 'b',
      peerScore: 1,
      latencyMs: 20,
      items: [{ id: 'd1', rateSats: 40, contentHash: 'cc'.repeat(32) }]
    });
    const exchange = new CliDocumentExchange({ offerBook: book });
    const result = exchange.listOffers('d1');
    assert.ok(result.ok);
    assert.ok(result.offers.length >= 2);
    assert.match(result.message, /Document offers/);
    const empty = exchange.listOffers('missing');
    assert.ok(empty.ok);
    assert.strictEqual(empty.offers.length, 0);
  });

  it('requestInventory lists local catalog and forwards remote requests', function () {
    const pending = [{ documentId: 'x' }];
    let requested = null;
    const peer = {
      _state: { content: { documentRates: {} } },
      listPendingDocumentRequests () { return pending; },
      requestPeerInventory (ref, opts) {
        requested = { ref, opts };
        return true;
      }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => peer
    });
    exchange.documents.abc = Buffer.from('hi');
    const local = exchange.requestInventory(null);
    assert.ok(local.ok);
    assert.ok(local.data.local);
    assert.strictEqual(local.data.pendingCount, 1);

    const remote = exchange.requestInventory('peer:1', { offerBtc: true });
    assert.ok(remote.ok);
    assert.strictEqual(requested.ref, 'peer:1');
    assert.strictEqual(requested.opts.offerBtc, true);

    peer.requestPeerInventory = () => false;
    assert.ok(!exchange.requestInventory('peer:2').ok);
  });

  it('confirm marks session delivery_pending and requests the document', async function () {
    const txid = 'ab'.repeat(32);
    const session = createDocumentPurchaseSession({
      documentId: 'doc-c',
      seller: 'seller:1',
      contentHashHex: 'cd'.repeat(32),
      amountSats: 0,
      paymentAddress: '',
      network: 'regtest'
    });
    let requested = null;
    const peer = {
      settings: {},
      blobTransfers: null,
      requestDocument (id, seller, opts) {
        requested = { id, seller, opts };
        return true;
      }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => peer,
      getBitcoin: () => null,
      getSettings: () => ({})
    });
    exchange.purchaseSessions.set(session.settlementId, session);

    const bad = await exchange.confirm(null, null);
    assert.ok(!bad.ok);
    const missing = await exchange.confirm('nope', txid);
    assert.ok(!missing.ok);
    const badTx = await exchange.confirm(session.settlementId, 'zz');
    assert.ok(!badTx.ok);

    const ok = await exchange.confirm(session.settlementId, txid);
    assert.ok(ok.ok, ok.error);
    assert.strictEqual(session.status, 'delivery_pending');
    assert.strictEqual(requested.id, 'doc-c');
    assert.strictEqual(requested.seller, 'seller:1');

    const again = await exchange.confirm(session.settlementId, txid);
    assert.ok(!again.ok);
    assert.match(again.error, /Already confirmed/);
  });

  it('confirm verifies L1 payment amount when bitcoind is available', async function () {
    const txid = '11'.repeat(32);
    const session = createDocumentPurchaseSession({
      documentId: 'doc-pay',
      seller: 'seller:1',
      contentHashHex: '22'.repeat(32),
      amountSats: 5000,
      paymentAddress: 'bcrt1qpayme',
      network: 'regtest'
    });
    const notices = [];
    const bitcoin = {
      async _makeRPCRequest (method, params) {
        if (method === 'getrawtransaction' && params[1] === true) {
          return {
            vout: [{
              value: 0.00005,
              scriptPubKey: { address: 'bcrt1qpayme' }
            }]
          };
        }
        if (method === 'getrawtransaction') return '00';
        return null;
      }
    };
    const peer = {
      settings: {},
      requestDocument () { return true; }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => peer,
      getBitcoin: () => bitcoin,
      getSettings: () => ({}),
      onNotice: (m) => notices.push(m)
    });
    exchange.purchaseSessions.set(session.settlementId, session);
    const ok = await exchange.confirm(session.settlementId, txid);
    assert.ok(ok.ok, ok.error);
    assert.ok(notices.some((n) => /L1 verified/.test(n)));

    const short = createDocumentPurchaseSession({
      documentId: 'doc-short',
      seller: 'seller:1',
      contentHashHex: '33'.repeat(32),
      amountSats: 9000,
      paymentAddress: 'bcrt1qpayme',
      network: 'regtest'
    });
    exchange.purchaseSessions.set(short.settlementId, short);
    const fail = await exchange.confirm(short.settlementId, txid);
    assert.ok(!fail.ok);
    assert.match(fail.error, /insufficient/);
  });

  it('confirm fails closed when paid L1 verify is missing or throws', async function () {
    const txid = '12'.repeat(32);
    const session = createDocumentPurchaseSession({
      documentId: 'doc-failclose',
      seller: 'seller:1',
      contentHashHex: '34'.repeat(32),
      amountSats: 1000,
      paymentAddress: 'bcrt1qfailclose',
      network: 'regtest'
    });
    const peer = { settings: {}, requestDocument () { return true; } };

    const noBtc = new CliDocumentExchange({
      getPeer: () => peer,
      getBitcoin: () => null,
      getSettings: () => ({})
    });
    noBtc.purchaseSessions.set(session.settlementId, session);
    const missing = await noBtc.confirm(session.settlementId, txid);
    assert.ok(!missing.ok);
    assert.match(missing.error, /L1 verify required|bitcoind|hubRpcUrl/i);
    assert.notStrictEqual(session.status, 'delivery_pending');
    assert.notStrictEqual(session.status, 'confirmed');

    const session2 = createDocumentPurchaseSession({
      documentId: 'doc-failclose-2',
      seller: 'seller:1',
      contentHashHex: '35'.repeat(32),
      amountSats: 1000,
      paymentAddress: 'bcrt1qfailclose',
      network: 'regtest'
    });
    const throwing = new CliDocumentExchange({
      getPeer: () => peer,
      getBitcoin: () => ({
        async _makeRPCRequest () { throw new Error('rpc down'); }
      }),
      getSettings: () => ({})
    });
    throwing.purchaseSessions.set(session2.settlementId, session2);
    const failed = await throwing.confirm(session2.settlementId, txid);
    assert.ok(!failed.ok);
    assert.match(failed.error, /L1 verify failed/);
    assert.ok(!throwing.paidSettlements.has(session2.dedupeKey));
  });

  it('claimWatch requires claim txid or hub reveal; refuses refunded sessions', async function () {
    const session = createDocumentPurchaseSession({
      documentId: 'doc-claim',
      seller: 'seller:1',
      contentHashHex: '44'.repeat(32),
      amountSats: 1,
      paymentAddress: 'bcrt1q',
      network: 'regtest'
    });
    const exchange = new CliDocumentExchange({
      getPeer: () => ({}),
      getBitcoin: () => null,
      getSettings: () => ({})
    });
    exchange.purchaseSessions.set(session.settlementId, session);
    assert.ok(!(await exchange.claimWatch(null)).ok);
    assert.ok(!(await exchange.claimWatch('missing')).ok);
    const needTx = await exchange.claimWatch(session.settlementId);
    assert.ok(!needTx.ok);
    assert.match(needTx.error, /claimTxid|claimwatch/i);

    session.status = 'refunded';
    const refused = await exchange.claimWatch(session.settlementId, '55'.repeat(32));
    assert.ok(!refused.ok);

    session.status = 'complete';
    const done = await exchange.claimWatch(session.settlementId);
    assert.ok(done.ok);
  });

  it('refund and listRefunds handle maturity / missing HTLC', async function () {
    const session = createDocumentPurchaseSession({
      documentId: 'doc-ref',
      seller: 'seller:1',
      contentHashHex: '66'.repeat(32),
      amountSats: 1000,
      paymentAddress: 'bcrt1qrefund',
      network: 'regtest',
      htlc: {
        paymentAddress: 'bcrt1qrefund',
        claimScriptHex: '51',
        refundScriptHex: '52',
        refundLocktimeHeight: 200
      }
    });
    session.status = 'confirmed';
    session.txid = '77'.repeat(32);
    const bitcoin = {
      async _makeRPCRequest (method) {
        if (method === 'getblockchaininfo') return { blocks: 50 };
        return null;
      }
    };
    const exchange = new CliDocumentExchange({
      getPeer: () => ({ settings: {} }),
      getBitcoin: () => bitcoin,
      getSettings: () => ({}),
      getNetworkName: () => 'regtest'
    });
    exchange.purchaseSessions.set(session.settlementId, session);

    assert.ok(!(await exchange.refund(null)).ok);
    const immature = await exchange.refund(session.settlementId);
    assert.ok(!immature.ok);
    assert.match(immature.error, /not mature|Missing fundedTxHex|Need local bitcoind/);

    const listed = await exchange.listRefunds('all');
    assert.ok(listed.ok);
    assert.ok(Array.isArray(listed.rows));

    const badFilter = await exchange.listRefunds('nope');
    assert.ok(!badFilter.ok);

    session.status = 'complete';
    assert.ok(!(await exchange.refund(session.settlementId)).ok);
  });

  it('buy auto opens a multi-blob plan when blobTotal > 1', function () {
    const Key = require('../types/key');
    const inventoryHtlc = require('../functions/inventoryHtlc');
    const seller = new Key();
    const buyer = new Key();
    const contentHash = 'ee'.repeat(32);
    const lock = 900_000;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: Buffer.from(String(seller.pubkey), 'hex'),
      buyerRefundPubkeyCompressed: Buffer.from(String(buyer.pubkey), 'hex'),
      paymentHash32: Buffer.from(contentHash, 'hex'),
      refundLocktimeHeight: lock
    });
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller-blobs',
      sellerPubkey: String(seller.pubkey).toLowerCase(),
      peerScore: 5,
      latencyMs: 5,
      items: [{
        id: 'doc-multi',
        rateSats: 10,
        contentHash,
        sealed: true,
        blobs: [
          { index: 0, total: 2, blobHashHex: 'f1'.repeat(32), rateSats: 10 },
          { index: 1, total: 2, blobHashHex: 'f2'.repeat(32), rateSats: 10 }
        ],
        merkleRootHex: 'f3'.repeat(32),
        htlc: { paymentAddress: built.address, paymentHashHex: contentHash }
      }]
    });
    const exchange = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({
        settings: { inventoryHtlcLocktimeHeight: lock },
        key: {
          public: {
            encodeCompressed (enc) {
              return enc === 'hex' ? String(buyer.pubkey).toLowerCase() : Buffer.from(String(buyer.pubkey), 'hex');
            }
          }
        },
        peers: {
          'seller-blobs': { id: 'seller-blobs', publicKey: String(seller.pubkey).toLowerCase() }
        }
      }),
      getSettings: () => ({ network: 'regtest' }),
      getNetworkName: () => 'regtest',
      getWallet: () => null
    });
    const plan = exchange.buy('doc-multi', 'auto');
    assert.ok(plan.ok, plan.error);
    assert.ok(plan.sessions && plan.sessions.length === 2);
    assert.match(plan.message, /Buy plan/);
  });

  it('confirm via Hub RPC marks session confirmed', async function () {
    const session = createDocumentPurchaseSession({
      documentId: 'doc-hub',
      seller: 'seller:hub',
      contentHashHex: '99'.repeat(32),
      amountSats: 1,
      paymentAddress: 'bcrt1qhub',
      network: 'regtest'
    });
    const prevFetch = global.fetch;
    global.fetch = async () => ({
      async json () {
        return { result: { ok: true, settlementId: session.settlementId } };
      }
    });
    try {
      const exchange = new CliDocumentExchange({
        getPeer: () => ({ settings: {} }),
        getSettings: () => ({ hubRpcUrl: 'http://127.0.0.1:9' })
      });
      exchange.purchaseSessions.set(session.settlementId, session);
      const ok = await exchange.confirm(session.settlementId, 'aa'.repeat(32));
      assert.ok(ok.ok, ok.error);
      assert.strictEqual(session.status, 'confirmed');
      assert.match(ok.message, /Hub confirmed/);
    } finally {
      global.fetch = prevFetch;
    }
  });

  it('listRefunds reports empty outstanding set', async function () {
    const exchange = new CliDocumentExchange({
      getBitcoin: () => ({
        async _makeRPCRequest (method) {
          if (method === 'getblockchaininfo') return { blocks: 1 };
          return null;
        }
      })
    });
    const empty = await exchange.listRefunds('outstanding');
    assert.ok(empty.ok);
    assert.strictEqual(empty.rows.length, 0);
    assert.match(empty.message, /No outstanding refunds/);
  });

  it('formatLocalInventory and buyer helpers tolerate missing peer', function () {
    const empty = new CliDocumentExchange({});
    assert.match(empty.formatLocalInventory(), /empty/);
    assert.strictEqual(empty.buyerRefundPubkeyHex(), null);
    assert.strictEqual(empty.buyerPrivateKey32(), null);

    const key = {
      public: { encodeCompressed () { return '02' + 'ab'.repeat(32); } },
      private: Buffer.alloc(32, 9)
    };
    const withPeer = new CliDocumentExchange({
      getPeer: () => ({
        key,
        _state: { content: { documentRates: { d: 7 } } }
      })
    });
    withPeer.documents.d = Buffer.from('abc');
    assert.match(withPeer.formatLocalInventory(), /rate=7/);
    assert.strictEqual(withPeer.buyerRefundPubkeyHex().length, 66);
    assert.strictEqual(withPeer.buyerPrivateKey32().length, 32);
  });
});

describe('@fabric/core/functions/contractSidechainLocal path hardening', function () {
  const local = require('../functions/contractSidechainLocal');

  it('rejects path-traversal contract ids and contains under storeRoot', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-csl-sec-'));
    assert.throws(() => local.storePathsForLocalContract('../evil', root));
    assert.throws(() => local.storePathsForLocalContract('a/b', root));
    assert.throws(() => local.storePathsForLocalContract('a\\b', root));
    const id = 'ab'.repeat(32);
    const paths = local.storePathsForLocalContract(id, root);
    assert.ok(paths.state.startsWith(path.resolve(root)));
    assert.ok(paths.state.endsWith(path.join('sidechains', id, 'STATE.json')));
  });

  it('rejects invalid storeRoot and recovers from corrupt STATE.json', function () {
    const id = 'ef'.repeat(32);
    assert.throws(() => local.storePathsForLocalContract(id, null));
    assert.throws(() => local.storePathsForLocalContract(id, ''));
    assert.throws(() => local.storePathsForLocalContract(id, 'bad\0root'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-csl-bad-'));
    const ensured = local.ensureLocalContractChain(root, id);
    fs.writeFileSync(ensured.paths.state, '{not-json');
    const recovered = local.loadState(root, id);
    assert.strictEqual(recovered.clock, 0);
    assert.deepStrictEqual(recovered.content, {});
    // Second ensure is not created
    const again = local.ensureLocalContractChain(root, id);
    assert.strictEqual(again.created, false);
    assert.strictEqual(local.storePathsForContract, local.storePathsForLocalContract);
  });
});
