'use strict';

const crypto = require('crypto');
const { Psbt } = require('bitcoinjs-lib');
const Contract = require('./contract');
const Witness = require('./witness');
const Resolutions = require('./resolutions');
const { signerFromPriv32 } = require('../functions/inventoryHtlc');
const {
  composeTaprootTree,
  buildHashlockLeaf,
  buildSpendLeaf,
  prepareLeafPsbt,
  finalizeHashlockPsbt,
  finalizeSpendPsbt,
  normalizeLock
} = require('../functions/contractTaproot');

const HEX64 = /^[0-9a-f]{64}$/;
const COMPRESSED = /^(02|03)[0-9a-f]{64}$/;
const MAINNET_NAMES = new Set(['mainnet', 'main', 'bitcoin', 'livenet']);

const BOUNTY_TYPE = 'BountyBond';
const DEPOSIT_TYPE = 'DepositBond';
const PENALTY_PRESIG_TYPE = 'DepositPenaltyPreSig';

/**
 * Normalise and validate a 33-byte compressed pubkey hex.
 * @param {string} label error prefix
 * @param {string} hex
 * @returns {string} lowercase hex
 * @private
 */
function compressedOrThrow (label, hex) {
  const s = String(hex || '').trim().toLowerCase();
  if (!COMPRESSED.test(s)) throw new Error(`${label} must be a 33-byte compressed pubkey (hex)`);
  return s;
}

/** Accept a block height, a `{ type, height|unix|blocks }` lock, or a normalized lock. @private */
function lockFrom (raw) {
  if (typeof raw === 'number') return normalizeLock({ type: 'cltv', height: raw });
  if (raw && typeof raw === 'object' && raw.type === 'cltv' && raw.value != null && raw.height == null && raw.unix == null) {
    return normalizeLock({ type: 'cltv', [raw.value >= 500000000 ? 'unix' : 'height']: raw.value });
  }
  if (raw && typeof raw === 'object' && raw.type === 'csv' && raw.value != null && raw.blocks == null) {
    return normalizeLock({ type: 'csv', blocks: raw.value });
  }
  return normalizeLock(raw);
}

/**
 * Throw for any mainnet network name (RC posture: regtest / signet only).
 * @param {string} network
 * @private
 */
function refuseMainnet (network) {
  if (MAINNET_NAMES.has(String(network || '').toLowerCase())) {
    throw new Error('Bond: mainnet refused — market bonds are regtest / signet only (RC posture)');
  }
}

/**
 * Publisher bounty and provider deposit terms as Taproot outputs
 * (`functions/contractTaproot.js` leaves) layered on {@link Contract}.
 *
 * **Bounty** (decision 1): one P2TR output per epoch. Leaves: for every
 * eligible provider a hashlock `SHA256(R_{epoch,provider})` + `CHECKSIG
 * provider` claim, and a publisher `CHECKSIG` refund after `refundAfter`.
 * The publisher reveals `R_{epoch,provider}` only to a provider that passed
 * that epoch's {@link Challenge}; the preimage is derived from a publisher
 * seed so nothing per-epoch has to be stored. No custodian.
 *
 * **Deposit** (decision 2): one P2TR output per provider commitment. Leaves:
 * a 2-of-2 `{ publisher, provider }` penalty leaf and a provider-only
 * withdraw after `withdrawAfter`. The provider pre-signs the penalty spend
 * (LN-justice style) alongside its availability commitment; the publisher can
 * complete it only with a verifying {@link Witness.FraudProof} attached —
 * `Bond.preparePenaltySpend` refuses otherwise (decision 6).
 *
 * @class Bond
 * @extends Contract
 */
