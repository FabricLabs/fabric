'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Channel = require('../types/channel');
const Witness = require('../types/witness');
const { signerFromPriv32 } = require('../functions/inventoryHtlc');

const NET = bitcoin.networks.regtest;
const ANCHORS = 2 * Channel.DEFAULTS.anchorSats;
const SAFETY = Channel.DEFAULTS.htlcSafetyBlocks;
const CLAIM_WINDOW = Channel.DEFAULTS.htlcClaimWindowBlocks;

function party () {
  const priv = crypto.randomBytes(32);
  const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
  const address = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address;
  return { priv, pub, address };
}

/** Fake (unsigned, segwit-shaped) funding tx paying each of `outputs` to `address`. */
function fundingTx (address, sats, opts = {}) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0);
  if (opts.scriptSig) tx.ins[0].script = opts.scriptSig;
  for (const value of opts.outputs || [sats]) tx.addOutput(bitcoin.address.toOutputScript(address, NET), BigInt(value));
  return tx.toHex();
}

const rnd = () => crypto.randomBytes(32).toString('hex');
const hashOf = (preimageHex) => crypto.createHash('sha256').update(Buffer.from(preimageHex, 'hex')).digest('hex');
const resign = (body, priv) => Witness.signArtifact(Object.assign({}, body, { pubkey: undefined, signature: undefined }), priv);

/**
 * Two sessions on one channel (A funds). Defaults: toSelfDelay 144, channel
 * expiry 5000, shared tip `clock.tip` (100), funding trusted as confirmed.
 */
function pair (opts = {}) {
  const capacity = opts.capacity || 100000;
  const fee = opts.fee != null ? opts.fee : 500;
  const toSelfDelay = opts.toSelfDelay || 144;
  const expireAfter = opts.expireAfter || 5000;
  const a = party();
  const b = party();
  const fundingA = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter, capacitySats: capacity, toSelfDelay });
  const fundingB = Channel.buildFunding({ network: 'regtest', localPubkey: b.pub, remotePubkey: a.pub, expireAfter, capacitySats: opts.capacityB || capacity, toSelfDelay, funder: 'remote' });
  const fundedTxHex = fundingTx(fundingA.address, capacity, { scriptSig: opts.scriptSig });
  const open = capacity - fee - ANCHORS;
  const clock = { tip: opts.tip || 100 };
  const base = { tipHeight: () => clock.tip, fundingConfirmed: true };
  const A = new Channel.Session(Object.assign({ funding: fundingA, fundedTxHex, localPrivateKey: a.priv, localSats: open, remoteSats: 0, localAddress: a.address, remoteAddress: b.address, feeSats: fee }, base, opts.A || {}));
  const B = new Channel.Session(Object.assign({ funding: fundingB, fundedTxHex, localPrivateKey: b.priv, localSats: 0, remoteSats: open, localAddress: b.address, remoteAddress: a.address, feeSats: fee }, base, opts.B || {}));
  return { a, b, A, B, fundedTxHex, open, clock };
}

function sync (from, to, body) {
  const trace = Channel.exchange(from, to, body);
  assert.strictEqual(from.busy, false, 'proposer idle after round');
  assert.strictEqual(to.busy, false, 'counterparty idle after round');
  return trace;
}

function opened (opts) {
  const ctx = pair(opts);
  sync(ctx.A, ctx.B, ctx.A.open());
  assert.strictEqual(ctx.A.status, 'open');
  assert.strictEqual(ctx.B.status, 'open');
  return ctx;
}

/** A pays B `amount` (offer + fulfil) so both sides hold a balance. */
function payB (ctx, amount) {
  const pre = rnd();
  sync(ctx.A, ctx.B, ctx.A.offerHtlc({ amountSats: amount, paymentHashHex: hashOf(pre), expireAfter: ctx.clock.tip + 400 }));
  sync(ctx.B, ctx.A, ctx.B.fulfillHtlc(ctx.B.state.htlcs[0].id, pre));
}

/** Channel.Book hosts with manual message delivery (broadcast to every other book). */
function books (n, extra = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = party();
    const queue = [];
    const book = new Channel.Book(Object.assign({ localPrivateKey: p.priv, network: 'regtest', confirmations: () => 6, publish: (body) => queue.push(body) }, extra));
    out.push({ p, book, queue });
  }
  const deliver = (from, opts = {}) => {
    const body = from.queue.shift();
    if (!body || opts.drop) return body;
    for (const other of out) if (other !== from) other.book.ingest(body, { sellerId: `peer-${out.indexOf(from)}` });
    return body;
  };
  const pump = () => {
    let moved = true;
    while (moved) {
      moved = false;
      for (const x of out) while (x.queue.length) { moved = true; deliver(x); }
    }
  };
  return { out, deliver, pump };
}

function bookOpen (A, B, opts = {}) {
  const capacity = opts.capacitySats || 50000;
  const expireAfter = opts.expireAfter || 5000;
  const funding = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter });
  return A.book.open(Object.assign({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(funding.address, capacity), capacitySats: capacity, expireAfter, feeSats: 500, localAddress: A.p.address, remoteAddress: B.p.address }, opts));
}

