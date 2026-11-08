'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Coinjoin = require('../types/coinjoin');
const ecc = require('../types/ecc');
const Bond = require('../types/bond');
const CoinjoinBook = require('../types/coinjoinBook');
const bip32 = require('../functions/bip32');
const { CoinjoinTakerRound, CoinjoinMakerRound, descriptorPrivateKey, envelopeRecipient, memoryWallet, memoryChain } = require('../types/coinjoinRound');

const NOW = 1700000000000;

function txid () {
  return crypto.randomBytes(32).toString('hex');
}

function party (values) {
  const keys = values.map(() => Coinjoin.randomPrivateKey());
  const inputs = keys.map((key, i) => ({
    txid: txid(),
    vout: i,
    valueSats: values[i],
    scriptPubKeyHex: Coinjoin.taprootKeyPath(key).scriptPubKeyHex
  }));
  return {
    keys,
    inputs,
    coinjoinScriptHex: Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).scriptPubKeyHex,
    changeScriptHex: Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).scriptPubKeyHex
  };
}

function offer (makerKey, fields = {}) {
  return Coinjoin.signBody(Object.assign({
    type: Coinjoin.BODY_TYPES.OFFER,
    network: 'regtest',
    minSats: 100000,
    maxSats: 10000000,
    feeSats: 100,
    feePpm: 200,
    txFeeContributionSats: 50,
    createdAt: NOW,
    expiresAt: NOW + 3600000,
    makerPubkey: Coinjoin.pubkeyFromPrivate(makerKey),
    nonce: Coinjoin.randomNonce()
  }, fields), makerKey);
}

function round () {
  const amountSats = 1000000;
  const taker = party([1500000]);
  const makers = [0, 1].map((i) => {
    const key = Coinjoin.randomPrivateKey();
    const side = party(i === 0 ? [1200000] : [700000, 600000]);
    return Object.assign(side, { id: `m${i}`, makerKey: key, offer: offer(key) });
  });
  const built = Coinjoin.buildPsbt({
    networkName: 'regtest',
    amountSats,
    feeRateSatVb: 2,
    lockTime: 500,
    taker,
    makers
  });
  return { amountSats, taker, makers, built };
}

