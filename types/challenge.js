'use strict';

const crypto = require('crypto');
const Witness = require('./witness');
const Tree = require('./tree');
const { verifyBlob } = require('../functions/documentBlobManifest');

/**
 * Storage tree over raw 32-byte blob hashes (its proofs are {@link Tree} proofs).
 * @param {string[]} hashes
 * @returns {Tree}
 */
function createBlobMerkleTree (hashes) {
  return new Tree({ leaves: hashes.map((h) => Buffer.from(h, 'hex')) });
}

const HEX64 = /^[0-9a-f]{64}$/;

const { FraudProof } = Witness;
const TYPES = FraudProof.TYPES;
const toInt = FraudProof.toInt;

// Blocks between a challenge's deadline height and the earliest withdraw of
// its deposit, so a provider cannot run out the clock on a pending penalty.
const WITHDRAW_MARGIN_BLOCKS = 144;

/**
 * Merkle-leaf availability challenge for a sealed blob tree.
 *
 * A **commitment** is the provider's signed promise to hold a tree (root,
 * `blobTotal`, publisher) until an epoch, optionally naming the deposit that
 * backs it. A **challenge** is the publisher's signed, Beacon-epoch stamped
 * request for one leaf; the leaf index is derived from the challenge nonce
 * so neither party picks it. A challenge may commit an **answer hash**
 * `SHA256(SHA256(nonce || blob bytes))`, also committed in that round's
 * deposit output as the provider's unilateral `answer` leaf (see
 * `Bond.buildDeposit`), so the provider can always answer on-chain. A
 * **response** is the provider's signed inclusion proof plus the nonce-bound
 * possession digest. A **receipt** is the counterparty's signed
 * acknowledgement of a challenge (and response) at an epoch; an **epoch
 * attestation** is a Beacon / federation key's signature that a digest
 * existed at an epoch. All are plain JSON artifacts carried as
 * `CONTRACT_MESSAGE` bodies and feed {@link Witness.FraudProof}.
 *
 * Response deadlines are expressed in **epochs** (default two) so a lagging
 * Hub view cannot make an honest provider provably late.
 */
class Challenge {
  constructor (settings = {}) {
    this.settings = Object.assign({
      deadlineEpochs: 2,
      withdrawMarginBlocks: WITHDRAW_MARGIN_BLOCKS
    }, settings);
    return this;
  }

  /**
   * Body `type` strings used on the wire.
   * @type {{ CHALLENGE: string, RESPONSE: string, COMMITMENT: string, RECEIPT: string, ATTESTATION: string }}
   */
  static get TYPES () {
    return { CHALLENGE: TYPES.CHALLENGE, RESPONSE: TYPES.RESPONSE, COMMITMENT: TYPES.COMMITMENT, RECEIPT: TYPES.RECEIPT, ATTESTATION: TYPES.ATTESTATION };
  }

  static get WITHDRAW_MARGIN_BLOCKS () { return WITHDRAW_MARGIN_BLOCKS; }

  /**
   * Deterministic leaf selection: `SHA256(root || epoch || nonce) mod blobTotal`.
   * @param {string} merkleRootHex
   * @param {number} epoch
   * @param {string} nonceHex
   * @param {number} blobTotal
   * @returns {number}
   */
  static leafIndexFor (merkleRootHex, epoch, nonceHex, blobTotal) {
    return FraudProof.leafIndexFor(merkleRootHex, epoch, nonceHex, blobTotal);
  }

  /**
   * Nonce-bound possession digest `SHA256(nonce || bytes)` hex.
   * @param {string} nonceHex
   * @param {Buffer} bytes
   * @returns {string}
   */
  static possessionHex (nonceHex, bytes) {
    return FraudProof.possessionHex(nonceHex, bytes);
  }

  /**
   * Answer hash for a possession digest: `SHA256(possession)` hex.
   * @param {string} possessionHex
   * @returns {string}
   */
  static answerHashFor (possessionHex) {
    return FraudProof.answerHashFor(possessionHex);
  }

