'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const coinjoin = require('../functions/coinjoin');

const NOW = 1700000000000;

function txid () {
  return crypto.randomBytes(32).toString('hex');
}

function party (values) {
  const keys = values.map(() => coinjoin.randomPrivateKey());
  const inputs = keys.map((key, i) => ({
    txid: txid(),
    vout: i,
    valueSats: values[i],
    scriptPubKeyHex: coinjoin.taprootKeyPath(key).scriptPubKeyHex
  }));
  return {
    keys,
    inputs,
    coinjoinScriptHex: coinjoin.taprootKeyPath(coinjoin.randomPrivateKey()).scriptPubKeyHex,
    changeScriptHex: coinjoin.taprootKeyPath(coinjoin.randomPrivateKey()).scriptPubKeyHex
  };
}

function offer (makerKey, fields = {}) {
  return coinjoin.signBody(Object.assign({
    type: coinjoin.BODY_TYPES.OFFER,
    network: 'regtest',
    minSats: 100000,
    maxSats: 10000000,
    feeSats: 100,
    feePpm: 200,
    txFeeContributionSats: 50,
    createdAt: NOW,
    expiresAt: NOW + 3600000,
    makerPubkey: coinjoin.pubkeyFromPrivate(makerKey),
    nonce: coinjoin.randomNonce()
  }, fields), makerKey);
}

function round () {
  const amountSats = 1000000;
  const taker = party([1500000]);
  const makers = [0, 1].map((i) => {
    const key = coinjoin.randomPrivateKey();
    const side = party(i === 0 ? [1200000] : [700000, 600000]);
    return Object.assign(side, { id: `m${i}`, makerKey: key, offer: offer(key) });
  });
  const built = coinjoin.buildCoinjoinPsbt({
    networkName: 'regtest',
    amountSats,
    feeRateSatVb: 2,
    lockTime: 500,
    taker,
    makers
  });
  return { amountSats, taker, makers, built };
}

