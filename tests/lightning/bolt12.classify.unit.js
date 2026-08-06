'use strict';

const assert = require('assert');
const lb = require('../../functions/lightningBolt12');
const fp = require('../../functions/fabricPaymentBech32');
const Lightning = require('../../services/lightning');

describe('@fabric/core/functions/lightningBolt12', function () {
  it('classifies lno1 as bolt12_offer', function () {
    assert.strictEqual(lb.classifyLightningEncodedString('lno1qqqqqqqqqqqq'), 'bolt12_offer');
    assert.strictEqual(lb.isBolt12OfferString('LNO1TEST'), true);
  });

  it('normalizeBolt12ScanString strips + continuations per BOLT12 § Encoding', function () {
    assert.strictEqual(
      lb.normalizeBolt12ScanString('lno1xxxx+\nyyyyyyyyyyyy+\nzzzzzz'),
      'lno1xxxxyyyyyyyyyyyyzzzzzz'
    );
    assert.strictEqual(lb.normalizeBolt12ScanString('  '), '');
    assert.strictEqual(lb.classifyLightningEncodedString('lno1aa+\nbb'), 'bolt12_offer');
  });

  it('classifies lnr1 as bolt12_invoice_request', function () {
    assert.strictEqual(lb.classifyLightningEncodedString('lnr1qqqqqqqqqqqq'), 'bolt12_invoice_request');
    assert.strictEqual(lb.isBolt12InvoiceRequestString('lnr1x'), true);
  });

  it('classifies common bolt11 HRPs', function () {
    assert.strictEqual(lb.classifyLightningEncodedString('lnbc1qqqq'), 'bolt11_invoice');
    assert.strictEqual(lb.classifyLightningEncodedString('lntb1qqqq'), 'bolt11_invoice');
    assert.strictEqual(lb.classifyLightningEncodedString('lnbcrt1qqqq'), 'bolt11_invoice');
    assert.strictEqual(lb.isLikelyBolt11InvoiceString('lnbc1'), true);
  });

  it('returns empty or unknown appropriately', function () {
    assert.strictEqual(lb.classifyLightningEncodedString(''), 'empty');
    assert.strictEqual(lb.classifyLightningEncodedString('   '), 'empty');
    assert.strictEqual(lb.classifyLightningEncodedString('notlightning'), 'unknown');
  });

  it('isBolt12OfferString and isLikelyBolt11InvoiceString edge cases', function () {
    assert.strictEqual(lb.isBolt12OfferString('lnr1qqqq'), false);
    assert.strictEqual(lb.isLikelyBolt11InvoiceString('lnbc'), false);
    assert.strictEqual(lb.isLikelyBolt11InvoiceString('lnbc1'), true);
    assert.strictEqual(lb.isLikelyBolt11InvoiceString('lnsb1qq'), true);
  });

  it('FabricLightningOfferRole has expected keys', function () {
    assert.deepStrictEqual(Object.keys(lb.FabricLightningOfferRole).sort(), [
      'fabric_document_commerce',
      'fabric_peer_handshake',
      'lightning_bolt12_invoice_request',
      'lightning_bolt12_offer'
    ]);
  });

  it('exports BOLT11_INVOICE_HRPS', function () {
    assert.ok(Array.isArray(lb.BOLT11_INVOICE_HRPS));
    assert.ok(lb.BOLT11_INVOICE_HRPS.includes('lnbc'));
  });

  it('FabricLightningMarketRole aliases FabricLightningOfferRole', function () {
    assert.strictEqual(lb.FabricLightningMarketRole, lb.FabricLightningOfferRole);
    assert.strictEqual(lb.FabricLightningMarketRole.lightning_bolt12_offer, 'lightning_bolt12_offer');
  });
});

describe('@fabric/core/services/lightning Bolt12 bridge', function () {
  it('Lightning.Bolt12 re-exports lightningBolt12', function () {
    assert.strictEqual(Lightning.Bolt12, lb);
    assert.strictEqual(Lightning.Bolt12.classifyLightningEncodedString('lno1x'), 'bolt12_offer');
  });

  it('Lightning.FabricPayment re-exports fabricPaymentBech32', function () {
    assert.strictEqual(Lightning.FabricPayment, fp);
  });

  it('Lightning.DOCS includes fabricLightningMarkets, fabricLightningOffers, fabricPaymentBech32', function () {
    assert.strictEqual(Lightning.DOCS.fabricLightningOffers, 'docs/FABRIC_LIGHTNING_OFFERS.md');
    assert.strictEqual(Lightning.DOCS.fabricLightningMarkets, Lightning.DOCS.fabricLightningOffers);
    assert.strictEqual(Lightning.DOCS.fabricPaymentBech32, 'docs/FABRIC_PAYMENT_BECH32.md');
  });
});
