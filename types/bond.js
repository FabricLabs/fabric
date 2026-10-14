'use strict';

const crypto = require('crypto');
const Contract = require('./contract');
const Witness = require('./witness');
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
   * @param {Array<{ epoch: number, amountSats: number, commitments?: object }>} opts.epochs
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
   * Penalty spend of a provider deposit. **Requires a verifying fraud proof**
   * naming this provider as offender; the proof hash is recorded on the result
   * so the spend always travels with its evidence.
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {object} opts `{ fraudProof, fundedTxHex, destinationAddress, feeSats, epoch }`
   * @returns {object}
   */
  static preparePenaltySpend (deposit, opts = {}) {
    const proof = opts.fraudProof instanceof Witness.FraudProof
      ? opts.fraudProof
      : Witness.FraudProof.fromBody(opts.fraudProof);
    if (!proof) throw new Error('preparePenaltySpend: fraudProof required');
    const verdict = proof.verify({ epoch: opts.epoch });
    if (!verdict.ok) throw new Error(`preparePenaltySpend: fraud proof does not verify (${verdict.reason})`);
    const xOnly = String(deposit.providerPubkey).slice(2);
    if (String(verdict.offender || '').toLowerCase() !== xOnly) {
      throw new Error('preparePenaltySpend: fraud proof names a different offender');
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

  _getExpiry (type, time) {
    return {
      type, time,
      content: Buffer.alloc(4)
    };
  }
}

module.exports = Bond;