describe('functions/coinjoin', function () {
  describe('bodies', function () {
    it('signs and verifies an offer, and rejects a tampered one', function () {
      const key = coinjoin.randomPrivateKey();
      const body = offer(key);
      const checked = coinjoin.verifyBody(body);
      assert.strictEqual(checked.ok, true, checked.reason);
      assert.strictEqual(checked.id, coinjoin.bodyId(body));
      const tampered = Object.assign({}, body, { feeSats: 1 });
      assert.strictEqual(coinjoin.verifyBody(tampered).reason, 'bad signature');
    });

    it('refuses to sign with a key that is not the author', function () {
      const body = offer(coinjoin.randomPrivateKey());
      assert.throws(() => coinjoin.signBody(body, coinjoin.randomPrivateKey()), /does not match makerPubkey/);
    });

    it('rejects malformed offers', function () {
      const key = coinjoin.randomPrivateKey();
      assert.throws(() => offer(key, { feePpm: coinjoin.MAX_FEE_PPM + 1 }), /feePpm/);
      assert.throws(() => offer(key, { minSats: 500 }), /minSats/);
      assert.throws(() => offer(key, { expiresAt: NOW }), /expiresAt/);
      assert.strictEqual(coinjoin.fromBody({ type: 'toString' }), null);
      assert.strictEqual(coinjoin.fromBody({ type: coinjoin.BODY_TYPES.OFFER, version: 2 }), null);
    });

    it('seals round messages to one recipient', function () {
      const takerKey = coinjoin.randomPrivateKey();
      const makerKey = coinjoin.randomPrivateKey();
      const fill = coinjoin.signBody({
        type: coinjoin.BODY_TYPES.FILL,
        offerId: 'aa'.repeat(32),
        roundId: coinjoin.randomRoundId(),
        amountSats: 200000,
        commitment: 'bb'.repeat(32),
        takerPubkey: coinjoin.pubkeyFromPrivate(takerKey),
        createdAt: NOW,
        nonce: coinjoin.randomNonce()
      }, takerKey);
      const sealed = coinjoin.sealRoundMessage(fill, coinjoin.pubkeyFromPrivate(makerKey));
      assert.ok(!JSON.stringify(sealed).includes(fill.commitment));
      const opened = coinjoin.openRoundMessage(sealed, makerKey);
      assert.strictEqual(opened.ok, true, opened.reason);
      assert.deepStrictEqual(opened.body, fill);
      assert.strictEqual(coinjoin.openRoundMessage(sealed, coinjoin.randomPrivateKey()).ok, false);
      assert.throws(() => coinjoin.sealRoundMessage(offer(makerKey), coinjoin.pubkeyFromPrivate(takerKey)), /only round messages/);
    });

    it('carries offers and sealed envelopes as CONTRACT_MESSAGE bodies', function () {
      const { buildMessage, tryParseLegacyBody } = require('../functions/fabricMessageBodies');
      const Message = require('../types/message');
      const makerKey = coinjoin.randomPrivateKey();
      const takerKey = coinjoin.randomPrivateKey();
      const roundTrip = (value) => {
        const message = buildMessage('CONTRACT_MESSAGE', coinjoin.toContractMessage(value));
        const parsed = tryParseLegacyBody(Message.fromBuffer(message.toBuffer()));
        assert.strictEqual(parsed.ok, true);
        return coinjoin.fromContractMessage(parsed.value);
      };

      const o = offer(makerKey);
      const read = roundTrip(o);
      assert.strictEqual(read.kind, 'offer');
      assert.strictEqual(read.id, coinjoin.bodyId(o));

      const fill = coinjoin.signBody({
        type: coinjoin.BODY_TYPES.FILL,
        offerId: read.id,
        roundId: coinjoin.randomRoundId(),
        amountSats: 200000,
        commitment: 'bb'.repeat(32),
        takerPubkey: coinjoin.pubkeyFromPrivate(takerKey),
        createdAt: NOW,
        nonce: coinjoin.randomNonce()
      }, takerKey);
      const sealed = roundTrip(coinjoin.sealRoundMessage(fill, coinjoin.pubkeyFromPrivate(makerKey)));
      assert.strictEqual(sealed.kind, 'sealed');
      assert.deepStrictEqual(coinjoin.openRoundMessage(sealed.envelope, makerKey).body, fill);

      assert.throws(() => coinjoin.toContractMessage(fill), /sealed envelopes/);
      assert.strictEqual(coinjoin.fromContractMessage(Object.assign({ contract: coinjoin.SEAL_NAMESPACE }, fill)), null);
      assert.strictEqual(coinjoin.fromContractMessage(Object.assign({}, coinjoin.toContractMessage(o), { contract: 'other' })), null);
      const forged = Object.assign({}, coinjoin.toContractMessage(o), { feeSats: 1 });
      assert.strictEqual(coinjoin.fromContractMessage(forged), null);
    });

    it('checks a fill against its offer', function () {
      const key = coinjoin.randomPrivateKey();
      const o = offer(key);
      const fill = { offerId: coinjoin.bodyId(o), amountSats: 200000, takerPubkey: coinjoin.pubkeyFromPrivate(coinjoin.randomPrivateKey()) };
      assert.strictEqual(coinjoin.validateFill(o, fill, { now: NOW }).ok, true);
      assert.strictEqual(coinjoin.validateFill(o, Object.assign({}, fill, { amountSats: 50 }), { now: NOW }).ok, false);
      assert.strictEqual(coinjoin.validateFill(o, fill, { now: NOW + 7200000 }).reason, 'offer expired');
    });
  });

  describe('fees', function () {
    it('computes maker fee and change', function () {
      assert.strictEqual(coinjoin.makerFee({ feeSats: 100, feePpm: 200 }, 1000000), 300);
      assert.strictEqual(coinjoin.makerChange({ inputSats: 1200000, amountSats: 1000000, cjfeeSats: 300, txFeeContributionSats: 50 }), 200250);
      assert.strictEqual(coinjoin.makerChange({ inputSats: 1000100, amountSats: 1000000, cjfeeSats: 0 }), 0);
      assert.throws(() => coinjoin.makerChange({ inputSats: 900000, amountSats: 1000000, cjfeeSats: 0 }), /do not cover/);
    });

    it('sizes P2TR transactions', function () {
      assert.strictEqual(coinjoin.estimateVsize(1, 1), 111);
      assert.strictEqual(coinjoin.estimateVsize(2, 2), 212);
    });
  });

  describe('transaction', function () {
    it('builds equal outputs with BIP-69 order, version 2, and nLockTime', function () {
      const { amountSats, built } = round();
      const tx = coinjoin.describeCoinjoinPsbt(built.psbtBase64);
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
      assert.throws(() => coinjoin.planCoinjoin(Object.assign({}, base, { makers: makers.slice(0, 1) })), /at least 2 makers/);
      const reused = Object.assign({}, makers[1], { coinjoinScriptHex: makers[0].coinjoinScriptHex });
      assert.throws(() => coinjoin.planCoinjoin(Object.assign({}, base, { makers: [makers[0], reused] })), /reused/);
      const poor = Object.assign({}, taker, { inputs: [Object.assign({}, taker.inputs[0], { valueSats: 1000100 })] });
      assert.throws(() => coinjoin.planCoinjoin(Object.assign({}, base, { taker: poor })), /taker inputs do not cover/);
    });

    it('runs a full round: makers validate and sign, taker merges and finalizes', function () {
      const { amountSats, taker, makers, built } = round();
      let psbt = built.psbtBase64;
      for (const m of makers) {
        const check = coinjoin.validateCoinjoinForMaker({
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
        const signed = coinjoin.signKeyPathInputs(built.psbtBase64, m.keys);
        assert.strictEqual(signed.signed.length, m.inputs.length);
        psbt = coinjoin.mergeMakerSignatures(psbt, signed.psbtBase64, m.inputs);
      }
      const takerCheck = coinjoin.validateCoinjoinForTaker({ psbtBase64: psbt, plan: built.plan });
      assert.strictEqual(takerCheck.ok, true, takerCheck.reason);
      psbt = coinjoin.signKeyPathInputs(psbt, taker.keys).psbtBase64;
      const final = coinjoin.finalizeCoinjoin(psbt);
      assert.strictEqual(final.txid, built.unsignedTxid);
      const tx = bitcoin.Transaction.fromHex(final.txHex);
      assert.ok(tx.ins.every((i) => i.witness.length === 1 && i.witness[0].length === 64));
      assert.strictEqual(final.feeSats, built.plan.minerFeeSats);
    });

    it('lets a maker refuse a short change or a missing output', function () {
      const { amountSats, makers, built } = round();
      const m = makers[0];
      const greedy = Object.assign({}, m.offer, { feeSats: 5000 });
      const resigned = coinjoin.signBody(Object.assign({}, greedy, { signature: undefined }), m.makerKey);
      const check = coinjoin.validateCoinjoinForMaker({
        psbtBase64: built.psbtBase64,
        amountSats,
        offer: resigned,
        inputs: m.inputs,
        coinjoinScriptHex: m.coinjoinScriptHex,
        changeScriptHex: m.changeScriptHex
      });
      assert.strictEqual(check.reason, 'maker change missing or short');
      const other = coinjoin.validateCoinjoinForMaker({
        psbtBase64: built.psbtBase64,
        amountSats,
        offer: m.offer,
        inputs: m.inputs,
        coinjoinScriptHex: coinjoin.taprootKeyPath(coinjoin.randomPrivateKey()).scriptPubKeyHex,
        changeScriptHex: m.changeScriptHex
      });
      assert.strictEqual(other.reason, 'maker coinjoin output missing or wrong amount');
    });

    it('refuses a maker signature that is invalid or for another transaction', function () {
      const { makers, built } = round();
      const m = makers[0];
      const wrong = coinjoin.signKeyPathInputs(built.psbtBase64, [coinjoin.randomPrivateKey()]);
      assert.throws(() => coinjoin.mergeMakerSignatures(built.psbtBase64, wrong.psbtBase64, m.inputs), /not signed/);
      const other = round();
      const signedOther = coinjoin.signKeyPathInputs(other.built.psbtBase64, other.makers[0].keys);
      assert.throws(() => coinjoin.mergeMakerSignatures(built.psbtBase64, signedOther.psbtBase64, m.inputs), /different transaction/);
      const signed = bitcoin.Psbt.fromBase64(coinjoin.signKeyPathInputs(built.psbtBase64, m.keys).psbtBase64);
      const index = signed.data.inputs.findIndex((i) => i.tapKeySig);
      const sig = Buffer.from(signed.data.inputs[index].tapKeySig);
      sig[10] ^= 1;
      signed.data.inputs[index].tapKeySig = sig;
      assert.throws(() => coinjoin.mergeMakerSignatures(built.psbtBase64, signed.toBase64(), m.inputs), /invalid/);
    });

    it('lets the taker catch an output that differs from the plan', function () {
      const { built } = round();
      const psbt = bitcoin.Psbt.fromBase64(built.psbtBase64);
      psbt.addOutput({ script: Buffer.from(coinjoin.taprootKeyPath(coinjoin.randomPrivateKey()).scriptPubKeyHex, 'hex'), value: 1000n });
      const check = coinjoin.validateCoinjoinForTaker({ psbtBase64: psbt.toBase64(), plan: built.plan });
      assert.strictEqual(check.ok, false);
    });
  });

  describe('ownership proofs', function () {
    it('signs with the output key and binds the round', function () {
      const key = coinjoin.randomPrivateKey();
      const input = { txid: txid(), vout: 3, scriptPubKeyHex: coinjoin.taprootKeyPath(key).scriptPubKeyHex };
      const roundId = coinjoin.randomRoundId();
      input.ownershipSig = coinjoin.signOwnership({ roundId, txid: input.txid, vout: input.vout, internalPrivateKey: key });
      assert.strictEqual(coinjoin.verifyOwnership({ roundId, input }), true);
      assert.strictEqual(coinjoin.verifyOwnership({ roundId: coinjoin.randomRoundId(), input }), false);
    });
  });
});
