'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Coinjoin = require('../types/coinjoin');

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