describe('Coinjoin', function () {
  describe('bodies', function () {
    it('signs and verifies an offer, and rejects a tampered one', function () {
      const key = Coinjoin.randomPrivateKey();
      const body = offer(key);
      const checked = Coinjoin.verifyBody(body);
      assert.strictEqual(checked.ok, true, checked.reason);
      assert.strictEqual(checked.id, Coinjoin.bodyId(body));
      const tampered = Object.assign({}, body, { feeSats: 1 });
      assert.strictEqual(Coinjoin.verifyBody(tampered).reason, 'bad signature');
    });

    it('refuses to sign with a key that is not the author', function () {
      const body = offer(Coinjoin.randomPrivateKey());
      assert.throws(() => Coinjoin.signBody(body, Coinjoin.randomPrivateKey()), /does not match makerPubkey/);
    });

    it('rejects malformed offers', function () {
      const key = Coinjoin.randomPrivateKey();
      assert.throws(() => offer(key, { feePpm: Coinjoin.MAX_FEE_PPM + 1 }), /feePpm/);
      assert.throws(() => offer(key, { minSats: 500 }), /minSats/);
      assert.throws(() => offer(key, { expiresAt: NOW }), /expiresAt/);
      assert.strictEqual(Coinjoin.fromBody({ type: 'toString' }), null);
      assert.strictEqual(Coinjoin.fromBody({ type: Coinjoin.BODY_TYPES.OFFER, version: 2 }), null);
    });

    it('seals round messages to one recipient', function () {
      const takerKey = Coinjoin.randomPrivateKey();
      const makerKey = Coinjoin.randomPrivateKey();
      const fill = Coinjoin.signBody({
        type: Coinjoin.BODY_TYPES.FILL,
        offerId: 'aa'.repeat(32),
        roundId: Coinjoin.randomRoundId(),
        amountSats: 200000,
        commitment: 'bb'.repeat(32),
        takerPubkey: Coinjoin.pubkeyFromPrivate(takerKey),
        createdAt: NOW,
        nonce: Coinjoin.randomNonce()
      }, takerKey);
      const sealed = Coinjoin.sealRoundMessage(fill, Coinjoin.pubkeyFromPrivate(makerKey));
      assert.ok(!JSON.stringify(sealed).includes(fill.commitment));
      const opened = Coinjoin.openRoundMessage(sealed, makerKey);
      assert.strictEqual(opened.ok, true, opened.reason);
      assert.deepStrictEqual(opened.body, fill);
      assert.strictEqual(Coinjoin.openRoundMessage(sealed, Coinjoin.randomPrivateKey()).ok, false);
      assert.throws(() => Coinjoin.sealRoundMessage(offer(makerKey), Coinjoin.pubkeyFromPrivate(takerKey)), /only round messages/);
    });

    it('carries offers and sealed envelopes as CONTRACT_MESSAGE bodies', function () {
      const Message = require('../types/message');
      const makerKey = Coinjoin.randomPrivateKey();
      const takerKey = Coinjoin.randomPrivateKey();
      const roundTrip = (value) => {
        const message = Message.fromLegacyBody('CONTRACT_MESSAGE', Coinjoin.toContractMessage(value));
        const parsed = Message.tryParseLegacyBody(Message.fromBuffer(message.toBuffer()));
        assert.strictEqual(parsed.ok, true);
        return Coinjoin.fromContractMessage(parsed.value);
      };

      const o = offer(makerKey);
      const read = roundTrip(o);
      assert.strictEqual(read.kind, 'offer');
      assert.strictEqual(read.id, Coinjoin.bodyId(o));

      const fill = Coinjoin.signBody({
        type: Coinjoin.BODY_TYPES.FILL,
        offerId: read.id,
        roundId: Coinjoin.randomRoundId(),
        amountSats: 200000,
        commitment: 'bb'.repeat(32),
        takerPubkey: Coinjoin.pubkeyFromPrivate(takerKey),
        createdAt: NOW,
        nonce: Coinjoin.randomNonce()
      }, takerKey);
      const sealed = roundTrip(Coinjoin.sealRoundMessage(fill, Coinjoin.pubkeyFromPrivate(makerKey)));
      assert.strictEqual(sealed.kind, 'sealed');
      assert.deepStrictEqual(Coinjoin.openRoundMessage(sealed.envelope, makerKey).body, fill);

      assert.throws(() => Coinjoin.toContractMessage(fill), /sealed envelopes/);
      assert.strictEqual(Coinjoin.fromContractMessage(Object.assign({ contract: Coinjoin.SEAL_NAMESPACE }, fill)), null);
      assert.strictEqual(Coinjoin.fromContractMessage(Object.assign({}, Coinjoin.toContractMessage(o), { contract: 'other' })), null);
      const forged = Object.assign({}, Coinjoin.toContractMessage(o), { feeSats: 1 });
      assert.strictEqual(Coinjoin.fromContractMessage(forged), null);
    });

    it('checks a fill against its offer', function () {
      const key = Coinjoin.randomPrivateKey();
      const o = offer(key);
      const fill = { offerId: Coinjoin.bodyId(o), amountSats: 200000, takerPubkey: Coinjoin.pubkeyFromPrivate(Coinjoin.randomPrivateKey()) };
      assert.strictEqual(Coinjoin.validateFill(o, fill, { now: NOW }).ok, true);
      assert.strictEqual(Coinjoin.validateFill(o, Object.assign({}, fill, { amountSats: 50 }), { now: NOW }).ok, false);
      assert.strictEqual(Coinjoin.validateFill(o, fill, { now: NOW + 7200000 }).reason, 'offer expired');
    });
  });

  describe('fees', function () {
    it('computes maker fee and change', function () {
      assert.strictEqual(Coinjoin.makerFee({ feeSats: 100, feePpm: 200 }, 1000000), 300);
      assert.strictEqual(Coinjoin.makerChange({ inputSats: 1200000, amountSats: 1000000, cjfeeSats: 300, txFeeContributionSats: 50 }), 200250);
      assert.strictEqual(Coinjoin.makerChange({ inputSats: 1000100, amountSats: 1000000, cjfeeSats: 0 }), 0);
      assert.throws(() => Coinjoin.makerChange({ inputSats: 900000, amountSats: 1000000, cjfeeSats: 0 }), /do not cover/);
    });

    it('sizes P2TR transactions', function () {
      assert.strictEqual(Coinjoin.estimateVsize(1, 1), 111);
      assert.strictEqual(Coinjoin.estimateVsize(2, 2), 212);
    });
  });

  describe('transaction', function () {
    it('builds equal outputs with BIP-69 order, version 2, and nLockTime', function () {
      const { amountSats, built } = round();
      const tx = Coinjoin.describePsbt(built.psbtBase64);
      assert.strictEqual(tx.version, 2);
      assert.strictEqual(tx.lockTime, 500);
      assert.strictEqual(tx.inputs.length, 4);
      assert.strictEqual(tx.outputs.filter((o) => o.valueSats === amountSats).length, 3);
      assert.ok(tx.inputs.every((i) => i.sequence === 0xfffffffe));
      const sorted = tx.inputs.map((i) => i.txid);
      assert.deepStrictEqual(sorted, sorted.slice().sort());
      const values = tx.outputs.map((o) => o.valueSats);
      assert.deepStrictEqual(values, values.slice().sort((a, b) => a - b));
      const fee = tx.inputs.reduce((t, i) => t + i.valueSats, 0) - tx.outputs.reduce((t, o) => t + o.valueSats, 0);
      assert.strictEqual(fee, built.plan.minerFeeSats);
      assert.ok(fee >= built.plan.vsize * 2);
    });

    it('pays each maker exactly its fee', function () {
      const { built, makers } = round();
      for (const m of makers) {
        const inputSats = m.inputs.reduce((t, i) => t + i.valueSats, 0);
        const change = built.plan.outputs.find((o) => o.id === m.id && o.kind === 'change');
        assert.strictEqual(change.valueSats, inputSats - 1000000 + 300 - 50);
      }
      assert.strictEqual(built.plan.totalMakerFeesSats, 600);
    });

    it('refuses too few makers, reused scripts, and short taker inputs', function () {
      const { taker, makers } = round();
      const base = { amountSats: 1000000, feeRateSatVb: 2, lockTime: 1, taker, makers };
      assert.throws(() => Coinjoin.plan(Object.assign({}, base, { makers: makers.slice(0, 1) })), /at least 2 makers/);
      const reused = Object.assign({}, makers[1], { coinjoinScriptHex: makers[0].coinjoinScriptHex });
      assert.throws(() => Coinjoin.plan(Object.assign({}, base, { makers: [makers[0], reused] })), /reused/);
      const poor = Object.assign({}, taker, { inputs: [Object.assign({}, taker.inputs[0], { valueSats: 1000100 })] });
      assert.throws(() => Coinjoin.plan(Object.assign({}, base, { taker: poor })), /taker inputs do not cover/);
    });

    it('runs a full round: makers validate and sign, taker merges and finalizes', function () {
      const { amountSats, taker, makers, built } = round();
      let psbt = built.psbtBase64;
      for (const m of makers) {
        const check = Coinjoin.validateForMaker({
          psbtBase64: built.psbtBase64,
          amountSats,
          offer: m.offer,
          inputs: m.inputs,
          coinjoinScriptHex: m.coinjoinScriptHex,
          changeScriptHex: m.changeScriptHex,
          lockTimeMax: 501
        });
        assert.strictEqual(check.ok, true, check.reason);
        assert.strictEqual(check.inputIndexes.length, m.inputs.length);
        const signed = Coinjoin.signKeyPathInputs(built.psbtBase64, m.keys);
        assert.strictEqual(signed.signed.length, m.inputs.length);
        psbt = Coinjoin.mergeMakerSignatures(psbt, signed.psbtBase64, m.inputs);
      }
      const takerCheck = Coinjoin.validateForTaker({ psbtBase64: psbt, plan: built.plan });
      assert.strictEqual(takerCheck.ok, true, takerCheck.reason);
      psbt = Coinjoin.signKeyPathInputs(psbt, taker.keys).psbtBase64;
      const final = Coinjoin.finalize(psbt);
      assert.strictEqual(final.txid, built.unsignedTxid);
      const tx = bitcoin.Transaction.fromHex(final.txHex);
      assert.ok(tx.ins.every((i) => i.witness.length === 1 && i.witness[0].length === 64));
      assert.strictEqual(final.feeSats, built.plan.minerFeeSats);
    });

    it('lets a maker refuse a short change or a missing output', function () {
      const { amountSats, makers, built } = round();
      const m = makers[0];
      const greedy = Object.assign({}, m.offer, { feeSats: 5000 });
      const resigned = Coinjoin.signBody(Object.assign({}, greedy, { signature: undefined }), m.makerKey);
      const check = Coinjoin.validateForMaker({
        psbtBase64: built.psbtBase64,
        amountSats,
        offer: resigned,
        inputs: m.inputs,
        coinjoinScriptHex: m.coinjoinScriptHex,
        changeScriptHex: m.changeScriptHex
      });
      assert.strictEqual(check.reason, 'maker change missing or short');
      const other = Coinjoin.validateForMaker({
        psbtBase64: built.psbtBase64,
        amountSats,
        offer: m.offer,
        inputs: m.inputs,
        coinjoinScriptHex: Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).scriptPubKeyHex,
        changeScriptHex: m.changeScriptHex
      });
      assert.strictEqual(other.reason, 'maker coinjoin output missing or wrong amount');
    });

    it('refuses a maker signature that is invalid or for another transaction', function () {
      const { makers, built } = round();
      const m = makers[0];
      const wrong = Coinjoin.signKeyPathInputs(built.psbtBase64, [Coinjoin.randomPrivateKey()]);
      assert.throws(() => Coinjoin.mergeMakerSignatures(built.psbtBase64, wrong.psbtBase64, m.inputs), /not signed/);
      const other = round();
      const signedOther = Coinjoin.signKeyPathInputs(other.built.psbtBase64, other.makers[0].keys);
      assert.throws(() => Coinjoin.mergeMakerSignatures(built.psbtBase64, signedOther.psbtBase64, m.inputs), /different transaction/);
      const signed = bitcoin.Psbt.fromBase64(Coinjoin.signKeyPathInputs(built.psbtBase64, m.keys).psbtBase64);
      const index = signed.data.inputs.findIndex((i) => i.tapKeySig);
      const sig = Buffer.from(signed.data.inputs[index].tapKeySig);
      sig[10] ^= 1;
      signed.data.inputs[index].tapKeySig = sig;
      assert.throws(() => Coinjoin.mergeMakerSignatures(built.psbtBase64, signed.toBase64(), m.inputs), /invalid/);
    });

    it('lets the taker catch an output that differs from the plan', function () {
      const { built } = round();
      const psbt = bitcoin.Psbt.fromBase64(built.psbtBase64);
      psbt.addOutput({ script: Buffer.from(Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).scriptPubKeyHex, 'hex'), value: 1000n });
      const check = Coinjoin.validateForTaker({ psbtBase64: psbt.toBase64(), plan: built.plan });
      assert.strictEqual(check.ok, false);
    });
  });

  describe('ownership proofs', function () {
    it('signs with the output key and binds the round', function () {
      const key = Coinjoin.randomPrivateKey();
      const input = { txid: txid(), vout: 3, scriptPubKeyHex: Coinjoin.taprootKeyPath(key).scriptPubKeyHex };
      const roundId = Coinjoin.randomRoundId();
      input.ownershipSig = Coinjoin.signOwnership({ roundId, txid: input.txid, vout: input.vout, internalPrivateKey: key });
      assert.strictEqual(Coinjoin.verifyOwnership({ roundId, input }), true);
      assert.strictEqual(Coinjoin.verifyOwnership({ roundId: Coinjoin.randomRoundId(), input }), false);
    });
  });
});

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

