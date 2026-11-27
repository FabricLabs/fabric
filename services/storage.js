'use strict';

/**
 * Peer storage market.
 *
 * Any Fabric peer can publish a storage contract, stake a deposit, answer a
 * publisher's challenge, and build a penalty PSBT. The contract root is the
 * challenge tree over raw blob hashes ({@link Challenge.createBlobMerkleTree}),
 * not the document sale tree (which also commits payment hashes and IVs).
 * Bonds stay on regtest, signet, and testnet: {@link Bond} refuses mainnet.
 *
 * A penalty that depends on chain state fails closed unless the host passed
 * `outpointUnspent`, `txConfirmed`, and `headerKnown`. Hub HTTP is an adapter
 * over this service.
 */

const crypto = require('crypto');
const Service = require('../types/service');
const Challenge = require('../types/challenge');
const Bond = require('../types/bond');
const Witness = require('../types/witness');

const HEX64 = /^[0-9a-f]{64}$/;
const CHAIN_CALLBACKS = ['outpointUnspent', 'txConfirmed', 'headerKnown'];

function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeHashes (hashes) {
  if (!Array.isArray(hashes) || !hashes.length) {
    throw new Error('storage: blobHashes required');
  }
  return hashes.map((h) => {
    const hex = String(h || '').toLowerCase();
    if (!HEX64.test(hex)) throw new Error('storage: each blob hash must be 64 hex chars');
    return hex;
  });
}

class Storage extends Service {
  /**
   * @param {object} [settings]
   * @param {string} [settings.network]
   * @param {function} [settings.outpointUnspent]
   * @param {function} [settings.txConfirmed]
   * @param {function} [settings.headerKnown]
   */
  constructor (settings = {}) {
    super(Object.assign({ name: 'Storage', networking: false, persistent: false }, settings));
    this.settings.network = settings.network || 'regtest';
    this._outpointUnspent = typeof settings.outpointUnspent === 'function' ? settings.outpointUnspent : null;
    this._txConfirmed = typeof settings.txConfirmed === 'function' ? settings.txConfirmed : null;
    this._headerKnown = typeof settings.headerKnown === 'function' ? settings.headerKnown : null;
    this._challenger = new Challenge({ deadlineEpochs: settings.deadlineEpochs || 2 });
    /** @type {Map<string, object>} */
    this.contracts = new Map();
    /** @type {Map<string, object>} */
    this.commitments = new Map();
    /** @type {Map<string, object>} */
    this.challenges = new Map();
    /** @type {Map<string, object>} deposit address → `{ deposit, fundedTxHex }` */
    this.deposits = new Map();
  }

  /**
   * Challenge-tree root for raw blob hashes. Refuses a sale-tree root that
   * does not match.
   * @param {string[]} blobHashes
   * @param {string} [claimedRoot]
   * @returns {{ merkleRootHex: string, blobTotal: number, blobHashes: string[] }}
   */
  static challengeRoot (blobHashes, claimedRoot) {
    const hashes = normalizeHashes(blobHashes);
    const merkleRootHex = Challenge.createBlobMerkleTree(hashes).rootHex;
    const claimed = claimedRoot ? String(claimedRoot).toLowerCase() : '';
    if (claimed && claimed !== merkleRootHex) {
      throw new Error('storage: merkleRootHex must be the challenge tree over raw blob hashes, not the sale-tree root');
    }
    return { merkleRootHex, blobTotal: hashes.length, blobHashes: hashes };
  }

