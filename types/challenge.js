'use strict';

const crypto = require('crypto');
const Witness = require('./witness');
const { createBlobMerkleTree, verifyBlob } = require('../functions/documentBlobManifest');

const HEX64 = /^[0-9a-f]{64}$/;

const CHALLENGE_TYPE = 'AvailabilityChallenge';
const RESPONSE_TYPE = 'AvailabilityResponse';
const COMMITMENT_TYPE = 'AvailabilityCommitment';

/**
 * Merkle-leaf availability challenge for a sealed blob tree.
 *
 * A **commitment** is the provider's signed promise to hold a tree until an
 * epoch (optionally naming the deposit output that backs it). A **challenge**
 * is the publisher's signed, Beacon-epoch stamped request for one leaf; the
 * leaf index is derived from the challenge nonce so neither party picks it.
 * A **response** is the provider's signed inclusion proof plus a nonce-bound
 * digest of the blob bytes (proof of possession for a verifier holding the
 * bytes). All three are plain JSON artifacts carried as `CONTRACT_MESSAGE`
 * bodies — no new opcodes — and feed {@link Witness.FraudProof}.
 *
 * Response deadlines are expressed in **epochs** (default two) so a lagging
 * Hub view cannot make an honest provider provably late.
 */
class Challenge {
  constructor (settings = {}) {
    this.settings = Object.assign({
      deadlineEpochs: 2
    }, settings);
    return this;
  }

  /**
   * Body `type` strings used on the wire.
   * @type {{ CHALLENGE: string, RESPONSE: string, COMMITMENT: string }}
   */
  static get TYPES () {
    return { CHALLENGE: CHALLENGE_TYPE, RESPONSE: RESPONSE_TYPE, COMMITMENT: COMMITMENT_TYPE };
  }

  /**
   * Deterministic leaf selection: `SHA256(root || epoch || nonce) mod blobTotal`.
   * @param {string} merkleRootHex
   * @param {number} epoch
   * @param {string} nonceHex
   * @param {number} blobTotal
   * @returns {number}
   */
  static leafIndexFor (merkleRootHex, epoch, nonceHex, blobTotal) {
    const total = Math.max(1, Math.floor(Number(blobTotal) || 1));
    const digest = crypto.createHash('sha256')
      .update(Buffer.from(String(merkleRootHex).toLowerCase(), 'hex'))
      .update(Buffer.from(String(Number(epoch) || 0)))
      .update(Buffer.from(String(nonceHex).toLowerCase(), 'hex'))
      .digest();
    return Number(digest.readUInt32BE(0) % total);
  }

