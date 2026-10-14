'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Channel = require('../types/channel');
const Witness = require('../types/witness');
const { signerFromPriv32 } = require('../functions/inventoryHtlc');

const NET = bitcoin.networks.regtest;
const ANCHORS = 2 * Channel.DEFAULTS.anchorSats;

function party () {
  const priv = crypto.randomBytes(32);
  const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
  const address = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: NET }).address;
  return { priv, pub, address };
}

/** Fake funding tx paying `sats` to `address` (regtest). */
function fundingTx (address, sats) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, NET), BigInt(sats));
  return tx.toHex();
}

function hashOf (preimageHex) {
  return crypto.createHash('sha256').update(Buffer.from(preimageHex, 'hex')).digest('hex');
}

function pair (capacity = 100000, fee = 500, extra = {}) {
  const a = party();
  const b = party();
  const toSelfDelay = extra.toSelfDelay || 6;
  const fundingA = Channel.buildFunding({ network: 'regtest', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 5000, capacitySats: capacity, toSelfDelay });
  const fundingB = Channel.buildFunding({ network: 'regtest', localPubkey: b.pub, remotePubkey: a.pub, expireAfter: 5000, capacitySats: capacity, funder: 'remote', toSelfDelay });
  assert.strictEqual(fundingA.address, fundingB.address);
  assert.strictEqual(fundingA.channelId, fundingB.channelId);
  const fundedTxHex = fundingTx(fundingA.address, capacity);
  const open = capacity - fee - ANCHORS;
  const A = new Channel.Session(Object.assign({ funding: fundingA, fundedTxHex, localPrivateKey: a.priv, localSats: open, remoteSats: 0, localAddress: a.address, remoteAddress: b.address, feeSats: fee }, extra.A || {}));
  const B = new Channel.Session(Object.assign({ funding: fundingB, fundedTxHex, localPrivateKey: b.priv, localSats: 0, remoteSats: open, localAddress: b.address, remoteAddress: a.address, feeSats: fee }, extra.B || {}));
  return { a, b, A, B, fundedTxHex, open };
}

/** Full round: proposal → reply (+inline revoke) → ChannelRevoke. */
function sync (from, to, body) {
  const trace = Channel.exchange(from, to, body);
  assert.strictEqual(from.fullySigned, true);
  assert.strictEqual(to.fullySigned, true);
  assert.strictEqual(from.busy, false, 'proposer idle after round');
  assert.strictEqual(to.busy, false, 'counterparty idle after round');
  return trace;
}

function opened (capacity, fee, extra) {
  const ctx = pair(capacity, fee, extra);
  const trace = sync(ctx.A, ctx.B, ctx.A.open());
  assert.deepStrictEqual(trace.map((t) => t.type), ['ChannelOpen', 'ChannelCommitment', 'ChannelCommitment']);
  assert.strictEqual(ctx.A.status, 'open');
  assert.strictEqual(ctx.B.status, 'open');
  return ctx;
}

describe('@fabric/core/types/channel (revocation keys)', function () {
  it('derives BOLT3 revocation keys: pubkey from points, privkey once the secret is revealed', function () {
    const base = party();
    const seed = crypto.randomBytes(32);
    const secret = Channel.commitmentSecret(seed, 7);
    const point = Channel.commitmentPoint(secret);
    const revPub = Channel.revocationPubkey(base.pub, point);
    const revPriv = Channel.revocationPrivkey(base.priv, secret);
    assert.strictEqual(Buffer.from(signerFromPriv32(revPriv).publicKey).toString('hex'), revPub);
    assert.notStrictEqual(Channel.commitmentSecret(seed, 8), secret);
  });

  it('refuses mainnet funding', function () {
    const a = party(); const b = party();
    assert.throws(() => Channel.buildFunding({ network: 'mainnet', localPubkey: a.pub, remotePubkey: b.pub, expireAfter: 10 }), /mainnet refused/);
  });
});

