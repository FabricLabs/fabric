'use strict';

const assert = require('assert');
const Htlc = require('../types/htlc');
const { encodeBitcoinUri, parseBitcoinUri } = require('../functions/bip21');

describe('@fabric/core/functions/bip21', function () {
  it('encodes amount and label like inventory HTLC funding hints', function () {
    const uri = encodeBitcoinUri({
      address: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amount: '0.00100000',
      label: 'Test doc'
    });
    assert.ok(uri.startsWith('bitcoin:bcrt1'));
    assert.ok(uri.includes('amount=0.00100000'));
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.address, 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr');
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('round-trips opaque BIP-321 extras (lightning, pj)', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { lightning: 'lnbc1qq', pj: 'https://example.test/pj' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.strictEqual(parsed.extras.pj, 'https://example.test/pj');
  });

  it('is used by Htlc.fundingHints', function () {
    const h = Htlc.fundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100000,
      label: 'Test doc'
    });
    const parsed = parseBitcoinUri(h.bitcoinUri);
    assert.strictEqual(parsed.amount, '0.00100000');
    assert.strictEqual(parsed.label, 'Test doc');
  });

  it('parses official BIP-21 examples (address, amount, label, message)', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    const bare = parseBitcoinUri(`bitcoin:${addr}`);
    assert.strictEqual(bare.address, addr);
    assert.strictEqual(bare.amount, null);
    const paid = parseBitcoinUri(`bitcoin:${addr}?amount=20.3&label=Luke-Jr`);
    assert.strictEqual(paid.amount, '20.3');
    assert.strictEqual(paid.label, 'Luke-Jr');
    const msg = parseBitcoinUri(
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(msg.message, 'Donation for project xyz');
    const upper = parseBitcoinUri(`BITCOIN:${addr}`);
    assert.strictEqual(upper.address, addr);
    const slash = parseBitcoinUri(`bitcoin://${addr}?amount=1`);
    assert.strictEqual(slash.address, addr);
    assert.strictEqual(slash.amount, '1');
  });

  it('encodes message and address-only URIs; extras cannot override amount', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      amount: 1,
      extras: { amount: '9', lightning: 'lnbc1qq', unused: '' }
    });
    const parsed = parseBitcoinUri(uri);
    assert.strictEqual(parsed.amount, '1.00000000');
    assert.strictEqual(parsed.extras.lightning, 'lnbc1qq');
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed.extras, 'unused'));
    assert.strictEqual(
      encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
      'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    );
    const withMsg = encodeBitcoinUri({
      address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
      message: 'Donation for project xyz'
    });
    assert.strictEqual(parseBitcoinUri(withMsg).message, 'Donation for project xyz');
  });

  it('percent-encodes per RFC 3986: space is %20 and + is a literal plus', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    assert.strictEqual(
      encodeBitcoinUri({ address: addr, amount: '50', label: 'Luke-Jr', message: 'Donation for project xyz' }),
      `bitcoin:${addr}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`
    );
    assert.strictEqual(parseBitcoinUri(`bitcoin:${addr}?label=a+b`).label, 'a+b');
    const plus = encodeBitcoinUri({ address: addr, label: 'C++ & co = 100%' });
    assert.ok(plus.endsWith('label=C%2B%2B%20%26%20co%20%3D%20100%25'));
    assert.strictEqual(parseBitcoinUri(plus).label, 'C++ & co = 100%');
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?label=%E0%A4%A`), /percent-encoding/);
  });

  it('parses the BIP-321 examples (case-insensitive keys, repeated and empty-address forms)', function () {
    const upper = parseBitcoinUri('BITCOIN:BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ?BC=BC1P5SWKUGEZN97763TL0YTY6556856UUG0Q6JFLLJVEP9M4P7339X5QZYRH4Q');
    assert.strictEqual(upper.address, 'BC1QUFGY354J3KMVUCH987XE4S40836X3H0LG8F5NQ');
    assert.strictEqual(upper.extras.bc, 'BC1P5SWKUGEZN97763TL0YTY6556856UUG0Q6JFLLJVEP9M4P7339X5QZYRH4Q');
    const two = parseBitcoinUri('bitcoin:?bc=bc1qufgy354j3kmvuch987xe4s40836x3h0lg8f5nq&bc=bc1p5swkugezn97763tl0yty6556856uug0q6jflljvep9m4p7339x5qzyrh4q');
    assert.strictEqual(two.address, '');
    assert.deepStrictEqual(two.extras.bc, [
      'bc1qufgy354j3kmvuch987xe4s40836x3h0lg8f5nq',
      'bc1p5swkugezn97763tl0yty6556856uug0q6jflljvep9m4p7339x5qzyrh4q'
    ]);
    assert.strictEqual(parseBitcoinUri('bitcoin:?lightning=lnbc420bogusinvoice').extras.lightning, 'lnbc420bogusinvoice');
    const offers = parseBitcoinUri('bitcoin:?lno=lno1bogusoffer&sp=sp1qsilentpayment');
    assert.strictEqual(offers.extras.lno, 'lno1bogusoffer');
    assert.strictEqual(offers.extras.sp, 'sp1qsilentpayment');
    const shouted = parseBitcoinUri('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?AMOUNT=20.3&Label=Luke-Jr');
    assert.strictEqual(shouted.amount, '20.3');
    assert.strictEqual(shouted.label, 'Luke-Jr');
    const unknown = parseBitcoinUri('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?somethingyoudontunderstand=50&somethingelseyoudontget=999');
    assert.strictEqual(unknown.extras.somethingyoudontunderstand, '50');
  });

  it('rejects the BIP-321 invalid URIs', function () {
    const addr = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?label=Luke-Jr&label=Matt`), /twice: label/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?amount=42&amount=10`), /twice: amount/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?amount=42&amount=42`), /twice: amount/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?pop=callback%3a&req-pop=callback%3a`), /req-pop/);
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?req-pop=https%3aevilwebsite.com`), /req-pop/);
    assert.throws(
      () => parseBitcoinUri(`bitcoin:${addr}?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999`),
      /unsupported required/
    );
    assert.throws(() => parseBitcoinUri(`bitcoin:${addr}?pj=https://a.test/pj&pj=https://b.test/pj`), /twice: pj/);
    assert.throws(() => parseBitcoinUri('bitcoin:'), /address or a payment instruction/);
    assert.throws(() => parseBitcoinUri('bitcoin:?label=nobody'), /address or a payment instruction/);
  });

  it('repeats array extras and keeps __proto__ a plain key', function () {
    const uri = encodeBitcoinUri({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      extras: { bc: ['bc1qa', 'bc1pb'], LABEL: 'ignored' }
    });
    assert.strictEqual(uri, 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?bc=bc1qa&bc=bc1pb');
    const parsed = parseBitcoinUri('bitcoin:bc1qxx?__proto__=x');
    assert.strictEqual(parsed.extras.__proto__, 'x');
    assert.strictEqual(Object.getPrototypeOf(parsed.extras), Object.prototype);
  });

  it('rejects amounts finer than one satoshi', function () {
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '0.000000001' }), /decimal BTC/);
    assert.throws(() => parseBitcoinUri('bitcoin:bc1qxx?amount=0.000000001'), /amount is invalid/);
    assert.strictEqual(parseBitcoinUri('bitcoin:bc1qxx?amount=0.00000001').amount, '0.00000001');
  });

  it('rejects missing address and invalid amounts', function () {
    assert.throws(() => encodeBitcoinUri({}), /address/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: -1 }), /non-negative/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1q?bad' }), /\? or #/);
    assert.throws(() => encodeBitcoinUri({ address: 'bc1qxx', amount: '1btc' }), /decimal BTC/);
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000009 }),
      /non-negative BTC/
    );
    assert.throws(
      () => encodeBitcoinUri({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', amount: 0.000000004 }),
      /non-negative BTC/
    );
    assert.throws(() => parseBitcoinUri('https://example.test'), /bitcoin:/);
    assert.throws(() => parseBitcoinUri('bitcoin:addr?amount=-1'), /amount is invalid/);
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?req-something=1'),
      /unsupported required BIP21 parameter/
    );
    assert.throws(
      () => parseBitcoinUri('bitcoin:addr?REQ-exp=1'),
      /unsupported required BIP21 parameter/
    );
  });
});