  /**
   * Publisher plans round `epoch` before building that round's deposit: picks
   * the nonce, derives the challenged index, and computes the answer hash
   * from its own copy of the blob. The deposit for the round commits the
   * answer hash (`Bond.buildDeposit({ answerHashHex })`) and the challenge
   * is issued with the same nonce and hash.
   * @param {object} opts
   * @param {string} opts.merkleRootHex
   * @param {number} opts.blobTotal
   * @param {number} opts.epoch
   * @param {string} [opts.nonceHex] 32-byte hex (random when omitted)
   * @param {function} opts.bytesFor `(blobIndex) → Buffer` the publisher's blob bytes
   * @param {string[]} [opts.blobHashes] leaf hashes, to check the bytes
   * @returns {{ epoch: number, nonceHex: string, blobIndex: number, possessionHex: string, answerHashHex: string }}
   */
  static planRound (opts = {}) {
    const root = String(opts.merkleRootHex || '').toLowerCase();
    if (!HEX64.test(root)) throw new Error('planRound: merkleRootHex must be 64 hex chars');
    const blobTotal = toInt(opts.blobTotal);
    if (!blobTotal) throw new Error('planRound: blobTotal must be a positive integer');
    const epoch = toInt(opts.epoch);
    if (epoch == null) throw new Error('planRound: epoch must be a non-negative integer');
    const nonceHex = opts.nonceHex ? String(opts.nonceHex).toLowerCase() : crypto.randomBytes(32).toString('hex');
    if (!HEX64.test(nonceHex)) throw new Error('planRound: nonceHex must be 32-byte hex');
    if (typeof opts.bytesFor !== 'function') throw new Error('planRound: bytesFor(blobIndex) required — the answer hash needs the blob');
    const blobIndex = Challenge.leafIndexFor(root, epoch, nonceHex, blobTotal);
    const bytes = opts.bytesFor(blobIndex);
    if (!Buffer.isBuffer(bytes)) throw new Error(`planRound: no bytes for blob ${blobIndex}`);
    if (Array.isArray(opts.blobHashes) && !verifyBlob(bytes, String(opts.blobHashes[blobIndex] || ''))) {
      throw new Error(`planRound: bytes for blob ${blobIndex} do not match its leaf hash`);
    }
    const possessionHex = Challenge.possessionHex(nonceHex, bytes);
    return { epoch, nonceHex, blobIndex, possessionHex, answerHashHex: Challenge.answerHashFor(possessionHex) };
  }

  /**
   * Provider's signed availability commitment. `blobTotal` and the
   * publisher's key are required: fraud proofs bind every challenge to them.
   * @param {object} opts
   * @param {string} opts.merkleRootHex
   * @param {number} opts.blobTotal leaves in the committed tree
   * @param {string} opts.publisherPubkey the only key whose challenges count
   * @param {number} opts.fromEpoch
   * @param {number} opts.untilEpoch
   * @param {string} [opts.depositAddress] deposit Bond address backing this promise
   * @param {string} [opts.depositTxid]
   * @param {Buffer|string} opts.providerPrivateKey
   * @returns {object} signed artifact
   */
  static commit (opts = {}) {
    const root = String(opts.merkleRootHex || '').toLowerCase();
    if (!HEX64.test(root)) throw new Error('commit: merkleRootHex must be 64 hex chars');
    const blobTotal = toInt(opts.blobTotal);
    if (!blobTotal) throw new Error('commit: blobTotal must be a positive integer');
    const publisher = String(opts.publisherPubkey || '').toLowerCase();
    if (!/^((02|03)[0-9a-f]{64}|[0-9a-f]{64})$/.test(publisher)) throw new Error('commit: publisherPubkey required (x-only or compressed hex)');
    const body = {
      type: TYPES.COMMITMENT,
      version: 1,
      merkleRootHex: root,
      blobTotal,
      fromEpoch: Math.max(0, Math.floor(Number(opts.fromEpoch) || 0)),
      untilEpoch: opts.untilEpoch != null ? Math.floor(Number(opts.untilEpoch)) : null,
      depositAddress: opts.depositAddress ? String(opts.depositAddress) : null,
      depositTxid: opts.depositTxid ? String(opts.depositTxid).toLowerCase() : null,
      publisherPubkey: publisher
    };
    return Witness.signArtifact(body, opts.providerPrivateKey);
  }