describe('@fabric/core/types/channel hardening: HTLC timelocks', function () {
  it('requires expireAfter − tip ≥ toSelfDelay + closeMarginBlocks + htlcSafetyBlocks on offer and on receive', function () {
    let tipB = 150;
    const { A, B, clock } = opened({ B: { tipHeight: () => tipB } });
    assert.strictEqual(Channel.minHtlcExpiryDelta(A), 144 + 144 + SAFETY);
    assert.strictEqual(Channel.minHtlcExpiryDelta(A.funding), 300, 'funding record alone uses the default policy');
    assert.deepStrictEqual(A.htlcExpiryBounds(), { min: clock.tip + 300, max: 5000 - 144 - 144 });
    assert.strictEqual(A.htlcExpiryBounds(null), null);
    // expire = tip + toSelfDelay: the receiver's CSV-delayed claim would mature exactly at expiry.
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 144 }), /expires too soon/);
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 299 }), /expires too soon/);
    // A peer whose view (or code) lets a short HTLC through is refused by the receiver.
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 300 });
    assert.throws(() => B.receive(offer), /receive: HTLC expires too soon/);
    assert.strictEqual(B.number, 0);
    tipB = clock.tip;
    sync(A, B, offer);
  });

  it('a sender withholding its countersignature cannot race a fulfilled HTLC', function () {
    const { A, B, clock } = opened();
    const pre = rnd();
    const E = clock.tip + 300;
    sync(A, B, A.offerHtlc({ amountSats: 2000, paymentHashHex: hashOf(pre), expireAfter: E }));
    const id = B.state.htlcs[0].id;

    // Too close to expiry the receiver keeps the preimage and claims on chain instead.
    clock.tip = E - (144 + SAFETY);
    assert.strictEqual(B.canFulfil(B.state.htlcs[0]), false);
    assert.throws(() => B.fulfillHtlc(id, pre), /expires too soon to settle off-chain/);
    assert.strictEqual(B.preimageFor(hashOf(pre)), pre, 'preimage kept for the on-chain claim');
    const late = B.tick(clock.tip);
    assert.strictEqual(late.bodies.length, 0);
    assert.deepStrictEqual(late.actions.map((x) => x.type), ['forceClose', 'claimHtlc']);
    assert.strictEqual(late.actions[0].reason, 'htlc-claim');
    assert.strictEqual(late.actions[1].preimageHex, pre);

    // With margin it reveals off-chain; the sender withholds its countersignature.
    clock.tip = E - (144 + SAFETY) - 1;
    assert.strictEqual(B.canFulfil(B.state.htlcs[0]), true);
    const fulfil = B.fulfillHtlc(id, pre);
    assert.strictEqual(fulfil.type, 'ChannelHtlcFulfill');
    assert.strictEqual(B.busy, true);
    assert.strictEqual(B.tick(clock.tip).actions.length, 0, 'still waiting on the sender');
    // B can always broadcast the last state A signed (the HTLC still pending)…
    const fin = B.finalize();
    assert.strictEqual(fin.number, 1);
    const out = fin.commitment.outputs.find((o) => o.kind === 'htlc');
    assert.ok(out && out.id === id);
    // …where B's claim waits toSelfDelay and A's timeout waits toSelfDelay + the claim window (plus CLTV).
    const claim = Channel.prepareHtlcClaim(fin.commitment, { htlcId: id, commitmentTxHex: fin.txHex, preimageHex: pre, destinationAddress: B.localAddress, feeSats: 300, network: 'regtest' });
    const timeout = Channel.prepareHtlcTimeout(fin.commitment, { htlcId: id, commitmentTxHex: fin.txHex, destinationAddress: A.localAddress, feeSats: 300, network: 'regtest' });
    assert.strictEqual(claim.delayed, true);
    assert.strictEqual(out._htlc.claimCsv, 144);
    assert.strictEqual(timeout.csv, 144 + CLAIM_WINDOW);
    const claimTx = bitcoin.Psbt.fromBase64(claim.psbtBase64, { network: NET });
    const timeoutTx = bitcoin.Psbt.fromBase64(timeout.psbtBase64, { network: NET });
    assert.strictEqual(claimTx.txInputs[0].sequence, 144);
    assert.strictEqual(timeoutTx.txInputs[0].sequence, 144 + CLAIM_WINDOW);
    assert.strictEqual(timeoutTx.locktime, E);
    assert.ok(timeout.csv - out._htlc.claimCsv >= CLAIM_WINDOW, 'receiver has an exclusive claim window');
    // On A's own commitment B claims immediately; A's timeout is delayed.
    const finA = A.finalize();
    const rowA = finA.commitment.outputs.find((o) => o.kind === 'htlc');
    assert.strictEqual(Channel.prepareHtlcClaim(finA.commitment, { htlcId: rowA.id, commitmentTxHex: finA.txHex, preimageHex: pre, destinationAddress: B.localAddress, feeSats: 300, network: 'regtest' }).delayed, false);
    assert.strictEqual(Channel.prepareHtlcTimeout(finA.commitment, { htlcId: rowA.id, commitmentTxHex: finA.txHex, destinationAddress: A.localAddress, feeSats: 300, network: 'regtest' }).csv, 144);
    // Approaching the deadline the watchdog claims on chain.
    clock.tip = E - (144 + SAFETY);
    const r = B.tick(clock.tip);
    assert.deepStrictEqual(r.actions.map((x) => x.type), ['forceClose', 'claimHtlc']);
  });

  it('enforces a forwarding CLTV delta that covers the downstream claim window', function () {
    const a = party(); const b = party();
    const f = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 5000, toSelfDelay: 200 });
    assert.strictEqual(Channel.minForwardCltvDelta(f), 200 + CLAIM_WINDOW + SAFETY);
  });
});