  /**
   * Publish a storage contract. `blobs` are hashed here; `blobHashes` are
   * used as given. The root is always the challenge tree.
   * @param {object} opts
   * @returns {object} `StorageContract` body
   */
  static publish (opts = {}) {
    let blobHashes = opts.blobHashes;
    if (!blobHashes && Array.isArray(opts.blobs)) {
      blobHashes = opts.blobs.map((b) => sha256Hex(Buffer.isBuffer(b) ? b : Buffer.from(b)));
    }
    const tree = Storage.challengeRoot(blobHashes, opts.merkleRootHex || opts.saleRootHex);
    const amountSats = opts.amountSats != null ? Math.floor(Number(opts.amountSats)) : null;
    if (amountSats != null && (!Number.isFinite(amountSats) || amountSats <= 0)) {
      throw new Error('storage: amountSats must be a positive integer');
    }
    return {
      type: 'StorageContract',
      version: 1,
      tree: 'blob-hash',
      document: opts.documentId ? String(opts.documentId) : null,
      merkleRootHex: tree.merkleRootHex,
      blobTotal: tree.blobTotal,
      blobHashes: tree.blobHashes,
      amountSats,
      challengeCadence: opts.challengeCadence || 'daily',
      responseDeadline: opts.responseDeadline || '10s',
      publisherPubkey: opts.publisherPubkey ? String(opts.publisherPubkey).toLowerCase() : null
    };
  }

  /**
   * @param {object} opts passed to {@link Bond.buildBounty}; mainnet throws
   * @returns {object}
   */
  static buildBounty (opts = {}) {
    return Bond.buildBounty(opts);
  }

  /**
   * @param {object} opts passed to {@link Bond.buildDeposit}; mainnet throws
   * @returns {object}
   */
  static buildDeposit (opts = {}) {
    return Bond.buildDeposit(opts);
  }

  /**
   * Remember a published contract.
   * @param {object} contract from {@link Storage.publish}
   * @param {string} [id]
   * @returns {object}
   */
  register (contract, id) {
    if (!contract || contract.type !== 'StorageContract' || !contract.merkleRootHex) {
      throw new Error('storage: StorageContract required');
    }
    const row = Object.assign({ id: id || contract.merkleRootHex }, contract);
    this.contracts.set(row.id, row);
    return row;
  }

  /**
   * @param {object} opts {@link Challenge.commit} options
   * @returns {object} signed commitment
   */
  commit (opts = {}) {
    const body = Challenge.commit(opts);
    this.commitments.set(Witness.artifactHash(body), body);
    return body;
  }

  /**
   * Publisher-signed challenge for the contract's challenge tree.
   * @param {object} opts
   * @returns {object}
   */
  challenge (opts = {}) {
    const contract = opts.contractId ? this.contracts.get(String(opts.contractId)) : null;
    const artifact = this._challenger.issue(Object.assign({
      merkleRootHex: contract && contract.merkleRootHex,
      blobHashes: contract && contract.blobHashes,
      blobTotal: contract && contract.blobTotal
    }, opts));
    this.challenges.set(Witness.artifactHash(artifact), {
      challenge: artifact,
      response: null,
      contractId: opts.contractId || null
    });
    return artifact;
  }

  /**
   * Check a provider's answer. A timely valid answer resolves the challenge.
   * @param {object} response
   * @param {object} [ctx]
   * @returns {object}
   */
  respond (response, ctx = {}) {
    if (!response || response.type !== 'AvailabilityResponse') {
      return { ok: false, reason: 'not an AvailabilityResponse' };
    }
    const row = this.challenges.get(String(response.challengeHash || ''));
    if (!row) return { ok: false, reason: 'unknown challenge' };
    if (row.resolved) return Object.assign({ duplicate: true }, row.verdict || { ok: false, reason: 'challenge already resolved' });
    if (!Witness.verifyArtifact(response, row.challenge.providerPubkey)) {
      return { ok: false, refused: true, reason: 'response signature invalid' };
    }
    const verdict = this._challenger.validate(row.challenge, response, ctx);
    row.rejected = row.rejected || [];
    if (verdict.ok) {
      row.resolved = true;
      row.response = response;
      row.verdict = verdict;
    } else {
      row.rejected.push({ response, verdict });
    }
    return verdict;
  }

  /**
   * @param {object} deposit from {@link Bond.buildDeposit}
   * @param {string} fundedTxHex
   */
  registerDeposit (deposit, fundedTxHex) {
    if (!deposit || !deposit.address) throw new Error('storage: deposit required');
    if (!fundedTxHex) throw new Error('storage: fundedTxHex required');
    this.deposits.set(deposit.address, { deposit, fundedTxHex: String(fundedTxHex) });
    return deposit;
  }

