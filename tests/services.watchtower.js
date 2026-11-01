'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Channel = require('../types/channel');
const Watchtower = require('../services/watchtower');
const Witness = require('../types/witness');
const { signerFromPriv32 } = require('../types/htlc');

const NET = bitcoin.networks.regtest;

function party () {
  const priv = crypto.randomBytes(32);
  const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
  const address = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address;
  return { priv, pub, address };
}

function fundingTx (address, sats) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, NET), BigInt(sats));
  return tx.toHex();
}

function opened () {
  const a = party();
  const b = party();
  const capacity = 100000;
  const fee = 500;
  const fundingA = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 5000, capacitySats: capacity, toSelfDelay: 6 });
  const fundingB = Channel.buildFunding({ network: 'regtest', localPubkey: b.pub, remotePubkey: a.pub, expireAfter: 5000, capacitySats: capacity, funder: 'remote', toSelfDelay: 6 });
  const fundedTxHex = fundingTx(fundingA.address, capacity);
  const open = capacity - fee - 2 * Channel.DEFAULTS.anchorSats;
  const base = { tipHeight: () => 100, fundingConfirmed: true, fundedTxHex, feeSats: fee };
  const A = new Channel.Session(Object.assign({ funding: fundingA, localPrivateKey: a.priv, localSats: open, remoteSats: 0, localAddress: a.address, remoteAddress: b.address }, base));
  const B = new Channel.Session(Object.assign({ funding: fundingB, localPrivateKey: b.priv, localSats: 0, remoteSats: open, localAddress: b.address, remoteAddress: a.address, policy: { minToSelfDelay: 1 } }, base));
  Channel.exchange(A, B, A.open());
  const preimage = crypto.randomBytes(32).toString('hex');
  const paymentHashHex = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
  Channel.exchange(A, B, A.offerHtlc({ amountSats: 2000, paymentHashHex, expireAfter: 4000 }));
  return { a, b, A, B };
}

function commitmentHex (session, txid) {
  const stale = session.state.revoked[txid];
  const built = Channel.buildCommitment(session.funding, Object.assign({ fundedTxHex: session.fundedTxHex }, stale.state), {
    holder: 'remote',
    holderPoint: stale.pointHex
  });
  assert.strictEqual(built.txid, txid);
  return built.txHex;
}

describe('@fabric/core/services/watchtower', function () {
  it('files its own penalty and broadcasts it when the revoked commitment is seen', function () {
    const { b, B } = opened();
    const filings = B.penaltyFilings();
    assert.ok(filings.length >= 1, 'a revoked counterparty commitment files per-output justice');
    const filing = filings[0];
    assert.ok(filing.transactions.length >= 1);
    const tower = new Watchtower({ localPrivateKey: b.priv });
    const appointment = Watchtower.appointment(filing, b.priv);
    assert.strictEqual(appointment.type, 'WatchtowerAppointment');
    assert.strictEqual(appointment.hint, filing.commitmentTxid.slice(0, 32));
    assert.strictEqual(tower.file(appointment).client, Witness.xOnlyPubkeyHex(b.priv));

    const other = new bitcoin.Transaction();
    other.addInput(crypto.randomBytes(32), 0);
    other.addOutput(bitcoin.address.toOutputScript(b.address, NET), 1000n);
    assert.deepStrictEqual(tower.match([other.toHex()]), [], 'a different transaction is not a breach');

    const hits = tower.match([commitmentHex(B, filing.commitmentTxid)]);
    assert.strictEqual(hits.length, 1);
    assert.deepStrictEqual(hits[0].transactions, filing.transactions);
    tower.drop(hits[0].client, hits[0].hint);
    assert.strictEqual(tower.size, filings.length - 1);
  });

  it('ignores a hint collision that does not decrypt', function () {
    const { b, B } = opened();
    const filing = B.penaltyFilings()[0];
    const appointment = Watchtower.appointment(filing, b.priv);
    const txid = filing.commitmentTxid;
    const collided = txid.slice(0, 32) + (txid.slice(32) === '00'.repeat(16) ? '11'.repeat(16) : '00'.repeat(16));
    assert.strictEqual(collided.slice(0, 32), appointment.hint);
    assert.notStrictEqual(collided, txid);
    assert.strictEqual(Watchtower.open(appointment, collided), null);
    assert.ok(Watchtower.open(appointment, txid).length);
  });

  it('refuses a client that is not registered, and accepts one that is', function () {
    const stranger = party();
    const operator = party();
    const client = party();
    const tower = new Watchtower({
      localPrivateKey: operator.priv,
      admit: (pubkey) => pubkey === Witness.xOnlyPubkeyHex(client.priv)
    });
    const body = (who) => Watchtower.appointment({
      commitmentTxid: crypto.randomBytes(32).toString('hex'),
      transactions: ['aa']
    }, who.priv);
    assert.throws(() => tower.file(body(stranger)), (err) => err.code === 'UNREGISTERED');
    assert.ok(tower.file(body(client)).hint);
    assert.ok(tower.file(body(operator)).hint);
    const session = party();
    const signed = body(session);
    assert.throws(() => tower.file(signed), (err) => err.code === 'UNREGISTERED');
    assert.ok(tower.file(signed, { sessionPubkey: session.pub }).hint, 'a current session may file for itself');
  });

  it('restores filings across a restart and replaces a hint in place', function () {
    const operator = party();
    const tower = new Watchtower({ localPrivateKey: operator.priv, maxPerClient: 2, maxFilings: 2 });
    const first = Watchtower.appointment({ commitmentTxid: crypto.randomBytes(32).toString('hex'), transactions: ['aa'] }, operator.priv);
    const second = Watchtower.appointment({ commitmentTxid: crypto.randomBytes(32).toString('hex'), transactions: ['bb'] }, operator.priv);
    tower.file(first);
    tower.file(second);
    assert.throws(() => tower.file(Watchtower.appointment({
      commitmentTxid: crypto.randomBytes(32).toString('hex'),
      transactions: ['cc']
    }, operator.priv)), /cap/);
    // Same hint, new ciphertext: a fee update, not another slot.
    const sameTxid = first.hint + crypto.randomBytes(16).toString('hex');
    assert.strictEqual(sameTxid.slice(0, 32), first.hint);
    const replacement = Watchtower.appointment({ commitmentTxid: sameTxid, transactions: ['dd'] }, operator.priv);
    assert.strictEqual(replacement.hint, first.hint);
    tower.file(replacement);
    assert.strictEqual(tower.size, 2);

    const restored = new Watchtower({ localPrivateKey: operator.priv });
    assert.strictEqual(restored.import(tower.export()), 2);
    assert.strictEqual(Watchtower.open(restored.export().filings.find((row) => row.hint === first.hint), sameTxid)[0], 'dd');
    const stranger = new Watchtower({ localPrivateKey: party().priv });
    assert.strictEqual(stranger.import(tower.export()), 0, 'another node does not keep filings it would not admit');
  });
});