describe('@fabric/core/types/channel hardening: commitment signatures', function () {
  it('accepts only a 64-byte SIGHASH_DEFAULT signature by the remote key on our leaf (65-byte SIGHASH_ALL refused)', function () {
    const { A, B, a, b, clock } = opened();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    // B's commitment #1 exactly as B derives it.
    const probe = Channel.Session.import(JSON.parse(JSON.stringify(B.export())), b.priv, { tipHeight: () => clock.tip });
    probe.receive(offer);
    const target = probe.commitment.psbtBase64;

    const allPsbt = bitcoin.Psbt.fromBase64(target, { network: NET });
    allPsbt.updateInput(0, { sighashType: bitcoin.Transaction.SIGHASH_ALL });
    allPsbt.signInput(0, signerFromPriv32(a.priv), [bitcoin.Transaction.SIGHASH_ALL]);
    const sig65 = Buffer.from(allPsbt.data.inputs[0].tapScriptSig[0].signature).toString('hex');
    assert.strictEqual(sig65.length, 130);
    assert.match(Channel.verifyCommitmentSignature(target, allPsbt.toBase64(), a.pub, 'regtest').reason, /64 bytes/);
    assert.match(Channel.verifyCommitmentSignature(target, sig65, a.pub, 'regtest').reason, /64 bytes/);
    assert.throws(() => Channel.finalizeCommitment(allPsbt.toBase64(), null, 'regtest'), /only 64-byte/);
    assert.throws(() => B.receive(resign(Object.assign({}, offer, { signatureHex: sig65, psbtBase64: undefined }), a.priv)), /64 bytes/);
    assert.throws(() => B.receive(resign(Object.assign({}, offer, { signatureHex: undefined, psbtBase64: allPsbt.toBase64() }), a.priv)), /64 bytes/);

    // Right length, wrong key or wrong transaction.
    const byB = Channel.signCommitment(target, b.priv, 'regtest');
    assert.match(Channel.verifyCommitmentSignature(target, byB, a.pub, 'regtest').reason, /no signature from the counterparty key/);
    assert.match(Channel.verifyCommitmentSignature(B.commitment.psbtBase64, offer.signatureHex, a.pub, 'regtest').reason, /invalid tapscript signature/);
    assert.strictEqual(Channel.verifyCommitmentSignature(target, offer.signatureHex, a.pub, 'regtest').ok, true);

    // Honest round: only the raw 64-byte signature is stored; finalize rebuilds the PSBT locally.
    sync(A, B, offer);
    assert.match(B.state.remoteSig, /^[0-9a-f]{128}$/);
    assert.match(A.state.remoteSig, /^[0-9a-f]{128}$/);
    const tx = bitcoin.Transaction.fromHex(B.finalize().txHex);
    assert.strictEqual(tx.ins[0].witness[0].length, 64);
    assert.strictEqual(tx.ins[0].witness[1].length, 64);
  });
});

describe('@fabric/core/types/channel hardening: last countersigned state', function () {
  it('finalize uses the last countersigned state mid-round and survives export/import', function () {
    const { A, B, clock } = opened();
    const before = A.finalize();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    assert.strictEqual(A.fullySigned, false);
    assert.strictEqual(A.lastSignedCommitment.number, 0);
    const mid = A.finalize();
    assert.strictEqual(mid.number, 0);
    assert.strictEqual(mid.txid, before.txid);

    const A2 = Channel.Session.import(JSON.parse(JSON.stringify(A.export())), A.localPrivateKey, { tipHeight: () => clock.tip });
    assert.strictEqual(A2.lastSignedCommitment.number, 0);
    assert.strictEqual(A2.finalize().txid, before.txid);
    assert.strictEqual(A2.resolvable, true);
    // The counterparty already holds state 1 signed.
    const reply = B.receive(offer);
    assert.strictEqual(B.finalize().number, 1);
    B.receive(A2.receive(reply));
    assert.strictEqual(A2.lastSignedCommitment.number, 1);
    assert.strictEqual(A2.finalize().number, 1);
    assert.strictEqual(A2.busy, false);
  });

  it('converts a legacy snapshot that stored the counterparty PSBT', function () {
    const { A } = opened();
    const snap = JSON.parse(JSON.stringify(A.export()));
    const psbt = Channel.withCommitmentSignature(A.commitment.psbtBase64, snap.state.remoteSig, A.funding.remotePubkey, 'regtest');
    snap.state.remoteSig = psbt;
    delete snap.state.lastSigned;
    const A2 = Channel.Session.import(snap, A.localPrivateKey, { tipHeight: () => 100 });
    assert.match(A2.state.remoteSig, /^[0-9a-f]{128}$/);
    assert.strictEqual(A2.lastSignedCommitment.number, 0);
    assert.strictEqual(A2.finalize().txid, A.finalize().txid);
  });
});