function xOnly (priv) {
  return Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1).toString('hex');
}

const UTXO = { txid: 'ab'.repeat(32), vout: 1 };

describe('Coinjoin (PoDLE)', function () {
  it('derives three distinct generators, none equal to G', function () {
    const seen = new Set();
    for (let i = 0; i < Coinjoin.PODLE_MAX_INDEX; i++) {
      const hex = Buffer.from(Coinjoin.podleGenerator(i).toBytes(true)).toString('hex');
      assert.notStrictEqual(hex, Buffer.from(ecc.pointFromScalar(Buffer.from('00'.repeat(31) + '01', 'hex'), true)).toString('hex'));
      seen.add(hex);
    }
    assert.strictEqual(seen.size, Coinjoin.PODLE_MAX_INDEX);
    assert.throws(() => Coinjoin.podleGenerator(Coinjoin.PODLE_MAX_INDEX), /index/);
  });

  it('round-trips a commitment and its reveal', function () {
    const priv = randomPriv();
    const { commitment, reveal } = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO, index: 1 });
    assert.strictEqual(commitment, Coinjoin.podleCommitment(reveal.P2));
    assert.strictEqual(reveal.P.slice(2), xOnly(priv));
    assert.deepStrictEqual(Coinjoin.verifyPodle({ commitment, reveal }), { ok: true, reason: null });
  });

  it('gives different commitments per index and the same P', function () {
    const priv = randomPriv();
    const a = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO, index: 0 });
    const b = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO, index: 2 });
    assert.notStrictEqual(a.commitment, b.commitment);
    assert.strictEqual(a.reveal.P, b.reveal.P);
    // Commitments are deterministic per (key, index): retries cannot dodge the blacklist.
    assert.strictEqual(Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO, index: 0 }).commitment, a.commitment);
  });

  it('rejects tampered reveals', function () {
    const priv = randomPriv();
    const { commitment, reveal } = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO });
    const other = Coinjoin.generatePodle({ privateKey: randomPriv(), utxo: UTXO });
    const cases = [
      [{ commitment: other.commitment, reveal }, /commitment/],
      [{ commitment, reveal: Object.assign({}, reveal, { P: other.reveal.P }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { vout: 2 }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { txid: 'cd'.repeat(32) }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { index: 1 }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { s: reveal.e }) }, /DLEQ/],
      [{ commitment, reveal: Object.assign({}, reveal, { e: '00'.repeat(32) }) }, /range/],
      [{ commitment, reveal: Object.assign({}, reveal, { index: 3 }) }, /index/]
    ];
    for (const [input, reason] of cases) {
      const v = Coinjoin.verifyPodle(input);
      assert.strictEqual(v.ok, false);
      assert.match(v.reason, reason);
    }
  });

  it('refuses a P2 forged without the key (different discrete log)', function () {
    const priv = randomPriv();
    const forged = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO });
    // Swap in P2 from another key: the commitment then names P2' but the proof binds P.
    const other = Coinjoin.generatePodle({ privateKey: randomPriv(), utxo: UTXO });
    const reveal = Object.assign({}, forged.reveal, { P2: other.reveal.P2 });
    const v = Coinjoin.verifyPodle({ commitment: Coinjoin.podleCommitment(reveal.P2), reveal });
    assert.strictEqual(v.ok, false);
  });

  it('checks the revealed UTXO against the chain', function () {
    const priv = randomPriv();
    const { reveal } = Coinjoin.generatePodle({ privateKey: priv, utxo: UTXO });
    const utxo = { scriptPubKeyHex: `5120${xOnly(priv)}`, valueSats: 50000, confirmations: 10 };
    assert.strictEqual(Coinjoin.checkPodleUtxo({ reveal, utxo, amountSats: 100000 }).ok, true);
    assert.match(Coinjoin.checkPodleUtxo({ reveal, utxo: null, amountSats: 100000 }).reason, /spent/);
    assert.match(Coinjoin.checkPodleUtxo({ reveal, utxo: Object.assign({}, utxo, { scriptPubKeyHex: `5120${'11'.repeat(32)}` }), amountSats: 100000 }).reason, /P2TR/);
    assert.match(Coinjoin.checkPodleUtxo({ reveal, utxo: Object.assign({}, utxo, { confirmations: 2 }), amountSats: 100000 }).reason, /confirmations/);
    assert.match(Coinjoin.checkPodleUtxo({ reveal, utxo, amountSats: 1000000 }).reason, /20%/);
  });

  it('tracks the next unused index', function () {
    assert.strictEqual(Coinjoin.nextPodleIndex([]), 0);
    assert.strictEqual(Coinjoin.nextPodleIndex([0, 2]), 1);
    assert.strictEqual(Coinjoin.nextPodleIndex([0, 1, 2]), null);
  });

  it('remembers used commitments in a bounded blacklist', function () {
    const list = new Coinjoin.PodleBlacklist({ max: 2 });
    const [a, b, c] = ['aa', 'bb', 'cc'].map((x) => x.repeat(32));
    assert.strictEqual(list.add(a), true);
    assert.strictEqual(list.add(a), false);
    list.add(b);
    list.add(c);
    assert.strictEqual(list.size, 2);
    assert.strictEqual(list.has(a), false);
    assert.strictEqual(list.has(c), true);
    const restored = new Coinjoin.PodleBlacklist({ commitments: list.toJSON() });
    assert.deepStrictEqual(restored.toJSON(), [b, c]);
  });
});