class Bond extends Contract {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      amount: null,
      expiry: null,
      issuer: null,
      network: 'regtest'
    }, this.settings);

    return this;
  }

  static get TYPES () { return { BOUNTY: BOUNTY_TYPE, DEPOSIT: DEPOSIT_TYPE }; }

  /**
   * `R_{epoch,provider} = SHA256(seed || epoch || providerPubkey)`.
   * @param {Buffer|string} seed 32-byte publisher secret
   * @param {number} epoch
   * @param {string} providerPubkey compressed hex
   * @returns {string} 32-byte hex preimage
   */
  static deriveEpochPreimage (seed, epoch, providerPubkey) {
    const s = Buffer.isBuffer(seed) ? seed : Buffer.from(String(seed), 'hex');
    if (s.length !== 32) throw new Error('deriveEpochPreimage: 32-byte seed required');
    return crypto.createHash('sha256')
      .update(s)
      .update(Buffer.from(String(Math.floor(Number(epoch) || 0))))
      .update(Buffer.from(compressedOrThrow('providerPubkey', providerPubkey), 'hex'))
      .digest('hex');
  }

  /** @param {string} preimageHex @returns {string} */
  static commitmentFor (preimageHex) {
    return crypto.createHash('sha256').update(Buffer.from(String(preimageHex), 'hex')).digest('hex');
  }

  /**
   * Deterministic leaf id for a provider's bounty claim at an epoch.
   * @param {number} epoch
   * @param {string} providerPubkey compressed hex
   * @returns {string}
   */
  static leafIdClaim (epoch, providerPubkey) {
    return `claim-e${Math.floor(Number(epoch) || 0)}-${String(providerPubkey).slice(0, 16)}`;
  }

  /**
   * Build the per-epoch bounty outputs.
   * @param {object} opts
   * @param {string} opts.network `regtest` | `signet` | `testnet`
   * @param {string} opts.publisherPubkey compressed hex (refund key)
   * @param {string[]} opts.providerPubkeys compressed hex, eligible claimants
   * @param {Buffer|string} [opts.seed] publisher secret (preimages derived)
   * @param {Array<{ epoch: number, amountSats: number, commitments: (object|undefined) }>} opts.epochs
   *   when `seed` is absent each epoch supplies `commitments[providerPubkey] = SHA256(R)`
   * @param {object|number} opts.refundAfter lock (`{ type: 'cltv', value }` or block height)
   * @param {string} [opts.merkleRootHex] the tree this bounty rewards
   * @returns {object} `BountyBond` record (JSON-safe except `_leaves`)
   */
  static buildBounty (opts = {}) {
    const network = String(opts.network || 'regtest');
    refuseMainnet(network);
    const publisher = compressedOrThrow('publisherPubkey', opts.publisherPubkey);
    const providers = (Array.isArray(opts.providerPubkeys) ? opts.providerPubkeys : [])
      .map((p) => compressedOrThrow('providerPubkeys[]', p));
    if (!providers.length) throw new Error('buildBounty: at least one providerPubkey required');
    const refundAfter = lockFrom(opts.refundAfter);
    if (!refundAfter) throw new Error('buildBounty: refundAfter lock required');
    const epochs = Array.isArray(opts.epochs) ? opts.epochs : [];
    if (!epochs.length) throw new Error('buildBounty: epochs required');
    const root = opts.merkleRootHex ? String(opts.merkleRootHex).toLowerCase() : null;
    if (root && !HEX64.test(root)) throw new Error('buildBounty: merkleRootHex must be 64 hex chars');

    const outputs = epochs.map((e) => {
      const epoch = Math.floor(Number(e.epoch) || 0);
      const amountSats = Math.floor(Number(e.amountSats) || 0);
      if (amountSats < 546) throw new Error(`buildBounty: epoch ${epoch} amountSats below dust`);
      const commitments = {};
      const leaves = providers.map((p) => {
        const commitmentHex = opts.seed
          ? Bond.commitmentFor(Bond.deriveEpochPreimage(opts.seed, epoch, p))
          : String((e.commitments || {})[p] || '').toLowerCase();
        if (!HEX64.test(commitmentHex)) throw new Error(`buildBounty: no commitment for ${p} in epoch ${epoch}`);
        commitments[p] = commitmentHex;
        return buildHashlockLeaf({ id: Bond.leafIdClaim(epoch, p), commitmentHex, pubkeyHex: p });
      });
      leaves.push(buildSpendLeaf({ id: 'refund', keys: [publisher], threshold: 1, after: refundAfter }));
      const tree = composeTaprootTree({ network, leaves });
      return {
        epoch,
        amountSats,
        address: tree.address,
        commitments,
        leaves: tree.leaves,
        internalPubkeyHex: tree.internalPubkeyHex,
        _leaves: tree.leafScripts
      };
    });

    return {
      type: BOUNTY_TYPE,
      version: 1,
      network,
      merkleRootHex: root,
      publisherPubkey: publisher,
      providerPubkeys: providers,
      refundAfter,
      totalSats: outputs.reduce((n, o) => n + o.amountSats, 0),
      outputs
    };
  }

  /**
   * JSON view (drops Buffer-backed leaves) for persistence / `CONTRACT_MESSAGE`.
   * @param {object} bond
   * @returns {object}
   */
  static toRecord (bond) {
    const copy = Object.assign({}, bond);
    if (Array.isArray(copy.outputs)) copy.outputs = copy.outputs.map((o) => { const c = Object.assign({}, o); delete c._leaves; return c; });
    delete copy._leaves;
    return copy;
  }

  /**
   * Rebuild Buffer-backed leaves from a stored record (deterministic).
   * @param {object} record from {@link Bond.toRecord}
   * @returns {object}
   */
  static fromRecord (record) {
    if (!record) throw new Error('fromRecord: record required');
    if (record.type === BOUNTY_TYPE) {
      return Bond.buildBounty({
        network: record.network,
        publisherPubkey: record.publisherPubkey,
        providerPubkeys: record.providerPubkeys,
        refundAfter: record.refundAfter,
        merkleRootHex: record.merkleRootHex,
        epochs: record.outputs.map((o) => ({ epoch: o.epoch, amountSats: o.amountSats, commitments: o.commitments }))
      });
    }
    if (record.type === DEPOSIT_TYPE) {
      return Bond.buildDeposit({
        network: record.network,
        providerPubkey: record.providerPubkey,
        publisherPubkey: record.publisherPubkey,
        withdrawAfter: record.withdrawAfter,
        amountSats: record.amountSats,
        merkleRootHex: record.merkleRootHex
      });
    }
    throw new Error(`fromRecord: unknown bond type ${record.type}`);
  }

  /**
   * Provider deposit output.
   * @param {object} opts
   * @param {string} opts.network
   * @param {string} opts.providerPubkey compressed hex
   * @param {string} opts.publisherPubkey compressed hex (penalty co-signer / adjudicator)
   * @param {object|number} opts.withdrawAfter lock for the provider's unilateral exit
   * @param {number} [opts.amountSats]
   * @param {string} [opts.merkleRootHex]
   * @returns {object} `DepositBond`
   */
  static buildDeposit (opts = {}) {
    const network = String(opts.network || 'regtest');
    refuseMainnet(network);
    const provider = compressedOrThrow('providerPubkey', opts.providerPubkey);
    const publisher = compressedOrThrow('publisherPubkey', opts.publisherPubkey);
    const withdrawAfter = lockFrom(opts.withdrawAfter);
    if (!withdrawAfter) throw new Error('buildDeposit: withdrawAfter lock required');
    const root = opts.merkleRootHex ? String(opts.merkleRootHex).toLowerCase() : null;
    const leaves = [
      buildSpendLeaf({ id: 'penalty', keys: [publisher, provider], threshold: 2 }),
      // Check-in: both parties re-deposit (spend back to this address) once the
      // deposit has one confirmation, defeating the pre-signed timelocked
      // penalty for the current round. The CSV also keeps the leaf distinct
      // from `penalty`, whose script would otherwise be byte-identical.
      buildSpendLeaf({ id: 'checkin', keys: [publisher, provider], threshold: 2, after: { type: 'csv', blocks: 1 } }),
      buildSpendLeaf({ id: 'withdraw', keys: [provider], threshold: 1, after: withdrawAfter })
    ];
    const tree = composeTaprootTree({ network, leaves });
    return {
      type: DEPOSIT_TYPE,
      version: 1,
      network,
      merkleRootHex: root,
      providerPubkey: provider,
      publisherPubkey: publisher,
      withdrawAfter,
      amountSats: opts.amountSats != null ? Math.floor(Number(opts.amountSats)) : null,
      address: tree.address,
      leaves: tree.leaves,
      internalPubkeyHex: tree.internalPubkeyHex,
      _leaves: tree.leafScripts
    };
  }

  /** @private */
  static _leaf (holder, id) {
    const leaf = (holder._leaves || []).find((l) => l.id === id);
    if (!leaf) throw new Error(`Bond: leaf ${id} missing (rebuild with Bond.fromRecord)`);
    return leaf;
  }

  /**
   * Provider claims an epoch slice with the revealed preimage.
   * @param {object} bounty from {@link Bond.buildBounty} / {@link Bond.fromRecord}
   * @param {object} opts `{ epoch, providerPubkey, preimageHex, fundedTxHex, destinationAddress, feeSats }`
   * @returns {object} `{ psbtBase64, leafId, witnessShape, … }`
   */
  static prepareBountyClaim (bounty, opts = {}) {
    const out = (bounty.outputs || []).find((o) => o.epoch === Math.floor(Number(opts.epoch)));
    if (!out) throw new Error(`prepareBountyClaim: epoch ${opts.epoch} not in bounty`);
    const provider = compressedOrThrow('providerPubkey', opts.providerPubkey);
    const preimageHex = String(opts.preimageHex || '').toLowerCase();
    if (!HEX64.test(preimageHex) || Bond.commitmentFor(preimageHex) !== out.commitments[provider]) {
      throw new Error('prepareBountyClaim: preimage does not open this provider\'s epoch leaf');
    }
    const leaf = Bond._leaf(out, Bond.leafIdClaim(out.epoch, provider));
    const psbt = prepareLeafPsbt({
      networkName: bounty.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: out.address,
      leafScript: leaf.script,
      leaves: out._leaves,
      internalPubkeyHex: out.internalPubkeyHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats
    });
    return Object.assign(psbt, { leafId: leaf.id, witnessShape: 'preimage+sig', epoch: out.epoch });
  }

  /**
   * Publisher refund after the bounty locktime.
   * @param {object} bounty
   * @param {object} opts `{ epoch, fundedTxHex, destinationAddress, feeSats }`
   * @returns {object}
   */
  static prepareBountyRefund (bounty, opts = {}) {
    const out = (bounty.outputs || []).find((o) => o.epoch === Math.floor(Number(opts.epoch)));
    if (!out) throw new Error(`prepareBountyRefund: epoch ${opts.epoch} not in bounty`);
    const leaf = Bond._leaf(out, 'refund');
    const psbt = prepareLeafPsbt({
      networkName: bounty.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: out.address,
      leafScript: leaf.script,
      leaves: out._leaves,
      internalPubkeyHex: out.internalPubkeyHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats,
      after: bounty.refundAfter
    });
    return Object.assign(psbt, { leafId: 'refund', witnessShape: 'sigs', epoch: out.epoch });
  }

  /**
   * Unsigned, **timelocked** penalty spend of a provider deposit for one
   * challenge round: `nLockTime = deadlineHeight`. The provider pre-signs it
   * ({@link Bond.signPenaltyAsProvider}) before the publisher co-signs that
   * round's check-in; if the provider never checks in, the publisher adds its
   * own signature after the deadline and broadcasts. No fraud proof is needed
   * to *build* it — the timelock is the evidence (decision 6, timelock form).
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {object} opts `{ fundedTxHex, deadlineHeight, destinationAddress, feeSats }`
   * @returns {object} `{ psbtBase64, txid, deadlineHeight, deposit: { txid, vout }, leafId: 'penalty' }`
   */
  static prepareDepositPenalty (deposit, opts = {}) {
    const deadlineHeight = Math.floor(Number(opts.deadlineHeight));
    if (!Number.isFinite(deadlineHeight) || deadlineHeight <= 0) throw new Error('prepareDepositPenalty: deadlineHeight required');
    const leaf = Bond._leaf(deposit, 'penalty');
    const psbt = prepareLeafPsbt({
      networkName: deposit.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats,
      after: { type: 'cltv', height: deadlineHeight }
    });
    const tx = Psbt.fromBase64(psbt.psbtBase64).__CACHE.__TX;
    return Object.assign(psbt, {
      leafId: 'penalty',
      witnessShape: 'sigs',
      txid: tx.getId(),
      deadlineHeight,
      deposit: { txid: Buffer.from(tx.ins[0].hash).reverse().toString('hex'), vout: tx.ins[0].index }
    });
  }

  /**
   * Provider pre-signs a {@link Bond.prepareDepositPenalty} PSBT and wraps it
   * as a signed `DepositPenaltyPreSig` artifact (a `CONTRACT_MESSAGE` body).
   * Verifiers use {@link Witness.verifyPenaltyPreSig}.
   * @param {object} deposit
   * @param {object} penalty from {@link Bond.prepareDepositPenalty}
   * @param {Buffer|string} providerPrivateKey 32 bytes
   * @returns {object} signed artifact
   */
  static signPenaltyAsProvider (deposit, penalty, providerPrivateKey) {
    const priv = Buffer.isBuffer(providerPrivateKey) ? providerPrivateKey : Buffer.from(String(providerPrivateKey), 'hex');
    if (priv.length !== 32) throw new Error('signPenaltyAsProvider: 32-byte private key required');
    const pub = Buffer.from(signerFromPriv32(priv).publicKey).toString('hex');
    if (pub !== String(deposit.providerPubkey).toLowerCase()) throw new Error('signPenaltyAsProvider: key is not the deposit provider');
    const psbt = Psbt.fromBase64(penalty.psbtBase64);
    psbt.signInput(0, signerFromPriv32(priv));
    const tx = psbt.__CACHE.__TX;
    return Witness.signArtifact({
      type: PENALTY_PRESIG_TYPE,
      version: 1,
      depositAddress: deposit.address,
      deposit: { txid: Buffer.from(tx.ins[0].hash).reverse().toString('hex'), vout: tx.ins[0].index },
      deadlineHeight: Number(tx.locktime),
      txid: tx.getId(),
      psbtBase64: psbt.toBase64()
    }, priv);
  }

  /**
   * Publisher completes a pre-signed penalty after the deadline: verifies the
   * provider's artifact, adds the publisher signature, finalizes.
   * @param {object} deposit
   * @param {object} preSig `DepositPenaltyPreSig`
   * @param {Buffer|string} publisherPrivateKey
   * @param {object} [ctx] `{ tipHeight, penaltyAddress?, minPenaltySats? }` — refuses before `deadlineHeight` when supplied; the destination (else `deposit.penaltyAddress`) must be paid
   * @returns {{ txHex: string, txid: string, deadlineHeight: number }}
   */
  static finalizePreSignedPenalty (deposit, preSig, publisherPrivateKey, ctx = {}) {
    const check = Witness.verifyPenaltyPreSig(preSig, Bond._penaltyExpectation(deposit, preSig, ctx));
    if (!check.ok) throw new Error(`finalizePreSignedPenalty: ${check.reason}`);
    if (ctx.tipHeight != null && Number(ctx.tipHeight) < Number(preSig.deadlineHeight)) {
      throw new Error(`finalizePreSignedPenalty: deadline ${preSig.deadlineHeight} not reached (tip ${ctx.tipHeight})`);
    }
    const priv = Buffer.isBuffer(publisherPrivateKey) ? publisherPrivateKey : Buffer.from(String(publisherPrivateKey), 'hex');
    const psbt = check.psbt;
    psbt.signInput(0, signerFromPriv32(priv));
    const done = finalizeSpendPsbt({ psbtBase64: psbt.toBase64() });
    return { txHex: done.txHex, txid: done.txid, deadlineHeight: Number(preSig.deadlineHeight) };
  }

  /**
   * Check-in transaction for one round: re-deposits the output to the same
   * deposit address through the `checkin` leaf, which invalidates every
   * pre-signed penalty on the old outpoint. Both parties sign (publisher only
   * after holding the provider's pre-signature for the **next** round).
   * @param {object} deposit
   * @param {object} opts `{ fundedTxHex, feeSats }`
   * @returns {object} `{ psbtBase64, txid, leafId: 'checkin', nextDeposit: { txid, vout } }`
   */
  static prepareDepositCheckIn (deposit, opts = {}) {
    const leaf = Bond._leaf(deposit, 'checkin');
    const psbt = prepareLeafPsbt({
      networkName: deposit.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: deposit.address,
      feeSats: opts.feeSats,
      after: { type: 'csv', blocks: 1 }
    });
    const tx = Psbt.fromBase64(psbt.psbtBase64).__CACHE.__TX;
    return Object.assign(psbt, { leafId: 'checkin', witnessShape: 'sigs', txid: tx.getId(), nextDeposit: { txid: tx.getId(), vout: 0 } });
  }

  /**
   * `verifyPenaltyPreSig` expectation. The destination comes from the
   * publisher (`opts` or its own `deposit` record), never from the provider's
   * artifact — the provider signs the PSBT and so chooses its outputs.
   * @private
   * @param {object} deposit
   * @param {object} preSig
   * @param {object} [opts] `{ penaltyAddress?, minPenaltySats? }`
   * @returns {object}
   */
  static _penaltyExpectation (deposit, preSig, opts = {}) {
    const expect = { providerPubkey: deposit.providerPubkey, deposit: preSig.deposit, deadlineHeight: preSig.deadlineHeight };
    const address = opts.penaltyAddress || deposit.penaltyAddress || null;
    if (address) expect.destinationAddress = address;
    const min = opts.minPenaltySats != null ? opts.minPenaltySats : deposit.minPenaltySats;
    if (min != null) expect.minValueSats = min;
    return expect;
  }

  /**
   * Record one check-in round in this bond's {@link Contract.Resolutions}:
   * round `n` is **resolvable** only when the provider's pre-signed penalty
   * for round `n + 1` (spending the post-check-in outpoint) is held. The
   * publisher must call this (and see `resolvable`) before co-signing the
   * round-`n` check-in — `P_{n+1}` before `C_n`.
   * @param {number} round
   * @param {object} opts `{ penaltyPreSig, checkInPsbtBase64?, deposit, penaltyAddress?, minPenaltySats? }` — the pre-signed penalty must pay `penaltyAddress` (else `deposit.penaltyAddress`)
   * @returns {{ round: number, resolvable: boolean, missing: string[] }}
   */
  recordRound (round, opts = {}) {
    const n = Math.floor(Number(round));
    const id = String(n);
    if (!this.resolutions.stateIds.includes(id)) this.resolutions.declare(id, n > 0 ? String(n - 1) : null);
    const preSig = opts.penaltyPreSig;
    const deposit = opts.deposit;
    if (preSig && deposit) {
      const check = Witness.verifyPenaltyPreSig(preSig, Bond._penaltyExpectation(deposit, preSig, opts));
      if (!check.ok) throw new Error(`recordRound: ${check.reason}`);
      this.resolutions.addExit(id, { id: 'penalty', kind: Resolutions.KINDS.PENALTY, psbtBase64: preSig.psbtBase64, required: [deposit.providerPubkey], locktime: { height: Number(preSig.deadlineHeight) }, meta: { deadlineHeight: Number(preSig.deadlineHeight) } });
    }
    if (opts.checkInPsbtBase64 && deposit) {
      this.resolutions.addExit(id, { id: 'checkin', kind: Resolutions.KINDS.CHECKIN, psbtBase64: opts.checkInPsbtBase64, required: [deposit.providerPubkey, deposit.publisherPubkey] });
    }
    const missing = this.resolutions.missing(id);
    const hasPenalty = !!this.resolutions.getExit(id, 'penalty');
    if (!hasPenalty) missing.push(`penalty pre-signature for round ${n}`);
    return { round: n, resolvable: missing.length === 0, missing };
  }

  /**
   * Penalty spend of a provider deposit. **Requires a verifying fraud proof**
   * naming this provider as offender; the proof hash is recorded on the result
   * so the spend always travels with its evidence. `ctx` is the verifier's
   * chain view (`tipHeight`, `outpointUnspent`, `txConfirmed`) — kinds that
   * assert on-chain facts refuse to verify without it.
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {object} opts `{ fraudProof, fundedTxHex, destinationAddress, feeSats, ctx? }`
   * @returns {object}
   */
  static preparePenaltySpend (deposit, opts = {}) {
    const proof = opts.fraudProof instanceof Witness.FraudProof
      ? opts.fraudProof
      : Witness.FraudProof.fromBody(opts.fraudProof);
    if (!proof) throw new Error('preparePenaltySpend: fraudProof required');
    const verdict = proof.verify(Object.assign({}, opts.ctx || {}, opts.epoch != null ? { epoch: opts.epoch } : {}));
    if (!verdict.ok) throw new Error(`preparePenaltySpend: fraud proof does not verify (${verdict.reason})`);
    const xOnly = String(deposit.providerPubkey).slice(2);
    if (String(verdict.offender || '').toLowerCase() !== xOnly) {
      throw new Error('preparePenaltySpend: fraud proof names a different offender');
    }
    if (verdict.evidence === 'timelock') {
      throw new Error('preparePenaltySpend: timelocked non-response is enforced by the pre-signed penalty — use Bond.finalizePreSignedPenalty');
    }
    const leaf = Bond._leaf(deposit, 'penalty');
    const psbt = prepareLeafPsbt({
      networkName: deposit.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats
    });
    return Object.assign(psbt, {
      leafId: 'penalty',
      witnessShape: 'sigs',
      fraudProofHash: proof.hash,
      fraudProofKind: proof.kind,
      offender: verdict.offender
    });
  }

  /**
   * Provider's unilateral deposit exit after `withdrawAfter`.
   * @param {object} deposit
   * @param {object} opts `{ fundedTxHex, destinationAddress, feeSats }`
   * @returns {object}
   */
  static prepareDepositWithdraw (deposit, opts = {}) {
    const leaf = Bond._leaf(deposit, 'withdraw');
    const psbt = prepareLeafPsbt({
      networkName: deposit.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats,
      after: deposit.withdrawAfter
    });
    return Object.assign(psbt, { leafId: 'withdraw', witnessShape: 'sigs' });
  }

  /** Finalize a signed hashlock (claim) PSBT. */
  static finalizeClaim (psbtBase64, preimageHex) {
    return finalizeHashlockPsbt({ psbtBase64, preimage32: Buffer.from(String(preimageHex), 'hex'), witnessShape: 'preimage+sig' });
  }

  /** Finalize a signed spend (refund / penalty / withdraw) PSBT. */
  static finalizeSpend (psbtBase64) {
    return finalizeSpendPsbt({ psbtBase64 });
  }

  /**
   * Build a `{ type, time }` expiry record.
   * @param {string} type
   * @param {number} time
   * @returns {Object}
   * @private
   */
  _getExpiry (type, time) {
    return {
      type, time,
      content: Buffer.alloc(4)
    };
  }
}

module.exports = Bond;
