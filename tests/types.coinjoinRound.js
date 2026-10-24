'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const coinjoin = require('../functions/coinjoin');
const podle = require('../functions/podle');
const bip32 = require('../functions/bip32');
const {
  CoinjoinTakerRound,
  CoinjoinMakerRound,
  descriptorPrivateKey,
  envelopeRecipient,
  memoryWallet,
  memoryChain
} = require('../types/coinjoinRound');

const NOW = 1700000000000;
const AMOUNT = 1000000;

function coin (valueSats, chain, confirmations = 10) {
  const c = { txid: crypto.randomBytes(32).toString('hex'), vout: 0, valueSats, internalPrivateKey: coinjoin.randomPrivateKey(), confirmations };
  chain.utxos.set(`${c.txid}:0`, { valueSats, scriptPubKeyHex: coinjoin.taprootKeyPath(c.internalPrivateKey).scriptPubKeyHex, confirmations });
  return c;
}

function setup (makerCount = 3, opts = {}) {
  let clock = NOW;
  const now = () => clock;
  const chain = memoryChain({ tip: { height: 500 } });
  const makers = [];
  for (let i = 0; i < makerCount; i++) {
    const identityKey = coinjoin.randomPrivateKey();
    const offer = coinjoin.signBody({
      type: coinjoin.BODY_TYPES.OFFER,
      network: 'regtest',
      minSats: 100000,
      maxSats: 5000000,
      feeSats: 100,
      feePpm: 100,
      txFeeContributionSats: 20,
      createdAt: NOW,
      expiresAt: NOW + 3600000,
      makerPubkey: coinjoin.pubkeyFromPrivate(identityKey),
      nonce: coinjoin.randomNonce()
    }, identityKey);
    const wallet = memoryWallet({ coins: [coin(1300000, chain)] });
    makers.push({ identityKey, offer, wallet, blacklist: new podle.PodleBlacklist() });
  }
  const takerWallet = memoryWallet({ coins: [coin(1600000, chain)] });
  const taker = new CoinjoinTakerRound(Object.assign({
    network: 'regtest',
    amountSats: AMOUNT,
    adapters: { bitcoin: chain, wallet: takerWallet },
    requireOwnership: true,
    now
  }, opts));
  const rounds = new Map();
  const makerFor = (m) => {
    if (!rounds.has(m.offer.makerPubkey)) {
      rounds.set(m.offer.makerPubkey, new CoinjoinMakerRound({
        offer: m.offer,
        identityKey: m.identityKey,
        adapters: { bitcoin: chain, wallet: m.wallet },
        blacklist: m.blacklist,
        now
      }));
    }
    return rounds.get(m.offer.makerPubkey);
  };
  // Deliver taker messages; collect maker replies (`skip` drops a maker's messages).
  const deliver = async (messages, skip = new Set()) => {
    const replies = [];
    for (const msg of messages) {
      if (skip.has(msg.to)) continue;
      const m = makers.find((x) => x.offer.makerPubkey === msg.to);
      const reply = await makerFor(m).receive(msg.envelope);
      if (reply) replies.push(reply);
    }
    const next = [];
    for (const reply of replies) next.push(...await taker.receive(reply));
    return next;
  };
  return { chain, taker, makers, rounds, makerFor, deliver, takerWallet, tick: (ms) => { clock += ms; } };
}