describe('types/coinjoinBook', function () {
  const NOW = 1700000000000;

  function maker () {
    const key = Coinjoin.randomPrivateKey();
    return { key, pubkey: Coinjoin.pubkeyFromPrivate(key) };
  }

  function offer (m, fields = {}) {
    return Coinjoin.signBody(Object.assign({
      type: Coinjoin.BODY_TYPES.OFFER,
      network: 'regtest',
      minSats: 100000,
      maxSats: 5000000,
      feeSats: 100,
      feePpm: 100,
      createdAt: NOW,
      expiresAt: NOW + 60000,
      makerPubkey: m.pubkey,
      nonce: Coinjoin.randomNonce()
    }, fields), m.key);
  }

  function cancel (m, offerId) {
    return Coinjoin.signBody({ type: Coinjoin.BODY_TYPES.CANCEL, offerId, makerPubkey: m.pubkey, createdAt: NOW }, m.key);
  }

  function bondFor (m, valueSats, utxos, opts = {}) {
    const bondKey = opts.bondKey || Coinjoin.randomPrivateKey();
    const txid = opts.txid || crypto.randomBytes(32).toString('hex');
    const locktime = 60000;
    const out = Bond.buildFidelity({ networkName: 'regtest', bondPubkey: Coinjoin.pubkeyFromPrivate(bondKey), locktime });
    utxos.set(`${txid}:0`, { valueSats, scriptPubKeyHex: out.scriptPubKeyHex, confirmations: 10 });
    return Bond.signFidelityCertificate({
      network: 'regtest', txid, vout: 0, locktime, makerPubkey: m.pubkey, certExpiresAt: 11000, bondPrivateKey: bondKey
    });
  }

  function verifier (utxos) {
    return new Bond.FidelityVerifier({
      network: 'regtest',
      bitcoin: {
        async getTipHeight () { return 10000; },
        async getTxOut (txid, vout) { return utxos.get(`${txid}:${vout}`) || null; }
      }
    });
  }

  let clock;
  let book;

  beforeEach(function () {
    clock = NOW;
    book = new CoinjoinBook({ now: () => clock });
  });

  it('holds valid offers and refuses bad ones', function () {
    const m = maker();
    assert.strictEqual(book.ingest(offer(m)).ok, true);
    assert.strictEqual(book.ingest(offer(m, { network: 'signet' })).reason, 'wrong network');
    assert.strictEqual(book.ingest(offer(m, { createdAt: NOW - 2, expiresAt: NOW - 1 })).reason, 'offer expired');
    const tampered = Object.assign({}, offer(m), { feeSats: 0 });
    assert.strictEqual(book.ingest(tampered).reason, 'bad signature');
    const o = offer(m);
    book.ingest(o);
    assert.strictEqual(book.ingest(o).duplicate, true);
    assert.strictEqual(book.size, 2);
  });

  it('applies cancels only from the maker, including for offers not yet seen', function () {
    const m = maker();
    const other = maker();
    const o = offer(m);
    const id = Coinjoin.bodyId(o);
    assert.strictEqual(book.cancel(cancel(other, id)).ok, true);
    assert.strictEqual(book.ingest(o).ok, true, 'a stranger cannot block the offer');
    assert.strictEqual(book.cancel(cancel(other, id)).reason, 'cancel is not from the maker');
    assert.strictEqual(book.cancel(cancel(m, id)).ok, true);
    assert.strictEqual(book.size, 0);
    assert.strictEqual(book.ingest(o).reason, 'offer cancelled');
  });

  it('caps offers per maker and prunes expired ones', function () {
    const small = new CoinjoinBook({ now: () => clock, maxOffersPerMaker: 2 });
    const m = maker();
    for (let i = 0; i < 3; i++) small.ingest(offer(m));
    assert.strictEqual(small.size, 2);
    clock = NOW + 60000;
    assert.strictEqual(small.prune(), 2);
  });

  it('chooses distinct makers whose range covers the amount and whose fee fits', function () {
    const makers = [maker(), maker(), maker(), maker()];
    book.ingest(offer(makers[0]));
    book.ingest(offer(makers[0], { feeSats: 50 }));
    book.ingest(offer(makers[1]));
    book.ingest(offer(makers[2], { feeSats: 10000 }));
    book.ingest(offer(makers[3], { maxSats: 200000 }));
    const chosen = book.choose(1000000, 5, { maxFeeSats: 1000 });
    const keys = chosen.map((o) => o.makerPubkey).sort();
    assert.deepStrictEqual(keys, [makers[0].pubkey, makers[1].pubkey].sort());
    const first = chosen.find((o) => o.makerPubkey === makers[0].pubkey);
    assert.strictEqual(first.cjfeeSats, 150, 'the maker\'s cheapest fitting offer');
    assert.strictEqual(book.choose(1000000, 5, { maxFeeSats: 1000, exclude: [makers[1].pubkey] }).length, 1);
  });

  it('weights the draw by bond value', async function () {
    const utxos = new Map();
    const bonded = maker();
    const plain = maker();
    book.ingest(offer(bonded, { fidelityBond: bondFor(bonded, 100000000, utxos) }));
    book.ingest(offer(plain));
    const report = await book.refreshBonds(verifier(utxos));
    assert.deepStrictEqual(report, { checked: 1, valid: 1, shared: 0 });
    assert.ok(book.bondOf(bonded.pubkey).value > 0);
    let bondedFirst = 0;
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 1000; i++) {
      if (book.choose(1000000, 1, { random })[0].makerPubkey === bonded.pubkey) bondedFirst++;
    }
    assert.ok(bondedFirst > 850 && bondedFirst < 950, `bonded maker drawn ${bondedFirst} / 1000 (expected ~909)`);
    assert.strictEqual(book.choose(1000000, 2, { requireBond: true }).length, 1);
  });

  it('gives a bond outpoint certified for two makers to neither', async function () {
    const utxos = new Map();
    const a = maker();
    const b = maker();
    const shared = { bondKey: Coinjoin.randomPrivateKey(), txid: crypto.randomBytes(32).toString('hex') };
    const copier = maker();
    const bondA = bondFor(a, 100000000, utxos, shared);
    book.ingest(offer(a, { fidelityBond: bondA }));
    book.ingest(offer(b, { fidelityBond: bondFor(b, 100000000, utxos, shared) }));
    book.ingest(offer(copier, { fidelityBond: bondA }));
    const report = await book.refreshBonds(verifier(utxos));
    assert.strictEqual(report.shared, 2);
    assert.strictEqual(book.bondOf(a.pubkey).ok, false);
    assert.strictEqual(book.bondOf(b.pubkey).reason, 'bond advertised by another maker');
    assert.strictEqual(book.bondOf(copier.pubkey).reason, 'bad certificate');
  });

  it('keeps a bond valid when another maker copies its descriptor', async function () {
    const utxos = new Map();
    const a = maker();
    const b = maker();
    const bond = bondFor(a, 100000000, utxos);
    book.ingest(offer(a, { fidelityBond: bond }));
    book.ingest(offer(b, { fidelityBond: bond }));
    const report = await book.refreshBonds(verifier(utxos));
    assert.strictEqual(report.shared, 0);
    assert.strictEqual(book.bondOf(a.pubkey).ok, true);
    assert.strictEqual(book.bondOf(b.pubkey).ok, false);
    assert.strictEqual(book.bondOf(b.pubkey).reason, 'bad certificate');
  });

  it('keeps a bond valid when another key certifies its outpoint', async function () {
    const utxos = new Map();
    const a = maker();
    const attacker = maker();
    const bond = bondFor(a, 100000000, utxos);
    // A certificate from the attacker's own key verifies offline but does not lock the output.
    const forged = Bond.signFidelityCertificate({
      network: 'regtest',
      txid: bond.txid,
      vout: bond.vout,
      locktime: bond.locktime,
      makerPubkey: attacker.pubkey,
      certExpiresAt: 11000,
      bondPrivateKey: Coinjoin.randomPrivateKey()
    });
    assert.ok(Bond.verifyFidelityCertificate(forged, { makerPubkey: attacker.pubkey, network: 'regtest' }));
    book.ingest(offer(a, { fidelityBond: bond }));
    book.ingest(offer(attacker, { fidelityBond: forged }));
    const report = await book.refreshBonds(verifier(utxos));
    assert.strictEqual(report.shared, 0);
    assert.strictEqual(book.bondOf(a.pubkey).ok, true);
    assert.strictEqual(book.bondOf(attacker.pubkey).reason, 'bond output script does not match');
  });

  it('rejects a bond certified for another maker', async function () {
    const utxos = new Map();
    const a = maker();
    const thief = maker();
    book.ingest(offer(thief, { fidelityBond: bondFor(a, 100000000, utxos) }));
    await book.refreshBonds(verifier(utxos));
    assert.strictEqual(book.bondOf(thief.pubkey).reason, 'bad certificate');
    assert.strictEqual(book.list()[0].bondValue, 0);
  });

  it('summarizes the market', function () {
    book.ingest(offer(maker()));
    book.ingest(offer(maker(), { feeSats: 300 }));
    const index = book.index(1000000);
    assert.strictEqual(index.offers, 2);
    assert.strictEqual(index.makers, 2);
    assert.strictEqual(index.makersForAmount, 2);
    assert.strictEqual(index.cheapestFeeSats, 200);
  });
});

