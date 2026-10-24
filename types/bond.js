'use strict';

/**
 * @fileoverview Bonds: coins locked in P2TR outputs whose spend paths enforce
 * a promise. {@link Bond} builds the publisher bounty and provider deposit of
 * the document market, and the fidelity bond of the coinjoin market
 * (`Bond.buildFidelity`, certificates, chain verification, JoinMarket's bond
 * value, `Bond.FidelityVerifier`).
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const { Psbt, address: bitcoinAddress } = require('bitcoinjs-lib');
const ecc = require('./ecc');
const Contract = require('./contract');
const Witness = require('./witness');
const Resolutions = require('./resolutions');
const Htlc = require('./htlc');
const {
  composeTaprootTree,
  buildHashlockLeaf,
  buildSpendLeaf,
  buildControlBlockForLeaf,
  networkForFabricName,
  TAPROOT_INTERNAL_NUMS,
  prepareLeafPsbt,
  finalizeHashlockPsbt,
  finalizeSpendPsbt,
  normalizeLock
} = require('./policy');
const { assertTestNetwork } = require('../functions/bitcoinNetworkAllowlist');
const { stableStringify, jsonSafe } = require('../functions/fabricCanonicalJson');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('../functions/bip125');

bitcoin.initEccLib(ecc);

const HEX64 = /^[0-9a-f]{64}$/;
const COMPRESSED = /^(02|03)[0-9a-f]{64}$/;

const BOUNTY_TYPE = 'BountyBond';
const DEPOSIT_TYPE = 'DepositBond';
const PENALTY_PRESIG_TYPE = 'DepositPenaltyPreSig';

// Only these verdicts may move a deposit through a fresh penalty spend; the
// timelocked absence is enforced by the provider's own pre-signed penalty.
const PENALTY_KINDS = new Set(['wrong-leaf', 'non-response']);
const DEFAULT_MAX_FEE_SATS = 20000;

// Evidence ids already turned into a penalty spend in this process (see
// `preparePenaltySpend`; pass `opts.consumed` for a persistent ledger).
const CONSUMED_EVIDENCE = new Set();

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
 * Throw unless `network` is a test network (RC posture: an unknown name
 * would otherwise build mainnet scripts).
 * @param {string} network
 * @returns {string} normalised network name
 * @private
 */
function refuseMainnet (network) {
  return assertTestNetwork(network, 'Bond');
}

/** @private display-order txid of input `i` */
function inputTxid (tx, i = 0) {
  return Buffer.from(tx.ins[i].hash).reverse().toString('hex');
}

/** @private output script for `address` on the deposit's network */
function scriptFor (network, address) {
  return Buffer.from(bitcoinAddress.toOutputScript(String(address), networkForFabricName(network)));
}