  /**
   * Publisher issues one leaf challenge for `epoch`.
   * @param {object} opts
   * @param {string} opts.merkleRootHex
   * @param {number} opts.blobTotal
   * @param {number} opts.epoch Beacon epoch (clock) the challenge is issued in
   * @param {string} opts.providerPubkey x-only hex the challenge is addressed to
   * @param {string[]} [opts.blobHashes] leaf hashes: pins `blobHashHex` for the chosen index with a Merkle `pinProof`
   * @param {string} [opts.nonceHex] 32-byte hex (random when omitted; use {@link Challenge.planRound}'s)
   * @param {string} [opts.answerHashHex] the round's answer hash (from {@link Challenge.planRound})
   * @param {function} [opts.bytesFor] `(blobIndex) → Buffer` computes `answerHashHex` instead
   * @param {number} [opts.deadlineEpochs]
   * @param {number} [opts.deadlineHeight] block height after which silence is enforceable (timelocked non-response); or derive from `tipHeight` + `deadlineBlocks`
   * @param {number} [opts.tipHeight] current block height (with `deadlineBlocks`)
   * @param {number} [opts.deadlineBlocks] blocks after `tipHeight` for the deadline
   * @param {object} [opts.deposit] `{ txid, vout, address?, penaltyAddress?, minPenaltySats?, withdrawAfter? }` the provider's deposit outpoint the pre-signed penalty must spend, and where / how much it must pay the publisher; `withdrawAfter` (the deposit's withdraw height) must clear the deadline by `withdrawMarginBlocks`
   * @param {number} [opts.withdrawMarginBlocks] default 144
   * @param {Buffer|string} opts.publisherPrivateKey
   * @returns {object} signed artifact
   */
  issue (opts = {}) {
    const root = String(opts.merkleRootHex || '').toLowerCase();
    if (!HEX64.test(root)) throw new Error('issue: merkleRootHex must be 64 hex chars');
    const provider = String(opts.providerPubkey || '').toLowerCase();
    if (!HEX64.test(provider)) throw new Error('issue: providerPubkey must be x-only hex');
    const epoch = Math.max(0, Math.floor(Number(opts.epoch) || 0));
    const nonceHex = opts.nonceHex ? String(opts.nonceHex).toLowerCase() : crypto.randomBytes(32).toString('hex');
    if (!HEX64.test(nonceHex)) throw new Error('issue: nonceHex must be 32-byte hex');
    const hashes = Array.isArray(opts.blobHashes) ? opts.blobHashes.map((h) => String(h).toLowerCase()) : null;
    const blobTotal = Math.max(1, Math.floor(Number(opts.blobTotal) || (hashes ? hashes.length : 1)));
    if (hashes && hashes.length !== blobTotal) throw new Error('issue: blobHashes length differs from blobTotal');
    const blobIndex = Challenge.leafIndexFor(root, epoch, nonceHex, blobTotal);
    const deadlineEpochs = Math.max(1, Math.floor(Number(opts.deadlineEpochs != null ? opts.deadlineEpochs : this.settings.deadlineEpochs) || 2));
    let pinned = null;
    let pinProof = null;
    if (hashes) {
      const tree = createBlobMerkleTree(hashes);
      if (tree.rootHex !== root) throw new Error('issue: blobHashes do not build merkleRootHex');
      pinned = hashes[blobIndex];
      pinProof = { proof: Tree.serializeProof(tree.getProof(pinned, blobIndex)), leafCount: blobTotal };
    }
    let answerHashHex = opts.answerHashHex ? String(opts.answerHashHex).toLowerCase() : null;
    if (typeof opts.bytesFor === 'function') {
      const planned = Challenge.planRound({ merkleRootHex: root, blobTotal, epoch, nonceHex, bytesFor: opts.bytesFor, blobHashes: hashes });
      if (answerHashHex && answerHashHex !== planned.answerHashHex) throw new Error('issue: answerHashHex does not match the blob bytes');
      answerHashHex = planned.answerHashHex;
    }
    if (answerHashHex && !HEX64.test(answerHashHex)) throw new Error('issue: answerHashHex must be 32-byte hex');
    let deadlineHeight = null;
    if (opts.deadlineHeight != null) deadlineHeight = Math.floor(Number(opts.deadlineHeight));
    else if (opts.tipHeight != null && opts.deadlineBlocks != null) deadlineHeight = Math.floor(Number(opts.tipHeight)) + Math.max(1, Math.floor(Number(opts.deadlineBlocks)));
    if (deadlineHeight != null && !(Number.isSafeInteger(deadlineHeight) && deadlineHeight > 0 && deadlineHeight < 500000000)) {
      throw new Error('issue: deadlineHeight must be a positive block height');
    }
    let deposit = null;
    if (opts.deposit) {
      const txid = String(opts.deposit.txid || '').toLowerCase();
      if (!HEX64.test(txid)) throw new Error('issue: deposit.txid must be 64 hex chars');
      deposit = { txid, vout: Math.max(0, Math.floor(Number(opts.deposit.vout) || 0)) };
      if (opts.deposit.address) deposit.address = String(opts.deposit.address);
      // Where the provider's pre-signed penalty must pay. Signed here by the
      // publisher, so the provider cannot pre-sign a penalty to itself.
      if (opts.deposit.penaltyAddress) deposit.penaltyAddress = String(opts.deposit.penaltyAddress);
      if (opts.deposit.minPenaltySats != null) {
        const min = Math.floor(Number(opts.deposit.minPenaltySats));
        if (!(Number.isFinite(min) && min > 0)) throw new Error('issue: deposit.minPenaltySats must be a positive integer');
        deposit.minPenaltySats = min;
      }
      if (opts.deposit.withdrawAfter != null && deadlineHeight != null) {
        const margin = Math.max(0, Math.floor(Number(opts.withdrawMarginBlocks != null ? opts.withdrawMarginBlocks : this.settings.withdrawMarginBlocks) || 0));
        if (!(Number(opts.deposit.withdrawAfter) > deadlineHeight + margin)) {
          throw new Error(`issue: deposit withdrawAfter ${opts.deposit.withdrawAfter} must be later than deadline ${deadlineHeight} + ${margin} blocks`);
        }
      }
    }
    if (deadlineHeight != null && !deposit) throw new Error('issue: deadlineHeight requires the deposit outpoint the penalty pre-signature spends');
    const body = {
      type: TYPES.CHALLENGE,
      version: 2,
      merkleRootHex: root,
      blobTotal,
      blobIndex,
      blobHashHex: pinned,
      pinProof,
      nonceHex,
      answerHashHex,
      epoch,
      deadlineEpoch: epoch + deadlineEpochs,
      deadlineHeight,
      deposit,
      providerPubkey: provider
    };
    return Witness.signArtifact(body, opts.publisherPrivateKey);
  }

