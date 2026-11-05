'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Bitcoin = require('../services/bitcoin');
const Channel = require('../types/channel');
const { signerFromPriv32 } = require('../types/htlc');
const { finalizeSpendPsbt } = require('../types/policy');
const { isolatedManagedRegtestSettings } = require('./helpers/bitcoinRegtest');

const NET = bitcoin.networks.regtest;
const TO_SELF_DELAY = 6;

function party () {
  const priv = crypto.randomBytes(32);
  const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
  const address = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address;
  return { priv, pub, address };
}

describe('@fabric/core/types/channel (regtest spends)', function () {
  if (!process.env.FABRIC_E2E_REGTEST) {
    console.log('[SKIP] Set FABRIC_E2E_REGTEST=1 to run channel regtest spends');
    return;
  }
  this.timeout(240000);

  let node;
  let miner;
  let tip = 0;
  const rpc = (method, params = []) => node._makeRPCRequest(method, params);
  const mine = async (n) => { await rpc('generatetoaddress', [n, miner]); tip = await rpc('getblockcount'); };
  const accept = async (txHex) => (await rpc('testmempoolaccept', [[txHex]]))[0];

  before(async function () {
    node = new Bitcoin(await isolatedManagedRegtestSettings());
    node.on('error', (msg) => console.warn(String(msg)));
    await node.start();
    await node.getUnusedAddress();
    // Segwit coins only: a legacy funding input makes the funding txid malleable (refused).
    miner = await rpc('getnewaddress', ['', 'bech32']);
    await mine(101);
  });

  after(async function () {
    if (node) await node.stop();
  });

  it('commitment, HTLC claim, HTLC timeout, and justice spends are valid on chain only after their timelocks', async function () {
    const a = party();
    const b = party();
    const capacity = 100000;
    const expireAfter = tip + 2000;
    const fundingA = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter, capacitySats: capacity, toSelfDelay: TO_SELF_DELAY });
    const fundingB = Channel.buildFunding({ network: 'regtest', localPubkey: b.pub, remotePubkey: a.pub, expireAfter, capacitySats: capacity, toSelfDelay: TO_SELF_DELAY, funder: 'remote' });
    const fundingTxid = await rpc('sendtoaddress', [fundingA.address, capacity / 1e8]);
    const fundedTxHex = await rpc('getrawtransaction', [fundingTxid]);
    await mine(1);

    const open = capacity - 500 - 2 * Channel.DEFAULTS.anchorSats;
    const base = { fundedTxHex, feeSats: 500, tipHeight: () => tip, fundingConfirmed: true };
    const A = new Channel.Session(Object.assign({ funding: fundingA, localPrivateKey: a.priv, localSats: open, remoteSats: 0, localAddress: a.address, remoteAddress: b.address }, base));
    const B = new Channel.Session(Object.assign({ funding: fundingB, localPrivateKey: b.priv, localSats: 0, remoteSats: open, localAddress: b.address, remoteAddress: a.address, policy: { minToSelfDelay: 1 } }, base));
    Channel.exchange(A, B, A.open());
    assert.strictEqual(B.status, 'open');

    const hashOf = (pre) => crypto.createHash('sha256').update(Buffer.from(pre, 'hex')).digest('hex');
    const expire = tip + Channel.minHtlcExpiryDelta(B) + 4;
    // A first payment gives B a toLocal output, so the stale state has two revocable outputs.
    const first = crypto.randomBytes(32).toString('hex');
    Channel.exchange(A, B, A.offerHtlc({ amountSats: 10000, paymentHashHex: hashOf(first), expireAfter: expire }));
    Channel.exchange(B, A, B.fulfillHtlc(B.state.htlcs[0].id, first));
    assert.strictEqual(B.balances.localSats, 10000);

    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHashHex = hashOf(preimage);
    Channel.exchange(A, B, A.offerHtlc({ amountSats: 20000, paymentHashHex, expireAfter: expire }));
    const stale = B.finalize();
    const row = stale.commitment.outputs.find((o) => o.kind === 'htlc');

    // B settles off-chain and revokes the HTLC state; its latest commitment relays.
    Channel.exchange(B, A, B.fulfillHtlc(row.id, preimage));
    const latest = B.finalize();
    assert.ok(latest.number > stale.number);
    const latestCheck = await accept(latest.txHex);
    assert.ok(latestCheck.allowed, JSON.stringify(latestCheck));

    // B cheats: the revoked HTLC state confirms.
    await rpc('sendrawtransaction', [stale.txHex]);
    await mine(1);

    const observed = A.observe(stale.txHex, { destinationAddress: a.address, perOutput: true, feeSats: 400 });
    assert.strictEqual(observed.kind, 'stale');
    const justice = await accept(observed.justice.txHex);
    assert.ok(justice.allowed, `justice: ${JSON.stringify(justice)}`);
    assert.deepStrictEqual(observed.justiceSpends.map((s) => s.kind).sort(), ['htlc', 'toLocal']);
    for (const spend of observed.justiceSpends) {
      const r = await accept(spend.txHex);
      assert.ok(r.allowed, `justice ${spend.kind}: ${JSON.stringify(r)}`);
    }

    // On B's own commitment the claim waits toSelfDelay (A's justice window).
    const claimTx = () => {
      const prepared = Channel.prepareHtlcClaim(stale.commitment, { htlcId: row.id, commitmentTxHex: stale.txHex, preimageHex: preimage, destinationAddress: b.address, feeSats: 300, network: 'regtest' });
      const psbt = bitcoin.Psbt.fromBase64(prepared.psbtBase64, { network: NET });
      psbt.signInput(0, signerFromPriv32(b.priv));
      return Channel.finalizeHtlcClaim(psbt.toBase64(), preimage).txHex;
    };
    const early = await accept(claimTx());
    assert.strictEqual(early.allowed, false);
    assert.match(early['reject-reason'], /non-BIP68-final/);
    await mine(TO_SELF_DELAY - 1);
    const claim = await accept(claimTx());
    assert.ok(claim.allowed, `claim: ${JSON.stringify(claim)}`);

    // A's timeout needs the CLTV expiry and toSelfDelay + the claim window.
    const timeoutTx = () => {
      const prepared = Channel.prepareHtlcTimeout(stale.commitment, { htlcId: row.id, commitmentTxHex: stale.txHex, destinationAddress: a.address, feeSats: 300, network: 'regtest' });
      assert.strictEqual(prepared.csv, TO_SELF_DELAY + Channel.DEFAULTS.htlcClaimWindowBlocks);
      const psbt = bitcoin.Psbt.fromBase64(prepared.psbtBase64, { network: NET });
      psbt.signInput(0, signerFromPriv32(a.priv));
      return finalizeSpendPsbt({ psbt }).txHex;
    };
    const beforeExpiry = await accept(timeoutTx());
    assert.strictEqual(beforeExpiry.allowed, false);
    assert.match(beforeExpiry['reject-reason'], /non-final|non-BIP68-final/);
    await mine(expire - tip);
    const timeout = await accept(timeoutTx());
    assert.ok(timeout.allowed, `timeout: ${JSON.stringify(timeout)}`);
  });

  it('a commitment carrying maxAcceptedHtlcs (30) HTLCs relays at its feerate on both sides', async function () {
    const a = party();
    const b = party();
    const capacity = 200000;
    const feerate = 2;
    const expireAfter = tip + 2000;
    const fundingA = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter, capacitySats: capacity, toSelfDelay: TO_SELF_DELAY });
    const fundingB = Channel.buildFunding({ network: 'regtest', localPubkey: b.pub, remotePubkey: a.pub, expireAfter, capacitySats: capacity, toSelfDelay: TO_SELF_DELAY, funder: 'remote' });
    const fundingTxid = await rpc('sendtoaddress', [fundingA.address, capacity / 1e8]);
    const fundedTxHex = await rpc('getrawtransaction', [fundingTxid]);
    await mine(1);

    const openFee = Math.max(Channel.DEFAULTS.minCommitFeeSats, Channel.commitmentFeeSats(feerate, 0));
    const open = capacity - openFee - 2 * Channel.DEFAULTS.anchorSats;
    const base = { fundedTxHex, feerate, tipHeight: () => tip, fundingConfirmed: true };
    const A = new Channel.Session(Object.assign({ funding: fundingA, localPrivateKey: a.priv, localSats: open, remoteSats: 0, localAddress: a.address, remoteAddress: b.address }, base));
    const B = new Channel.Session(Object.assign({ funding: fundingB, localPrivateKey: b.priv, localSats: 0, remoteSats: open, localAddress: b.address, remoteAddress: a.address, policy: { minToSelfDelay: 1 } }, base));
    Channel.exchange(A, B, A.open());
    assert.strictEqual(B.status, 'open');

    const expire = tip + Channel.minHtlcExpiryDelta(B) + 4;
    for (let i = 0; i < Channel.DEFAULTS.maxAcceptedHtlcs; i++) {
      const hash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
      Channel.exchange(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: hash, expireAfter: expire }));
    }
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: 'ab'.repeat(32), expireAfter: expire }), /maxAcceptedHtlcs/);
    assert.strictEqual(A.feeSats, Channel.commitmentFeeSats(feerate, Channel.DEFAULTS.maxAcceptedHtlcs));

    for (const side of [A, B]) {
      const commitment = side.finalize();
      assert.strictEqual(commitment.commitment.outputs.filter((o) => o.kind === 'htlc').length, Channel.DEFAULTS.maxAcceptedHtlcs);
      const r = await accept(commitment.txHex);
      assert.ok(r.allowed, JSON.stringify(r));
      assert.ok(r.fees.base * 1e8 / r.vsize >= feerate - 0.01, `paid ${r.fees.base * 1e8} sats for ${r.vsize} vB`);
    }
  });
});