const AMOUNT = 1000000;

function coin (valueSats, chain, confirmations = 10) {
  const c = { txid: crypto.randomBytes(32).toString('hex'), vout: 0, valueSats, internalPrivateKey: Coinjoin.randomPrivateKey(), confirmations };
  chain.utxos.set(`${c.txid}:0`, { valueSats, scriptPubKeyHex: Coinjoin.taprootKeyPath(c.internalPrivateKey).scriptPubKeyHex, confirmations });
  return c;
}

function setup (makerCount = 3, opts = {}) {
  let clock = NOW;
  const now = () => clock;
  const chain = memoryChain({ tip: { height: 500 } });
  const makers = [];
  for (let i = 0; i < makerCount; i++) {
    const identityKey = Coinjoin.randomPrivateKey();
    const offer = Coinjoin.signBody({
      type: Coinjoin.BODY_TYPES.OFFER,
      network: 'regtest',
      minSats: 100000,
      maxSats: 5000000,
      feeSats: 100,
      feePpm: 100,
      txFeeContributionSats: 20,
      createdAt: NOW,
      expiresAt: NOW + 3600000,
      makerPubkey: Coinjoin.pubkeyFromPrivate(identityKey),
      nonce: Coinjoin.randomNonce()
    }, identityKey);
    const wallet = memoryWallet({ coins: [coin(1300000, chain)] });
    makers.push({ identityKey, offer, wallet, blacklist: new Coinjoin.PodleBlacklist() });
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
      assert.strictEqual(Coinjoin.openRoundMessage(msg.envelope, s.makers.find((m) => m.offer.makerPubkey !== msg.to).identityKey).ok, false);
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
    const firstTxid = s.taker.plan && Coinjoin.unsignedTxid(s.taker.psbt);
    const second = await s.taker.rebuild();
    assert.strictEqual(second.length, 2);
    assert.notStrictEqual(Coinjoin.unsignedTxid(s.taker.psbt), firstTxid);
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
    const body = Coinjoin.signBody({
      type: Coinjoin.BODY_TYPES.TX,
      roundId: s.taker.roundId,
      takerPubkey: s.taker.takerPubkey,
      psbt: forged.toBase64(),
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => round.receive(Coinjoin.sealRoundMessage(body, round.sealPubkey)), /maker change missing or short/);
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
    victim.wallet.coins.push(Object.assign({ scriptPubKeyHex: Coinjoin.taprootKeyPath(extra.internalPrivateKey).scriptPubKeyHex }, extra));
    const psbt = bitcoin.Psbt.fromBase64(s.taker.psbt);
    const forged = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    forged.setVersion(2);
    forged.setLocktime(psbt.locktime);
    psbt.txInputs.forEach((input, i) => forged.addInput({ hash: input.hash, index: input.index, sequence: input.sequence, witnessUtxo: psbt.data.inputs[i].witnessUtxo }));
    forged.addInput({
      hash: extra.txid,
      index: 0,
      witnessUtxo: { script: Buffer.from(Coinjoin.taprootKeyPath(extra.internalPrivateKey).scriptPubKeyHex, 'hex'), value: BigInt(extra.valueSats) }
    });
    psbt.txOutputs.forEach((o) => forged.addOutput({ script: Buffer.from(o.script), value: o.value }));
    const thief = Coinjoin.taprootKeyPath(Coinjoin.randomPrivateKey()).scriptPubKeyHex;
    forged.addOutput({ script: Buffer.from(thief, 'hex'), value: BigInt(extra.valueSats - 1000) });
    const roundKey = s.taker.toJSON({ includeSecrets: true }).roundKey;
    const body = Coinjoin.signBody({
      type: Coinjoin.BODY_TYPES.TX,
      roundId: s.taker.roundId,
      takerPubkey: s.taker.takerPubkey,
      psbt: forged.toBase64(),
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => round.receive(Coinjoin.sealRoundMessage(body, round.sealPubkey)), /did not offer/);
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
    const opened = Coinjoin.openRoundMessage(reply, roundKey);
    assert.ok(opened.ok, opened.reason);
    const own = new Set(round.toJSON().inputs.map((c) => `${c.txid}:${c.vout}`));
    const rows = Coinjoin.describePsbt(opened.body.psbt).inputs;
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
    const auth = Coinjoin.signBody({
      type: Coinjoin.BODY_TYPES.AUTH,
      roundId: t.taker.roundId,
      fillId: maker.fillId,
      takerPubkey: t.taker.takerPubkey,
      reveal,
      createdAt: NOW
    }, roundKey);
    await assert.rejects(() => maker.receive(Coinjoin.sealRoundMessage(auth, maker.sealPubkey)), /bad PoDLE/);
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

  it('drops a maker that lists one of the taker\'s coins and rebuilds without it', async function () {
    const s = setup(3, { requireOwnership: false });
    const spare = coin(300000, s.chain);
    s.takerWallet.coins.push(Object.assign({ scriptPubKeyHex: Coinjoin.taprootKeyPath(spare.internalPrivateKey).scriptPubKeyHex }, spare));
    const spareKey = `${spare.txid}:0`;
    let signedSpare = false;
    const sign = s.takerWallet.signPsbt;
    s.takerWallet.signPsbt = async (psbtBase64) => {
      if (Coinjoin.describePsbt(psbtBase64).inputs.some((r) => `${r.txid}:${r.vout}` === spareKey)) signedSpare = true;
      return sign(psbtBase64);
    };
    const thief = s.makers[2];
    const select = thief.wallet.selectInputs;
    thief.wallet.selectInputs = async (opts) => (await select(opts)).concat([{
      txid: spare.txid, vout: 0, valueSats: spare.valueSats, scriptPubKeyHex: Coinjoin.taprootKeyPath(spare.internalPrivateKey).scriptPubKeyHex
    }]);
    delete thief.wallet.signOwnership;
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    // The maker signs only its own coin: the taker's must come from the taker.
    const round = s.makerFor(thief);
    round._state.inputs = round._state.inputs.filter((r) => `${r.txid}:${r.vout}` !== spareKey);
    await s.deliver(await s.taker.buildTx({ feeRateSatVb: 2 }));
    assert.strictEqual(s.taker.status, 'built', 'a transaction missing a signature is not complete');
    assert.deepStrictEqual(s.taker.dropped, [thief.offer.makerPubkey]);
    assert.deepStrictEqual(s.taker.timedOut().map((t) => t.makerPubkey), [thief.offer.makerPubkey]);
    const again = await s.taker.rebuild({ feeRateSatVb: 2 });
    assert.strictEqual(again.length, 2);
    await s.deliver(again);
    assert.strictEqual(s.taker.status, 'signed');
    const final = await s.taker.finalize();
    const tx = bitcoin.Transaction.fromHex(final.txHex);
    assert.ok(!tx.ins.some((i) => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}` === spareKey));
    assert.strictEqual(signedSpare, false, 'the taker never signed its unselected coin');
  });

  it('takes only the taker\'s own signatures from its wallet', async function () {
    const s = setup(2);
    await s.deliver(await s.deliver(await s.taker.start(s.makers.map((m) => m.offer))));
    await s.deliver(await s.taker.buildTx());
    assert.strictEqual(s.taker.status, 'signed');
    const own = new Set(s.taker.toJSON().takerInputs.map((c) => `${c.txid}:${c.vout}`));
    const witnessOf = (psbt) => Coinjoin.describePsbt(psbt).inputs.map((row, i) => ({
      key: `${row.txid}:${row.vout}`,
      witness: bitcoin.Psbt.fromBase64(psbt).data.inputs[i].finalScriptWitness
    }));
    const makerWitness = witnessOf(s.taker.psbt).filter((r) => !own.has(r.key));
    assert.ok(makerWitness.length && makerWitness.every((r) => r.witness));
    // A wallet that also signs a coin a maker listed puts its own witness there.
    const sign = s.takerWallet.signPsbt;
    s.takerWallet.signPsbt = async (psbtBase64) => {
      const psbt = bitcoin.Psbt.fromBase64(await sign(psbtBase64));
      psbt.data.inputs.forEach((input, i) => {
        if (input.finalScriptWitness && !own.has(witnessOf(psbtBase64)[i].key)) {
          input.finalScriptWitness = Buffer.from('0140' + '11'.repeat(64), 'hex');
        }
      });
      return psbt.toBase64();
    };
    const final = await s.taker.finalize();
    const tx = bitcoin.Transaction.fromHex(final.txHex);
    for (const row of makerWitness) {
      const i = tx.ins.findIndex((input) => `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}` === row.key);
      const sent = Buffer.concat([Buffer.from([tx.ins[i].witness.length])].concat(tx.ins[i].witness.map((w) => Buffer.concat([Buffer.from([w.length]), w]))));
      assert.ok(sent.equals(Buffer.from(row.witness)), `maker witness kept on ${row.key}`);
    }
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
      scriptPubKey: Coinjoin.taprootKeyPath(priv).scriptPubKeyHex
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
