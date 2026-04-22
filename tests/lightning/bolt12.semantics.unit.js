'use strict';

const assert = require('assert');
const bs = require('../../functions/bolt12Semantics');

describe('@fabric/core/functions/bolt12Semantics', function () {
  it('classifyDecodedBolt12 recognizes CLN-style type strings', function () {
    assert.strictEqual(bs.classifyDecodedBolt12({ type: 'bolt12 offer' }), bs.Bolt12StreamKind.bolt12_offer);
    assert.strictEqual(
      bs.classifyDecodedBolt12({ type: 'bolt12 invoice_request' }),
      bs.Bolt12StreamKind.bolt12_invoice_request
    );
    assert.strictEqual(
      bs.classifyDecodedBolt12({ type: 'bolt12 invoice' }),
      bs.Bolt12StreamKind.bolt12_invoice
    );
    assert.strictEqual(
      bs.classifyDecodedBolt12({ type: 'bolt11 invoice' }),
      bs.Bolt12StreamKind.bolt11_invoice
    );
    assert.strictEqual(bs.classifyDecodedBolt12(null), bs.Bolt12StreamKind.unknown);
  });

  it('bip340SignatureApplies only for invoice_request and invoice', function () {
    assert.strictEqual(bs.bip340SignatureApplies(bs.Bolt12StreamKind.bolt12_offer), false);
    assert.strictEqual(bs.bip340SignatureApplies(bs.Bolt12StreamKind.bolt12_invoice_request), true);
    assert.strictEqual(bs.bip340SignatureApplies(bs.Bolt12StreamKind.bolt12_invoice), true);
  });

  it('summarizeBolt12RecurrenceFromDecode collects known keys', function () {
    const decoded = {
      offer_recurrence: { period: 7, time_unit: 1 },
      invreq_recurrence_counter: 2,
      invoice_recurrence_basetime: 1700000000
    };
    const sum = bs.summarizeBolt12RecurrenceFromDecode(decoded);
    assert.ok(sum);
    assert.strictEqual(sum.invreq_recurrence_counter, 2);
    assert.ok(sum.offer_recurrence);
  });

  it('BOLT12_TLV aliases CLN_BOLT12_TLV', function () {
    assert.strictEqual(bs.BOLT12_TLV, bs.CLN_BOLT12_TLV);
  });

  it('CLN_BOLT12_TLV exposes recurrence and BOLT #12 invoice_request / invoice TLV ids', function () {
    assert.strictEqual(bs.CLN_BOLT12_TLV.OFFER_RECURRENCE_COMPULSORY, 24);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVREQ_FEATURES, 84);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVREQ_PAYER_NOTE, 89);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVREQ_PATHS, 90);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVREQ_BIP353_NAME, 91);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVREQ_RECURRENCE_COUNTER, 92);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVOICE_RELATIVE_EXPIRY, 166);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVOICE_FALLBACKS, 172);
    assert.strictEqual(bs.CLN_BOLT12_TLV.INVOICE_FEATURES, 174);
    assert.strictEqual(bs.CLN_BOLT12_TLV.SIGNATURE_MIN, 240);
  });
});