/**
 * Publisher bounty and provider deposit terms as Taproot outputs
 * ({@link Policy} leaves) layered on {@link Contract}.
 *
 * **Bounty** (decision 1): one P2TR output per epoch. Leaves: for every
 * eligible provider a hashlock `SHA256(R_{epoch,provider})` + `CHECKSIG
 * provider` claim, and a publisher `CHECKSIG` refund after `refundAfter`.
 * The publisher reveals `R_{epoch,provider}` only to a provider that passed
 * that epoch's {@link Challenge}; the preimage is derived from a publisher
 * seed so nothing per-epoch has to be stored. No custodian.
 *
 * **Deposit** (decision 2): one P2TR output per provider commitment round.
 * Leaves: a 2-of-2 `{ publisher, provider }` penalty leaf, a 2-of-2 check-in
 * leaf (CSV 1), a provider-only withdraw after `withdrawAfter`, and — when the
 * round commits an answer hash — the provider-only **answer** leaf
 * `OP_SHA256 <answerHash> OP_EQUALVERIFY <provider> OP_CHECKSIG`, opened by
 * the possession digest `SHA256(nonce || blob)`.
 *
 * Rounds: the publisher plans round `n` (`Challenge.planRound`), builds
 * deposit `D_n` with that answer hash, and issues challenge `n` naming
 * `D_n`'s outpoint. The provider checks the answer hash against its blob and
 * pre-signs the timelocked penalty `P_n` acknowledging the challenge
 * ({@link Bond.signPenaltyAsProvider}). Only then does the publisher co-sign
 * check-in `C_{n-1}` (`D_{n-1}` → `D_n`). If the publisher withholds the
 * check-in, the provider answers on-chain through `D_n`'s answer leaf before
 * the deadline, which consumes the outpoint `P_n` spends — so the publisher
 * cannot manufacture a non-response. Funds move only through those
 * pre-signed / co-signed paths: {@link Bond.preparePenaltySpend} builds an
 * unsigned 2-of-2 spend that still needs the provider's signature
 * (adjudicated or cooperative settlement), never a unilateral seizure.
 *
 * **Fidelity** (coinjoin market): A maker locks coins in a P2TR output that
 * only its bond key can spend, and only after a block height (`<locktime>
 * OP_CHECKLOCKTIMEVERIFY OP_DROP <bondXOnly> OP_CHECKSIG` under the NUMS
 * internal key, so there is no key path). Locked capital is costly to fake,
 * so takers weight makers by bond value and a Sybil attacker must lock coins
 * for every identity it runs. The bond key signs a certificate binding the
 * bond to the maker's offer key until `certExpiresAt` (a block height), so
 * the bond key itself can stay cold. Takers check the certificate, then the
 * UTXO on chain: unspent, the expected script, confirmed. Value follows
 * JoinMarket's formula (interest on the locked amount over the lock period,
 * decaying once the lock has expired, raised to an exponent so splitting a
 * bond across identities loses value). Mainnet locktimes sit on a 4320-block
 * grid (about a month) so bonds are not fingerprinted by odd heights.
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
   * Deterministic leaf id for a provider's bounty claim at an epoch (the full
   * compressed key, so two providers can never share an id).
   * @param {number} epoch
   * @param {string} providerPubkey compressed hex
   * @returns {string}
   */
  static leafIdClaim (epoch, providerPubkey) {
    return `claim-e${Math.floor(Number(epoch) || 0)}-${String(providerPubkey).toLowerCase()}`;
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
    const network = refuseMainnet(opts.network || 'regtest');
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
        merkleRootHex: record.merkleRootHex,
        round: record.round,
        answerHashHex: record.answerHashHex,
        penaltyAddress: record.penaltyAddress,
        minPenaltySats: record.minPenaltySats
      });
    }
    throw new Error(`fromRecord: unknown bond type ${record.type}`);
  }

  /**
   * Provider deposit output for one round.
   * @param {object} opts
   * @param {string} opts.network
   * @param {string} opts.providerPubkey compressed hex
   * @param {string} opts.publisherPubkey compressed hex (penalty co-signer / adjudicator)
   * @param {object|number} opts.withdrawAfter lock for the provider's unilateral exit (a block height; must clear every round deadline by the withdraw margin)
   * @param {number} [opts.amountSats]
   * @param {string} [opts.merkleRootHex]
   * @param {number} [opts.round] check-in round this output backs
   * @param {string} [opts.answerHashHex] round answer hash (`Challenge.planRound`); adds the provider's `answer` leaf
   * @param {string} [opts.penaltyAddress] publisher's penalty destination
   * @param {number} [opts.minPenaltySats]
   * @returns {object} `DepositBond`
   */
  static buildDeposit (opts = {}) {
    const network = refuseMainnet(opts.network || 'regtest');
    const provider = compressedOrThrow('providerPubkey', opts.providerPubkey);
    const publisher = compressedOrThrow('publisherPubkey', opts.publisherPubkey);
    const withdrawAfter = lockFrom(opts.withdrawAfter);
    if (!withdrawAfter) throw new Error('buildDeposit: withdrawAfter lock required');
    const root = opts.merkleRootHex ? String(opts.merkleRootHex).toLowerCase() : null;
    const answerHashHex = opts.answerHashHex ? String(opts.answerHashHex).toLowerCase() : null;
    if (answerHashHex && !HEX64.test(answerHashHex)) throw new Error('buildDeposit: answerHashHex must be 32-byte hex');
    const leaves = [
      buildSpendLeaf({ id: 'penalty', keys: [publisher, provider], threshold: 2 }),
      // Check-in: both parties move the deposit to the next round's output
      // once it has one confirmation, defeating the round's pre-signed
      // timelocked penalty. The CSV also keeps the leaf distinct from
      // `penalty`, whose script would otherwise be byte-identical.
      buildSpendLeaf({ id: 'checkin', keys: [publisher, provider], threshold: 2, after: { type: 'csv', blocks: 1 } }),
      buildSpendLeaf({ id: 'withdraw', keys: [provider], threshold: 1, after: withdrawAfter })
    ];
    if (answerHashHex) leaves.push(buildHashlockLeaf({ id: 'answer', commitmentHex: answerHashHex, pubkeyHex: provider }));
    const tree = composeTaprootTree({ network, leaves });
    const out = {
      type: DEPOSIT_TYPE,
      version: 2,
      network,
      merkleRootHex: root,
      providerPubkey: provider,
      publisherPubkey: publisher,
      withdrawAfter,
      round: opts.round != null ? Math.max(0, Math.floor(Number(opts.round) || 0)) : null,
      answerHashHex,
      amountSats: opts.amountSats != null ? Math.floor(Number(opts.amountSats)) : null,
      address: tree.address,
      leaves: tree.leaves,
      internalPubkeyHex: tree.internalPubkeyHex,
      _leaves: tree.leafScripts
    };
    if (opts.penaltyAddress) out.penaltyAddress = String(opts.penaltyAddress);
    if (opts.minPenaltySats != null) out.minPenaltySats = Math.floor(Number(opts.minPenaltySats));
    return out;
  }

  /** @private */
  static _leaf (holder, id) {
    const leaf = (holder._leaves || []).find((l) => l.id === id);
    if (!leaf) throw new Error(`Bond: leaf ${id} missing (rebuild with Bond.fromRecord)`);
    return leaf;
  }

  /**
   * The deposit's `answer` leaf and its control block — the artifact a
   * timelocked non-response proof carries (`answerPath`) to show the provider
   * could have answered on-chain.
   * @param {object} deposit with `answerHashHex`
   * @returns {{ leafScriptHex: string, controlBlockHex: string, answerHashHex: string }}
   */
  static answerPath (deposit) {
    const leaf = Bond._leaf(deposit, 'answer');
    const internal = deposit.internalPubkeyHex ? Buffer.from(deposit.internalPubkeyHex, 'hex') : undefined;
    const control = buildControlBlockForLeaf(deposit._leaves, leaf.script, internal);
    return { leafScriptHex: leaf.script.toString('hex'), controlBlockHex: control.toString('hex'), answerHashHex: deposit.answerHashHex };
  }

  /**
   * Which deposit leaf a spending transaction used (`penalty`, `checkin`,
   * `withdraw`, `answer`), from the revealed tapscript — what a verifier's
   * `ctx.outpointSpend` reports for a confirmed spend.
   * @param {object} deposit
   * @param {string} txHex spending transaction
   * @param {object} [outpoint] `{ txid, vout }` of the deposit (first input otherwise)
   * @returns {{ leafId: (string|null), txid: string }|null} `null` when the tx does not spend the outpoint
   */
  static classifySpend (deposit, txHex, outpoint = null) {
    const tx = require('bitcoinjs-lib').Transaction.fromHex(String(txHex || '').trim());
    const i = outpoint
      ? tx.ins.findIndex((inp, k) => inputTxid(tx, k) === String(outpoint.txid).toLowerCase() && inp.index === Number(outpoint.vout))
      : 0;
    if (i < 0 || !tx.ins[i]) return null;
    const witness = (tx.ins[i].witness || []).map((w) => Buffer.from(w));
    const items = witness.length && witness[witness.length - 1][0] === 0x50 ? witness.slice(0, -1) : witness;
    const script = items.length >= 2 ? items[items.length - 2] : null;
    const leaf = script ? (deposit._leaves || []).find((l) => Buffer.from(l.script).equals(script)) : null;
    return { leafId: leaf ? leaf.id : null, txid: tx.getId() };
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
   * ({@link Bond.signPenaltyAsProvider}) before the publisher co-signs the
   * check-in into this round; if the provider neither checks in nor answers,
   * the publisher adds its own signature after the deadline and broadcasts.
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {object} opts `{ fundedTxHex, deadlineHeight, destinationAddress, feeSats }`
   * @returns {object} `{ psbtBase64, txid, deadlineHeight, deposit: { txid, vout }, leafId: 'penalty' }`
   */
  static prepareDepositPenalty (deposit, opts = {}) {
    const deadlineHeight = Math.floor(Number(opts.deadlineHeight));
    if (!Number.isFinite(deadlineHeight) || deadlineHeight <= 0 || deadlineHeight >= 500000000) throw new Error('prepareDepositPenalty: deadlineHeight must be a block height');
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
      deposit: { txid: inputTxid(tx, 0), vout: tx.ins[0].index }
    });
  }

  /**
   * Provider pre-signs a {@link Bond.prepareDepositPenalty} PSBT and wraps it
   * as a signed `DepositPenaltyPreSig` artifact (a `CONTRACT_MESSAGE` body).
   * Before signing it checks the PSBT ({@link Witness.checkPenaltyPsbt}: one
   * input on this deposit, non-final sequence, height locktime, destination,
   * fee cap) and that it spends only this deposit's penalty leaf. With
   * `opts.challenge` it also checks the challenge (publisher-signed, for this
   * provider, deadline and outpoint as in the PSBT) and, when the challenge
   * commits an answer hash, that this deposit carries the matching `answer`
   * leaf and — given `opts.bytes` — that the provider's blob opens it; the
   * artifact then names `challengeHash`, acknowledging the challenge.
   * Verifiers use {@link Witness.verifyPenaltyPreSig}.
   * @param {object} deposit
   * @param {object} penalty from {@link Bond.prepareDepositPenalty}
   * @param {Buffer|string} providerPrivateKey 32 bytes
   * @param {object} [opts] `{ challenge?, bytes?, destinationAddress?, minPenaltySats?, maxFeeSats? }`
   * @returns {object} signed artifact
   */
  static signPenaltyAsProvider (deposit, penalty, providerPrivateKey, opts = {}) {
    const priv = Buffer.isBuffer(providerPrivateKey) ? providerPrivateKey : Buffer.from(String(providerPrivateKey), 'hex');
    if (priv.length !== 32) throw new Error('signPenaltyAsProvider: 32-byte private key required');
    const pub = Buffer.from(Htlc.signerFromPriv32(priv).publicKey).toString('hex');
    if (pub !== String(deposit.providerPubkey).toLowerCase()) throw new Error('signPenaltyAsProvider: key is not the deposit provider');
    const psbt = Psbt.fromBase64(penalty.psbtBase64);
    const tx = psbt.__CACHE.__TX;
    const challenge = opts.challenge || null;
    const named = challenge && challenge.deposit ? challenge.deposit : null;
    const expect = {
      deposit: named || { txid: tx.ins.length ? inputTxid(tx, 0) : null, vout: tx.ins.length ? tx.ins[0].index : null },
      deadlineHeight: challenge ? challenge.deadlineHeight : tx.locktime,
      depositAddress: deposit.address,
      maxFeeSats: opts.maxFeeSats
    };
    const destination = opts.destinationAddress || (named && named.penaltyAddress) || deposit.penaltyAddress || null;
    if (destination) expect.destinationAddress = destination;
    const min = opts.minPenaltySats != null ? opts.minPenaltySats : (named && named.minPenaltySats != null ? named.minPenaltySats : deposit.minPenaltySats);
    if (min != null) expect.minValueSats = min;
    const check = Witness.checkPenaltyPsbt(psbt, expect);
    if (!check.ok) throw new Error(`signPenaltyAsProvider: ${check.reason}`);
    const leaves = psbt.data.inputs[0].tapLeafScript || [];
    const penaltyScript = Bond._leaf(deposit, 'penalty').script;
    if (leaves.length !== 1 || !Buffer.from(leaves[0].script).equals(penaltyScript)) {
      throw new Error('signPenaltyAsProvider: PSBT must spend only this deposit\'s penalty leaf');
    }
    let challengeHash = null;
    if (challenge) {
      if (!Witness.verifyArtifact(challenge, String(deposit.publisherPubkey).slice(2))) throw new Error('signPenaltyAsProvider: challenge is not signed by the deposit publisher');
      if (String(challenge.providerPubkey).toLowerCase() !== pub.slice(2)) throw new Error('signPenaltyAsProvider: challenge is addressed to another provider');
      const answerHash = challenge.answerHashHex ? String(challenge.answerHashHex).toLowerCase() : null;
      if (answerHash) {
        if (deposit.answerHashHex !== answerHash) throw new Error('signPenaltyAsProvider: deposit carries no answer leaf for this challenge — the round could not be answered on-chain');
        if (Buffer.isBuffer(opts.bytes)) {
          const possession = Witness.FraudProof.possessionHex(challenge.nonceHex, opts.bytes);
          if (Witness.FraudProof.answerHashFor(possession) !== answerHash) throw new Error('signPenaltyAsProvider: the blob does not open the challenge answer hash');
        }
      }
      challengeHash = Witness.artifactHash(challenge);
    }
    psbt.signInput(0, Htlc.signerFromPriv32(priv));
    const body = {
      type: PENALTY_PRESIG_TYPE,
      version: 2,
      depositAddress: deposit.address,
      deposit: { txid: inputTxid(tx, 0), vout: tx.ins[0].index },
      deadlineHeight: Number(tx.locktime),
      txid: tx.getId(),
      psbtBase64: psbt.toBase64()
    };
    if (challengeHash) body.challengeHash = challengeHash;
    return Witness.signArtifact(body, priv);
  }

  /**
   * Publisher completes a pre-signed penalty after the deadline: verifies the
   * provider's artifact, adds the publisher signature, finalizes. Refuses a
   * penalty that names no publisher destination — the provider would have
   * chosen where it pays, so it is not enforceable.
   * @param {object} deposit
   * @param {object} preSig `DepositPenaltyPreSig`
   * @param {Buffer|string} publisherPrivateKey
   * @param {object} [ctx] `{ tipHeight, penaltyAddress?, minPenaltySats?, maxFeeSats? }` — refuses before `deadlineHeight` when supplied; the destination (else `deposit.penaltyAddress`) must be paid
   * @returns {{ txHex: string, txid: string, deadlineHeight: number }}
   */
  static finalizePreSignedPenalty (deposit, preSig, publisherPrivateKey, ctx = {}) {
    const check = Witness.verifyPenaltyPreSig(preSig, Bond._penaltyExpectation(deposit, preSig, ctx));
    if (!check.ok) throw new Error(`finalizePreSignedPenalty: ${check.reason}`);
    if (!check.enforceable) throw new Error('finalizePreSignedPenalty: no penalty destination (ctx.penaltyAddress or deposit.penaltyAddress) — not enforceable');
    if (ctx.tipHeight != null && Number(ctx.tipHeight) < Number(preSig.deadlineHeight)) {
      throw new Error(`finalizePreSignedPenalty: deadline ${preSig.deadlineHeight} not reached (tip ${ctx.tipHeight})`);
    }
    const priv = Buffer.isBuffer(publisherPrivateKey) ? publisherPrivateKey : Buffer.from(String(publisherPrivateKey), 'hex');
    const psbt = check.psbt;
    psbt.signInput(0, Htlc.signerFromPriv32(priv));
    const done = finalizeSpendPsbt({ psbtBase64: psbt.toBase64() });
    return { txHex: done.txHex, txid: done.txid, deadlineHeight: Number(preSig.deadlineHeight) };
  }

  /**
   * Check-in transaction: moves the deposit through the `checkin` leaf to the
   * next round's output, which invalidates every pre-signed penalty on the
   * old outpoint. Both parties sign (the publisher only after holding the
   * provider's pre-signature for the **next** round). A deposit that commits
   * a round answer hash must move to `opts.nextDeposit` (the next round's
   * answer hash); one without may re-deposit to its own address.
   * @param {object} deposit
   * @param {object} opts `{ fundedTxHex, feeSats, nextDeposit? }`
   * @returns {object} `{ psbtBase64, txid, leafId: 'checkin', nextDeposit: { txid, vout, address }, nextFundedTxHex }`
   */
  static prepareDepositCheckIn (deposit, opts = {}) {
    const next = opts.nextDeposit || null;
    if (deposit.answerHashHex && !next) throw new Error('prepareDepositCheckIn: per-round deposit — check in to the next round\'s deposit (opts.nextDeposit)');
    if (next && (next.providerPubkey !== deposit.providerPubkey || next.publisherPubkey !== deposit.publisherPubkey || next.network !== deposit.network)) {
      throw new Error('prepareDepositCheckIn: next deposit is for other parties or another network');
    }
    const leaf = Bond._leaf(deposit, 'checkin');
    const destination = next ? next.address : deposit.address;
    const psbt = prepareLeafPsbt({
      networkName: deposit.network,
      fundedTxHex: opts.fundedTxHex,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: destination,
      feeSats: opts.feeSats,
      after: { type: 'csv', blocks: 1 }
    });
    const tx = Psbt.fromBase64(psbt.psbtBase64).__CACHE.__TX;
    return Object.assign(psbt, {
      leafId: 'checkin',
      witnessShape: 'sigs',
      txid: tx.getId(),
      nextDeposit: { txid: tx.getId(), vout: 0, address: destination },
      // The txid does not commit to the witness, so the unsigned transaction
      // already funds the next round's penalty PSBT.
      nextFundedTxHex: tx.toHex()
    });
  }

  /**
   * Check a check-in PSBT before co-signing or recording it: one input on
   * `previous`'s output through its `checkin` leaf, one output paying
   * `next.address` (which becomes `nextOutpoint` when given), fee within
   * `maxFeeSats`.
   * @param {object} previous deposit being spent
   * @param {string} psbtBase64
   * @param {object} next deposit receiving the funds
   * @param {object} [opts] `{ nextOutpoint?: { txid, vout }, maxFeeSats? }`
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined) }}
   */
  static verifyCheckIn (previous, psbtBase64, next, opts = {}) {
    const no = (reason) => ({ ok: false, reason });
    let psbt;
    try { psbt = Psbt.fromBase64(String(psbtBase64 || '')); } catch (_) { return no('check-in PSBT invalid'); }
    const tx = psbt.__CACHE.__TX;
    if (tx.ins.length !== 1 || psbt.data.inputs.length !== 1) return no('check-in must spend exactly the previous deposit');
    const input = psbt.data.inputs[0];
    if (!input.witnessUtxo || !Buffer.from(input.witnessUtxo.script).equals(scriptFor(previous.network, previous.address))) {
      return no('check-in does not spend the previous deposit address');
    }
    const leaves = input.tapLeafScript || [];
    const checkinScript = Bond._leaf(previous, 'checkin').script;
    if (leaves.length !== 1 || !Buffer.from(leaves[0].script).equals(checkinScript)) return no('check-in must spend only the previous deposit\'s checkin leaf');
    if (tx.outs.length !== 1 || !Buffer.from(tx.outs[0].script).equals(scriptFor(next.network, next.address))) {
      return no('check-in must pay exactly the next round\'s deposit');
    }
    if (opts.nextOutpoint && (String(opts.nextOutpoint.txid).toLowerCase() !== tx.getId() || Number(opts.nextOutpoint.vout) !== 0)) {
      return no('the next round\'s penalty spends another outpoint than this check-in creates');
    }
    const fee = BigInt(input.witnessUtxo.value) - BigInt(tx.outs[0].value);
    const cap = opts.maxFeeSats != null ? BigInt(Math.floor(Number(opts.maxFeeSats))) : BigInt(DEFAULT_MAX_FEE_SATS);
    if (fee < 0n || fee > cap) return no(`check-in fee ${fee} outside 0…${cap}`);
    return { ok: true, txid: tx.getId() };
  }

  /**
   * Provider answers a round on-chain through the deposit's `answer` leaf —
   * what it does when the publisher withholds the check-in co-signature. The
   * spend consumes the outpoint the round's pre-signed penalty needs.
   * Finalize with {@link Bond.finalizeClaim}`(psbt, possessionHex)`.
   * @param {object} deposit with `answerHashHex`
   * @param {object} opts `{ fundedTxHex, destinationAddress, feeSats, possessionHex? }` — `possessionHex` is checked against the answer hash
   * @returns {object} `{ psbtBase64, leafId: 'answer', witnessShape: 'preimage+sig', … }`
   */
  static prepareDepositAnswer (deposit, opts = {}) {
    if (!deposit.answerHashHex) throw new Error('prepareDepositAnswer: deposit commits no answer hash');
    if (opts.possessionHex != null && Witness.FraudProof.answerHashFor(String(opts.possessionHex)) !== deposit.answerHashHex) {
      throw new Error('prepareDepositAnswer: possession digest does not open the answer hash');
    }
    const leaf = Bond._leaf(deposit, 'answer');
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
    return Object.assign(psbt, { leafId: 'answer', witnessShape: 'preimage+sig' });
  }

  /**
   * `verifyPenaltyPreSig` expectation. The destination comes from the
   * publisher (`opts` or its own `deposit` record), never from the provider's
   * artifact — the provider signs the PSBT and so chooses its outputs.
   * @private
   * @param {object} deposit
   * @param {object} preSig
   * @param {object} [opts] `{ penaltyAddress?, minPenaltySats?, maxFeeSats?, challengeHash? }`
   * @returns {object}
   */
  static _penaltyExpectation (deposit, preSig, opts = {}) {
    const expect = {
      providerPubkey: deposit.providerPubkey,
      publisherPubkey: deposit.publisherPubkey,
      depositAddress: deposit.address,
      deposit: opts.depositOutpoint || preSig.deposit,
      deadlineHeight: opts.deadlineHeight != null ? opts.deadlineHeight : preSig.deadlineHeight,
      maxFeeSats: opts.maxFeeSats
    };
    const address = opts.penaltyAddress || deposit.penaltyAddress || null;
    if (address) expect.destinationAddress = address;
    const min = opts.minPenaltySats != null ? opts.minPenaltySats : deposit.minPenaltySats;
    if (min != null) expect.minValueSats = min;
    if (opts.challengeHash) expect.challengeHash = opts.challengeHash;
    return expect;
  }

  /**
   * Record one round in this bond's {@link Contract.Resolutions}. Round `n`
   * is **resolvable** only when the provider's pre-signed penalty for round
   * `n` is held, verifies, and pays the publisher's destination, and — when
   * the check-in into round `n` is supplied — that check-in verifies and
   * carries the provider's signature. The publisher must call this (and see
   * `resolvable`) before co-signing that check-in — `P_n` before `C_{n-1}`.
   * The deposit's withdraw height must clear the round deadline by
   * `withdrawMarginBlocks` (default 144).
   * @param {number} round
   * @param {object} opts `{ deposit, penaltyPreSig, challenge?, previousDeposit?, checkInPsbtBase64?, penaltyAddress?, minPenaltySats?, maxFeeSats?, withdrawMarginBlocks? }`
   * @returns {{ round: number, resolvable: boolean, answerable: boolean, missing: string[] }}
   */
  recordRound (round, opts = {}) {
    const n = Math.floor(Number(round));
    const id = String(n);
    if (!this.resolutions.stateIds.includes(id)) this.resolutions.declare(id, n > 0 ? String(n - 1) : null);
    const preSig = opts.penaltyPreSig;
    const deposit = opts.deposit;
    const challenge = opts.challenge || null;
    const extraMissing = [];
    let answerable = false;
    if (challenge && deposit) {
      if (!Witness.verifyArtifact(challenge, String(deposit.publisherPubkey).slice(2))) throw new Error('recordRound: challenge is not signed by the deposit publisher');
      const answerHash = challenge.answerHashHex ? String(challenge.answerHashHex).toLowerCase() : null;
      if (answerHash && answerHash !== deposit.answerHashHex) throw new Error('recordRound: challenge answer hash is not committed in this round\'s deposit');
      answerable = !!answerHash;
    }
    if (preSig && deposit) {
      const deadline = Number(preSig.deadlineHeight);
      const margin = Math.max(0, Math.floor(Number(opts.withdrawMarginBlocks != null ? opts.withdrawMarginBlocks : 144) || 0));
      const withdraw = deposit.withdrawAfter || {};
      if (withdraw.type !== 'cltv' || withdraw.height == null) throw new Error('recordRound: withdrawAfter must be an absolute block height');
      if (!(Number(withdraw.height) > deadline + margin)) {
        throw new Error(`recordRound: withdrawAfter ${withdraw.height} must be later than deadline ${deadline} + ${margin} blocks`);
      }
      const expectOpts = Object.assign({}, opts);
      if (challenge) {
        expectOpts.challengeHash = Witness.artifactHash(challenge);
        expectOpts.depositOutpoint = challenge.deposit;
        expectOpts.deadlineHeight = challenge.deadlineHeight;
        const named = challenge.deposit || {};
        if (!expectOpts.penaltyAddress && named.penaltyAddress) expectOpts.penaltyAddress = named.penaltyAddress;
        if (expectOpts.minPenaltySats == null && named.minPenaltySats != null) expectOpts.minPenaltySats = named.minPenaltySats;
      }
      const check = Witness.verifyPenaltyPreSig(preSig, Bond._penaltyExpectation(deposit, preSig, expectOpts));
      if (!check.ok) throw new Error(`recordRound: ${check.reason}`);
      if (!check.enforceable) extraMissing.push('penalty destination (penaltyAddress) — a penalty paying a provider-chosen output is not enforceable');
      this.resolutions.addExit(id, { id: 'penalty', kind: Resolutions.KINDS.PENALTY, psbtBase64: preSig.psbtBase64, required: [deposit.providerPubkey], locktime: { height: deadline }, meta: { deadlineHeight: deadline } });
      if (opts.checkInPsbtBase64) {
        if (!opts.previousDeposit) throw new Error('recordRound: previousDeposit required to verify the check-in');
        const checkIn = Bond.verifyCheckIn(opts.previousDeposit, opts.checkInPsbtBase64, deposit, { nextOutpoint: preSig.deposit, maxFeeSats: opts.maxFeeSats });
        if (!checkIn.ok) throw new Error(`recordRound: ${checkIn.reason}`);
        this.resolutions.addExit(id, { id: 'checkin', kind: Resolutions.KINDS.CHECKIN, psbtBase64: opts.checkInPsbtBase64, required: [opts.previousDeposit.providerPubkey] });
      }
    } else if (opts.checkInPsbtBase64) {
      throw new Error('recordRound: a check-in is recorded only with the next round\'s penalty pre-signature');
    }
    const missing = this.resolutions.missing(id).concat(extraMissing);
    if (!this.resolutions.getExit(id, 'penalty')) missing.push(`penalty pre-signature for round ${n}`);
    return { round: n, resolvable: missing.length === 0, answerable, missing };
  }

  /**
   * Unsigned 2-of-2 penalty spend of a provider deposit, for adjudicated or
   * cooperative settlement: it still needs the **provider's** signature, so
   * it never moves funds on the publisher's word alone (the timelocked path
   * is {@link Bond.finalizePreSignedPenalty}). **Requires a verifying,
   * reputational fraud proof** of an accepted kind (`wrong-leaf`, late
   * `non-response`) naming this provider, bound to this deposit: the
   * challenge's root equals `deposit.merkleRootHex`, the commitment names
   * `deposit.address`, and the challenge's deposit outpoint is the funded
   * output being spent. Each evidence id (see `FraudProof#evidenceIds`) is
   * spent once — in `opts.consumed` when given, else a process-wide set.
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {object} opts `{ fraudProof, fundedTxHex, destinationAddress, feeSats, ctx?, consumed? }`
   * @returns {object}
   */
  static preparePenaltySpend (deposit, opts = {}) {
    const proof = opts.fraudProof instanceof Witness.FraudProof
      ? opts.fraudProof
      : Witness.FraudProof.fromBody(opts.fraudProof);
    if (!proof) throw new Error('preparePenaltySpend: fraudProof required');
    if (!PENALTY_KINDS.has(proof.kind)) throw new Error(`preparePenaltySpend: ${proof.kind} proofs do not move a deposit`);
    const verdict = proof.verify(Object.assign({}, opts.ctx || {}, opts.epoch != null ? { epoch: opts.epoch } : {}));
    if (!verdict.ok) throw new Error(`preparePenaltySpend: fraud proof does not verify (${verdict.reason})`);
    if (verdict.evidence === 'timelock') {
      throw new Error('preparePenaltySpend: timelocked non-response is enforced by the pre-signed penalty — use Bond.finalizePreSignedPenalty');
    }
    const xOnly = String(deposit.providerPubkey).slice(2);
    if (!verdict.reputational || String(verdict.offender || '').toLowerCase() !== xOnly) {
      throw new Error('preparePenaltySpend: fraud proof names a different offender');
    }
    const { challenge, commitment } = proof.artifacts;
    const root = deposit.merkleRootHex ? String(deposit.merkleRootHex).toLowerCase() : null;
    if (!root || String(challenge.merkleRootHex).toLowerCase() !== root) throw new Error('preparePenaltySpend: proof is for another tree than this deposit backs');
    if (!commitment || commitment.depositAddress !== deposit.address) throw new Error('preparePenaltySpend: commitment does not name this deposit address');
    const outpoint = challenge.deposit || {};
    if (!HEX64.test(String(outpoint.txid || '')) || outpoint.vout == null) throw new Error('preparePenaltySpend: challenge names no deposit outpoint');
    const funded = require('bitcoinjs-lib').Transaction.fromHex(String(opts.fundedTxHex || '').trim());
    if (funded.getId() !== String(outpoint.txid).toLowerCase()) throw new Error('preparePenaltySpend: fundedTxHex is not the challenged deposit transaction');
    const out = funded.outs[Number(outpoint.vout)];
    if (!out || !Buffer.from(out.script).equals(scriptFor(deposit.network, deposit.address))) throw new Error('preparePenaltySpend: challenged outpoint does not pay this deposit');
    const consumed = opts.consumed instanceof Set ? opts.consumed : CONSUMED_EVIDENCE;
    const ids = proof.evidenceIds();
    if (!ids.length) throw new Error('preparePenaltySpend: proof carries no evidence id');
    const reused = ids.find((e) => consumed.has(e));
    if (reused) throw new Error(`preparePenaltySpend: evidence ${reused} already spent`);
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
    if (psbt.vout !== Number(outpoint.vout)) throw new Error('preparePenaltySpend: deposit address paid more than once in the funding transaction');
    for (const e of ids) consumed.add(e);
    return Object.assign(psbt, {
      leafId: 'penalty',
      witnessShape: 'sigs',
      fraudProofHash: proof.hash,
      fraudProofKind: proof.kind,
      evidenceIds: ids,
      offender: verdict.offender,
      enforceable: false,
      signaturesRequired: [deposit.publisherPubkey, deposit.providerPubkey]
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

  /** Finalize a signed hashlock (claim / answer) PSBT. */
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

Bond.PENALTY_KINDS = PENALTY_KINDS;

// Fidelity bonds (coinjoin market)
/** Blocks in a year (10-minute blocks). */
const YEAR_BLOCKS = 52560;
const FIDELITY_INTEREST_RATE = 0.015;
const FIDELITY_EXPONENT = 1.3;
/** Mainnet bond locktimes are multiples of this height. */
const FIDELITY_LOCKTIME_GRID = 4320;
/** Furthest ahead a certificate may expire: about a year. */
const FIDELITY_MAX_CERT_BLOCKS = 2016 * 26;
const FIDELITY_MIN_CONFS = 6;
/** Leaf version for BIP342 tapscript. */
const LEAF_VERSION = 0xc0;
const LOCKTIME_MAX_HEIGHT = 499999999;
const FIDELITY_CERTIFICATE_TYPE = 'FidelityBondCertificate';
const FIDELITY_CERTIFICATE_VERSION = 1;

/** @private */
function fail (message) {
  throw new Error(`Bond: ${message}`);
}

/** @private */
function hexOf (label, value, bytes) {
  const s = String(value == null ? '' : value).trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(s) || s.length !== bytes * 2) fail(`${label} must be ${bytes * 2} hex characters`);
  return s;
}

/** @private */
function intOf (label, value, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${label} must be an integer in [${min}, ${max}]`);
  return n;
}

/** @private */
function xOnlyOf (label, value) {
  const s = String(value == null ? '' : value).trim().toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return fail(`${label} must be an x-only or compressed public key`);
}

/** @private */
function privOf (value) {
  const priv = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(hexOf('private key', value, 32), 'hex');
  if (!ecc.isPrivate(priv)) fail('invalid private key');
  return priv;
}

/** @private */
function isMainnet (networkName) {
  const n = String(networkName || '').trim().toLowerCase();
  return n === 'mainnet' || n === 'main' || n === 'bitcoin';
}

/**
 * BIP-32 path of the `index`th bond key: `m/86'/coin'/0'/2/index`
 * (chain 2 beside the BIP-86 receive and change chains).
 * @param {number} index
 * @param {string} [networkName='regtest']
 * @returns {string}
 */
function fidelityPath (index, networkName = 'regtest') {
  const i = intOf('index', index, 0, 0x7fffffff);
  return `m/86'/${isMainnet(networkName) ? 0 : 1}'/0'/2/${i}`;
}

/**
 * Whether a bond may lock until `locktime` on this network: a block height,
 * on the mainnet grid.
 * @param {number} locktime
 * @param {string} [networkName='regtest']
 * @returns {boolean}
 */
function isValidFidelityLocktime (locktime, networkName = 'regtest') {
  const n = Number(locktime);
  if (!Number.isSafeInteger(n) || n < 1 || n > LOCKTIME_MAX_HEIGHT) return false;
  return !isMainnet(networkName) || n % FIDELITY_LOCKTIME_GRID === 0;
}

/**
 * The next `count` locktimes a new bond may use, after `tipHeight`.
 * @param {Object} opts
 * @param {number} opts.tipHeight
 * @param {string} [opts.networkName='regtest']
 * @param {number} [opts.count=12]
 * @param {number} [opts.step] blocks between choices (mainnet: the grid)
 * @returns {number[]}
 */
function fidelityLocktimes (opts = {}) {
  const tip = intOf('tipHeight', opts.tipHeight, 0, LOCKTIME_MAX_HEIGHT);
  const count = intOf('count', opts.count == null ? 12 : opts.count, 1, 120);
  const step = isMainnet(opts.networkName) ? FIDELITY_LOCKTIME_GRID : intOf('step', opts.step || FIDELITY_LOCKTIME_GRID, 1, YEAR_BLOCKS * 10);
  const first = (Math.floor(tip / step) + 1) * step;
  const out = [];
  for (let i = 0; i < count; i++) out.push(first + (i * step));
  return out;
}

/**
 * The bond output: NUMS internal key, one CLTV leaf.
 * @param {Object} opts
 * @param {string} [opts.networkName='regtest']
 * @param {string} opts.bondPubkey compressed or x-only
 * @param {number} opts.locktime block height
 * @returns {{ address: string, scriptPubKeyHex: string, leafScriptHex: string, controlBlockHex: string, bondXOnly: string, locktime: number }}
 */
function buildFidelity (opts = {}) {
  const networkName = opts.networkName || 'regtest';
  const bondXOnly = xOnlyOf('bondPubkey', opts.bondPubkey);
  const locktime = Number(opts.locktime);
  if (!isValidFidelityLocktime(locktime, networkName)) fail(`invalid locktime ${opts.locktime} for ${networkName}`);
  const leaf = bitcoin.script.compile([
    bitcoin.script.number.encode(locktime),
    bitcoin.script.OPS.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.script.OPS.OP_DROP,
    Buffer.from(bondXOnly, 'hex'),
    bitcoin.script.OPS.OP_CHECKSIG
  ]);
  const pay = bitcoin.payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree: { output: leaf },
    redeem: { output: leaf, redeemVersion: LEAF_VERSION },
    network: networkForFabricName(networkName)
  });
  const witness = pay.witness || [];
  return {
    address: pay.address,
    scriptPubKeyHex: Buffer.from(pay.output).toString('hex'),
    leafScriptHex: Buffer.from(leaf).toString('hex'),
    controlBlockHex: Buffer.from(witness[witness.length - 1]).toString('hex'),
    bondXOnly,
    locktime
  };
}

/**
 * Unsigned PSBT spending a bond after its locktime (`nLockTime` = locktime,
 * sequence `0xfffffffe` so CLTV applies).
 * @param {Object} opts
 * @param {string} [opts.networkName='regtest']
 * @param {Object} opts.bond `{ txid, vout, valueSats, locktime, bondXOnly }`
 * @param {string} opts.destinationAddress
 * @param {number} [opts.feeSats=500]
 * @returns {string} PSBT base64
 */
function prepareFidelityRedeem (opts = {}) {
  const networkName = opts.networkName || 'regtest';
  const bond = opts.bond || {};
  const valueSats = intOf('bond.valueSats', bond.valueSats, 1, Number.MAX_SAFE_INTEGER);
  const fee = intOf('feeSats', opts.feeSats == null ? 500 : opts.feeSats, 1, valueSats);
  if (valueSats - fee < 330) fail('bond value after fee is dust');
  const out = buildFidelity({ networkName, bondPubkey: bond.bondXOnly, locktime: bond.locktime });
  const network = networkForFabricName(networkName);
  const psbt = new bitcoin.Psbt({ network });
  psbt.setVersion(2);
  psbt.setLocktime(out.locktime);
  psbt.addInput({
    hash: hexOf('bond.txid', bond.txid, 32),
    index: intOf('bond.vout', bond.vout, 0, 0xffffffff),
    sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
    witnessUtxo: { script: Buffer.from(out.scriptPubKeyHex, 'hex'), value: BigInt(valueSats) },
    tapLeafScript: [{
      leafVersion: LEAF_VERSION,
      script: Buffer.from(out.leafScriptHex, 'hex'),
      controlBlock: Buffer.from(out.controlBlockHex, 'hex')
    }]
  });
  psbt.addOutput({ address: String(opts.destinationAddress || '').trim(), value: BigInt(valueSats - fee) });
  return psbt.toBase64();
}

/**
 * Sign a bond redeem PSBT with the bond key and extract the transaction.
 * @param {string} psbtBase64 {@link prepareFidelityRedeem} output
 * @param {Buffer|string} bondPriv32
 * @returns {{ txHex: string, txid: string }}
 */
function signFidelityRedeem (psbtBase64, bondPriv32) {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || ''));
  psbt.signInput(0, Htlc.signerFromPriv32(privOf(bondPriv32)));
  psbt.finalizeInput(0, (_index, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    const sig = (input.tapScriptSig || [])[0];
    if (!leaf || !sig) fail('bond redeem input is not signed');
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness([sig.signature, leaf.script, leaf.controlBlock]) };
  });
  const tx = psbt.extractTransaction();
  return { txHex: tx.toHex(), txid: tx.getId() };
}