describe('@fabric/core/types/channel hardening: watchdog', function () {
  it('asks for a force close before the channel expiry window', function () {
    const { A } = opened();
    const closeBy = 5000 - 144 - 144;
    assert.strictEqual(A.tick(closeBy - 1).actions.length, 0);
    const r = A.tick(closeBy);
    assert.deepStrictEqual(r.actions, [{ type: 'forceClose', channelId: A.channelId, reason: 'channel-expiry', deadline: 5000, tip: closeBy }]);
  });

  it('never auto-fails an HTLC whose preimage is known; times out on chain when the peer will not settle', function () {
    const { A, B, clock } = opened();
    const pre = rnd();
    const E = clock.tip + 400;
    sync(A, B, A.offerHtlc({ amountSats: 3000, paymentHashHex: hashOf(pre), expireAfter: E }));
    assert.strictEqual(B.learnPreimage(hashOf(pre), pre), true);
    assert.strictEqual(B.learnPreimage(hashOf(rnd()), pre), false);
    clock.tip = E;
    const atB = B.tick(E);
    assert.strictEqual(atB.bodies.length, 0, 'no fail with the preimage in hand');
    assert.deepStrictEqual(atB.actions.map((x) => x.type), ['forceClose', 'claimHtlc']);
    // The sender tries to fail its expired HTLC; the receiver refuses (it will claim instead).
    const atA = A.tick(E);
    assert.strictEqual(atA.timeouts.length, 1);
    assert.strictEqual(atA.bodies[0].type, 'ChannelHtlcFail');
    assert.throws(() => B.receiveSettlement(atA.bodies[0]), /preimage we hold/);
    // A is stuck mid-round; after the safety margin it goes on chain.
    assert.strictEqual(A.tick(E + SAFETY - 1).actions.length, 0);
    const late = A.tick(E + SAFETY);
    assert.deepStrictEqual(late.actions.map((x) => x.type), ['forceClose', 'timeoutHtlc']);
    assert.strictEqual(late.actions[0].reason, 'htlc-timeout');
    assert.strictEqual(late.actions[1].htlcId, A.lastSignedCommitment.htlcs[0].id);
  });

  it('ChannelBook.tick returns actions and emits each new one once', function () {
    let tip = 10;
    const { out, pump } = books(2, { tipHeight: () => tip });
    const [A, B] = out;
    const { session } = bookOpen(A, B);
    pump();
    const seen = [];
    A.book.on('channelAction', (x) => seen.push(x));
    assert.deepStrictEqual(A.book.tick().actions, []);
    tip = 5000 - 144 - 144;
    const first = A.book.tick();
    assert.strictEqual(first.actions.length, 1);
    assert.strictEqual(first.actions[0].reason, 'channel-expiry');
    assert.strictEqual(first.actions[0].channelId, session.channelId);
    assert.strictEqual(A.book.tick().actions.length, 1, 'still returned');
    assert.strictEqual(seen.length, 1, 'emitted once');
    const block = A.book.onBlock({ height: tip });
    assert.deepStrictEqual(Object.keys(block).sort(), ['actions', 'observations', 'published']);
    assert.strictEqual(seen.length, 1);
  });
});

describe('@fabric/core/types/channel hardening: inbound ChannelOpen trust', function () {
  it('refuses delays outside [minToSelfDelay, maxToSelfDelay], short-lived channels, unknown tips, malleable funding, and wrong capacity', function () {
    const refuse = (opts, re) => {
      const { A, B } = pair(opts);
      assert.throws(() => B.receive(A.open()), re);
      assert.strictEqual(B.state.lastSigned, null);
    };
    refuse({ toSelfDelay: 6 }, /toSelfDelay 6 outside \[144, 2016\]/);
    refuse({ toSelfDelay: 3000 }, /toSelfDelay 3000 outside/);
    refuse({ expireAfter: 600 }, /channel expires within 1008 blocks/);
    refuse({ B: { tipHeight: () => null } }, /chain tip unknown/);
    // P2PKH-style scriptSig: a third party could malleate the funding txid.
    const p2pkhSig = bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.from(party().pub, 'hex')]);
    refuse({ scriptSig: p2pkhSig }, /not segwit \(txid malleable\)/);
    // B agreed to 100000 sats; the funder funded (and signs balances for) only 90000.
    refuse({ capacity: 90000, capacityB: 100000 }, /capacitySats 100000 is not the funding output value 90000/);
  });

  it('needs a confirmations source; refuses HTLCs and fulfils before the funding confirms', function () {
    let confs = 0;
    const { A, B, clock } = pair({ A: { confirmations: () => 6 }, B: { confirmations: () => confs } });
    sync(A, B, A.open());
    assert.strictEqual(A.status, 'open');
    assert.strictEqual(B.status, 'pending');
    assert.strictEqual(B.state.fundingConfirmed, false);
    const pre = rnd();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: hashOf(pre), expireAfter: clock.tip + 400 });
    assert.throws(() => B.receive(offer), /channel pending/);
    confs = 1;
    B.tick(clock.tip);
    assert.strictEqual(B.status, 'open');
    sync(A, B, offer);
    // Trust is never implied: without a confirmations source the non-funder is unconfirmed.
    const bare = pair({ B: { fundingConfirmed: undefined } });
    assert.strictEqual(bare.B.state.fundingConfirmed, false);
    assert.strictEqual(bare.A.state.fundingConfirmed, true, 'the funder trusts its own funding');
    // A received HTLC is never revealed off-chain while the funding is unconfirmed.
    B.state.fundingConfirmed = false;
    assert.throws(() => B.fulfillHtlc(B.state.htlcs[0].id, pre), /funding not confirmed/);
    assert.strictEqual(B.preimageFor(hashOf(pre)), pre);
  });

  it('a book without a confirmations source refuses inbound opens', function () {
    const { out } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    const lax = new Channel.Book({ localPrivateKey: B.p.priv, network: 'regtest', tipHeight: () => 10 });
    const { body } = bookOpen(A, B);
    assert.throws(() => lax.ingest(body), /needs a confirmations source/);
    assert.strictEqual(lax.sessions.size, 0);
  });
});