describe('@fabric/core/types/channel (Phase 4 sessions)', function () {
  it('opens in three messages; each party holds its own commitment with delayed toLocal + anchors', function () {
    const { A, B, open } = opened();
    assert.notStrictEqual(A.commitment.txid, B.commitment.txid, 'asymmetric commitments');
    const fin = A.finalize();
    const tx = bitcoin.Transaction.fromHex(fin.txHex);
    assert.strictEqual(tx.ins[0].witness.length, 4, '2 sigs + script + control');
    const kinds = A.commitment.outputs.map((o) => o.kind);
    assert.deepStrictEqual(kinds, ['toLocal', 'anchor', 'anchor'], 'B has 0 so no toRemote');
    assert.strictEqual(A.commitment.outputs[0].amountSats, open);
    assert.strictEqual(B.commitment.outputs.map((o) => o.kind).join(), 'toRemote,anchor,anchor');
    assert.ok(B.finalize().txid === B.commitment.txid);
  });

  it('settles chunks off-chain: HTLC per blob, fulfilled by preimage, balances move, states revoked', function () {
    const { A, B, open } = opened(100000, 500);
    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHashHex = hashOf(preimage);
    const blobHashHex = crypto.randomBytes(32).toString('hex');

    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex, blobHashHex, expireAfter: 4000 });
    assert.strictEqual(offer.type, 'ChannelCommitment');
    assert.strictEqual(offer.number, 1);
    assert.strictEqual(A.balances.localSats, open - 1000);
    assert.throws(() => A.offerHtlc({ amountSats: 1, paymentHashHex: hashOf('aa'.repeat(32)), expireAfter: 4000 }), /busy/);
    const trace = sync(A, B, offer);
    assert.deepStrictEqual(trace.map((t) => t.type), ['ChannelCommitment', 'ChannelCommitment', 'ChannelRevoke']);
    assert.ok(trace[1].revoke && trace[1].revoke.number === 0, 'reply revokes state 0 inline');
    assert.strictEqual(Object.keys(A.state.revoked).length, 1);
    assert.strictEqual(Object.keys(B.state.revoked).length, 1);
    assert.strictEqual(B.state.htlcs[0].direction, 'received');
    const htlcOut = A.commitment.outputs.find((o) => o.kind === 'htlc');
    assert.ok(htlcOut && htlcOut.amountSats === 1000 && htlcOut.blobHashHex === blobHashHex);
    assert.deepStrictEqual(htlcOut._htlc._leaves.map((l) => l.id), ['claim', 'timeout', 'revocation']);

    // If A broadcasts its commitment, B claims the HTLC immediately with the preimage;
    // A's timeout leaf is CSV-delayed on A's own commitment.
    const broadcast = A.finalize();
    const claim = Channel.prepareHtlcClaim(A.commitment, { htlcId: htlcOut.id, commitmentTxHex: broadcast.txHex, preimageHex: preimage, destinationAddress: B.localAddress, feeSats: 300, network: 'regtest' });
    assert.strictEqual(claim.delayed, false);
    const bClaim = Channel.prepareHtlcClaim(B.commitment, { htlcId: B.commitment.outputs.find((o) => o.kind === 'htlc').id, commitmentTxHex: B.finalize().txHex, preimageHex: preimage, destinationAddress: B.localAddress, feeSats: 300, network: 'regtest' });
    assert.strictEqual(bClaim.delayed, true, 'receiver waits on its own commitment');
    assert.throws(() => Channel.prepareHtlcClaim(A.commitment, { htlcId: htlcOut.id, commitmentTxHex: broadcast.txHex, preimageHex: '00'.repeat(32), destinationAddress: B.localAddress }), /preimage/);
    const timeout = Channel.prepareHtlcTimeout(A.commitment, { htlcId: htlcOut.id, commitmentTxHex: broadcast.txHex, destinationAddress: A.localAddress, feeSats: 300, network: 'regtest' });
    assert.strictEqual(timeout.delayed, true);

    // Off-chain: B reveals, A applies; both revoke the HTLC state.
    const fulfill = B.fulfillHtlc(htlcOut.id, preimage);
    assert.strictEqual(fulfill.type, 'ChannelHtlcFulfill');
    assert.strictEqual(B.balances.localSats, 1000);
    sync(B, A, fulfill);
    assert.strictEqual(A.balances.remoteSats, 1000);
    assert.strictEqual(A.preimageFor(paymentHashHex), preimage);
    assert.strictEqual(A.state.settled[0].outcome, 'fulfilled');
    assert.strictEqual(Object.keys(A.state.revoked).length, 2);

    // The sender may also settle its own offered HTLC with a preimage it learned elsewhere — pays B.
    const pre3 = crypto.randomBytes(32).toString('hex');
    sync(A, B, A.offerHtlc({ amountSats: 700, paymentHashHex: hashOf(pre3), expireAfter: 4000 }));
    sync(A, B, A.fulfillHtlc(A.state.htlcs[0].id, pre3));
    assert.strictEqual(B.balances.localSats, 1700);
    assert.strictEqual(B.state.htlcs.length, 0);

    // Sub-dust chunk prices become trimmed HTLCs: tracked off-chain, no output.
    const tiny = A.offerHtlc({ amountSats: 5, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    sync(A, B, tiny);
    const trimmedRow = A.commitment.outputs.find((o) => o.kind === 'htlc');
    assert.strictEqual(trimmedRow.trimmed, true);
    assert.strictEqual(A.commitment.trimmedSats, 5);
    assert.throws(() => Channel.prepareHtlcClaim(A.commitment, { htlcId: trimmedRow.id }), /trimmed/);
    sync(B, A, B.failHtlc(trimmedRow.id));

    // Failure returns funds to the sender.
    const fail1 = A.offerHtlc({ amountSats: 2000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    sync(A, B, fail1);
    sync(B, A, B.failHtlc(B.state.htlcs[0].id, 'no-such-chunk'));
    assert.strictEqual(A.balances.localSats, open - 1700);
    assert.strictEqual(B.balances.remoteSats, open - 1700);

    // Cooperative close carries both signatures after exchange.
    const close = A.close();
    assert.strictEqual(close.type, 'ChannelClose');
    const closeTrace = sync(A, B, close);
    assert.strictEqual(closeTrace[1].type, 'ChannelClose');
    assert.strictEqual(B.status, 'closing');
    assert.strictEqual(A.status, 'closing');
    const closed = A.finalize();
    assert.strictEqual(bitcoin.Transaction.fromHex(closed.txHex).outs.length, 4, 'toLocal + toRemote + 2 anchors');

    // Persistence round trip keeps balances, preimages, and revoked states.
    const snap = B.export();
    assert.strictEqual(JSON.stringify(snap).includes('"_leaves"'), false);
    const B2 = Channel.Session.import(snap, B.localPrivateKey);
    assert.strictEqual(B2.balances.localSats, 1700);
    assert.strictEqual(B2.preimageFor(paymentHashHex), preimage);
    assert.strictEqual(B2.commitment.txid, B.commitment.txid);
    assert.strictEqual(Object.keys(B2.state.revoked).length, Object.keys(B.state.revoked).length);
  });

  it('rejects tampered, self-serving, and out-of-order counterparty states', function () {
    const { A, B } = opened();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    const forged = Object.assign({}, offer, { localSats: offer.localSats + 1 });
    assert.throws(() => B.receive(forged), /bad counterparty signature/);
    const resign = (b) => Witness.signArtifact(Object.assign({}, b, { pubkey: undefined, signature: undefined }), A.localPrivateKey);
    assert.throws(() => B.receive(resign(forged)), /balances do not follow/);
    // Proposer tries to move the counterparty's funds.
    const theft = resign(Object.assign({}, offer, { htlcs: [], localSats: offer.localSats + 1001, remoteSats: offer.remoteSats }));
    assert.throws(() => B.receive(theft), /balances do not follow/);
    // Proposer adds an HTLC "from" the counterparty.
    const onBehalf = resign(Object.assign({}, offer, { htlcs: [Object.assign({}, offer.htlcs[0], { direction: 'received' })] }));
    assert.throws(() => B.receive(onBehalf), /on our behalf/);
    // Signature on a different transaction than the derived state.
    const other = resign(Object.assign({}, offer, { commitmentTxid: '11'.repeat(32) }));
    assert.throws(() => B.receive(other), /does not match the derived state/);
    // Skipping a state number.
    assert.throws(() => B.receive(resign(Object.assign({}, offer, { number: 3 }))), /expected state 1/);
    // The honest round still completes afterwards.
    sync(A, B, offer);
  });

  it('refuses to advance while the previous state is unrevoked (no revocation withholding)', function () {
    const { A, B } = opened();
    const offer = A.offerHtlc({ amountSats: 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    const reply = B.receive(offer);
    assert.strictEqual(B.busy, true, 'B waits for A revoke');
    assert.throws(() => B.failHtlc(B.state.htlcs[0].id), /busy/);
    const revoke = A.receive(reply);
    assert.strictEqual(revoke.type, 'ChannelRevoke');
    assert.strictEqual(A.busy, false);
    // B cannot be pushed to state 2 before it sees A's revoke of state 0.
    const next = A.offerHtlc({ amountSats: 10, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    assert.throws(() => B.receive(next), /has not revoked state 0/);
    // A wrong secret is rejected; the right one unblocks.
    const bogus = Witness.signArtifact(Object.assign({}, revoke, { pubkey: undefined, signature: undefined, perCommitmentSecret: '22'.repeat(32) }), A.localPrivateKey);
    assert.throws(() => B.receive(bogus), /does not match the per-commitment point/);
    assert.strictEqual(B.receive(revoke), null);
    assert.strictEqual(B.busy, false);
    sync(A, B, Witness.signArtifact(Object.assign({}, next, { pubkey: undefined, signature: undefined }), A.localPrivateKey));
  });

  it('punishes a stale broadcast: justice tx sweeps toLocal + HTLC outputs, fraud proof verifies', function () {
    const { A, B } = opened(100000, 500);
    const preimage = crypto.randomBytes(32).toString('hex');
    sync(A, B, A.offerHtlc({ amountSats: 5000, paymentHashHex: hashOf(preimage), expireAfter: 4000 }));
    // State 1 (HTLC pending) is A's favourite: it still "owns" the 5000 sats. Capture it now.
    const staleA = A.finalize();
    sync(B, A, B.fulfillHtlc(B.state.htlcs[0].id, preimage));
    assert.strictEqual(A.number, 2);
    // A broadcasts the revoked state 1. Without broadcast evidence the proof
    // is a bare claim; with a block (header + txids) it carries an SPV branch.
    const bare = B.observe(staleA.txHex, { destinationAddress: B.localAddress, feeSats: 400 });
    assert.strictEqual(Witness.FraudProof.fromBody(bare.fraudProof).verify().ok, false, 'no broadcast evidence');
    assert.strictEqual(Witness.FraudProof.fromBody(bare.fraudProof).verify({ txConfirmed: (id) => id === staleA.txid }).ok, true, 'verifier chain view suffices');
    const { merkleRootFromTxids } = require('../functions/bitcoinTxInclusion');
    const txids = [crypto.randomBytes(32).toString('hex'), staleA.txid, crypto.randomBytes(32).toString('hex')];
    const header = Buffer.alloc(80);
    header.writeInt32LE(2, 0);
    Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
    const seen = B.observe(staleA.txHex, { destinationAddress: B.localAddress, feeSats: 400, inclusion: { blockHeaderHex: header.toString('hex'), txids } });
    assert.strictEqual(seen.kind, 'stale');
    assert.strictEqual(seen.number, 1);
    assert.ok(seen.inclusion && seen.inclusion.branch.length === 2);
    const justice = bitcoin.Transaction.fromHex(seen.justice.txHex);
    assert.strictEqual(justice.ins.length, 2, 'toLocal + HTLC swept');
    assert.strictEqual(seen.justice.sweptSats, 100000 - 500 - ANCHORS, 'everything but anchors');
    assert.strictEqual(Number(justice.outs[0].value), seen.justice.sweptSats - 400);
    for (const input of justice.ins) assert.strictEqual(input.witness.length, 3, 'sig + revocation script + control');
    const proof = Witness.FraudProof.fromBody(seen.fraudProof);
    const verdict = proof.verify();
    assert.strictEqual(verdict.ok, true, verdict.reason);
    assert.strictEqual(verdict.evidence, 'inclusion');
    assert.strictEqual(verdict.offender, seen.fraudProof.artifacts.revoke.pubkey);
    // A branch for another block header does not verify.
    const wrongHeader = Buffer.from(header); wrongHeader[40] ^= 1;
    const forged = new Witness.FraudProof(Object.assign({}, seen.fraudProof, { artifacts: Object.assign({}, seen.fraudProof.artifacts, { inclusion: Object.assign({}, seen.inclusion, { blockHeaderHex: wrongHeader.toString('hex') }) }) }));
    assert.strictEqual(forged.verify().ok, false);
    assert.strictEqual(seen.fraudProof.artifacts.revoke.pubkey, A.funding.localPubkey.slice(2));
    // Any third party can check it; a different tx is not the revoked commitment.
    const bogus = new Witness.FraudProof(Object.assign({}, seen.fraudProof, { artifacts: Object.assign({}, seen.fraudProof.artifacts, { staleTxHex: A.finalize().txHex }) }));
    assert.strictEqual(bogus.verify().ok, false);
    // The latest commitment is recognised, not punished.
    assert.strictEqual(B.observe(A.finalize().txHex).kind, 'remote-latest');
    // Preimages are harvested from on-chain claims.
    const claimTx = new bitcoin.Transaction();
    claimTx.addInput(crypto.randomBytes(32), 0);
    claimTx.ins[0].witness = [Buffer.alloc(64), Buffer.from(preimage, 'hex'), Buffer.alloc(10)];
    claimTx.addOutput(bitcoin.address.toOutputScript(A.localAddress, NET), 1000n);
    const C = opened();
    const pre2 = crypto.randomBytes(32).toString('hex');
    sync(C.A, C.B, C.A.offerHtlc({ amountSats: 1000, paymentHashHex: hashOf(pre2), expireAfter: 4000 }));
    claimTx.ins[0].witness[1] = Buffer.from(pre2, 'hex');
    assert.strictEqual(C.A.observe(claimTx.toHex()).kind, 'htlc-spend');
    assert.strictEqual(C.A.preimageFor(hashOf(pre2)), pre2);
  });

  it('enforces negotiated limits: reserve, in-flight, HTLC count, duplicate hashes, fee bounds', function () {
    const { A, B, open } = opened(100000, 500, { A: { policy: { maxAcceptedHtlcs: 2, maxHtlcValueInFlightSats: 3000 } }, B: { policy: { channelReserveSats: 2000, maxCommitFeeSats: 800 } } });
    assert.strictEqual(A.policy.maxAcceptedHtlcs, 2);
    assert.strictEqual(A.policy.channelReserveSats, 2000, 'stricter reserve wins');
    assert.deepStrictEqual(A.policy, B.policy);
    const hash = crypto.randomBytes(32).toString('hex');
    sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: hash, expireAfter: 4000 }));
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: hash, expireAfter: 4000 }), /duplicate paymentHash/);
    assert.throws(() => A.offerHtlc({ amountSats: 2500, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 }), /maxHtlcValueInFlightSats/);
    assert.throws(() => A.offerHtlc({ amountSats: 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4900 }), /past channel expiry window/);
    assert.throws(() => A.offerHtlc({ amountSats: open - 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 }), /maxHtlcValueInFlightSats|reserve/);
    sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 }));
    assert.throws(() => A.offerHtlc({ amountSats: 500, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 }), /maxAcceptedHtlcs/);
    assert.throws(() => A.updateFee(5000), /within/);
    const feeBump = A.updateFee(700);
    sync(A, B, feeBump);
    assert.strictEqual(A.feeSats, 700);
    assert.strictEqual(B.balances.remoteSats, open - 2000 - 200, 'funder pays the fee delta');
  });

  it('gates on chain time: pending funding, expiry window, auto-fail of expired HTLCs, stale tip', function () {
    let tip = 100;
    let confs = 0;
    const deps = { tipHeight: () => tip, confirmations: () => confs };
    const { A, B } = pair(100000, 500, { A: deps, B: deps });
    sync(A, B, A.open());
    assert.strictEqual(A.status, 'pending');
    assert.throws(() => A.offerHtlc({ amountSats: 10, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 400 }), /pending/);
    confs = 1;
    A.tick(tip); B.tick(tip);
    assert.strictEqual(A.status, 'open');
    assert.throws(() => A.offerHtlc({ amountSats: 10, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 103 }), /expires too soon/);
    const h = crypto.randomBytes(32).toString('hex');
    sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: h, expireAfter: 200 }));
    assert.throws(() => A.failHtlc(A.state.htlcs[0].id), /not yet expired/);
    tip = 250;
    const r = B.tick(tip);
    assert.strictEqual(r.bodies.length, 1, 'receiver auto-fails the expired HTLC');
    assert.strictEqual(r.bodies[0].type, 'ChannelHtlcFail');
    sync(B, A, r.bodies[0]);
    assert.strictEqual(A.balances.localSats, 100000 - 500 - ANCHORS);
    // Unknown / stale tip refuses new HTLCs.
    tip = null;
    assert.throws(() => A.offerHtlc({ amountSats: 10, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 400 }), /tip unknown or stale/);
  });

  it('plans a multi-hop atomic HTLC and settles it backward by preimage', function () {
    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHashHex = hashOf(preimage);
    const route = Channel.planRoute({ paymentHashHex, amountSats: 1000, finalExpireHeight: 3000, hops: [{ feeSats: 10, cltvDelta: 40 }, { feeSats: 0, cltvDelta: 40 }] });
    assert.deepStrictEqual(route.hops.map((h) => h.amountSats), [1010, 1000]);
    assert.deepStrictEqual(route.hops.map((h) => h.expireAfter.height), [3040, 3000]);
    assert.strictEqual(Channel.checkForward(route.hops[0], route.hops[1], { feeSats: 10, cltvDelta: 40 }).ok, true);
    assert.strictEqual(Channel.checkForward(route.hops[0], route.hops[1], { feeSats: 11, cltvDelta: 40 }).reason, 'fee-short');

    const ab = opened(); const bc = opened();
    sync(ab.A, ab.B, ab.A.offerHtlc({ id: 'hop0', amountSats: route.hops[0].amountSats, paymentHashHex, expireAfter: route.hops[0].expireAfter }));
    assert.strictEqual(Channel.checkForward(ab.B.state.htlcs[0], route.hops[1], { feeSats: 10, cltvDelta: 40 }).ok, true);
    sync(bc.A, bc.B, bc.A.offerHtlc({ id: 'hop1', amountSats: route.hops[1].amountSats, paymentHashHex, expireAfter: route.hops[1].expireAfter }));
    sync(bc.B, bc.A, bc.B.fulfillHtlc('hop1', preimage));
    const learned = bc.A.preimageFor(paymentHashHex);
    assert.strictEqual(learned, preimage);
    sync(ab.B, ab.A, ab.B.fulfillHtlc('hop0', learned));
    assert.strictEqual(bc.B.balances.localSats, 1000);
    assert.strictEqual(ab.B.balances.localSats, 1010);
    assert.strictEqual(ab.A.balances.localSats, 100000 - 500 - ANCHORS - 1010);
  });
});

