'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Bond = require('../types/bond');
const Coinjoin = require('../types/coinjoin');

function chain (utxos, tip) {
  return {
    async getTipHeight () {
      return tip.height;
    },
    async getTxOut (txid, vout) {
      return utxos.get(`${txid}:${vout}`) || null;
    }
  };
}

function setup () {
  const bondKey = Coinjoin.randomPrivateKey();
  const makerKey = Coinjoin.randomPrivateKey();
  const makerPubkey = Coinjoin.pubkeyFromPrivate(makerKey);
  const locktime = 60000;
  const out = Bond.buildFidelity({ networkName: 'regtest', bondPubkey: Coinjoin.pubkeyFromPrivate(bondKey), locktime });
  const txid = crypto.randomBytes(32).toString('hex');
  const tip = { height: 10000 };
  const utxos = new Map([[`${txid}:0`, { valueSats: 50000000, scriptPubKeyHex: out.scriptPubKeyHex, confirmations: 10 }]]);
  const descriptor = Bond.signFidelityCertificate({
    network: 'regtest',
    txid,
    vout: 0,
    locktime,
    makerPubkey,
    certExpiresAt: tip.height + 1000,
    bondPrivateKey: bondKey
  });
  return { bondKey, makerKey, makerPubkey, locktime, out, txid, tip, utxos, descriptor };
}