describe('@fabric/core/types/channel hardening: seller-fulfils preimage lookup', function () {
  it('passes the HTLC to preimageFor(hash, htlc) so the host can refuse an underpaid HTLC', function () {
    let tip = 10;
    const { out, pump } = books(2, { tipHeight: () => tip });
    const [A, B] = out;
    const preimages = new Map();
    const calls = [];
    B.book._preimageFor = (hash, htlc) => {
      calls.push({ hash, htlc });
      return htlc && htlc.amountSats >= 2000 ? preimages.get(hash) || null : null;
    };
    const committed = [];
    B.book.on('htlcCommitted', (e) => committed.push(e));
    const { session } = bookOpen(A, B);
    pump();
    const cheap = rnd(); preimages.set(hashOf(cheap), cheap);
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex: hashOf(cheap), expireAfter: tip + 1000 }), session);
    pump();
    assert.strictEqual(committed.length, 1);
    assert.strictEqual(session.state.htlcs.length, 1, 'underpaid HTLC not fulfilled');
    assert.strictEqual(session.preimageFor(hashOf(cheap)), null);
    assert.ok(calls.some((c) => c.htlc && c.htlc.amountSats === 1000 && c.htlc.paymentHashHex === hashOf(cheap)));
    assert.strictEqual(B.book.preimageFor(hashOf(cheap), { amountSats: 1000 }), null, 'host is authoritative for an HTLC');

    const paid = rnd(); preimages.set(hashOf(paid), paid);
    A.book.publish(session.offerHtlc({ amountSats: 2000, paymentHashHex: hashOf(paid), expireAfter: tip + 1000 }), session);
    pump();
    assert.strictEqual(session.preimageFor(hashOf(paid)), paid);
    assert.strictEqual(session.state.htlcs.length, 1);
  });

  it('does not reveal off-chain without margin; hands the preimage to the watchdog instead', function () {
    let tip = 10;
    const { out, pump } = books(2, { tipHeight: () => tip });
    const [A, B] = out;
    const pre = rnd();
    let release = false;
    B.book._preimageFor = (hash) => (release ? pre : null);
    const { session } = bookOpen(A, B);
    pump();
    const E = tip + 300;
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex: hashOf(pre), expireAfter: E }), session);
    pump();
    release = true;
    tip = E - 144 - SAFETY;
    const r = B.book.tick();
    pump();
    assert.strictEqual(session.state.htlcs.length, 1, 'no off-chain reveal');
    assert.strictEqual(session.preimageFor(hashOf(pre)), null);
    assert.deepStrictEqual(r.actions.map((x) => x.type), ['forceClose', 'claimHtlc']);
    assert.strictEqual(r.actions[1].preimageHex, pre);
  });
});

describe('@fabric/core/types/channel hardening: concurrent updates + reconnect', function () {
  it('simultaneous proposals converge: the funder wins, the other side rolls back and re-proposes', function () {
    const ctx = opened();
    const { A, B, clock } = ctx;
    payB(ctx, 5000);
    const pA = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    const pB = B.offerHtlc({ amountSats: 1500, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    assert.strictEqual(pA.number, pB.number);
    assert.strictEqual(A.receive(pB), null, 'funder ignores the colliding proposal');
    const reply = B.receive(pA);
    assert.strictEqual(B.state.rolledBack.length, 1);
    const revoke = A.receive(reply);
    assert.strictEqual(B.receive(revoke), null);
    assert.strictEqual(A.receive(pB), null, 'late abandoned proposal is ignored');
    const again = B.repropose();
    assert.ok(again && again.number === pA.number + 1);
    sync(B, A, again);
    assert.strictEqual(A.number, B.number);
    assert.strictEqual(A.state.htlcs.length, 2);
    assert.strictEqual(B.state.htlcs.length, 2);
    assert.deepStrictEqual(A.balances, { localSats: B.balances.remoteSats, remoteSats: B.balances.localSats });
    assert.strictEqual(A.finalize().txid, A.commitment.txid);
  });

  it('a settlement colliding with a funder proposal is replayed after the round', function () {
    const ctx = opened();
    const { A, B, clock } = ctx;
    const pre = rnd();
    sync(A, B, A.offerHtlc({ amountSats: 2000, paymentHashHex: hashOf(pre), expireAfter: clock.tip + 400 }));
    const fulfil = B.fulfillHtlc(B.state.htlcs[0].id, pre);
    const pA = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    assert.strictEqual(A.receiveSettlement(fulfil), null);
    assert.strictEqual(A.preimageFor(hashOf(pre)), pre, 'funder learns the preimage from the losing proposal');
    sync(A, B, pA);
    assert.strictEqual(B.state.settled.length, 0, 'rolled-back settlement is not recorded');
    sync(B, A, B.repropose());
    assert.strictEqual(B.balances.localSats, 2000);
    assert.strictEqual(A.state.htlcs.length, 1);
  });

  it('books converge on simultaneous proposals without host intervention', function () {
    let tip = 10;
    const { out, pump } = books(2, { tipHeight: () => tip });
    const [A, B] = out;
    const pre = rnd();
    B.book._preimageFor = (h) => (h === hashOf(pre) ? pre : null);
    const { session } = bookOpen(A, B);
    pump();
    A.book.publish(session.offerHtlc({ amountSats: 5000, paymentHashHex: hashOf(pre), expireAfter: tip + 1000 }), session);
    pump();
    const sB = B.book.sessions.get(session.channelId);
    assert.strictEqual(sB.balances.localSats, 5000);
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: tip + 1000 }), session);
    B.book.publish(sB.offerHtlc({ amountSats: 1500, paymentHashHex: rnd(), expireAfter: tip + 1000 }), sB);
    pump();
    assert.strictEqual(session.busy, false);
    assert.strictEqual(sB.busy, false);
    assert.strictEqual(session.number, sB.number);
    assert.strictEqual(session.state.htlcs.length, 2);
    assert.strictEqual(sB.state.htlcs.length, 2);
  });

  it('reestablish recovers a dropped reply, a dropped revoke, and duplicate deliveries', function () {
    const { A, B, clock } = opened();
    // Dropped reply.
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    B.receive(offer);
    const answer = B.ingest(A.reestablish());
    assert.ok(Array.isArray(answer));
    assert.ok(answer.some((x) => x.type === 'ChannelCommitment' && x.number === 1 && x.revoke));
    let revoke = null;
    for (const body of answer) { const r = A.ingest(body); if (r) revoke = r; }
    assert.strictEqual(revoke.type, 'ChannelRevoke');
    assert.strictEqual(B.receive(revoke), null);
    assert.strictEqual(A.busy || B.busy, false);
    // Duplicates are harmless.
    assert.strictEqual(B.receive(offer), null);
    assert.strictEqual(B.receive(revoke), null);
    assert.strictEqual(A.number, 1);
    // Dropped revoke.
    const offer2 = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    A.receive(B.receive(offer2));
    assert.strictEqual(B.busy, true);
    const resent = A.handleReestablish(B.reestablish());
    assert.deepStrictEqual(resent.map((x) => [x.type, x.number]), [['ChannelRevoke', 1]]);
    for (const body of resent) B.ingest(body);
    assert.strictEqual(B.busy, false);
    assert.strictEqual(B.number, 2);
  });

  it('book.reestablish resends a ChannelOpen the peer never answered', function () {
    const { out, deliver, pump } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    const { session } = bookOpen(A, B);
    deliver(A, { drop: true });
    assert.strictEqual(B.book.sessions.size, 0);
    const sent = A.book.reestablish();
    assert.strictEqual(sent[0].type, 'ChannelOpen');
    pump();
    assert.strictEqual(session.status, 'open');
    assert.strictEqual(B.book.sessions.get(session.channelId).status, 'open');
    // Once open, reestablish is a ChannelReestablish answered with nothing new.
    assert.strictEqual(A.book.reestablish()[0].type, 'ChannelReestablish');
    pump();
    assert.strictEqual(session.busy, false);
  });
});