describe('@fabric/core/types/bond (regtest spends)', function () {
  if (!process.env.FABRIC_E2E_REGTEST) {
    console.log('[SKIP] Set FABRIC_E2E_REGTEST=1 to run bond regtest spends');
    return;
  }
  this.timeout(240000);

  const Bond = require('../types/bond');
  const { FraudProof } = require('../types/witness');

  let node;
  let miner;
  let tip = 0;
  const rpc = (method, params = []) => node._makeRPCRequest(method, params);
  const mine = async (n) => { await rpc('generatetoaddress', [n, miner]); tip = await rpc('getblockcount'); };
  const accept = async (txHex) => (await rpc('testmempoolaccept', [[txHex]]))[0];
  const signAll = (psbtBase64, privs) => {
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NET });
    for (const p of privs) psbt.signInput(0, signerFromPriv32(p));
    return psbt.toBase64();
  };

  before(async function () {
    node = new Bitcoin(await isolatedManagedRegtestSettings());
    node.on('error', (msg) => console.warn(String(msg)));
    await node.start();
    await node.getUnusedAddress();
    miner = await rpc('getnewaddress', ['', 'bech32']);
    await mine(101);
  });

  after(async function () {
    if (node) await node.stop();
  });

  it('deposit penalty, answer, check-in, and withdraw spends are valid on chain only after their timelocks', async function () {
    const provider = party();
    const publisher = party();
    const possessionHex = crypto.randomBytes(32).toString('hex');
    const nextPossessionHex = crypto.randomBytes(32).toString('hex');
    const withdrawAfter = tip + 12;
    const deposit = (round, possession) => Bond.buildDeposit({
      network: 'regtest',
      providerPubkey: provider.pub,
      publisherPubkey: publisher.pub,
      withdrawAfter,
      amountSats: 30000,
      round,
      answerHashHex: FraudProof.answerHashFor(possession),
      penaltyAddress: publisher.address
    });
    const d0 = deposit(0, possessionHex);
    const d1 = deposit(1, nextPossessionHex);
    const txid = await rpc('sendtoaddress', [d0.address, 30000 / 1e8]);
    const fundedTxHex = await rpc('getrawtransaction', [txid]);

    // Check-in needs one confirmation (CSV 1); both parties sign.
    const checkIn = Bond.prepareDepositCheckIn(d0, { fundedTxHex, feeSats: 500, nextDeposit: d1 });
    const checkInTx = Bond.finalizeSpend(signAll(checkIn.psbtBase64, [provider.priv, publisher.priv])).txHex;
    await mine(1);
    const checkInOk = await accept(checkInTx);
    assert.ok(checkInOk.allowed, `check-in: ${JSON.stringify(checkInOk)}`);

    // The provider answers the round alone, with no timelock.
    const answer = Bond.prepareDepositAnswer(d0, { fundedTxHex, destinationAddress: provider.address, feeSats: 500, possessionHex });
    const answerTx = Bond.finalizeClaim(signAll(answer.psbtBase64, [provider.priv]), possessionHex).txHex;
    const answerOk = await accept(answerTx);
    assert.ok(answerOk.allowed, `answer: ${JSON.stringify(answerOk)}`);
    assert.strictEqual(Bond.classifySpend(d0, answerTx, { txid, vout: bitcoin.Transaction.fromHex(answerTx).ins[0].index }).leafId, 'answer');

    // The pre-signed penalty is final only at its deadline.
    const deadlineHeight = tip + 4;
    const penalty = Bond.prepareDepositPenalty(d0, { fundedTxHex, deadlineHeight, destinationAddress: publisher.address, feeSats: 500 });
    const preSig = Bond.signPenaltyAsProvider(d0, penalty, provider.priv);
    const penaltyTx = Bond.finalizePreSignedPenalty(d0, preSig, publisher.priv).txHex;
    const early = await accept(penaltyTx);
    assert.strictEqual(early.allowed, false);
    assert.match(early['reject-reason'], /non-final/);
    await mine(deadlineHeight - tip);
    const penaltyOk = await accept(penaltyTx);
    assert.ok(penaltyOk.allowed, `penalty: ${JSON.stringify(penaltyOk)}`);

    // The provider's unilateral withdraw waits for withdrawAfter.
    const withdraw = Bond.prepareDepositWithdraw(d0, { fundedTxHex, destinationAddress: provider.address, feeSats: 500 });
    const withdrawTx = Bond.finalizeSpend(signAll(withdraw.psbtBase64, [provider.priv])).txHex;
    const tooSoon = await accept(withdrawTx);
    assert.strictEqual(tooSoon.allowed, false);
    assert.match(tooSoon['reject-reason'], /non-final/);
    await mine(withdrawAfter - tip);
    const withdrawOk = await accept(withdrawTx);
    assert.ok(withdrawOk.allowed, `withdraw: ${JSON.stringify(withdrawOk)}`);
  });
});