  /**
   * Provider answers a challenge from its local tree. Refuses challenges that
   * do not match its tree (root, leaf count, nonce-derived index, pinned
   * leaf), its commitment when given, or whose deadline epoch has passed.
   * @param {object} challenge signed artifact from {@link Challenge#issue}
   * @param {object} source
   * @param {string[]} source.blobHashes every leaf hash of the tree, in order
   * @param {Buffer} [source.bytes] the challenged blob's bytes (enables the possession digest; required when the challenge commits an answer hash)
   * @param {number} source.epoch epoch the response is signed in
   * @param {object} [source.commitment] the provider's own signed commitment
   * @param {boolean} [source.allowLate] sign even after the deadline epoch
   * @param {Buffer|string} source.providerPrivateKey
   * @returns {object} signed artifact
   */
  respond (challenge, source = {}) {
    if (!challenge || challenge.type !== TYPES.CHALLENGE || !Witness.verifyArtifact(challenge)) throw new Error('respond: challenge signature invalid');
    const hashes = (Array.isArray(source.blobHashes) ? source.blobHashes : []).map((h) => String(h).toLowerCase());
    if (!hashes.length) throw new Error('respond: blobHashes required');
    const tree = createBlobMerkleTree(hashes);
    if (String(challenge.merkleRootHex).toLowerCase() !== tree.rootHex) throw new Error('respond: challenge is for another tree');
    if (toInt(challenge.blobTotal) !== hashes.length) throw new Error('respond: challenge blobTotal differs from the tree');
    const index = toInt(challenge.blobIndex);
    if (index !== Challenge.leafIndexFor(tree.rootHex, challenge.epoch, challenge.nonceHex, hashes.length)) {
      throw new Error('respond: challenge blobIndex is not the nonce-derived leaf');
    }
    const leaf = hashes[index];
    if (challenge.blobHashHex != null && String(challenge.blobHashHex).toLowerCase() !== leaf) throw new Error('respond: challenge pins another blob hash');
    if (source.commitment) {
      const bound = FraudProof.bindChallenge(challenge, source.commitment);
      if (!bound.ok) throw new Error(`respond: ${bound.reason}`);
    }
    const epoch = Math.max(0, Math.floor(Number(source.epoch) || 0));
    if (!source.allowLate && epoch > Number(challenge.deadlineEpoch)) throw new Error('respond: challenge deadline has passed');
    const bytes = Buffer.isBuffer(source.bytes) ? source.bytes : null;
    if (bytes && !verifyBlob(bytes, leaf)) throw new Error('respond: bytes do not hash to the leaf');
    const possession = bytes ? Challenge.possessionHex(challenge.nonceHex, bytes) : null;
    if (challenge.answerHashHex) {
      if (!possession) throw new Error('respond: bytes required — the challenge commits an answer hash');
      if (Challenge.answerHashFor(possession) !== String(challenge.answerHashHex).toLowerCase()) {
        throw new Error('respond: the blob does not open the committed answer hash (wrong-answer-hash evidence)');
      }
    }
    const body = {
      type: TYPES.RESPONSE,
      version: 1,
      challengeHash: Witness.artifactHash(challenge),
      merkleRootHex: tree.rootHex,
      blobIndex: index,
      blobHashHex: leaf,
      proof: { proof: Tree.serializeProof(tree.getProof(leaf, index)), leafCount: hashes.length },
      possessionHex: possession,
      epoch
    };
    return Witness.signArtifact(body, source.providerPrivateKey);
  }