describe('@fabric/core/types/channel hardening: fees', function () {
  it('only the funder changes the fee, within its reserve', function () {
    const ctx = opened();
    const { A, B, b, clock } = ctx;
    payB(ctx, 5000);
    assert.throws(() => B.updateFee(700), /only the funder/);
    assert.throws(() => B.updateFeerate(2), /only the funder/);
    // A non-funder proposal that changes the fee is refused.
    const offer = B.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    const forged = resign(Object.assign({}, offer, { feeSats: offer.feeSats + 100, localSats: offer.localSats - 100 }), b.priv);
    assert.throws(() => A.receive(forged), /only the funder may change the commitment fee/);
    sync(B, A, offer);

    // Funder spends almost everything; a fee bump can't eat into the reserve.
    const big = opened({ capacity: 20000 });
    payB(big, 17000);
    const left = big.A.balances.localSats;
    assert.ok(left < 3000);
    assert.throws(() => big.A.updateFee(500 + left), /channelReserveSats|cannot cover/);
  });

  it('feerate mode: fee = feerate × vsize including HTLC outputs, paid by the funder', function () {
    const fee0 = Channel.commitmentFeeSats(2, 0);
    assert.strictEqual(fee0, 2 * Channel.estimateCommitmentVsize(0));
    assert.ok(Channel.estimateCommitmentVsize(1) > Channel.estimateCommitmentVsize(0));
    const { A, B, a, open, clock } = opened({ fee: fee0, A: { feerate: 2 } });
    assert.strictEqual(B.feerate, 2);
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    const fee1 = Channel.commitmentFeeSats(2, 1);
    assert.strictEqual(offer.feeSats, fee1);
    assert.strictEqual(A.balances.localSats, open - 1000 - (fee1 - fee0));
    const forged = resign(Object.assign({}, offer, { feeSats: fee0, localSats: offer.localSats + (fee1 - fee0) }), a.priv);
    assert.throws(() => B.receive(forged), /does not follow 2 sat\/vB/);
    sync(A, B, offer);
    assert.strictEqual(B.feeSats, fee1);
    assert.throws(() => A.updateFeerate(0), /feerate must be/);
    sync(A, B, A.updateFeerate(3));
    assert.strictEqual(B.feeSats, Channel.commitmentFeeSats(3, 1));
  });

  it('fixed fee: refuses HTLCs that would push the fee below the minimum feerate', function () {
    const { A, B, clock } = opened({ fee: 500 });
    for (let i = 0; i < 4; i++) sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 }));
    assert.ok(Channel.commitmentFeeSats(1, 5) > 500);
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 }), /below 1 sat\/vB/);
    assert.throws(() => A.updateFee(Channel.commitmentFeeSats(1, 4) - 1), /below 1 sat\/vB|within/);
    sync(A, B, A.updateFee(600));
    sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 }));
    assert.strictEqual(B.state.htlcs.length, 5);
  });
});