describe('@fabric/core/types/channel (Channel.Book host registry)', function () {
  function books (n = 2, extra = {}) {
    const wires = new Map();
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = party();
      const book = new Channel.Book(Object.assign({ localPrivateKey: p.priv, network: 'regtest', publish: (body) => wires.get(book).push(body) }, extra));
      wires.set(book, []);
      out.push({ p, book });
    }
    const pump = () => {
      let moved = true;
      while (moved) {
        moved = false;
        for (const { book } of out) {
          const q = wires.get(book);
          while (q.length) {
            const body = q.shift();
            moved = true;
            for (const other of out) if (other.book !== book) other.book.ingest(body, { sellerId: `peer-${out.indexOf(out.find((x) => x.book === book))}` });
          }
        }
      }
    };
    return { out, pump };
  }

  it('opens, routes inbound bodies to the right session, and persists', function () {
    const { out, pump } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter: 5000 });
    const { session } = A.book.open({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, localAddress: A.p.address, remoteAddress: B.p.address, aliases: ['peer-b'] });
    assert.strictEqual(A.book.sessionFor('peer-b'), session);
    assert.strictEqual(A.book.sessionFor('nobody', B.p.pub), session);
    pump();
    const sB = B.book.sessionFor('peer-0');
    assert.ok(sB && sB.fullySigned && session.fullySigned);
    assert.strictEqual(sB.status, 'open');
    assert.strictEqual(sB.balances.remoteSats, 20000 - 500 - ANCHORS);
    // Stranger opens are ignored.
    const c = party();
    assert.strictEqual(B.book.ingest({ type: 'ChannelOpen', channelId: 'x', funding: { remotePubkey: c.pub } }), null);
    // A pays over the book; the round completes through publish/ingest.
    session.offerHtlc({ amountSats: 1000, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 4000 });
    A.book.publish(null); // no-op
    assert.strictEqual(session.busy, true);
    // The proposal was returned, not published automatically — hosts publish what offerHtlc returns.
    assert.strictEqual(session.number, 1);
    // Snapshot round trip.
    const bookA2 = new Channel.Book({ localPrivateKey: A.p.priv, network: 'regtest' }).import(JSON.parse(JSON.stringify(A.book.export())));
    assert.strictEqual(bookA2.list()[0].channelId, session.channelId);
    assert.strictEqual(bookA2.sessionFor('peer-b').number, 1);
  });

  it('forwards an HTLC across two channels and propagates fulfil / fail upstream', function () {
    const { out, pump } = books(3, { tipHeight: () => 10, forwardPolicy: { feeSats: 10, cltvDelta: 40 } });
    const [A, B, C] = out;
    const fAB = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter: 5000 });
    const fBC = Channel.buildFunding({ network: 'regtest', localPubkey: B.p.pub, remotePubkey: C.p.pub, expireAfter: 5000 });
    const ab = A.book.open({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(fAB.address, 50000), capacitySats: 50000, expireAfter: 5000, localAddress: A.p.address, remoteAddress: B.p.address });
    const bc = B.book.open({ remotePubkey: C.p.pub, fundedTxHex: fundingTx(fBC.address, 50000), capacitySats: 50000, expireAfter: 5000, localAddress: B.p.address, remoteAddress: C.p.address });
    pump();
    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHashHex = hashOf(preimage);
    const route = Channel.planRoute({ paymentHashHex, amountSats: 1000, finalExpireHeight: 3000, hops: [{ feeSats: 10, cltvDelta: 40 }, { feeSats: 0, cltvDelta: 40 }] });
    A.book.publish(ab.session.offerHtlc({ amountSats: route.hops[0].amountSats, paymentHashHex, expireAfter: route.hops[0].expireAfter }), ab.session);
    pump();
    const upstream = B.book.sessions.get(ab.session.channelId);
    assert.strictEqual(upstream.state.htlcs.length, 1);
    // B refuses to forward below its fee / delta policy.
    assert.throws(() => B.book.forward(upstream, upstream.state.htlcs[0].id, bc.session, { feeSats: 2000 }), /fee-short|insufficient/);
    B.book.forward(upstream, upstream.state.htlcs[0].id, bc.session);
    pump();
    const atC = C.book.sessions.get(bc.session.channelId);
    assert.strictEqual(atC.state.htlcs[0].amountSats, 1000);
    assert.strictEqual(atC.state.htlcs[0].expireAfter.height, 3000);
    C.book.publish(atC.fulfillHtlc(atC.state.htlcs[0].id, preimage), atC);
    pump();
    assert.strictEqual(bc.session.preimageFor(paymentHashHex), preimage);
    assert.strictEqual(upstream.balances.localSats, 1010, 'B earned 10 sats forwarding');
    assert.strictEqual(atC.balances.localSats, 1000);
    assert.strictEqual(A.book.sessions.get(ab.session.channelId).balances.remoteSats, 1010);
    assert.strictEqual(B.book.forwards.size, 0);

    // Downstream failure refunds upstream.
    A.book.publish(ab.session.offerHtlc({ amountSats: 500 + 10, paymentHashHex: crypto.randomBytes(32).toString('hex'), expireAfter: 3040 }), ab.session);
    pump();
    B.book.forward(upstream, upstream.state.htlcs[0].id, bc.session);
    pump();
    C.book.publish(atC.failHtlc(atC.state.htlcs[0].id, 'no-such-chunk'), atC);
    pump();
    assert.strictEqual(ab.session.balances.localSats, 50000 - 500 - ANCHORS - 1010);
    assert.strictEqual(upstream.state.htlcs.length, 0);
    assert.strictEqual(upstream.state.settled.pop().outcome, 'failed');
  });

  it('seller-fulfils: the book fulfils a committed HTLC from preimageFor and the payer learns the preimage', function () {
    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHashHex = hashOf(preimage);
    const { out, pump } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    // Only the seller (B) knows the preimage.
    B.book._preimageFor = (h) => (h === paymentHashHex ? preimage : null);
    const events = { committed: [], fulfilled: [], settled: [] };
    B.book.on('htlcCommitted', (e) => events.committed.push(e));
    A.book.on('htlcFulfilled', (e) => events.fulfilled.push(e));
    A.book.on('htlcSettled', (e) => events.settled.push(e));
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter: 5000 });
    const { session } = A.book.open({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, localAddress: A.p.address, remoteAddress: B.p.address });
    pump();
    A.book.publish(session.offerHtlc({ amountSats: 1000, paymentHashHex, blobHashHex: 'ab'.repeat(32), expireAfter: 4000 }), session);
    pump();
    assert.strictEqual(events.committed.length, 1);
    assert.strictEqual(events.committed[0].paymentHashHex, paymentHashHex);
    assert.strictEqual(events.fulfilled.length, 1, 'payer learned the preimage from ChannelHtlcFulfill');
    assert.strictEqual(events.fulfilled[0].preimageHex, preimage);
    assert.strictEqual(events.settled[0].outcome, 'fulfilled');
    assert.strictEqual(session.preimageFor(paymentHashHex), preimage);
    assert.strictEqual(session.balances.remoteSats, 1000);
    assert.strictEqual(session.state.htlcs.length, 0);
    assert.strictEqual(session.resolvable, true, 'latest state carries a counterparty-signed exit');
    assert.strictEqual(session.resolutions.stateIds.length, session.number + 1);
  });

  it('does not register a session for a ChannelOpen that fails validation', function () {
    const { out } = books(2, { tipHeight: () => 10 });
    const [A, B] = out;
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: A.p.pub, remotePubkey: B.p.pub, expireAfter: 5000 });
    const { body } = A.book.open({ remotePubkey: B.p.pub, fundedTxHex: fundingTx(funding.address, 20000), capacitySats: 20000, expireAfter: 5000, localAddress: A.p.address, remoteAddress: B.p.address });
    const forged = Object.assign({}, body, { signature: '00'.repeat(64) });
    assert.throws(() => B.book.ingest(forged, { sellerId: 'peer-a' }));
    assert.strictEqual(B.book.sessions.size, 0);
    assert.strictEqual(B.book.sessionFor('peer-a'), null);
  });
});