  /**
   * Publisher / third party validates a response. Pure.
   * @param {object} challenge
   * @param {object} response
   * @param {object} [ctx]
   * @param {Buffer} [ctx.bytes] blob bytes to check the possession digest against
   * @param {number} [ctx.epoch] current epoch (absence check)
   * @param {number} [ctx.tipHeight] current block height (absence check)
   * @param {number} [ctx.minConfirmations] blocks past `deadlineHeight` before silence counts (default 6)
   * @returns {{ ok: boolean, reason: string|null, late: boolean, fraud: string|null }}
   */
  validate (challenge, response, ctx = {}) {
    const out = (ok, reason = null, extra = {}) => Object.assign({ ok, reason, late: false, fraud: null }, extra);
    const K = Witness.FRAUD_PROOF_KINDS;
    if (!challenge || !Witness.verifyArtifact(challenge)) return out(false, 'challenge signature invalid');
    if (!response) {
      // Silence is only *enforceable* through the timelocked penalty: the
      // challenge must carry `deadlineHeight` and the caller's chain tip must
      // be `minConfirmations` past it. The epoch clock alone yields a hint.
      const now = toInt(ctx.epoch);
      const tip = toInt(ctx.tipHeight);
      const deadlineHeight = toInt(challenge.deadlineHeight);
      const depth = toInt(ctx.minConfirmations) || FraudProof.DEFAULT_CONFIRMATIONS;
      if (deadlineHeight && tip != null && tip >= deadlineHeight + depth) {
        return out(false, 'no response by deadline height', { late: true, fraud: K.NON_RESPONSE, evidence: 'timelock', enforceableAfterHeight: deadlineHeight });
      }
      if (now != null && now > Number(challenge.deadlineEpoch)) {
        return out(false, 'no response by deadline epoch (not enforceable without deadlineHeight + chain tip)', { late: true, fraud: null });
      }
      return out(false, 'awaiting response');
    }
    if (!Witness.verifyArtifact(response, challenge.providerPubkey)) return out(false, 'response signature invalid');
    if (String(response.challengeHash) !== Witness.artifactHash(challenge)) return out(false, 'response answers another challenge');
    if (toInt(response.blobIndex) !== toInt(challenge.blobIndex)) return out(false, 'wrong blob index', { fraud: K.WRONG_LEAF });
    if (challenge.blobHashHex && String(response.blobHashHex).toLowerCase() !== String(challenge.blobHashHex).toLowerCase()) {
      return out(false, 'wrong leaf hash', { fraud: K.WRONG_LEAF });
    }
    const included = Witness.verifyBlobPath({
      merkleRootHex: challenge.merkleRootHex,
      leafHex: response.blobHashHex,
      index: challenge.blobIndex,
      leafCount: challenge.blobTotal,
      proof: response.proof
    });
    if (!included) return out(false, 'leaf not at the challenged index of the committed tree', { fraud: K.WRONG_LEAF });
    if (Buffer.isBuffer(ctx.bytes) && response.possessionHex !== Challenge.possessionHex(challenge.nonceHex, ctx.bytes)) {
      return out(false, 'possession digest mismatch');
    }
    if (challenge.answerHashHex && (!response.possessionHex || Challenge.answerHashFor(response.possessionHex) !== String(challenge.answerHashHex).toLowerCase())) {
      return out(false, 'possession digest does not open the committed answer hash');
    }
    if (toInt(response.epoch) == null || toInt(response.epoch) > Number(challenge.deadlineEpoch)) {
      return out(false, 'response after deadline', { late: true, fraud: K.NON_RESPONSE });
    }
    return out(true);
  }