/** @private */
function certificateHash (fields) {
  const message = {
    type: FIDELITY_CERTIFICATE_TYPE,
    version: FIDELITY_CERTIFICATE_VERSION,
    network: String(fields.network || '').trim().toLowerCase(),
    txid: hexOf('txid', fields.txid, 32),
    vout: intOf('vout', fields.vout, 0, 0xffffffff),
    locktime: intOf('locktime', fields.locktime, 1, LOCKTIME_MAX_HEIGHT),
    bondXOnly: xOnlyOf('bondXOnly', fields.bondXOnly),
    makerPubkey: String(fields.makerPubkey || '').trim().toLowerCase(),
    certExpiresAt: intOf('certExpiresAt', fields.certExpiresAt, 1, LOCKTIME_MAX_HEIGHT)
  };
  return crypto.createHash('sha256').update(stableStringify(jsonSafe(message))).digest();
}

/**
 * Sign a certificate letting `makerPubkey` advertise this bond until block
 * `certExpiresAt`.
 * @param {Object} opts
 * @param {string} opts.network
 * @param {string} opts.txid
 * @param {number} opts.vout
 * @param {number} opts.locktime
 * @param {string} opts.makerPubkey compressed offer key
 * @param {number} opts.certExpiresAt block height
 * @param {Buffer|string} opts.bondPrivateKey
 * @returns {Object} bond descriptor for `CoinjoinOffer.fidelityBond`
 */