describe('@fabric/core/types/channel hardening: channel ids', function () {
  it('binds the id to the funding outpoint; refuses ambiguous outputs and overwrites', function () {
    const a = party(); const b = party();
    const f = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 5000, capacitySats: 20000 });
    const make = (fundedTxHex, funding = f) => new Channel.Session({ funding, fundedTxHex, localPrivateKey: a.priv, localSats: 20000 - 500 - ANCHORS, remoteSats: 0, localAddress: a.address, remoteAddress: b.address, tipHeight: () => 100 });
    const s1 = make(fundingTx(f.address, 20000));
    const s2 = make(fundingTx(f.address, 20000));
    assert.notStrictEqual(s1.channelId, s2.channelId, 'two fundings of one address');
    assert.strictEqual(s1.funding.fundingVout, 0);
    assert.match(s1.funding.fundingTxid, /^[0-9a-f]{64}$/);
    const twice = fundingTx(f.address, 0, { outputs: [20000, 20000] });
    assert.throws(() => make(twice), /more than once/);
    const txid = bitcoin.Transaction.fromHex(twice).getId();
    const v1 = make(twice, Channel.buildFunding(Object.assign({}, f, { funder: 'local', fundingTxid: txid, fundingVout: 1 })));
    const v0 = make(twice, Channel.buildFunding(Object.assign({}, f, { funder: 'local', fundingTxid: txid, fundingVout: 0 })));
    assert.notStrictEqual(v0.channelId, v1.channelId);
    const other = fundingTx(f.address, 0, { outputs: [] });
    const tx = bitcoin.Transaction.fromHex(other);
    tx.addOutput(bitcoin.address.toOutputScript(a.address, NET), 1000n);
    tx.addOutput(bitcoin.address.toOutputScript(f.address, NET), 20000n);
    assert.throws(() => make(tx.toHex(), Channel.buildFunding(Object.assign({}, f, { funder: 'local', fundingTxid: tx.getId(), fundingVout: 0 }))), /does not pay the channel address/);

    const book = new Channel.Book({ localPrivateKey: a.priv, network: 'regtest' });
    book.add(s1);
    book.add(s1);
    assert.throws(() => book.add(Channel.Session.import(s1.export(), a.priv)), /already registered/);
    assert.strictEqual(book.sessions.get(s1.channelId), s1);
  });

  it('ignores a ChannelOpen whose declared id is not the derived one', function () {
    const { out } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    const { body } = bookOpen(A, B);
    const forged = resign(Object.assign({}, body, { channelId: 'ff'.repeat(32) }), A.p.priv);
    assert.strictEqual(B.book.ingest(forged), null);
    assert.strictEqual(B.book.sessions.size, 0);
  });
});

describe('@fabric/core/types/channel hardening: forwarding', function () {
  it('forwards only irrevocably committed HTLCs with a safe CLTV delta and retries upstream settlement', function () {
    const tip = 10;
    const { out, deliver, pump } = books(3, { tipHeight: () => tip, forwardPolicy: { feeSats: 10, cltvDelta: 10 } });
    const [A, B, C] = out;
    const ab = bookOpen(A, B);
    const bc = bookOpen(B, C);
    pump();
    const pre = rnd();
    const upExpire = tip + 1000;
    A.book.publish(ab.session.offerHtlc({ amountSats: 1010, paymentHashHex: hashOf(pre), expireAfter: upExpire }), ab.session);
    deliver(A);
    const upstream = B.book.sessions.get(ab.session.channelId);
    assert.strictEqual(upstream.busy, true);
    assert.throws(() => B.book.forward(upstream, upstream.state.htlcs[0].id, bc.session), /not irrevocably committed/);
    pump();
    B.book.forward(upstream, upstream.state.htlcs[0].id, bc.session);
    pump();
    const atC = C.book.sessions.get(bc.session.channelId);
    assert.strictEqual(atC.state.htlcs[0].expireAfter.height, upExpire - Channel.minForwardCltvDelta(bc.session), 'policy delta raised to the safe minimum');

    // Upstream busy when the downstream preimage arrives: settlement is queued, then retried.
    A.book.publish(ab.session.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: upExpire }), ab.session);
    deliver(A);
    assert.strictEqual(upstream.busy, true);
    C.book.publish(atC.fulfillHtlc(atC.state.htlcs[0].id, pre), atC);
    deliver(C);
    assert.strictEqual(B.book.pendingPropagation.length, 1);
    assert.strictEqual(B.book.export().pendingPropagation.length, 1, 'persisted');
    pump();
    assert.strictEqual(B.book.pendingPropagation.length, 0);
    assert.strictEqual(ab.session.preimageFor(hashOf(pre)), pre);
    assert.strictEqual(upstream.balances.localSats, 1010);
  });
});

describe('@fabric/core/types/channel hardening: persistence', function () {
  it('persists before publishing; a failing persist cancels the publish', async function () {
    const log = [];
    const a = party(); const b = party();
    const book = new Channel.Book({ localPrivateKey: a.priv, network: 'regtest', tipHeight: () => 10, persist: (s, body) => log.push(['persist', body.type]), publish: (body) => log.push(['publish', body.type]) });
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 5000 });
    book.open({ remotePubkey: b.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, feeSats: 500, localAddress: a.address, remoteAddress: b.address });
    assert.deepStrictEqual(log, [['persist', 'ChannelOpen'], ['publish', 'ChannelOpen']]);

    const sent = [];
    let resolve;
    const slow = new Channel.Book({ localPrivateKey: a.priv, network: 'regtest', tipHeight: () => 10, persist: () => new Promise((r) => { resolve = r; }), publish: (body) => sent.push(body) });
    slow.open({ remotePubkey: b.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, feeSats: 500, localAddress: a.address, remoteAddress: b.address });
    assert.strictEqual(sent.length, 0, 'waits for persist');
    resolve();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(sent.length, 1);

    const none = [];
    const failing = new Channel.Book({ localPrivateKey: a.priv, network: 'regtest', tipHeight: () => 10, persist: () => { throw new Error('disk full'); }, publish: (body) => none.push(body) });
    assert.throws(() => failing.open({ remotePubkey: b.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, feeSats: 500, localAddress: a.address, remoteAddress: b.address }), /disk full/);
    assert.strictEqual(none.length, 0);
  });

  it('keys revocations by state number: replays are idempotent, a conflicting secret is refused', function () {
    const { A, B, b, clock } = opened();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    const reply = B.receive(offer);
    A.receive(reply);
    assert.deepStrictEqual(Object.keys(A.state.revokedSecrets), ['0']);
    const revoke0 = reply.revoke;
    assert.strictEqual(A.receive(revoke0), null);
    const conflicting = resign(Object.assign({}, revoke0, { perCommitmentSecret: rnd() }), b.priv);
    assert.throws(() => A.receive(conflicting), /conflicting secret for state 0/);
  });

  it('requires a chain tip to offer or accept HTLCs', function () {
    const { A, clock } = opened({ A: { tipHeight: undefined } });
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 }), /chain tip unknown or stale/);
    const other = opened();
    const offer = other.A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: other.clock.tip + 400 });
    other.clock.tip = null;
    assert.throws(() => other.B.receive(offer), /receive: chain tip unknown or stale/);
  });
});