  /**
   * Build the matching {@link Witness.FraudProof} for a failed validation, or
   * `null` when the evidence a verifier needs is not at hand.
   * @param {object} challenge
   * @param {object|null} response
   * @param {object} [extra] `{ commitment }` always; `{ anchor }` (receipt / attestations) for a late response; `{ penaltyPreSig, answerPath }` for silence; validation ctx fields
   * @returns {FraudProof|null}
   */
  proofFor (challenge, response, extra = {}) {
    const v = this.validate(challenge, response, extra);
    if (v.ok || !v.fraud || !extra.commitment) return null;
    const K = Witness.FRAUD_PROOF_KINDS;
    if (v.fraud === K.NON_RESPONSE) {
      if (response) {
        if (!extra.anchor) return null;
        return new FraudProof({ kind: v.fraud, artifacts: { challenge, commitment: extra.commitment, response, anchor: extra.anchor } });
      }
      if (!extra.penaltyPreSig) return null;
      const artifacts = { challenge, commitment: extra.commitment, response: null, penaltyPreSig: extra.penaltyPreSig };
      if (extra.answerPath) artifacts.answerPath = extra.answerPath;
      return new FraudProof({ kind: v.fraud, artifacts, claim: { evidence: 'timelock', enforceableAfterHeight: Number(challenge.deadlineHeight) } });
    }
    return new FraudProof({ kind: v.fraud, artifacts: { challenge, commitment: extra.commitment, response } });
  }