describe('types/coinjoinRound', function () {
  it('runs a round with three makers to a broadcast transaction', async function () {
    const s = setup(3);
    const fills = await s.taker.start(s.makers.map((m) => m.offer));
    assert.strictEqual(s.taker.status, 'filled');
    const auths = await s.deliver(fills);
    assert.strictEqual(s.taker.status, 'authed');
    assert.deepStrictEqual(await s.deliver(auths), []);
    const txs = await s.taker.buildTx({ feeRateSatVb: 2 });
    assert.strictEqual(txs.length, 3);
    await s.deliver(txs);
    assert.strictEqual(s.taker.status, 'signed');
    const final = await s.taker.finalize();
    assert.strictEqual(s.taker.status, 'broadcast');
    assert.strictEqual(s.chain.broadcasts.length, 1);
    const tx = bitcoin.Transaction.fromHex(final.txHex);
    assert.strictEqual(tx.outs.filter((o) => Number(o.value) === AMOUNT).length, 4);
    for (const round of s.rounds.values()) assert.strictEqual(round.status, 'signed');
    assert.ok(s.makers.every((m) => m.blacklist.size === 1), 'each maker spent the one commitment');
  });

  it('seals every message to its recipient', async function () {
    const s = setup(2);
    const fills = await s.taker.start(s.makers.map((m) => m.offer));
    for (const msg of fills) {
      assert.strictEqual(envelopeRecipient(msg.envelope), msg.to.slice(2));
      assert.strictEqual(coinjoin.openRoundMessage(msg.envelope, s.makers.find((m) => m.offer.makerPubkey !== msg.to).identityKey).ok, false);
    }
    const replies = await s.deliver(fills);
    const round = s.makerFor(s.makers[0]);
    const auth = replies.find((r) => r.to === s.makers[0].offer.makerPubkey);
    assert.strictEqual(envelopeRecipient(auth.envelope), round.sealXOnly);
  });

  it('drops a maker that does not sign and rebuilds without it', async function () {
    const s = setup(3);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    const staller = s.makers[2].offer.makerPubkey;
    const first = await s.taker.buildTx({ feeRateSatVb: 2 });
    await s.deliver(first, new Set([staller]));
    assert.strictEqual(s.taker.status, 'built');
    assert.deepStrictEqual(s.taker.timedOut(), []);
    s.tick(61000);
    assert.deepStrictEqual(s.taker.timedOut().map((t) => t.makerPubkey), [staller]);
    const firstTxid = s.taker.plan && coinjoin.unsignedTxid(s.taker.psbt);
    const second = await s.taker.rebuild();
    assert.strictEqual(second.length, 2);
    assert.notStrictEqual(coinjoin.unsignedTxid(s.taker.psbt), firstTxid);
    assert.deepStrictEqual(s.taker.dropped, [staller]);
    await s.deliver(second);
    assert.strictEqual(s.taker.status, 'signed');
    await s.taker.finalize();
    const tx = bitcoin.Transaction.fromHex(s.chain.broadcasts[0]);
    assert.strictEqual(tx.outs.filter((o) => Number(o.value) === AMOUNT).length, 3);
  });

  it('refuses to rebuild below the minimum number of makers', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    await s.taker.buildTx();
    await assert.rejects(() => s.taker.rebuild({ drop: [s.makers[0].offer.makerPubkey] }), /need 2/);
  });

  it('lets a maker refuse a transaction that shorts it', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    const txs = await s.taker.buildTx();
    const victim = s.makers[0];
    const round = s.makerFor(victim);
    const psbt = bitcoin.Psbt.fromBase64(s.taker.psbt);
    const outs = psbt.txOutputs.map((o) => ({ script: Buffer.from(o.script), value: o.value }));
    const change = outs.findIndex((o) => Buffer.from(o.script).toString('hex') === round.toJSON().changeScriptHex);
    const forged = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    forged.setVersion(2);
    forged.setLocktime(psbt.locktime);
    psbt.txInputs.forEach((input, i) => forged.addInput({ hash: input.hash, index: input.index, sequence: input.sequence, witnessUtxo: psbt.data.inputs[i].witnessUtxo }));
    outs.forEach((o, i) => forged.addOutput({ script: o.script, value: i === change ? o.value - 1000n : o.value }));
    const roundKey = s.taker.toJSON({ includeSecrets: true }).roundKey;
    const body = coinjoin.signBody({
      type: coinjoin.BODY_TYPES.TX,
      roundId: s.taker.roundId,
      takerPubkey: s.taker.takerPubkey,
      psbt: forged.toBase64(),
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => round.receive(coinjoin.sealRoundMessage(body, round.sealPubkey)), /maker change missing or short/);
    assert.strictEqual(round.status, 'aborted');
    assert.ok(txs.length === 2);
  });

  it('refuses a transaction that spends another of the maker\'s coins', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    await s.taker.buildTx();
    const victim = s.makers[0];
    const round = s.makerFor(victim);
    const extra = coin(500000, s.chain);
    victim.wallet.coins.push(Object.assign({ scriptPubKeyHex: coinjoin.taprootKeyPath(extra.internalPrivateKey).scriptPubKeyHex }, extra));
    const psbt = bitcoin.Psbt.fromBase64(s.taker.psbt);
    const forged = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    forged.setVersion(2);
    forged.setLocktime(psbt.locktime);
    psbt.txInputs.forEach((input, i) => forged.addInput({ hash: input.hash, index: input.index, sequence: input.sequence, witnessUtxo: psbt.data.inputs[i].witnessUtxo }));
    forged.addInput({
      hash: extra.txid,
      index: 0,
      witnessUtxo: { script: Buffer.from(coinjoin.taprootKeyPath(extra.internalPrivateKey).scriptPubKeyHex, 'hex'), value: BigInt(extra.valueSats) }
    });
    psbt.txOutputs.forEach((o) => forged.addOutput({ script: Buffer.from(o.script), value: o.value }));
    const thief = coinjoin.taprootKeyPath(coinjoin.randomPrivateKey()).scriptPubKeyHex;
    forged.addOutput({ script: Buffer.from(thief, 'hex'), value: BigInt(extra.valueSats - 1000) });
    const roundKey = s.taker.toJSON({ includeSecrets: true }).roundKey;
    const body = coinjoin.signBody({
      type: coinjoin.BODY_TYPES.TX,
      roundId: s.taker.roundId,
      takerPubkey: s.taker.takerPubkey,
      psbt: forged.toBase64(),
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => round.receive(coinjoin.sealRoundMessage(body, round.sealPubkey)), /did not offer/);
    assert.strictEqual(round.status, 'aborted');
  });

  it('returns signatures for the maker\'s own inputs only', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    const txs = await s.taker.buildTx();
    const m = s.makers[0];
    const round = s.makerFor(m);
    const reply = await round.receive(txs.find((t) => t.to === m.offer.makerPubkey).envelope);
    const roundKey = s.taker.toJSON({ includeSecrets: true }).roundKey;
    const opened = coinjoin.openRoundMessage(reply, roundKey);
    assert.ok(opened.ok, opened.reason);
    const own = new Set(round.toJSON().inputs.map((c) => `${c.txid}:${c.vout}`));
    const rows = coinjoin.describeCoinjoinPsbt(opened.body.psbt).inputs;
    assert.ok(rows.some((r) => r.signed));
    for (const r of rows) assert.strictEqual(r.signed, own.has(`${r.txid}:${r.vout}`));
    const parsed = bitcoin.Psbt.fromBase64(opened.body.psbt);
    assert.ok(parsed.data.inputs.every((d) => !d.tapBip32Derivation), 'no wallet derivation paths');
  });

  it('refuses a reused PoDLE commitment and a bad proof', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    const again = new CoinjoinTakerRound({
      network: 'regtest',
      amountSats: AMOUNT,
      adapters: { bitcoin: s.chain, wallet: s.takerWallet },
      now: () => NOW
    });
    const fills = await again.start(s.makers.map((m) => m.offer));
    const fresh = new CoinjoinMakerRound({
      offer: s.makers[0].offer,
      identityKey: s.makers[0].identityKey,
      adapters: { bitcoin: s.chain, wallet: s.makers[0].wallet },
      blacklist: s.makers[0].blacklist,
      now: () => NOW
    });
    await assert.rejects(() => fresh.receive(fills[0].envelope), /already used/);

    const t = setup(2);
    const tFills = await t.taker.start(t.makers.map((m) => m.offer));
    const maker = t.makerFor(t.makers[0]);
    const ack = await maker.receive(tFills.find((f) => f.to === t.makers[0].offer.makerPubkey).envelope);
    await t.taker.receive(ack);
    const reveal = Object.assign({}, t.taker.toJSON().podle.reveal, { s: '11'.repeat(32) });
    const roundKey = t.taker.toJSON({ includeSecrets: true }).roundKey;
    const auth = coinjoin.signBody({
      type: coinjoin.BODY_TYPES.AUTH,
      roundId: t.taker.roundId,
      fillId: maker.fillId,
      takerPubkey: t.taker.takerPubkey,
      reveal,
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => maker.receive(coinjoin.sealRoundMessage(auth, maker.sealPubkey)), /bad PoDLE/);
  });

  it('drops a maker whose inputs do not match the chain', async function () {
    const s = setup(3);
    const auths = await s.deliver(await s.taker.start(s.makers.map((m) => m.offer)));
    const liar = s.makers[1];
    for (const c of liar.wallet.coins) s.chain.utxos.delete(`${c.txid}:${c.vout}`);
    await s.deliver(auths);
    assert.deepStrictEqual(s.taker.dropped, [liar.offer.makerPubkey]);
    assert.strictEqual((await s.taker.buildTx()).length, 2);
  });

  it('saves and restores both sides mid-round', async function () {
    const s = setup(2);
    const auths = await s.deliver(await s.taker.start(s.makers.map((m) => m.offer)));
    await s.deliver(auths);
    const saved = JSON.parse(JSON.stringify(s.taker.toJSON({ includeSecrets: true })));
    const restored = CoinjoinTakerRound.fromJSON(saved, { adapters: s.taker.adapters, now: () => NOW, requireOwnership: true });
    assert.strictEqual(restored.status, 'authed');
    const txs = await restored.buildTx();
    for (const m of s.makers) {
      const round = s.makerFor(m);
      const again = CoinjoinMakerRound.fromJSON(JSON.parse(JSON.stringify(round.toJSON({ includeSecrets: true }))), {
        identityKey: m.identityKey,
        adapters: round.adapters,
        now: () => NOW
      });
      const msg = txs.find((t) => t.to === m.offer.makerPubkey);
      await restored.receive(await again.receive(msg.envelope));
    }
    assert.strictEqual(restored.status, 'signed');
    assert.ok((await restored.finalize()).txid);
    assert.throws(() => CoinjoinTakerRound.fromJSON(s.taker.toJSON(), { adapters: s.taker.adapters }), /round key is required/);
  });

  it('derives a wallet key from a private tr() descriptor', function () {
    const root = bip32.fromSeed(crypto.randomBytes(32));
    const node = root.derivePath("m/86'/1'/0'/0/7");
    const priv = Buffer.from(node.privateKey);
    const info = {
      hdkeypath: "m/86h/1h/0h/0/7",
      hdmasterfingerprint: Buffer.alloc(4).toString('hex'),
      scriptPubKey: coinjoin.taprootKeyPath(priv).scriptPubKeyHex
    };
    const descriptors = [
      { desc: `wpkh(${root.toBase58()}/84h/1h/0h/0/*)#abcd` },
      { desc: `tr(${root.toBase58()}/86h/1h/0h/0/*)#abcd` }
    ];
    assert.ok(descriptorPrivateKey(Object.assign({}, info, { hdmasterfingerprint: undefined }), descriptors).equals(priv));
    const account = root.derivePath("m/86'/1'/0'");
    const fp = Buffer.alloc(4);
    fp.writeUInt32BE(root.fingerprint >>> 0);
    const withOrigin = [{ desc: `tr([${fp.toString('hex')}/86h/1h/0h]${account.toBase58()}/0/*)#abcd` }];
    assert.ok(descriptorPrivateKey(Object.assign({}, info, { hdmasterfingerprint: fp.toString('hex') }), withOrigin).equals(priv));
    assert.throws(() => descriptorPrivateKey(Object.assign({}, info, { hdkeypath: "m/86h/1h/0h/0/8" }), descriptors), /no private tr/);
  });
});