describe('@fabric/core/types/channel hardening: justice, settlements, and HTLC rows', function () {
  it('builds one justice tx per output and skips outputs already spent', function () {
    const { A, B, clock } = opened();
    const pre = rnd();
    sync(A, B, A.offerHtlc({ amountSats: 5000, paymentHashHex: hashOf(pre), expireAfter: clock.tip + 400 }));
    const stale = A.finalize();
    const htlcVout = stale.commitment.outputs.find((o) => o.kind === 'htlc').vout;
    sync(B, A, B.fulfillHtlc(B.state.htlcs[0].id, pre));
    const all = B.observe(stale.txHex, { destinationAddress: B.localAddress, feeSats: 400, perOutput: true });
    assert.strictEqual(all.justice.inputs.length, 2);
    assert.deepStrictEqual(all.justiceSpends.map((x) => x.kind).sort(), ['htlc', 'toLocal']);
    for (const spend of all.justiceSpends) assert.strictEqual(bitcoin.Transaction.fromHex(spend.txHex).ins.length, 1);
    const rest = B.observe(stale.txHex, { destinationAddress: B.localAddress, feeSats: 400, perOutput: true, excludeVouts: [htlcVout] });
    assert.deepStrictEqual(rest.justice.inputs.map((x) => x.kind), ['toLocal']);
    assert.deepStrictEqual(rest.justiceSpends.map((x) => x.kind), ['toLocal']);
  });

  it('checks the outer channel id of a settlement', function () {
    const { A, B, b, clock } = opened();
    const pre = rnd();
    sync(A, B, A.offerHtlc({ amountSats: 2000, paymentHashHex: hashOf(pre), expireAfter: clock.tip + 400 }));
    const fulfil = B.fulfillHtlc(B.state.htlcs[0].id, pre);
    assert.throws(() => A.receiveSettlement(resign(Object.assign({}, fulfil, { channelId: 'ab'.repeat(32) }), b.priv)), /channel id mismatch/);
    sync(B, A, fulfil);
  });

  it('validates counterparty HTLC rows', function () {
    const { A, B, a, clock } = opened();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: clock.tip + 400 });
    const row = offer.htlcs[0];
    const bad = (patch) => resign(Object.assign({}, offer, { htlcs: [Object.assign({}, row, patch)] }), a.priv);
    assert.throws(() => B.receive(bad({ id: 'bad id!' })), /invalid HTLC id/);
    assert.throws(() => B.receive(bad({ amountSats: '1000' })), /amountSats must be a positive integer/);
    assert.throws(() => B.receive(bad({ paymentHashHex: 'zz' })), /paymentHashHex/);
    assert.throws(() => B.receive(bad({ direction: 'sideways' })), /direction invalid/);
    assert.throws(() => B.receive(bad({ expireAfter: null })), /expireAfter height required/);
    assert.throws(() => B.receive(resign(Object.assign({}, offer, { htlcs: [row, row] }), a.priv)), /duplicate HTLC id/);
    assert.throws(() => B.receive(resign(Object.assign({}, offer, { htlcs: 'nope' }), a.priv)), /htlcs must be an array/);
    sync(A, B, offer);
  });

  it('reports the settled HTLC direction and keeps the announced set across export/import', function () {
    let tip = 10;
    const { out, pump } = books(2, { tipHeight: () => tip });
    const [A, B] = out;
    const settledAtB = [];
    const committedAtB = [];
    B.book.on('htlcSettled', (e) => settledAtB.push(e));
    B.book.on('htlcCommitted', (e) => committedAtB.push(e));
    const { session } = bookOpen(A, B);
    pump();
    const E = tip + 400;
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: E }), session);
    pump();
    assert.strictEqual(committedAtB.length, 1);
    const snap = JSON.parse(JSON.stringify(B.book.export()));
    assert.strictEqual(snap.announced.length, 1);

    // Restored book does not re-announce the old HTLC.
    const restored = new Channel.Book({ localPrivateKey: B.p.priv, network: 'regtest', confirmations: () => 6, tipHeight: () => tip, publish: (body) => B.queue.push(body) }).import(snap);
    const reannounced = [];
    restored.on('htlcCommitted', (e) => reannounced.push(e));
    restored.on('htlcSettled', (e) => settledAtB.push(e));
    B.book = restored;
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex: rnd(), expireAfter: E }), session);
    pump();
    assert.strictEqual(reannounced.length, 1);
    assert.notStrictEqual(reannounced[0].htlcId, committedAtB[0].htlcId);

    // The sender fails its expired HTLCs; the receiver's event says `received`.
    tip = E;
    A.book.tick();
    pump();
    A.book.tick();
    pump();
    assert.strictEqual(session.state.htlcs.length, 0);
    assert.ok(settledAtB.length >= 1);
    for (const e of settledAtB) {
      assert.strictEqual(e.direction, 'received');
      assert.strictEqual(e.outcome, 'failed');
    }
  });
});