  /**
   * Provider's signed availability commitment.
   * @param {object} opts
   * @param {string} opts.merkleRootHex
   * @param {number} [opts.blobTotal]
   * @param {number} opts.fromEpoch
   * @param {number} opts.untilEpoch
   * @param {string} [opts.depositAddress] deposit Bond address backing this promise
   * @param {string} [opts.depositTxid]
   * @param {string} [opts.publisherPubkey] penalty co-signer
   * @param {Buffer|string} opts.providerPrivateKey
   * @returns {object} signed artifact
   */
  static commit (opts = {}) {
    const root = String(opts.merkleRootHex || '').toLowerCase();
    if (!HEX64.test(root)) throw new Error('commit: merkleRootHex must be 64 hex chars');
    const body = {
      type: COMMITMENT_TYPE,
      version: 1,
      merkleRootHex: root,
      blobTotal: opts.blobTotal != null ? Math.max(1, Math.floor(Number(opts.blobTotal))) : null,
      fromEpoch: Math.max(0, Math.floor(Number(opts.fromEpoch) || 0)),
      untilEpoch: opts.untilEpoch != null ? Math.floor(Number(opts.untilEpoch)) : null,
      depositAddress: opts.depositAddress ? String(opts.depositAddress) : null,
      depositTxid: opts.depositTxid ? String(opts.depositTxid).toLowerCase() : null,
      publisherPubkey: opts.publisherPubkey ? String(opts.publisherPubkey).toLowerCase() : null
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
   * @param {string[]} [opts.blobHashes] leaf hashes (pins `blobHashHex` for the chosen index)
   * @param {string} [opts.nonceHex] 32-byte hex (random when omitted)
   * @param {number} [opts.deadlineEpochs]
   * @param {number} [opts.deadlineHeight] block height after which silence is enforceable (timelocked non-response); or derive from `tipHeight` + `deadlineBlocks`
   * @param {number} [opts.tipHeight] current block height (with `deadlineBlocks`)
   * @param {number} [opts.deadlineBlocks] blocks after `tipHeight` for the deadline
   * @param {object} [opts.deposit] `{ txid, vout }` the provider's deposit outpoint the pre-signed penalty must spend
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
    const blobTotal = Math.max(1, Math.floor(Number(opts.blobTotal) || (Array.isArray(opts.blobHashes) ? opts.blobHashes.length : 1)));
    const blobIndex = Challenge.leafIndexFor(root, epoch, nonceHex, blobTotal);
    const deadlineEpochs = Math.max(1, Math.floor(Number(opts.deadlineEpochs != null ? opts.deadlineEpochs : this.settings.deadlineEpochs) || 2));
    const pinned = Array.isArray(opts.blobHashes) && opts.blobHashes[blobIndex]
      ? String(opts.blobHashes[blobIndex]).toLowerCase()
      : null;
    let deadlineHeight = null;
    if (opts.deadlineHeight != null) deadlineHeight = Math.floor(Number(opts.deadlineHeight));
    else if (opts.tipHeight != null && opts.deadlineBlocks != null) deadlineHeight = Math.floor(Number(opts.tipHeight)) + Math.max(1, Math.floor(Number(opts.deadlineBlocks)));
    if (deadlineHeight != null && !(Number.isFinite(deadlineHeight) && deadlineHeight > 0)) throw new Error('issue: deadlineHeight must be a positive block height');
    let deposit = null;
    if (opts.deposit) {
      const txid = String(opts.deposit.txid || '').toLowerCase();
      if (!HEX64.test(txid)) throw new Error('issue: deposit.txid must be 64 hex chars');
      deposit = { txid, vout: Math.max(0, Math.floor(Number(opts.deposit.vout) || 0)) };
    }
    if (deadlineHeight != null && !deposit) throw new Error('issue: deadlineHeight requires the deposit outpoint the penalty pre-signature spends');
    const body = {
      type: CHALLENGE_TYPE,
      version: 1,
      merkleRootHex: root,
      blobTotal,
      blobIndex,
      blobHashHex: pinned,
      nonceHex,
      epoch,
      deadlineEpoch: epoch + deadlineEpochs,
      deadlineHeight,
      deposit,
      providerPubkey: provider
    };
    return Witness.signArtifact(body, opts.publisherPrivateKey);
  }

  /**
   * Provider answers a challenge from its local tree.
   * @param {object} challenge signed artifact from {@link Challenge#issue}
   * @param {object} source
   * @param {string[]} source.blobHashes every leaf hash of the tree, in order
   * @param {Buffer} [source.bytes] the challenged blob's bytes (enables possession digest)
   * @param {number} source.epoch epoch the response is signed in
   * @param {Buffer|string} source.providerPrivateKey
   * @returns {object} signed artifact
   */
  respond (challenge, source = {}) {
    if (!Witness.verifyArtifact(challenge)) throw new Error('respond: challenge signature invalid');
    const hashes = (Array.isArray(source.blobHashes) ? source.blobHashes : []).map((h) => String(h).toLowerCase());
    const index = Number(challenge.blobIndex);
    const leaf = hashes[index];
    if (!leaf) throw new Error(`respond: no leaf for blob index ${index}`);
    const tree = createBlobMerkleTree(hashes);
    const proof = tree.proveInclusion(leaf);
    const bytes = Buffer.isBuffer(source.bytes) ? source.bytes : null;
    if (bytes && !verifyBlob(bytes, leaf)) throw new Error('respond: bytes do not hash to the leaf');
    const possession = bytes
      ? crypto.createHash('sha256').update(Buffer.from(challenge.nonceHex, 'hex')).update(bytes).digest('hex')
      : null;
    const body = {
      type: RESPONSE_TYPE,
      version: 1,
      challengeHash: Witness.artifactHash(challenge),
      merkleRootHex: String(challenge.merkleRootHex).toLowerCase(),
      blobIndex: index,
      blobHashHex: leaf,
      proof: { proof: proof.proof, leafCount: proof.leafCount },
      possessionHex: possession,
      epoch: Math.max(0, Math.floor(Number(source.epoch) || 0))
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
   * @returns {{ ok: boolean, reason: string|null, late: boolean, fraud: string|null }}
   */
  validate (challenge, response, ctx = {}) {
    const out = (ok, reason = null, extra = {}) => Object.assign({ ok, reason, late: false, fraud: null }, extra);
    if (!Witness.verifyArtifact(challenge)) return out(false, 'challenge signature invalid');
    if (!response) {
      // Silence is only *enforceable* through the timelocked penalty: the
      // challenge must carry `deadlineHeight` and the caller's chain tip must
      // have passed it. The epoch clock alone yields a hint, never a verdict.
      const now = ctx.epoch != null ? Number(ctx.epoch) : null;
      const tip = ctx.tipHeight != null ? Number(ctx.tipHeight) : null;
      const deadlineHeight = challenge.deadlineHeight != null ? Number(challenge.deadlineHeight) : null;
      if (deadlineHeight != null && tip != null && tip >= deadlineHeight) {
        return out(false, 'no response by deadline height', { late: true, fraud: Witness.FRAUD_PROOF_KINDS.NON_RESPONSE, evidence: 'timelock', enforceableAfterHeight: deadlineHeight });
      }
      if (now != null && now > Number(challenge.deadlineEpoch)) {
        return out(false, 'no response by deadline epoch (not enforceable without deadlineHeight + chain tip)', { late: true, fraud: null });
      }
      return out(false, 'awaiting response');
    }
    if (!Witness.verifyArtifact(response, challenge.providerPubkey)) return out(false, 'response signature invalid');
    if (String(response.challengeHash) !== Witness.artifactHash(challenge)) return out(false, 'response answers another challenge');
    if (Number(response.blobIndex) !== Number(challenge.blobIndex)) {
      return out(false, 'wrong blob index', { fraud: Witness.FRAUD_PROOF_KINDS.WRONG_LEAF });
    }
    if (challenge.blobHashHex && String(response.blobHashHex).toLowerCase() !== String(challenge.blobHashHex).toLowerCase()) {
      return out(false, 'wrong leaf hash', { fraud: Witness.FRAUD_PROOF_KINDS.WRONG_LEAF });
    }
    const root = String(challenge.merkleRootHex).toLowerCase();
    const leaf = String(response.blobHashHex || '').toLowerCase();
    let included = false;
    try {
      included = createBlobMerkleTree([leaf]).verifyInclusion(Object.assign({}, response.proof, { leaf, root }), root);
    } catch (_) { included = false; }
    if (!included) return out(false, 'leaf not in committed tree', { fraud: Witness.FRAUD_PROOF_KINDS.WRONG_LEAF });
    if (Buffer.isBuffer(ctx.bytes)) {
      const want = crypto.createHash('sha256').update(Buffer.from(challenge.nonceHex, 'hex')).update(ctx.bytes).digest('hex');
      if (!response.possessionHex || response.possessionHex !== want) return out(false, 'possession digest mismatch');
    }
    if (Number(response.epoch) > Number(challenge.deadlineEpoch)) {
      return out(false, 'response after deadline', { late: true, fraud: Witness.FRAUD_PROOF_KINDS.NON_RESPONSE });
    }
    return out(true);
  }

  /**
   * Build the matching {@link Witness.FraudProof} for a failed validation.
   * @param {object} challenge
   * @param {object|null} response
   * @param {object} [extra] `{ commitment }` for non-response
   * @returns {FraudProof|null}
   */
  proofFor (challenge, response, extra = {}) {
    const v = this.validate(challenge, response, extra);
    if (v.ok || !v.fraud) return null;
    const { FraudProof } = Witness;
    if (v.fraud === Witness.FRAUD_PROOF_KINDS.NON_RESPONSE) {
      if (!extra.commitment) return null;
      // Absence needs the provider's pre-signed timelocked penalty for this
      // round; a late response needs nothing more than the response.
      if (!response && !extra.penaltyPreSig) return null;
      return new FraudProof({
        kind: v.fraud,
        artifacts: Object.assign({ challenge, commitment: extra.commitment, response: response || null }, response ? {} : { penaltyPreSig: extra.penaltyPreSig }),
        claim: response ? {} : { evidence: 'timelock', enforceableAfterHeight: Number(challenge.deadlineHeight) }
      });
    }
    return new FraudProof({ kind: v.fraud, artifacts: { challenge, response } });
  }

  /**
   * Provider's counter-proof when penalized despite a valid response. The
   * penalty transaction that spent the deposit outpoint **is** the evidence;
   * without it the proof does not verify.
   * @param {object} challenge
   * @param {object} response
   * @param {object} [penalty] `{ txHex, txid? }` the penalty spend as seen on-chain
   * @returns {FraudProof}
   */
  static wrongfulPenaltyProof (challenge, response, penalty = null) {
    return new Witness.FraudProof({
      kind: Witness.FRAUD_PROOF_KINDS.WRONGFUL_PENALTY,
      artifacts: Object.assign({ challenge, response }, penalty && penalty.txHex ? { penaltyTxHex: String(penalty.txHex) } : {}),
      claim: penalty ? { penaltyTxid: String(penalty.txid || '') } : {}
    });
  }
}

module.exports = Challenge;