function signFidelityCertificate (opts = {}) {
  const priv = privOf(opts.bondPrivateKey);
  const bondXOnly = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1).toString('hex');
  const fields = Object.assign({}, opts, { bondXOnly });
  const certSig = Buffer.from(ecc.signSchnorr(certificateHash(fields), priv)).toString('hex');
  return normalizeFidelity({
    txid: opts.txid,
    vout: opts.vout,
    locktime: opts.locktime,
    bondXOnly,
    certExpiresAt: opts.certExpiresAt,
    certSig
  });
}

/**
 * Shape of `CoinjoinOffer.fidelityBond`.
 * @param {Object} input
 * @returns {{ txid: string, vout: number, locktime: number, bondXOnly: string, certExpiresAt: number, certSig: string }}
 */
function normalizeFidelity (input = {}) {
  return {
    txid: hexOf('fidelityBond.txid', input.txid, 32),
    vout: intOf('fidelityBond.vout', input.vout, 0, 0xffffffff),
    locktime: intOf('fidelityBond.locktime', input.locktime, 1, LOCKTIME_MAX_HEIGHT),
    bondXOnly: xOnlyOf('fidelityBond.bondXOnly', input.bondXOnly),
    certExpiresAt: intOf('fidelityBond.certExpiresAt', input.certExpiresAt, 1, LOCKTIME_MAX_HEIGHT),
    certSig: hexOf('fidelityBond.certSig', input.certSig, 64)
  };
}