  /**
   * Counterparty's signed acknowledgement that it held `challenge` (and
   * `response`, when given) at `epoch`. The provider signs one for each
   * challenge it receives; the publisher signs one for each response. Each
   * anchors the *other* side's claims in {@link Witness.FraudProof}.
   * @param {object} opts
   * @param {object} opts.challenge
   * @param {object} [opts.response]
   * @param {number} opts.epoch
   * @param {number} [opts.height]
   * @param {Buffer|string} opts.privateKey
   * @returns {object} signed `AvailabilityReceipt`
   */
  static receipt (opts = {}) {
    if (!opts.challenge) throw new Error('receipt: challenge required');
    const epoch = toInt(opts.epoch);
    if (epoch == null) throw new Error('receipt: epoch must be a non-negative integer');
    return Witness.signArtifact({
      type: TYPES.RECEIPT,
      version: 1,
      challengeHash: Witness.artifactHash(opts.challenge),
      responseHash: opts.response ? Witness.artifactHash(opts.response) : null,
      epoch,
      height: toInt(opts.height)
    }, opts.privateKey);
  }

  /**
   * Beacon / federation attestation that `digestHex` (a challenge or response
   * artifact hash) existed at `epoch`.
   * @param {object} opts
   * @param {string} opts.digestHex
   * @param {number} opts.epoch
   * @param {number} [opts.height]
   * @param {Buffer|string} opts.privateKey
   * @returns {object} signed `EpochAttestation`
   */
  static attestEpoch (opts = {}) {
    const digestHex = String(opts.digestHex || '').toLowerCase();
    if (!HEX64.test(digestHex)) throw new Error('attestEpoch: digestHex must be 64 hex chars');
    const epoch = toInt(opts.epoch);
    if (epoch == null) throw new Error('attestEpoch: epoch must be a non-negative integer');
    return Witness.signArtifact({ type: TYPES.ATTESTATION, version: 1, digestHex, epoch, height: toInt(opts.height) }, opts.privateKey);
  }

  /**
   * Provider's counter-proof when penalized despite a valid response. The
   * penalty transaction that spent the deposit outpoint **is** the evidence,
   * and an anchor (publisher receipt or attestations) must show the response
   * existed by the deadline; without both the proof does not verify.
   * @param {object} challenge
   * @param {object} response
   * @param {object} [penalty] `{ txHex, txid?, prevouts?, inclusion? }` the penalty spend as seen on-chain; `prevouts` are its spent outputs `[{ scriptHex, valueSats }]` in input order
   * @param {object} [extra] `{ anchor }`
   * @returns {FraudProof}
   */
  static wrongfulPenaltyProof (challenge, response, penalty = null, extra = {}) {
    const artifacts = { challenge, response };
    if (penalty && penalty.txHex) artifacts.penaltyTxHex = String(penalty.txHex);
    if (penalty && Array.isArray(penalty.prevouts)) {
      artifacts.prevouts = penalty.prevouts.map((p) => ({ scriptHex: String(p.scriptHex), valueSats: String(p.valueSats) }));
    }
    if (penalty && penalty.inclusion) artifacts.inclusion = penalty.inclusion;
    if (extra.anchor) artifacts.anchor = extra.anchor;
    return new FraudProof({
      kind: Witness.FRAUD_PROOF_KINDS.WRONGFUL_PENALTY,
      artifacts,
      claim: penalty ? { penaltyTxid: String(penalty.txid || '') } : {}
    });
  }
}

Challenge.createBlobMerkleTree = createBlobMerkleTree;

module.exports = Challenge;