  /**
   * Names of chain callbacks the host did not pass.
   * @returns {string[]}
   */
  missingChainCallbacks () {
    const missing = [];
    if (typeof this._outpointUnspent !== 'function') missing.push('outpointUnspent');
    if (typeof this._txConfirmed !== 'function') missing.push('txConfirmed');
    if (typeof this._headerKnown !== 'function') missing.push('headerKnown');
    return missing;
  }

  /**
   * @returns {{ ok: true, ctx: object } | { ok: false, failClosed: true, error: string }}
   */
  chainView () {
    const missing = this.missingChainCallbacks();
    if (missing.length) {
      return {
        ok: false,
        failClosed: true,
        error: `chain view required: ${missing.join(', ')}`
      };
    }
    return {
      ok: true,
      ctx: {
        outpointUnspent: this._outpointUnspent,
        txConfirmed: this._txConfirmed,
        headerKnown: this._headerKnown
      }
    };
  }

  /**
   * Build a penalty PSBT for a verifying fraud proof bound to a registered
   * deposit. Refuses to run without a chain view.
   * @param {object} opts
   * @param {object} opts.fraudProof
   * @param {object} [opts.deposit]
   * @param {string} [opts.fundedTxHex]
   * @param {string} opts.destinationAddress
   * @param {object} [opts.ctx]
   * @returns {object}
   */
  preparePenalty (opts = {}) {
    const view = this.chainView();
    if (!view.ok) {
      const err = new Error(`storage: ${view.error}`);
      err.code = 'CHAIN_VIEW_REQUIRED';
      throw err;
    }
    const proof = opts.fraudProof;
    const held = opts.deposit
      ? { deposit: opts.deposit, fundedTxHex: opts.fundedTxHex }
      : null;
    const deposit = held || this._depositForProof(proof);
    if (!deposit || !deposit.fundedTxHex) throw new Error('storage: funded deposit required');
    return Bond.preparePenaltySpend(deposit.deposit, {
      fraudProof: proof && proof.toBody ? proof.toBody() : proof,
      fundedTxHex: deposit.fundedTxHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats,
      ctx: Object.assign({}, view.ctx, opts.ctx || {}),
      consumed: opts.consumed
    });
  }

  /**
   * Late answer → non-response proof → penalty PSBT.
   * @param {object} opts
   * @returns {{ proof: object, penalty: object }}
   */
  penalizeLateResponse (opts = {}) {
    const proof = this._challenger.proofFor(opts.challenge, opts.response, {
      commitment: opts.commitment,
      anchor: opts.anchor
    });
    if (!proof || proof.kind !== 'non-response') {
      throw new Error('storage: late response is not a non-response proof');
    }
    const penalty = this.preparePenalty({
      fraudProof: proof,
      deposit: opts.deposit,
      fundedTxHex: opts.fundedTxHex,
      destinationAddress: opts.destinationAddress,
      feeSats: opts.feeSats,
      ctx: opts.ctx,
      consumed: opts.consumed
    });
    return { proof, penalty };
  }

  /**
   * Silence past the deadline does not become a penalty unless the chain
   * view is present. Missing callbacks return `failClosed` and build nothing.
   * @param {object} [opts]
   * @param {number} [opts.epoch]
   * @param {number} [opts.tipHeight]
   * @returns {{ ok: boolean, failClosed?: boolean, error?: string, late: number }}
   */
  sweep (opts = {}) {
    const view = this.chainView();
    if (!view.ok) return Object.assign({ late: 0 }, view);
    let late = 0;
    for (const row of this.challenges.values()) {
      if (row.resolved) continue;
      const verdict = this._challenger.validate(row.challenge, null, {
        epoch: opts.epoch,
        tipHeight: opts.tipHeight
      });
      if (verdict.late) late += 1;
    }
    return { ok: true, late };
  }

  /** @private */
  _depositForProof (proof) {
    const body = proof && proof.toBody ? proof.toBody() : proof;
    const address = body && body.artifacts && body.artifacts.commitment && body.artifacts.commitment.depositAddress;
    if (!address) return null;
    return this.deposits.get(address) || null;
  }
}

Storage.CHAIN_CALLBACKS = CHAIN_CALLBACKS;

module.exports = Storage;
