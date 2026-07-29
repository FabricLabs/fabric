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
} = require('../functions/documentExchange');
const { DocumentOfferBook } = require('../functions/documentOfferBook');

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

  it('buy opens a session from the offer book without double-pay', function () {
    const book = new DocumentOfferBook();
    book.ingestInventoryResponse({
      origin: 'seller1',
      peerScore: 1,
      latencyMs: 10,
      items: [{
        id: 'doc-a',
        rateSats: 100,
        contentHash: 'aa'.repeat(32),
        htlc: {
          paymentAddress: 'bcrt1qtest',
          paymentHashHex: 'aa'.repeat(32),
          bitcoinUri: 'bitcoin:bcrt1qtest?amount=0.00000100'
        }
      }]
    });
    const exchange = new CliDocumentExchange({
      offerBook: book,
      getPeer: () => ({ settings: {}, key: null }),
      getSettings: () => ({ network: 'regtest' }),
      getNetworkName: () => 'regtest',
      getWallet: () => null
    });

    const first = exchange.buy('doc-a', 'auto');
    assert.ok(first.ok, first.error);
    assert.ok(first.session);
    assert.strictEqual(first.session.amountSats, 100);
    assert.strictEqual(exchange.purchaseSessions.size, 1);

    const dup = exchange.buy('doc-a', 'auto');
    assert.ok(!dup.ok);
    assert.match(dup.error, /Open session already exists|Already settled/);
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
  });
});