describe('Bond (fidelity)', function () {
  it('derives bond paths and locktimes', function () {
    assert.strictEqual(Bond.fidelityPath(3, 'mainnet'), "m/86'/0'/0'/2/3");
    assert.strictEqual(Bond.fidelityPath(0, 'regtest'), "m/86'/1'/0'/2/0");
    assert.strictEqual(Bond.isValidFidelityLocktime(4320 * 200, 'mainnet'), true);
    assert.strictEqual(Bond.isValidFidelityLocktime(4320 * 200 + 1, 'mainnet'), false);
    assert.strictEqual(Bond.isValidFidelityLocktime(123, 'regtest'), true);
    assert.strictEqual(Bond.isValidFidelityLocktime(500000000, 'regtest'), false);
    assert.deepStrictEqual(Bond.fidelityLocktimes({ tipHeight: 870000, networkName: 'mainnet', count: 2 }), [872640, 876960]);
  });

  it('builds a script-only P2TR with the CLTV leaf', function () {
    const { out, locktime } = setup();
    assert.ok(/^5120[0-9a-f]{64}$/.test(out.scriptPubKeyHex));
    const chunks = bitcoin.script.decompile(Buffer.from(out.leafScriptHex, 'hex'));
    assert.strictEqual(chunks[1], bitcoin.script.OPS.OP_CHECKLOCKTIMEVERIFY);
    assert.strictEqual(chunks[4], bitcoin.script.OPS.OP_CHECKSIG);
    assert.strictEqual(bitcoin.script.number.decode(chunks[0]), locktime);
    assert.strictEqual(out.controlBlockHex.length, 33 * 2);
  });

  it('signs and spends the redeem path with nLockTime at the bond locktime', function () {
    const { out, txid, bondKey, locktime } = setup();
    const dest = Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).address;
    const psbt = Bond.prepareFidelityRedeem({
      networkName: 'regtest',
      bond: { txid, vout: 0, valueSats: 50000000, locktime, bondXOnly: out.bondXOnly },
      destinationAddress: dest,
      feeSats: 400
    });
    const { txHex } = Bond.signFidelityRedeem(psbt, bondKey);
    const tx = bitcoin.Transaction.fromHex(txHex);
    assert.strictEqual(tx.locktime, locktime);
    assert.strictEqual(tx.ins[0].sequence, 0xfffffffe);
    assert.strictEqual(tx.ins[0].witness.length, 3);
    assert.strictEqual(Number(tx.outs[0].value), 50000000 - 400);
  });

  it('verifies a certificate only for its maker and network', function () {
    const { descriptor, makerPubkey } = setup();
    assert.strictEqual(Bond.verifyFidelityCertificate(descriptor, { makerPubkey, network: 'regtest' }), true);
    assert.strictEqual(Bond.verifyFidelityCertificate(descriptor, { makerPubkey: Coinjoin.pubkeyFromPrivate(Coinjoin.randomPrivateKey()), network: 'regtest' }), false);
    assert.strictEqual(Bond.verifyFidelityCertificate(descriptor, { makerPubkey, network: 'signet' }), false);
  });

  it('values bonds by amount and lock period, decaying after expiry', function () {
    const base = { valueSats: 100000000, confirmHeight: 0, tipHeight: 0 };
    const year = Bond.fidelityValue(Object.assign({}, base, { locktime: Bond.YEAR_BLOCKS }));
    const twoYears = Bond.fidelityValue(Object.assign({}, base, { locktime: 2 * Bond.YEAR_BLOCKS }));
    assert.ok(year > 0 && twoYears > year);
    const twice = Bond.fidelityValue(Object.assign({}, base, { valueSats: 200000000, locktime: Bond.YEAR_BLOCKS }));
    assert.ok(twice > 2 * year, 'value is superlinear in amount');
    const decayed = Bond.fidelityValue(Object.assign({}, base, { locktime: Bond.YEAR_BLOCKS, tipHeight: 2 * Bond.YEAR_BLOCKS }));
    assert.ok(decayed < year);
    assert.strictEqual(Bond.fidelityValue(Object.assign({}, base, { locktime: 0 })), 0);
  });

  it('verifies a bond on chain', async function () {
    const { descriptor, makerPubkey, utxos, tip, locktime } = setup();
    const result = await Bond.verifyFidelity(descriptor, { makerPubkey, network: 'regtest', bitcoin: chain(utxos, tip) });
    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(result.confirmHeight, tip.height - 9);
    assert.strictEqual(result.value, Bond.fidelityValue({ valueSats: 50000000, locktime, confirmHeight: tip.height - 9, tipHeight: tip.height }));
  });

  it('rejects spent, wrong-script, unconfirmed, and expired-certificate bonds', async function () {
    const s = setup();
    const opts = { makerPubkey: s.makerPubkey, network: 'regtest' };
    const spent = await Bond.verifyFidelity(s.descriptor, Object.assign({ bitcoin: chain(new Map(), s.tip) }, opts));
    assert.strictEqual(spent.reason, 'bond output is spent or unknown');
    const other = new Map([[`${s.txid}:0`, { valueSats: 1, scriptPubKeyHex: '5120' + '11'.repeat(32), confirmations: 10 }]]);
    assert.strictEqual((await Bond.verifyFidelity(s.descriptor, Object.assign({ bitcoin: chain(other, s.tip) }, opts))).reason, 'bond output script does not match');
    s.utxos.get(`${s.txid}:0`).confirmations = 2;
    assert.strictEqual((await Bond.verifyFidelity(s.descriptor, Object.assign({ bitcoin: chain(s.utxos, s.tip) }, opts))).reason, 'bond not confirmed enough');
    s.utxos.get(`${s.txid}:0`).confirmations = 10;
    s.tip.height = s.descriptor.certExpiresAt;
    assert.strictEqual((await Bond.verifyFidelity(s.descriptor, Object.assign({ bitcoin: chain(s.utxos, s.tip) }, opts))).reason, 'certificate expired');
  });

  it('caches results until the tip moves', async function () {
    const s = setup();
    let lookups = 0;
    const counted = chain(s.utxos, s.tip);
    const getTxOut = counted.getTxOut;
    counted.getTxOut = async (...args) => {
      lookups++;
      return getTxOut(...args);
    };
    const verifier = new Bond.FidelityVerifier({ bitcoin: counted, network: 'regtest' });
    await verifier.verify(s.descriptor, s.makerPubkey);
    await verifier.verify(s.descriptor, s.makerPubkey);
    assert.strictEqual(lookups, 1);
    s.tip.height += 1;
    await verifier.verify(s.descriptor, s.makerPubkey);
    assert.strictEqual(lookups, 2);
  });

  it('rides on a coinjoin offer', function () {
    const s = setup();
    const offer = Coinjoin.signBody({
      type: Coinjoin.BODY_TYPES.OFFER,
      network: 'regtest',
      minSats: 100000,
      maxSats: 1000000,
      createdAt: 1,
      expiresAt: 2,
      makerPubkey: s.makerPubkey,
      nonce: Coinjoin.randomNonce(),
      fidelityBond: s.descriptor
    }, s.makerKey);
    assert.deepStrictEqual(Coinjoin.verifyBody(offer).body.fidelityBond, s.descriptor);
  });
});