describe('@fabric/core/types/channel (unknown tip + output indices)', function () {
  it('refuses sender-side fails when the chain tip is unknown', function () {
    let tip = 10;
    const { A, B } = opened(100000, 500, { A: { tipHeight: () => tip }, B: { tipHeight: () => tip } });
    sync(A, B, A.offerHtlc({ amountSats: 1000, paymentHashHex: hashOf(crypto.randomBytes(32).toString('hex')), expireAfter: 4000 }));
    tip = null;
    assert.throws(() => A.failHtlc(A.state.htlcs[0].id), /chain tip unknown/);
    tip = 4001;
    const fail = A.failHtlc(A.state.htlcs[0].id, 'expired');
    tip = null;
    assert.throws(() => B.receiveSettlement(fail), /chain tip is unknown/);
  });

  it('keeps HTLC and anchor vouts aligned when a dust HTLC is trimmed', function () {
    const { A, B } = opened(100000, 500, { A: { tipHeight: () => 10 }, B: { tipHeight: () => 10 } });
    sync(A, B, A.offerHtlc({ amountSats: 100, paymentHashHex: hashOf(crypto.randomBytes(32).toString('hex')), expireAfter: 4000 }));
    sync(A, B, A.offerHtlc({ amountSats: 5000, paymentHashHex: hashOf(crypto.randomBytes(32).toString('hex')), expireAfter: 4000 }));
    const c = A.commitment;
    const tx = bitcoin.Transaction.fromHex(bitcoin.Psbt.fromBase64(c.psbtBase64).__CACHE.__TX.toHex());
    const trimmed = c.outputs.find((o) => o.kind === 'htlc' && o.trimmed);
    assert.ok(trimmed && trimmed.vout === null, 'trimmed HTLC has no output index');
    for (const row of c.outputs) {
      if (row.vout == null) continue;
      const script = bitcoin.address.toOutputScript(row.address, NET);
      assert.ok(Buffer.from(tx.outs[row.vout].script).equals(script), `${row.kind} vout ${row.vout} points at its own script`);
    }
    assert.strictEqual(c.outputs.filter((o) => o.vout != null).length, tx.outs.length);
  });
});