/**
 * Check the bond key signed this certificate for `makerPubkey` on `network`.
 * @param {Object} bond
 * @param {Object} opts
 * @param {string} opts.makerPubkey
 * @param {string} opts.network
 * @returns {boolean}
 */
function verifyFidelityCertificate (bond, opts = {}) {
  try {
    const b = normalizeFidelity(bond);
    const hash = certificateHash(Object.assign({}, b, { network: opts.network, makerPubkey: opts.makerPubkey }));
    return ecc.verifySchnorr(hash, Buffer.from(b.bondXOnly, 'hex'), Buffer.from(b.certSig, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Value of a bond (JoinMarket's formula, heights in place of times):
 * `T = (locktime − confirmHeight) / year`, `L = max(0, tip − locktime) / year`,
 * `a = max(0, min(1, e^(rT) − 1) − min(1, e^(rL) − 1))`,
 * `value = (valueSats × a)^exponent`.
 * @param {Object} opts
 * @param {number} opts.valueSats
 * @param {number} opts.locktime
 * @param {number} opts.confirmHeight
 * @param {number} opts.tipHeight
 * @param {number} [opts.interestRate=0.015]
 * @param {number} [opts.exponent=1.3]
 * @returns {number}
 */
function fidelityValue (opts = {}) {
  const valueSats = Number(opts.valueSats);
  const locktime = Number(opts.locktime);
  const confirmHeight = Number(opts.confirmHeight);
  const tip = Number(opts.tipHeight);
  if (![valueSats, locktime, confirmHeight, tip].every(Number.isFinite) || valueSats <= 0) return 0;
  const r = opts.interestRate != null ? Number(opts.interestRate) : FIDELITY_INTEREST_RATE;
  const exponent = opts.exponent != null ? Number(opts.exponent) : FIDELITY_EXPONENT;
  const T = Math.max(0, locktime - confirmHeight) / YEAR_BLOCKS;
  const L = Math.max(0, tip - locktime) / YEAR_BLOCKS;
  const a = Math.max(0, Math.min(1, Math.exp(r * T) - 1) - Math.min(1, Math.exp(r * L) - 1));
  if (a <= 0) return 0;
  return Math.pow(valueSats * a, exponent);
}

/**
 * Verify a bond on chain for one maker. `bitcoin.getTxOut(txid, vout)` must
 * resolve to `{ valueSats, scriptPubKeyHex, confirmations }` for an unspent
 * output, else `null`.
 * @param {Object} bond `CoinjoinOffer.fidelityBond`
 * @param {Object} opts
 * @param {string} opts.makerPubkey
 * @param {string} opts.network
 * @param {Object} opts.bitcoin `{ getTipHeight(), getTxOut(txid, vout) }`
 * @param {number} [opts.tipHeight] skip `getTipHeight`
 * @param {number} [opts.minConfs=6]
 * @param {number} [opts.maxCertBlocks]
 * @returns {Promise<{ ok: boolean, reason: (string|null), valueSats: number, confirmHeight: (number|null), value: number }>}
 */
async function verifyFidelity (bond, opts = {}) {
  const bad = (reason) => ({ ok: false, reason, valueSats: 0, confirmHeight: null, value: 0 });
  let b;
  try {
    b = normalizeFidelity(bond);
  } catch (err) {
    return bad(err.message);
  }
  const network = String(opts.network || '').trim().toLowerCase();
  if (!isValidFidelityLocktime(b.locktime, network)) return bad('locktime not allowed on this network');
  if (!verifyFidelityCertificate(b, { makerPubkey: opts.makerPubkey, network })) return bad('bad certificate');
  const chain = opts.bitcoin;
  if (!chain || typeof chain.getTxOut !== 'function') return bad('no chain access');
  let tip;
  let utxo;
  try {
    tip = opts.tipHeight != null ? Number(opts.tipHeight) : Number(await chain.getTipHeight());
    utxo = await chain.getTxOut(b.txid, b.vout);
  } catch (err) {
    return bad(`chain lookup failed: ${err.message}`);
  }
  if (!Number.isSafeInteger(tip) || tip < 0) return bad('unknown tip height');
  if (b.certExpiresAt <= tip) return bad('certificate expired');
  const maxCert = opts.maxCertBlocks != null ? Number(opts.maxCertBlocks) : FIDELITY_MAX_CERT_BLOCKS;
  if (b.certExpiresAt > tip + maxCert) return bad('certificate runs too far ahead');
  if (!utxo) return bad('bond output is spent or unknown');
  const expected = buildFidelity({ networkName: network, bondPubkey: b.bondXOnly, locktime: b.locktime });
  if (String(utxo.scriptPubKeyHex || '').toLowerCase() !== expected.scriptPubKeyHex) return bad('bond output script does not match');
  const confs = Number(utxo.confirmations);
  const minConfs = opts.minConfs != null ? Number(opts.minConfs) : FIDELITY_MIN_CONFS;
  if (!Number.isSafeInteger(confs) || confs < Math.max(1, minConfs)) return bad('bond not confirmed enough');
  const valueSats = Number(utxo.valueSats);
  const confirmHeight = tip - confs + 1;
  const value = fidelityValue({
    valueSats,
    locktime: b.locktime,
    confirmHeight,
    tipHeight: tip,
    interestRate: opts.interestRate,
    exponent: opts.exponent
  });
  return { ok: true, reason: null, valueSats, confirmHeight, value };
}

/**
 * Caches bond checks per (outpoint, maker, certificate) until the tip moves.
 */
class FidelityVerifier {
  /**
   * @param {Object} settings
   * @param {Object} settings.bitcoin `{ getTipHeight(), getTxOut(txid, vout) }`
   * @param {string} settings.network
   * @param {number} [settings.minConfs]
   * @param {number} [settings.maxCertBlocks]
   * @param {number} [settings.interestRate]
   * @param {number} [settings.exponent]
   */
  constructor (settings = {}) {
    this.settings = Object.assign({}, settings);
    this._tip = null;
    this._cache = new Map();
  }

  /**
   * @param {Object} bond
   * @param {string} makerPubkey
   * @returns {Promise<Object>} {@link verifyFidelity} result
   */
  async verify (bond, makerPubkey) {
    const tip = Number(await this.settings.bitcoin.getTipHeight());
    if (tip !== this._tip) {
      this._tip = tip;
      this._cache.clear();
    }
    const key = `${bond && bond.txid}:${bond && bond.vout}:${makerPubkey}:${bond && bond.certSig}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const result = await verifyFidelity(bond, Object.assign({}, this.settings, { makerPubkey, tipHeight: tip }));
    this._cache.set(key, result);
    return result;
  }

  clear () {
    this._tip = null;
    this._cache.clear();
  }
}

Object.assign(Bond, {
  YEAR_BLOCKS,
  FIDELITY_INTEREST_RATE,
  FIDELITY_EXPONENT,
  FIDELITY_LOCKTIME_GRID,
  FIDELITY_MAX_CERT_BLOCKS,
  FIDELITY_MIN_CONFS,
  FIDELITY_CERTIFICATE_TYPE,
  fidelityPath,
  isValidFidelityLocktime,
  fidelityLocktimes,
  buildFidelity,
  prepareFidelityRedeem,
  signFidelityRedeem,
  signFidelityCertificate,
  normalizeFidelity,
  verifyFidelityCertificate,
  fidelityValue,
  verifyFidelity,
  FidelityVerifier
});

module.exports = Bond;
