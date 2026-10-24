'use strict';

const crypto = require('crypto');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');
const { stableStringify } = require('../functions/fabricCanonicalJson');
const { verifyBlob } = require('../functions/documentBlobManifest');
const { verifyInclusion } = require('../functions/bitcoinTxInclusion');
const { verifyFrameAuthor } = require('../functions/fabricFrameAuthor');
const { P2P_FILE_SEND } = require('../constants');

const HEX64 = /^[0-9a-f]{64}$/;
/** @private lazily loaded bitcoinjs (fraud proofs that carry transactions) */
function bitcoinjs () { return require('bitcoinjs-lib'); }
/** @private BIP341 helpers; `contractTaproot` initialises the ECC library they need */
function bip341 () {
  require('../functions/contractTaproot');
  return require('bitcoinjs-lib/src/payments/bip341');
}

/** @private x-only hex from compressed or x-only hex */
function xOnlyHex (pubkey) {
  const s = String(pubkey || '').toLowerCase();
  return /^(02|03)[0-9a-f]{64}$/.test(s) ? s.slice(2) : s;
}

/** @private display-order txid of input `i` of a bitcoinjs Transaction */
function inputTxid (tx, i = 0) {
  return Buffer.from(tx.ins[i].hash).reverse().toString('hex');
}

/**
 * Fraud proof kinds. Each is a self-contained bundle of signed artifacts that
 * any third party verifies from the artifacts alone (decision 6).
 * @private
 */
const FRAUD_PROOF_KINDS = Object.freeze({
  WRONG_LEAF: 'wrong-leaf',
  NON_RESPONSE: 'non-response',
  WRONG_ANSWER_HASH: 'wrong-answer-hash',
  WRONG_BYTES: 'wrong-bytes',
  BAD_KEY: 'bad-key',
  WRONGFUL_PENALTY: 'wrongful-penalty',
  STALE_COMMITMENT: 'stale-commitment'
});

const FRAUD_PROOF_TYPE = 'FraudProof';

class Witness {
  constructor (settings = {}) {
    this.settings = Object.assign({
      curve: 'secp256k1',
      data: null,
      keypair: null
    }, settings);

    this.buffer = Buffer.alloc(32 * 256);
    this._state = {
      data: this.settings.data
    };

    if (settings && settings.keypair) {
      if (settings.keypair.private) {
        this._usePrivateKey(settings.keypair.private);
      } else if (settings.keypair.public) {
        this._usePublicKey(settings.keypair.public);
      }
    }

    if (!this.keypair) {
      const privateKey = crypto.randomBytes(32);
      const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
      this.keypair = { privateKey, publicKey };
    }

    if (settings && settings.data) {
      this._loadData(settings.data);
    }

    Object.defineProperty(this, 'buffer', { enumerable: false });
    Object.defineProperty(this, 'keypair', { enumerable: false });

    return this;
  }

  get data () {
    return this._state.data;
  }

  get hash () {
    return this.digest(this._state.data || '');
  }

  get pubkey () {
    return Buffer.from(this.keypair.publicKey).toString('hex');
  }

  get signature () {
    const digest = Buffer.from(this.hash, 'hex');
    const sig = secp256k1.sign(digest, this.keypair.privateKey, { prehash: false });
    const compact = (sig && typeof sig.toCompactRawBytes === 'function')
      ? Buffer.from(sig.toCompactRawBytes())
      : Buffer.from(sig);

    return {
      curve: this.settings.curve,
      r: compact.slice(0, 32).toString('hex'),
      s: compact.slice(32, 64).toString('hex')
    };
  }

  digest (data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  lock () {
    return Object.freeze(this);
  }

  _dumpKeypair () {
    return {
      private: this.keypair.privateKey,
      public: this.keypair.publicKey
    };
  }

  _usePrivateKey (key) {
    const privateKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, false));
    this.keypair = { privateKey, publicKey };
  }

  _usePublicKey (key) {
    const publicKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
    this.keypair = { publicKey };
  }

  _loadData (data) {
    if (data && typeof data !== 'string') data = JSON.stringify(data);
    if (this.buffer.size < data.length) return new Error(`Insufficient storage (needed ${data.length} bytes)`);

    try {
      // set internal state and write buffer...
      this._state.data = data;
      this.buffer.write(data);
    } catch (E) {
      console.error('Could not write data for Witness:', E);
    }

    return this;
  }

  _fromBitcoinSignature (_signature = {}) {

  }

  /**
   * Converts the Witness to a Compact DER format.
   */
  toCompactDER () {
    let sig = this.signature;
    let R = sig.r;
    let S = sig.s;

    let payload = [
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the R value
      // TODO: assign R coordinate
      R, // The R coordinate, as a big-endian integer.
      0x02, // a header byte indicating an integer.
      32, // A 1-byte length descriptor for the S value.
      // TODO: assign S coordinate
      S // The S coordinate, as a big-endian integer.
    ].map(x => x.toString(16)).join('');

    console.log('payload:', payload);

    let raw = [
      0x30, // indicates compound structure
      Buffer.from(payload, 'hex').size, // payload size
    ].join('') + payload;

    let der = Buffer.from(raw, 'hex');

    return der;
  }

  /**
   * Verify a Schnorr signature over `digest(msg)` with this witness's public key.
   * @param {Buffer|string} msg
   * @param {Buffer|string} signature
   * @returns {boolean}
   */
  verify (msg, signature) {
    const hash = Buffer.from(this.digest(msg), 'hex');
    const publicKey = Buffer.from(this.keypair.publicKey);
    const compact = Buffer.concat([
      Buffer.from(signature.r, 'hex'),
      Buffer.from(signature.s, 'hex')
    ]);
    const verifies = secp256k1.verify(compact, hash, publicKey, { prehash: false });
    let verification = {
      msg: msg,
      hash: hash.toString('hex'),
      pubkey: this.pubkey,
      signature: signature,
      verifies: verifies
    };

    return verification;
  }

  // --- Signed artifacts (market obligations) ---------------------------------

  /**
   * Canonical JSON of an artifact body (signature fields stripped).
   * @param {object} body
   * @returns {string}
   */
  static canonical (body) {
    // JSON round trip first so `undefined` members and Buffers canonicalize the
    // same way before and after the wire (CONTRACT_MESSAGE bodies are JSON).
    const copy = JSON.parse(JSON.stringify(Object.assign({}, body || {})));
    delete copy.signature;
    return stableStringify(copy);
  }

  /**
   * SHA-256 (hex) over {@link Witness.canonical}.
   * @param {object} body
   * @returns {string}
   */
  static artifactHash (body) {
    return crypto.createHash('sha256').update(Witness.canonical(body)).digest('hex');
  }

  /**
   * BIP340 x-only public key (hex) for a 32-byte private key.
   * @param {Buffer|string} priv32
   * @returns {string}
   */
  static xOnlyPubkeyHex (priv32) {
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    return Buffer.from(schnorr.getPublicKey(priv)).toString('hex');
  }

  /**
   * Sign an artifact body with BIP340 Schnorr over its canonical hash. The
   * returned object carries `pubkey` (x-only hex) and `signature` (64-byte hex)
   * so it can ride a `CONTRACT_MESSAGE` body or a Taproot penalty spend.
   * @param {object} body
   * @param {Buffer|string} priv32
   * @returns {object}
   */
  static signArtifact (body, priv32) {
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    if (priv.length !== 32) throw new Error('signArtifact: 32-byte private key required');
    const unsigned = Object.assign({}, body, { pubkey: Witness.xOnlyPubkeyHex(priv) });
    delete unsigned.signature;
    const digest = Buffer.from(Witness.artifactHash(unsigned), 'hex');
    const signature = Buffer.from(schnorr.sign(digest, priv)).toString('hex');
    return Object.assign(unsigned, { signature });
  }

  /**
   * Verify a {@link Witness.signArtifact} output. Pure.
   * @param {object} artifact
   * @param {string} [expectedPubkey] x-only hex the artifact must be signed by
   * @returns {boolean}
   */
  static verifyArtifact (artifact, expectedPubkey = null) {
    if (!artifact || typeof artifact !== 'object') return false;
    const pubkey = String(artifact.pubkey || '').toLowerCase();
    const signature = String(artifact.signature || '').toLowerCase();
    if (!HEX64.test(pubkey) || !/^[0-9a-f]{128}$/.test(signature)) return false;
    if (expectedPubkey && String(expectedPubkey).toLowerCase() !== pubkey) return false;
    try {
      const digest = Buffer.from(Witness.artifactHash(artifact), 'hex');
      return schnorr.verify(Buffer.from(signature, 'hex'), digest, Buffer.from(pubkey, 'hex'));
    } catch (_) {
      return false;
    }
  }
}

const COMMITMENT_TYPE = 'AvailabilityCommitment';
const CHALLENGE_TYPE = 'AvailabilityChallenge';
const RESPONSE_TYPE = 'AvailabilityResponse';
const RECEIPT_TYPE = 'AvailabilityReceipt';
const ATTESTATION_TYPE = 'EpochAttestation';
const PRESIG_TYPE = 'DepositPenaltyPreSig';

// On-chain facts a verdict rests on must be this many blocks deep unless the
// verifier asks for more (`ctx.minConfirmations`).
const DEFAULT_CONFIRMATIONS = 6;
const DEFAULT_MAX_PENALTY_FEE_SATS = 20000;
// nLockTime at or above this is a Unix time, not a height.
const LOCKTIME_THRESHOLD = 500000000;
const SEQUENCE_FINAL = 0xffffffff;

/** @private non-negative safe integer from a number or canonical decimal string, else `null` */
function toInt (value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** @private lowercase 64-hex string, else `null` */
function hex64 (value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX64.test(s) ? s : null;
}

/** @private even-length hex string, else `null` */
function hexBytes (value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^([0-9a-f]{2})+$/i.test(s) ? Buffer.from(s, 'hex') : null;
}

/** @private SHA-256 hex over the concatenated parts */
function sha256Hex (...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

/** @private confirmations the verifier demands of an on-chain fact */
function minConfirmations (ctx = {}) {
  const n = toInt(ctx.minConfirmations);
  return n != null && n >= 1 ? n : DEFAULT_CONFIRMATIONS;
}

/** @private blob tree parent, same as `types/tree.js` (display-order hashes) */
function blobParent (left, right) {
  const rev = (b) => Buffer.from(b).reverse();
  const once = crypto.createHash('sha256').update(Buffer.concat([rev(left), rev(right)])).digest();
  return rev(crypto.createHash('sha256').update(once).digest());
}

/**
 * Strict blob-tree inclusion check. Every left/right choice comes from
 * `index` (not from the prover's `position` labels, which must agree), the
 * branch must be exactly as deep as a tree of `leafCount` leaves, and a
 * self-paired step is accepted only for the odd last node of a level. With
 * `leafCount` pinned by a signed commitment, an inner node cannot pass as a
 * leaf and a padded (CVE-2012-2459) tree cannot stand in for the real one.
 * @param {object} opts
 * @param {string} opts.merkleRootHex
 * @param {string} opts.leafHex 32-byte blob hash
 * @param {number} opts.index leaf position
 * @param {number} opts.leafCount committed number of leaves
 * @param {Array|object} opts.proof `[{ position, data }]` or `{ proof: [...], leafCount }` (as `Challenge#respond` emits)
 * @returns {boolean}
 */
function verifyBlobPath (opts = {}) {
  const root = hex64(opts.merkleRootHex);
  const leaf = hex64(opts.leafHex);
  const index = toInt(opts.index);
  const count = toInt(opts.leafCount);
  if (!root || !leaf || index == null || !count || index >= count) return false;
  const proof = opts.proof;
  const steps = Array.isArray(proof) ? proof : (proof && Array.isArray(proof.proof) ? proof.proof : null);
  if (!steps) return false;
  if (proof && !Array.isArray(proof) && proof.leafCount != null && toInt(proof.leafCount) !== count) return false;
  let hash = Buffer.from(leaf, 'hex');
  let position = index;
  let width = count;
  let used = 0;
  while (width > 1) {
    const step = steps[used++];
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const sibling = hex64(typeof step.data === 'string' ? step.data : (Buffer.isBuffer(step.data) ? step.data.toString('hex') : ''));
    if (!sibling) return false;
    const other = Buffer.from(sibling, 'hex');
    if (position % 2 === 1) {
      if (step.position !== 'left') return false;
      hash = blobParent(other, hash);
    } else {
      if (step.position !== 'right') return false;
      if (position === width - 1 && !other.equals(hash)) return false;
      hash = blobParent(hash, other);
    }
    position = Math.floor(position / 2);
    width = Math.ceil(width / 2);
  }
  return used === steps.length && hash.toString('hex') === root;
}

/**
 * `SHA256(root || String(epoch) || nonce) mod blobTotal` — the challenged
 * leaf, which neither party picks.
 * @private
 */
function leafIndexFor (merkleRootHex, epoch, nonceHex, blobTotal) {
  const total = Math.max(1, Math.floor(Number(blobTotal) || 1));
  const digest = crypto.createHash('sha256')
    .update(Buffer.from(String(merkleRootHex).toLowerCase(), 'hex'))
    .update(Buffer.from(String(Number(epoch) || 0)))
    .update(Buffer.from(String(nonceHex).toLowerCase(), 'hex'))
    .digest();
  return Number(digest.readUInt32BE(0) % total);
}

/**
 * Self-contained proof that a market counterparty broke a signed obligation.
 * Shape: `{ type: 'FraudProof', kind, artifacts, claim }`. `verify()` is pure
 * over the artifacts; the few kinds that assert an **on-chain fact** (a
 * broadcast happened, an outpoint is unspent, the tip passed a height) take
 * that fact from `ctx` — the verifier's own chain view, which must describe
 * **confirmed** state at least `ctx.minConfirmations` (default 6) deep — and
 * refuse to conclude without it. No kind infers fraud from a *missing*
 * message alone, and no kind trusts a time its accused party could backdate.
 *
 * Every challenge-based kind binds the challenge to the provider's signed
 * `AvailabilityCommitment` (root, `blobTotal`, publisher) and recomputes the
 * challenged index from the nonce. A verdict carries `reputational: true`
 * only when it may move a reputation score.
 *
 * Kinds:
 * - `wrong-leaf`: challenge + commitment + provider-signed response whose
 *   leaf is not at the challenged index of the committed tree, or (with a
 *   Merkle proof of the publisher's pin) names another blob hash.
 * - `non-response`: challenge + commitment and either
 *   (a) a provider-signed response after `deadlineEpoch` **plus** an anchor
 *   showing the challenge reached the provider in time — a provider-signed
 *   `AvailabilityReceipt` or trusted `EpochAttestation`s (`ctx.beaconPubkeys`)
 *   — or (b) **timelock evidence**: the provider's `DepositPenaltyPreSig`
 *   for the deadline, past `deadlineHeight + confirmations`, with the deposit
 *   outpoint neither checked in nor answered. (b) names the provider as
 *   offender only when the provider had a unilateral way to answer: the
 *   pre-signature acknowledges this challenge (`challengeHash`), the
 *   challenge commits `answerHashHex`, and `artifacts.answerPath` proves the
 *   deposit output carries the provider's `answer` hashlock leaf for it.
 *   Otherwise the publisher could manufacture the silence (by refusing to
 *   co-sign check-in), so the verdict is `offender: null`,
 *   `reputational: false` — the pre-signed penalty is enforceable, but it is
 *   **not** proof of non-response.
 * - `wrong-answer-hash`: challenge + commitment + the challenged blob's bytes
 *   and branch; the answer hash the publisher committed cannot be opened by
 *   those bytes — publisher fraud (it would make an honest answer impossible).
 * - `wrong-bytes`: seller-signed `DocumentOffer` (documentId, root, blob
 *   index, blob hash, payment hash) + the claim preimage + the seller-signed
 *   AMP `P2P_FILE_SEND` frame for the same document / root / index / payment
 *   whose bytes miss the offered `blobHashHex`.
 * - `bad-key`: same artifacts for a sealed offer, but the bytes **match**
 *   `blobHashHex` and the revealed key K (the claim preimage) does not open
 *   them: AES-GCM authentication fails, or the plaintext misses the offered
 *   `plaintextSha256`.
 * - `wrongful-penalty`: challenge + the provider's valid, Merkle-proven
 *   response + an un-backdatable anchor that it existed by the deadline (a
 *   publisher-signed `AvailabilityReceipt`, or trusted `EpochAttestation`s
 *   over the response hash) + the penalty transaction that spent the deposit
 *   outpoint anyway — publisher fraud. The provider's own `epoch` / `height`
 *   fields are never trusted. (An on-chain answer spend needs no such proof:
 *   it consumes the outpoint, so no penalty can follow it.)
 * - `stale-commitment`: a payment-channel party's signed `ChannelRevoke`
 *   (channel, number, `perCommitmentSecret` opening `perCommitmentPoint`,
 *   revoked txid) plus that transaction and evidence it confirmed. Assumes
 *   asymmetric commitments: each party holds only its own commitment, so a
 *   broadcast of the revoked txid can only have come from the revoker.
 */
class FraudProof {
  constructor (body = {}) {
    this.kind = String(body.kind || '');
    this.artifacts = Object.assign({}, body.artifacts || {});
    this.claim = Object.assign({}, body.claim || {});
    this.observedAt = body.observedAt != null ? Number(body.observedAt) : Date.now();
  }

  static get KINDS () { return FRAUD_PROOF_KINDS; }
  static get TYPE () { return FRAUD_PROOF_TYPE; }

  /** @returns {object} `CONTRACT_MESSAGE` body (JSON-safe). */
  toBody () {
    return {
      type: FRAUD_PROOF_TYPE,
      version: 1,
      kind: this.kind,
      artifacts: this.artifacts,
      claim: this.claim,
      observedAt: this.observedAt
    };
  }

  /** @returns {string} SHA-256 hex over the canonical body. */
  get hash () {
    return Witness.artifactHash(this.toBody());
  }

  /**
   * Rehydrate a `FraudProof` from a `CONTRACT_MESSAGE` body (or `null` for other types).
   * @param {Object} body
   * @returns {FraudProof|null}
   */
  static fromBody (body) {
    if (!body || body.type !== FRAUD_PROOF_TYPE) return null;
    return new FraudProof(body);
  }

  /**
   * Stable ids of the evidence this proof rests on. Unlike
   * {@link FraudProof#hash} (which covers `observedAt` and the free-form
   * `claim`) they do not change when the same evidence is re-wrapped, so
   * ledgers dedupe and refuse replays on them: two proofs sharing any id are
   * the same offence.
   * - `challenge:<hash>` wrong-leaf, non-response
   * - `answer:<challenge hash>` wrong-answer-hash
   * - `payment:<seller x-only>:<payment hash>` and `frame:<sha256 of frame>` wrong-bytes, bad-key
   * - `penalty-tx:<txid>` wrongful-penalty
   * - `stale-tx:<txid>` stale-commitment
   * @returns {string[]}
   */
  evidenceIds () {
    const a = this.artifacts || {};
    const ids = [];
    const objectHash = (artifact) => (artifact && typeof artifact === 'object' ? Witness.artifactHash(artifact) : null);
    switch (this.kind) {
      case FRAUD_PROOF_KINDS.WRONG_LEAF:
      case FRAUD_PROOF_KINDS.NON_RESPONSE: {
        const h = objectHash(a.challenge);
        if (h) ids.push(`challenge:${h}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONG_ANSWER_HASH: {
        const h = objectHash(a.challenge);
        if (h) ids.push(`answer:${h}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONG_BYTES:
      case FRAUD_PROOF_KINDS.BAD_KEY: {
        const offer = a.offer || {};
        const seller = hex64(xOnlyHex(offer.pubkey));
        const payment = hex64(offer.paymentHashHex);
        if (seller && payment) ids.push(`payment:${seller}:${payment}`);
        const frame = hexBytes(a.delivery && (a.delivery.frameHex || a.delivery.frame));
        if (frame) ids.push(`frame:${sha256Hex(frame)}`);
        break;
      }
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: {
        try {
          ids.push(`penalty-tx:${bitcoinjs().Transaction.fromHex(String(a.penaltyTxHex || '').trim()).getId()}`);
        } catch (_) { /* no transaction, no id */ }
        break;
      }
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: {
        const txid = hex64(a.revoke && a.revoke.commitmentTxid);
        if (txid) ids.push(`stale-tx:${txid}`);
        break;
      }
    }
    return ids;
  }

  /**
   * @param {object} [ctx] verifier's chain view and trust roots
   * @param {number} [ctx.tipHeight] current block height (timelocked non-response)
   * @param {number} [ctx.minConfirmations] depth every on-chain fact needs (default 6)
   * @param {function} [ctx.outpointSpend] `(txid, vout) → null | { leafId, height }` confirmed spend of the deposit (preferred: tells check-in / answer from withdraw)
   * @param {function} [ctx.outpointUnspent] `(txid, vout) → boolean` confirmed-unspent fallback
   * @param {function} [ctx.headerKnown] `(blockHash) → boolean` block is in the verifier's best chain
   * @param {function} [ctx.confirmations] `(blockHash) → number` depth of that block
   * @param {function} [ctx.txCount] `(blockHash) → number` transactions in that block (pins the branch depth)
   * @param {function} [ctx.txConfirmations] `(txid) → number` depth of a transaction
   * @param {function} [ctx.txConfirmed] `(txid, depth) → boolean` legacy: the transaction is at least `depth` (`minConfirmations`) deep; prefer `ctx.txConfirmations`
   * @param {string[]} [ctx.beaconPubkeys] keys whose `EpochAttestation`s anchor times
   * @param {number} [ctx.beaconThreshold] distinct attestations needed (default 1)
   * @param {number} [ctx.minResponseEpochs] epochs a provider must have had to answer (default 1)
   * @param {string} [ctx.channelId] channel the verifier is judging (stale-commitment)
   * @returns {{ ok: boolean, offender: (string|null), reason: (string|null), reputational: boolean, evidence: (string|undefined), enforceableAfterHeight: (number|undefined) }}
   */
  verify (ctx = {}) {
    const fail = (reason, extra = {}) => Object.assign({ ok: false, offender: null, reputational: false, reason }, extra);
    switch (this.kind) {
      case FRAUD_PROOF_KINDS.WRONG_LEAF: return this._verifyWrongLeaf(fail);
      case FRAUD_PROOF_KINDS.NON_RESPONSE: return this._verifyNonResponse(ctx, fail);
      case FRAUD_PROOF_KINDS.WRONG_ANSWER_HASH: return this._verifyWrongAnswerHash(fail);
      case FRAUD_PROOF_KINDS.WRONG_BYTES: return this._verifyWrongBytes(fail);
      case FRAUD_PROOF_KINDS.BAD_KEY: return this._verifyBadKey(fail);
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: return this._verifyWrongfulPenalty(ctx, fail);
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: return this._verifyStaleCommitment(ctx, fail);
      default: return fail(`unknown fraud proof kind: ${this.kind}`);
    }
  }

  /** @private */
  _verifyWrongLeaf (fail) {
    const a = this.artifacts;
    const bound = FraudProof.bindChallenge(a.challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    const pair = FraudProof._responseTo(a.challenge, a.response, bound.provider);
    if (!pair.ok) return fail(pair.reason);
    const response = a.response;
    const index = toInt(response.blobIndex);
    if (index == null) return fail('response blobIndex is not an integer');
    if (index !== bound.blobIndex) return convict(bound.provider, 'response answers a different blob index');
    const pin = hex64(a.challenge.blobHashHex);
    if (pin && FraudProof._pinProven(a.challenge, bound, a.pinProof) && hex64(response.blobHashHex) !== pin) {
      return convict(bound.provider, 'response names a blob hash other than the proven pinned leaf');
    }
    if (!verifyBlobPath({ merkleRootHex: bound.root, leafHex: response.blobHashHex, index, leafCount: bound.blobTotal, proof: response.proof })) {
      return convict(bound.provider, 'response leaf is not at the challenged index of the committed tree');
    }
    return fail('response is valid — no wrong-leaf fraud');
  }

  /** @private */
  _verifyNonResponse (ctx, fail) {
    const a = this.artifacts;
    const challenge = a.challenge;
    const bound = FraudProof.bindChallenge(challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    if (!a.response) return FraudProof._timelockedAbsence(bound, challenge, a.commitment, a, ctx, fail);
    const pair = FraudProof._responseTo(challenge, a.response, bound.provider);
    if (!pair.ok) return fail(pair.reason);
    const epoch = toInt(a.response.epoch);
    if (epoch == null) return fail('response epoch is not an integer');
    if (epoch <= bound.deadlineEpoch) return fail('response was in time — no non-response fraud');
    // The provider's own late epoch only shows *when it answered*; that the
    // challenge reached it in time needs a time it cannot have been handed late.
    const challengeHash = Witness.artifactHash(challenge);
    const anchor = FraudProof.anchorEpoch(a.anchor, { digest: challengeHash, challengeHash, receiptSigner: bound.provider }, ctx);
    if (!anchor.ok) return fail(`late response: ${anchor.reason}`);
    const lag = toInt(ctx.minResponseEpochs) || 1;
    if (anchor.epoch + lag > bound.deadlineEpoch) {
      return fail(`challenge is anchored at epoch ${anchor.epoch}, too close to deadline ${bound.deadlineEpoch} to demand an answer`);
    }
    return convict(bound.provider, `response signed in epoch ${epoch} after deadline ${bound.deadlineEpoch}`, { evidence: 'late-response', anchor: anchor.kind });
  }

  /** @private */
  _verifyWrongAnswerHash (fail) {
    const a = this.artifacts;
    const bound = FraudProof.bindChallenge(a.challenge, a.commitment);
    if (!bound.ok) return fail(bound.reason);
    const answerHash = hex64(a.challenge.answerHashHex);
    if (!answerHash) return fail('challenge commits no answer hash');
    const blob = a.blob || {};
    const bytes = hexBytes(blob.bytesHex);
    if (!bytes) return fail('challenged blob bytes required (blob.bytesHex)');
    if (!verifyBlobPath({ merkleRootHex: bound.root, leafHex: sha256Hex(bytes), index: bound.blobIndex, leafCount: bound.blobTotal, proof: blob.proof })) {
      return fail('bytes are not the challenged leaf of the committed tree');
    }
    if (FraudProof.answerHashFor(FraudProof.possessionHex(bound.nonce, bytes)) === answerHash) {
      return fail('the challenged blob opens the answer hash — no fraud');
    }
    return convict(bound.publisher, 'publisher committed an answer hash the challenged blob cannot open', { evidence: 'blob-bytes' });
  }

  /** @private */
  _verifyWrongBytes (fail) {
    const d = FraudProof._offerDelivery(this.artifacts);
    if (!d.ok) return fail(d.reason);
    if (verifyBlob(d.bytes, d.want)) return fail('delivered bytes match the offer — no wrong-bytes fraud');
    return convict(d.seller, 'seller-signed delivery does not hash to the offered blob', { evidence: 'signed-frame', deliveredBlobHashHex: sha256Hex(d.bytes) });
  }

  /** @private */
  _verifyBadKey (fail) {
    const d = FraudProof._offerDelivery(this.artifacts);
    if (!d.ok) return fail(d.reason);
    if (d.offer.sealed !== true) return fail('bad-key needs a sealed offer (offer.sealed)');
    if (!verifyBlob(d.bytes, d.want)) return fail('delivered bytes miss the offered blob — that is wrong-bytes, not bad-key');
    const ivBase64 = typeof d.offer.iv === 'string' && d.offer.iv ? d.offer.iv : (typeof d.body.iv === 'string' ? d.body.iv : '');
    const iv = Buffer.from(ivBase64, 'base64');
    if (iv.length !== 12) return fail('no 12-byte IV in the signed offer or frame');
    const { openCiphertext } = require('../functions/documentSealedExchange');
    let plaintext;
    try {
      plaintext = openCiphertext(d.bytes, Buffer.from(d.preimage, 'hex'), iv.toString('base64'));
    } catch (_) {
      return convict(d.seller, 'revealed key does not decrypt the delivered blob (AES-GCM authentication fails)', { evidence: 'aes-gcm' });
    }
    const plain = hex64(d.offer.plaintextSha256);
    if (plain && sha256Hex(plaintext) !== plain) {
      return convict(d.seller, 'decrypted blob does not hash to the offered plaintextSha256', { evidence: 'plaintext-hash' });
    }
    return fail('revealed key opens the delivered blob — no bad-key fraud');
  }

  /** @private */
  _verifyWrongfulPenalty (ctx, fail) {
    const a = this.artifacts;
    const { challenge, response } = a;
    if (!challenge || challenge.type !== CHALLENGE_TYPE || !Witness.verifyArtifact(challenge)) return fail('challenge signature invalid');
    const publisher = xOnlyHex(challenge.pubkey);
    const provider = hex64(xOnlyHex(challenge.providerPubkey));
    if (!provider) return fail('challenge names no provider');
    const pair = FraudProof._responseTo(challenge, response, provider);
    if (!pair.ok) return fail(pair.reason);
    const root = hex64(challenge.merkleRootHex);
    const total = toInt(challenge.blobTotal);
    const index = toInt(challenge.blobIndex);
    const deadlineEpoch = toInt(challenge.deadlineEpoch);
    if (!root || !total || index == null || index >= total || deadlineEpoch == null) return fail('challenge root / blob index / total / deadline malformed');
    if (toInt(response.blobIndex) !== index) return fail('response answers a different blob index');
    const pin = hex64(challenge.blobHashHex);
    if (pin && hex64(response.blobHashHex) !== pin) return fail('response names the wrong blob hash');
    if (!verifyBlobPath({ merkleRootHex: root, leafHex: response.blobHashHex, index, leafCount: total, proof: response.proof })) {
      return fail('response leaf is not at the challenged index of the tree');
    }
    const answerHash = hex64(challenge.answerHashHex);
    if (answerHash) {
      const possession = hex64(response.possessionHex);
      if (!possession || FraudProof.answerHashFor(possession) !== answerHash) return fail('response possession digest does not open the committed answer hash');
    }
    const responseHash = Witness.artifactHash(response);
    const anchor = FraudProof.anchorEpoch(a.anchor, { digest: responseHash, challengeHash: response.challengeHash, responseHash, receiptSigner: publisher }, ctx);
    if (!anchor.ok) return fail(`in-time response: ${anchor.reason}`);
    if (anchor.epoch > deadlineEpoch) return fail(`response is anchored at epoch ${anchor.epoch}, after deadline ${deadlineEpoch}`);
    const deadlineHeight = toInt(challenge.deadlineHeight);
    if (deadlineHeight && anchor.height != null && anchor.height > deadlineHeight) return fail('response is anchored after the deadline height');
    // The penalty must actually have been taken: a transaction spending the
    // deposit outpoint the challenge names.
    const dep = challenge.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return fail('challenge names no deposit outpoint');
    let penalty;
    try { penalty = bitcoinjs().Transaction.fromHex(String(a.penaltyTxHex || '').trim()); } catch (_) { return fail('penaltyTxHex missing or not a transaction'); }
    const spendIndex = penalty.ins.findIndex((inp, i) => inputTxid(penalty, i) === depTxid && inp.index === depVout);
    if (spendIndex < 0) return fail('penalty transaction does not spend the deposit outpoint');
    const witness = penalty.ins[spendIndex].witness || [];
    if (!witness.length || witness.every((w) => !w || !w.length)) return fail('penalty transaction carries no witness for the deposit input');
    // Check-in, answer, and withdraw also spend the deposit: only a spend
    // through the 2-of-2 `penalty` leaf is a penalty.
    const path = FraudProof._scriptPathOf(witness);
    if (!path) return fail('deposit input is not a tapscript spend');
    const penaltyLeaves = FraudProof._penaltyLeafScripts(publisher, provider);
    if (!penaltyLeaves.some((s) => s.equals(path.script))) return fail('deposit input does not spend the penalty leaf (check-in, answer, or withdraw is not a penalty)');
    // The txid does not commit to the witness: the control block must commit
    // that leaf to the deposit output, and both signatures must verify.
    const prevouts = FraudProof._prevouts(a.prevouts, penalty);
    if (!prevouts) return fail('prevouts required: [{ scriptHex, valueSats }] for every penalty input');
    if (!FraudProof._controlBlockCommits(prevouts.scripts[spendIndex], path.script, path.controlBlock)) {
      return fail('control block does not commit the penalty leaf to the deposit output');
    }
    if (!FraudProof._scriptPathSignedBy(penalty, spendIndex, prevouts, path, [publisher, provider])) {
      return fail('penalty leaf signatures do not verify for the deposit spend');
    }
    const evidence = FraudProof._broadcastEvidence(penalty, a.inclusion, ctx);
    if (!evidence.ok) return fail(evidence.reason);
    return convict(publisher, 'valid in-time response was penalized', { evidence: evidence.kind, anchor: anchor.kind, penaltyTxid: penalty.getId(), blockHash: evidence.blockHash || null });
  }

  /** @private */
  _verifyStaleCommitment (ctx, fail) {
    const { revoke, staleTxHex, inclusion } = this.artifacts;
    if (!revoke || revoke.type !== 'ChannelRevoke') return fail('ChannelRevoke artifact missing');
    if (!Witness.verifyArtifact(revoke)) return fail('revoke signature invalid');
    const channelId = typeof revoke.channelId === 'string' ? revoke.channelId : '';
    if (!channelId) return fail('revoke names no channelId');
    if (this.claim.channelId != null && String(this.claim.channelId) !== channelId) return fail('claim names another channel than the revoke');
    if (ctx.channelId != null && String(ctx.channelId) !== channelId) return fail('revoke is for another channel');
    const commitmentTxid = hex64(revoke.commitmentTxid);
    if (!commitmentTxid) return fail('revoke names no commitment txid');
    const secret = hex64(revoke.perCommitmentSecret);
    if (!secret) return fail('revoke carries no per-commitment secret');
    const point = String(revoke.perCommitmentPoint || '').toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/.test(point)) return fail('revoke carries no perCommitmentPoint');
    if (FraudProof._commitmentPoint(secret) !== point) return fail('perCommitmentSecret does not open perCommitmentPoint');
    let tx;
    try { tx = bitcoinjs().Transaction.fromHex(String(staleTxHex || '').trim()); } catch (_) { return fail('staleTxHex is not a transaction'); }
    const txid = tx.getId();
    if (txid !== commitmentTxid) return fail('transaction is not the revoked commitment');
    // Possessing the signed bytes proves nothing (the verifier may simply
    // hold the old commitment): require evidence it reached the chain.
    const evidence = FraudProof._broadcastEvidence(tx, inclusion, ctx);
    if (!evidence.ok) return fail(evidence.reason);
    return convict(xOnlyHex(revoke.pubkey), `revoked commitment ${revoke.number} (${txid}) was broadcast`, { evidence: evidence.kind, blockHash: evidence.blockHash || null });
  }

  /**
   * Bind a challenge to the provider's signed `AvailabilityCommitment`: the
   * commitment fixes root, leaf count, and publisher, and the challenged
   * index is recomputed from the nonce. Pure.
   * @param {object} challenge signed `AvailabilityChallenge`
   * @param {object} commitment signed `AvailabilityCommitment`
   * @returns {{ ok: boolean, reason: (string|undefined), provider: string, publisher: string, root: string, blobTotal: number, blobIndex: number, epoch: number, deadlineEpoch: number, nonce: string }}
   */
  static bindChallenge (challenge, commitment) {
    const no = (reason) => ({ ok: false, reason });
    if (!challenge || challenge.type !== CHALLENGE_TYPE || !Witness.verifyArtifact(challenge)) return no('challenge signature invalid');
    const provider = hex64(xOnlyHex(challenge.providerPubkey));
    if (!provider) return no('challenge names no provider');
    if (!commitment || commitment.type !== COMMITMENT_TYPE) return no('provider AvailabilityCommitment required');
    if (!Witness.verifyArtifact(commitment, provider)) return no('commitment is not signed by the challenged provider');
    const publisher = hex64(xOnlyHex(commitment.publisherPubkey));
    if (!publisher) return no('commitment names no publisherPubkey — anyone could challenge it');
    if (publisher !== xOnlyHex(challenge.pubkey)) return no('challenge was not issued by the committed publisher');
    const root = hex64(challenge.merkleRootHex);
    if (!root || root !== hex64(commitment.merkleRootHex)) return no('commitment does not cover the challenged tree');
    const blobTotal = toInt(commitment.blobTotal);
    if (!blobTotal) return no('commitment names no blobTotal');
    if (toInt(challenge.blobTotal) !== blobTotal) return no('challenge blobTotal differs from the commitment');
    const epoch = toInt(challenge.epoch);
    const nonce = hex64(challenge.nonceHex);
    if (epoch == null || !nonce) return no('challenge epoch / nonce malformed');
    const blobIndex = leafIndexFor(root, epoch, nonce, blobTotal);
    if (toInt(challenge.blobIndex) !== blobIndex) return no('challenge blobIndex is not the nonce-derived leaf');
    const from = commitment.fromEpoch == null ? 0 : toInt(commitment.fromEpoch);
    if (from == null || epoch < from) return no('challenge issued before the commitment began');
    if (commitment.untilEpoch != null) {
      const until = toInt(commitment.untilEpoch);
      if (until == null || epoch > until) return no('challenge issued after the commitment expired');
    }
    const deadlineEpoch = toInt(challenge.deadlineEpoch);
    if (deadlineEpoch == null || deadlineEpoch <= epoch) return no('challenge deadlineEpoch must be an integer after its epoch');
    return { ok: true, provider, publisher, root, blobTotal, blobIndex, epoch, deadlineEpoch, nonce };
  }

  /**
   * Earliest epoch at which `want.digest` provably existed, from an anchor
   * its author cannot backdate:
   * - an `AvailabilityReceipt` `{ challengeHash, responseHash?, epoch, height? }`
   *   signed by `want.receiptSigner` (the counterparty, who gains nothing by
   *   dating it early);
   * - `EpochAttestation`s `{ digestHex, epoch, height? }` from distinct keys in
   *   `ctx.beaconPubkeys`, at least `ctx.beaconThreshold` (default 1) of them;
   *   the anchored epoch is the latest one that threshold agrees on.
   * @param {object|object[]} anchor
   * @param {{ digest: string, challengeHash: string, responseHash: (string|undefined), receiptSigner: string }} want
   * @param {object} [ctx]
   * @returns {{ ok: boolean, reason: (string|undefined), kind: (string|undefined), epoch: (number|undefined), height: (number|null|undefined) }}
   */
  static anchorEpoch (anchor, want = {}, ctx = {}) {
    const items = (Array.isArray(anchor) ? anchor : [anchor]).filter((item) => item && typeof item === 'object');
    if (!items.length) return { ok: false, reason: 'anchor required (counterparty AvailabilityReceipt or trusted EpochAttestation)' };
    const digest = hex64(want.digest);
    const challengeHash = hex64(want.challengeHash);
    const responseHash = want.responseHash ? hex64(want.responseHash) : null;
    const signer = hex64(xOnlyHex(want.receiptSigner));
    for (const item of items) {
      if (item.type !== RECEIPT_TYPE || !signer || !Witness.verifyArtifact(item, signer)) continue;
      if (!challengeHash || hex64(item.challengeHash) !== challengeHash) continue;
      if (responseHash && hex64(item.responseHash) !== responseHash) continue;
      const epoch = toInt(item.epoch);
      if (epoch == null) continue;
      return { ok: true, kind: 'receipt', epoch, height: toInt(item.height) };
    }
    const trusted = new Set((Array.isArray(ctx.beaconPubkeys) ? ctx.beaconPubkeys : []).map((k) => hex64(xOnlyHex(k))).filter(Boolean));
    if (!trusted.size) return { ok: false, reason: 'no valid counterparty receipt, and no trusted beacon keys (ctx.beaconPubkeys) for attestations' };
    const threshold = Math.max(1, toInt(ctx.beaconThreshold) || 1);
    const bySigner = new Map();
    for (const item of items) {
      if (item.type !== ATTESTATION_TYPE) continue;
      const key = hex64(xOnlyHex(item.pubkey));
      if (!key || !trusted.has(key) || bySigner.has(key)) continue;
      if (!digest || hex64(item.digestHex) !== digest) continue;
      const epoch = toInt(item.epoch);
      if (epoch == null || !Witness.verifyArtifact(item, key)) continue;
      bySigner.set(key, { epoch, height: toInt(item.height) });
    }
    if (bySigner.size < threshold) return { ok: false, reason: `need ${threshold} trusted EpochAttestation(s), have ${bySigner.size}` };
    const at = [...bySigner.values()].sort((x, y) => x.epoch - y.epoch)[threshold - 1];
    return { ok: true, kind: 'attestation', epoch: at.epoch, height: at.height };
  }

  /**
   * Nonce-bound proof of possession: `SHA256(nonce || blob bytes)` hex.
   * @param {string} nonceHex
   * @param {Buffer} bytes
   * @returns {string}
   */
  static possessionHex (nonceHex, bytes) {
    return sha256Hex(Buffer.from(String(nonceHex).toLowerCase(), 'hex'), bytes);
  }

  /**
   * Answer hash committed per round: `SHA256(possession digest bytes)`, so
   * revealing the possession digest on-chain opens the `answer` leaf.
   * @param {string} possessionHex
   * @returns {string}
   */
  static answerHashFor (possessionHex) {
    return sha256Hex(Buffer.from(String(possessionHex).toLowerCase(), 'hex'));
  }

  /**
   * The deposit's provider-unilateral `answer` leaf for `answerHashHex`
   * (`OP_SHA256 <answerHash> OP_EQUALVERIFY <provider> OP_CHECKSIG`).
   * @param {string} providerPubkey x-only or compressed hex
   * @param {string} answerHashHex
   * @returns {Buffer|null}
   */
  static answerLeafScript (providerPubkey, answerHashHex) {
    const provider = hex64(xOnlyHex(providerPubkey));
    const answerHash = hex64(answerHashHex);
    if (!provider || !answerHash) return null;
    const { buildHashlockLeaf } = require('../functions/contractTaproot');
    try {
      return buildHashlockLeaf({ id: 'answer', commitmentHex: answerHash, pubkeyHex: `02${provider}` }).script;
    } catch (_) {
      return null;
    }
  }

  /**
   * Structural checks every penalty PSBT must pass before anyone signs it and
   * whenever a pre-signature is verified: exactly one input, on the challenged
   * deposit outpoint; a non-final nSequence (else nLockTime is ignored);
   * `nLockTime` equal to the deadline, which must be a block height; every
   * output paying the publisher-named destination (at least `minValueSats`);
   * and a fee no larger than `maxFeeSats` (default 20000). Without a named
   * destination the result is `enforceable: false` — the provider, who signs
   * first, would choose where the penalty pays.
   * @param {object} psbt bitcoinjs Psbt
   * @param {object} expect `{ deposit: { txid, vout, penaltyAddress?, minPenaltySats? }, deadlineHeight, depositAddress?, destinationAddress?, destinationScriptHex?, minValueSats?, maxFeeSats? }`
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined), spentScript: (Buffer|undefined), feeSats: (number|undefined), enforceable: (boolean|undefined) }}
   */
  static checkPenaltyPsbt (psbt, expect = {}) {
    const no = (reason) => ({ ok: false, reason });
    const tx = psbt.__CACHE.__TX;
    if (tx.ins.length !== 1 || psbt.data.inputs.length !== 1) return no('penalty must spend exactly one input (the deposit outpoint)');
    const dep = expect.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return no('deposit outpoint { txid, vout } required');
    if (inputTxid(tx, 0) !== depTxid || tx.ins[0].index !== depVout) return no('penalty does not spend the challenged deposit outpoint');
    if (!(tx.ins[0].sequence < SEQUENCE_FINAL)) return no('penalty input nSequence is final — its nLockTime would not be enforced');
    const deadline = toInt(expect.deadlineHeight);
    if (!deadline || deadline >= LOCKTIME_THRESHOLD) return no('deadlineHeight must be a block height');
    if (tx.locktime !== deadline) return no(`penalty nLockTime ${tx.locktime} is not the deadline ${deadline}`);
    const input = psbt.data.inputs[0];
    if (!input.witnessUtxo) return no('PSBT carries no witnessUtxo for the deposit');
    const spent = Buffer.from(input.witnessUtxo.script);
    if (expect.depositAddress && !FraudProof._addressScripts(expect.depositAddress).some((s) => s.equals(spent))) {
      return no('penalty does not spend the deposit address');
    }
    const destination = FraudProof._penaltyDestination(expect);
    if (destination) {
      if (!destination.scripts.length) return no(`penalty destination ${destination.label} is not a valid address or script`);
      const toDestination = (o) => destination.scripts.some((s) => Buffer.from(o.script).equals(s));
      const min = destination.minValueSats;
      if (!tx.outs.some((o) => toDestination(o) && (!min || Number(o.value) >= min))) {
        return no(`penalty does not pay ${min ? `at least ${min} sats to ` : ''}${destination.label}`);
      }
      if (!tx.outs.every(toDestination)) return no(`penalty pays outputs other than ${destination.label}`);
    }
    const fee = BigInt(input.witnessUtxo.value) - tx.outs.reduce((n, o) => n + BigInt(o.value), 0n);
    if (fee < 0n) return no('penalty outputs exceed the deposit');
    const cap = toInt(expect.maxFeeSats) != null ? toInt(expect.maxFeeSats) : DEFAULT_MAX_PENALTY_FEE_SATS;
    if (fee > BigInt(cap)) return no(`penalty fee ${fee} exceeds the cap ${cap}`);
    return { ok: true, txid: tx.getId(), spentScript: spent, feeSats: Number(fee), enforceable: !!destination, deadlineHeight: deadline, deposit: { txid: depTxid, vout: depVout } };
  }

  /**
   * Verify a provider's `DepositPenaltyPreSig`: a signed artifact wrapping a
   * penalty PSBT that passes {@link FraudProof.checkPenaltyPsbt} and carries
   * the provider's valid tapscript signature on the canonical publisher +
   * provider penalty leaf, whose control block commits to the spent deposit
   * output. Pure.
   * @param {object} preSig artifact `{ type: 'DepositPenaltyPreSig', psbtBase64, deposit: { txid, vout }, deadlineHeight, txid, challengeHash?, pubkey, signature }`
   * @param {object} expect as {@link FraudProof.checkPenaltyPsbt}, plus `providerPubkey`, `publisherPubkey`, and optional `challengeHash` the pre-signature must acknowledge
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined), psbt: (object|undefined), enforceable: (boolean|undefined), spentScript: (Buffer|undefined), feeSats: (number|undefined) }}
   */
  static verifyPenaltyPreSig (preSig, expect = {}) {
    const no = (reason) => ({ ok: false, reason });
    if (!preSig || preSig.type !== PRESIG_TYPE) return no('DepositPenaltyPreSig artifact missing');
    const provider = hex64(xOnlyHex(expect.providerPubkey));
    if (!provider || !Witness.verifyArtifact(preSig, provider)) return no('pre-signature artifact not signed by the provider');
    let psbt;
    try { psbt = bitcoinjs().Psbt.fromBase64(String(preSig.psbtBase64 || '')); } catch (_) { return no('pre-signature PSBT invalid'); }
    const check = FraudProof.checkPenaltyPsbt(psbt, expect);
    if (!check.ok) return check;
    if (toInt(preSig.deadlineHeight) !== check.deadlineHeight) return no('pre-signature names another deadline');
    if (hex64(preSig.txid) !== check.txid) return no('pre-signature txid does not match its PSBT');
    const named = preSig.deposit || {};
    if (hex64(named.txid) !== check.deposit.txid || toInt(named.vout) !== check.deposit.vout) return no('pre-signature names another deposit outpoint');
    if (expect.challengeHash && hex64(preSig.challengeHash) !== hex64(expect.challengeHash)) return no('pre-signature is for another challenge');
    // The provider signs the PSBT and so chooses its leaf: only the canonical
    // 2-of-2 penalty leaf, committed to the deposit output, is a penalty.
    const penaltyLeaves = FraudProof._penaltyLeafScripts(expect.publisherPubkey, provider);
    if (!penaltyLeaves.length) return no('publisherPubkey required to identify the penalty leaf');
    const input = psbt.data.inputs[0];
    const leaves = input.tapLeafScript || [];
    if (!leaves.length) return no('PSBT names no tapscript leaf');
    if (!leaves.every((l) => penaltyLeaves.some((s) => s.equals(Buffer.from(l.script))))) return no('PSBT spends a leaf other than the penalty leaf');
    if (!leaves.every((l) => FraudProof._controlBlockCommits(check.spentScript, Buffer.from(l.script), Buffer.from(l.controlBlock)))) {
      return no('control block does not commit the penalty leaf to the deposit output');
    }
    const b = bip341();
    const leafHashes = leaves.map((l) => Buffer.from(b.tapleafHash({ output: Buffer.from(l.script), version: l.leafVersion })));
    const sigs = input.tapScriptSig || [];
    const mine = sigs.find((s) => Buffer.from(s.pubkey).toString('hex') === provider && leafHashes.some((h) => h.equals(Buffer.from(s.leafHash))));
    if (!mine) return no('PSBT carries no provider tapscript signature on the penalty leaf');
    let valid = false;
    try {
      valid = psbt.validateSignaturesOfInput(0, (pk, msghash, sig) => schnorr.verify(sig, msghash, pk), Buffer.from(provider, 'hex'));
    } catch (e) {
      return no(`tapscript signature check failed: ${e.message}`);
    }
    if (!valid) return no('provider tapscript signature invalid');
    return { ok: true, txid: check.txid, psbt, enforceable: check.enforceable, spentScript: check.spentScript, feeSats: check.feeSats };
  }

  /**
   * Publisher-controlled penalty destination from `expect` (explicit fields
   * win over the challenge's signed `deposit`). `null` when none is named.
   * @private
   * @param {object} expect
   * @returns {{ scripts: Buffer[], minValueSats: number, label: string }|null}
   */
  static _penaltyDestination (expect = {}) {
    const dep = expect.deposit || {};
    const address = expect.destinationAddress || dep.penaltyAddress || null;
    const scriptHex = expect.destinationScriptHex || null;
    if (!address && !scriptHex) return null;
    const minValueSats = Math.max(0, Math.floor(Number(expect.minValueSats != null ? expect.minValueSats : dep.minPenaltySats) || 0));
    const scripts = [];
    if (scriptHex && /^([0-9a-f]{2})+$/i.test(String(scriptHex))) scripts.push(Buffer.from(String(scriptHex), 'hex'));
    if (address) scripts.push(...FraudProof._addressScripts(address));
    return { scripts, minValueSats, label: String(address || scriptHex) };
  }

  /**
   * Output script for `address` on the first network that parses it.
   * @private
   * @param {string} address
   * @returns {Buffer[]} one script, or none when the address is invalid
   */
  static _addressScripts (address) {
    const { address: addr, networks } = bitcoinjs();
    for (const net of [networks.bitcoin, networks.testnet, networks.regtest]) {
      try { return [Buffer.from(addr.toOutputScript(String(address), net))]; } catch (_) { /* try the next network */ }
    }
    return [];
  }

  /**
   * Leaf script revealed by a Taproot script-path witness
   * (`[…stack, script, controlBlock, annex?]`), or `null` for a key-path spend.
   * @private
   * @param {Buffer[]} witness
   * @returns {Buffer|null}
   */
  static _tapscriptOf (witness = []) {
    const path = FraudProof._scriptPathOf(witness);
    return path ? path.script : null;
  }

  /**
   * Taproot script-path witness split into its parts, or `null` for a
   * key-path spend.
   * @private
   * @param {Buffer[]} witness
   * @returns {{ stack: Buffer[], script: Buffer, controlBlock: Buffer, annex: (Buffer|null) }|null}
   */
  static _scriptPathOf (witness = []) {
    let items = witness.filter((w) => Buffer.isBuffer(w) || w instanceof Uint8Array).map((w) => Buffer.from(w));
    let annex = null;
    if (items.length >= 2 && items[items.length - 1].length && items[items.length - 1][0] === 0x50) {
      annex = items[items.length - 1];
      items = items.slice(0, -1);
    }
    if (items.length < 2) return null;
    const control = items[items.length - 1];
    if (control.length < 33 || (control.length - 33) % 32 !== 0 || (control[0] & 0xfe) !== 0xc0) return null;
    return { stack: items.slice(0, -2), script: items[items.length - 2], controlBlock: control, annex };
  }

  /**
   * Spent outputs for every input of `tx` (the Taproot sighash commits to all
   * of them), from `[{ scriptHex, valueSats }]` aligned with `tx.ins`.
   * @private
   * @param {object[]} rows
   * @param {object} tx bitcoinjs Transaction
   * @returns {{ scripts: Buffer[], values: bigint[] }|null}
   */
  static _prevouts (rows, tx) {
    if (!Array.isArray(rows) || rows.length !== tx.ins.length) return null;
    const scripts = [];
    const values = [];
    for (const row of rows) {
      const scriptHex = String((row && row.scriptHex) || '');
      if (!/^([0-9a-f]{2})+$/i.test(scriptHex)) return null;
      let value;
      try { value = BigInt(row.valueSats); } catch (_) { return null; }
      if (value < 0n) return null;
      scripts.push(Buffer.from(scriptHex, 'hex'));
      values.push(value);
    }
    return { scripts, values };
  }

  /**
   * Whether `controlBlock` commits `leafScript` to the Taproot output
   * `prevoutScript` (`OP_1 <32-byte output key>`).
   * @private
   * @param {Buffer} prevoutScript
   * @param {Buffer} leafScript
   * @param {Buffer} controlBlock
   * @returns {boolean}
   */
  static _controlBlockCommits (prevoutScript, leafScript, controlBlock) {
    const out = Buffer.from(prevoutScript || []);
    const control = Buffer.from(controlBlock || []);
    if (out.length !== 34 || out[0] !== 0x51 || out[1] !== 0x20) return false;
    if (control.length < 33 || (control.length - 33) % 32 !== 0) return false;
    try {
      const b = bip341();
      const leafHash = b.tapleafHash({ output: Buffer.from(leafScript), version: control[0] & 0xfe });
      const tweaked = b.tweakKey(control.subarray(1, 33), b.rootHashFromPath(control, leafHash));
      return !!tweaked && tweaked.parity === (control[0] & 1) && Buffer.from(tweaked.x).equals(out.subarray(2));
    } catch (_) {
      return false;
    }
  }

  /**
   * Whether every key in `pubkeys` has a valid BIP340 signature on the
   * script-path stack over input `index` of `tx` through `path.script`.
   * @private
   * @param {object} tx bitcoinjs Transaction
   * @param {number} index
   * @param {{ scripts: Buffer[], values: bigint[] }} prevouts
   * @param {object} path from {@link FraudProof._scriptPathOf}
   * @param {string[]} pubkeys x-only hex
   * @returns {boolean}
   */
  static _scriptPathSignedBy (tx, index, prevouts, path, pubkeys) {
    const b = bip341();
    const leafHash = b.tapleafHash({ output: path.script, version: path.controlBlock[0] & 0xfe });
    const digests = new Map();
    const digest = (hashType) => {
      if (!digests.has(hashType)) {
        digests.set(hashType, Buffer.from(tx.hashForWitnessV1(index, prevouts.scripts, prevouts.values, hashType, leafHash, path.annex || undefined)));
      }
      return digests.get(hashType);
    };
    return pubkeys.every((pk) => HEX64.test(String(pk || '')) && path.stack.some((sig) => {
      if (sig.length !== 64 && sig.length !== 65) return false;
      const hashType = sig.length === 65 ? sig[64] : 0x00;
      if (sig.length === 65 && hashType === 0x00) return false;
      try {
        return schnorr.verify(sig.subarray(0, 64), digest(hashType), Buffer.from(pk, 'hex'));
      } catch (_) {
        return false;
      }
    }));
  }

  /**
   * Every byte form the deposit's `penalty` leaf (2-of-2 publisher + provider,
   * no lock — see `Bond.buildDeposit`) can take for two x-only keys. The leaf
   * sorts compressed keys, so each parity combination is a candidate.
   * @private
   * @param {string} publisherPubkey x-only or compressed hex
   * @param {string} providerPubkey x-only or compressed hex
   * @returns {Buffer[]}
   */
  static _penaltyLeafScripts (publisherPubkey, providerPubkey) {
    const { buildSpendLeaf } = require('../functions/contractTaproot');
    const a = xOnlyHex(publisherPubkey);
    const b = xOnlyHex(providerPubkey);
    if (!HEX64.test(String(a || '')) || !HEX64.test(String(b || '')) || a === b) return [];
    const out = [];
    for (const pa of ['02', '03']) {
      for (const pb of ['02', '03']) {
        try {
          const script = buildSpendLeaf({ id: 'penalty', keys: [pa + a, pb + b], threshold: 2 }).script;
          if (!out.some((s) => s.equals(script))) out.push(script);
        } catch (_) { /* not a curve point */ }
      }
    }
    return out;
  }

  /**
   * Evidence that `tx` confirmed in the verifier's chain at least
   * `ctx.minConfirmations` (default 6) deep: an SPV inclusion proof whose
   * header meets its target, is in the verifier's best chain
   * (`ctx.headerKnown`), is deep enough (`ctx.confirmations`), and whose
   * branch depth matches the block's transaction count (`ctx.txCount`, else
   * the artifact's own `txCount`); or the verifier's own
   * `ctx.txConfirmations(txid)` (preferred), else `ctx.txConfirmed(txid, depth)`,
   * which the host must answer for at least `depth` confirmations — it is
   * trusted as given. Without a chain view nothing verifies — a
   * header anyone can build proves nothing.
   * @private
   * @param {object} tx bitcoinjs Transaction
   * @param {object} [inclusion] `BitcoinTxInclusion` artifact
   * @param {object} ctx verifier chain view
   * @returns {{ ok: boolean, reason: (string|undefined), kind: (string|undefined), blockHash: (string|undefined) }}
   */
  static _broadcastEvidence (tx, inclusion, ctx = {}) {
    const txid = tx.getId();
    const depth = minConfirmations(ctx);
    // A 64-byte transaction can masquerade as an inner Merkle node.
    if (tx.byteLength(false) === 64) return { ok: false, reason: '64-byte transaction cannot be proven by a Merkle branch' };
    const ownView = () => {
      if (typeof ctx.txConfirmations === 'function') {
        const n = toInt(ctx.txConfirmations(txid));
        if (n == null || n < depth) return { ok: false, reason: `transaction has ${n || 0} of ${depth} confirmations in the verifier's chain view` };
        return { ok: true, kind: 'chain-view' };
      }
      if (typeof ctx.txConfirmed === 'function') {
        if (!ctx.txConfirmed(txid, depth)) return { ok: false, reason: 'transaction is not confirmed in the verifier\'s chain view' };
        return { ok: true, kind: 'chain-view' };
      }
      return null;
    };
    if (inclusion && typeof inclusion === 'object') {
      if (String(inclusion.txid || '').toLowerCase() !== txid) return { ok: false, reason: 'inclusion artifact is for another transaction' };
      if (typeof ctx.headerKnown === 'function') {
        const header = verifyInclusion(inclusion);
        if (!header.ok && header.reason !== 'txCount required to pin the branch depth') {
          return { ok: false, reason: `inclusion artifact invalid: ${header.reason}` };
        }
        const blockHash = header.blockHash;
        if (!blockHash || !ctx.headerKnown(blockHash)) return { ok: false, reason: `block ${blockHash} is not in the verifier's header chain` };
        if (typeof ctx.confirmations !== 'function') return { ok: false, reason: 'chain view required: ctx.confirmations(blockHash) for inclusion depth' };
        const confirmations = toInt(ctx.confirmations(blockHash));
        if (confirmations == null || confirmations < depth) return { ok: false, reason: `block ${blockHash} has ${confirmations || 0} of ${depth} confirmations` };
        const txCount = typeof ctx.txCount === 'function' ? ctx.txCount(blockHash) : undefined;
        const check = verifyInclusion(inclusion, { txCount, requireTxCount: true });
        if (!check.ok) return { ok: false, reason: `inclusion artifact invalid: ${check.reason}` };
        return { ok: true, kind: 'inclusion', blockHash };
      }
      const view = ownView();
      if (view) {
        if (!view.ok) return view;
        const check = verifyInclusion(inclusion);
        return Object.assign(view, { blockHash: check.ok ? check.blockHash : undefined });
      }
      return { ok: false, reason: 'chain view required: ctx.headerKnown + ctx.confirmations, or ctx.txConfirmations' };
    }
    const view = ownView();
    if (view) return view;
    return { ok: false, reason: 'broadcast evidence required: inclusion artifact with ctx.headerKnown + ctx.confirmations, or ctx.txConfirmations' };
  }

  /**
   * Non-response absence anchored to a timelock (see class doc). The deposit
   * outpoint's state must come from confirmed chain data at least
   * `ctx.minConfirmations` deep past the deadline; a mempool view would let a
   * pending check-in or answer be ignored.
   * @private
   */
  static _timelockedAbsence (bound, challenge, commitment, a, ctx, fail) {
    const deadlineHeight = toInt(challenge.deadlineHeight);
    if (!deadlineHeight) return fail('absence needs a challenge with deadlineHeight — silence alone is not provable');
    const dep = challenge.deposit || {};
    const depTxid = hex64(dep.txid);
    const depVout = toInt(dep.vout);
    if (!depTxid || depVout == null) return fail('challenge names no deposit outpoint');
    const challengeHash = Witness.artifactHash(challenge);
    const check = Witness.verifyPenaltyPreSig(a.penaltyPreSig, {
      providerPubkey: bound.provider,
      publisherPubkey: bound.publisher,
      deposit: dep,
      deadlineHeight,
      depositAddress: commitment.depositAddress || dep.address || null
    });
    if (!check.ok) return fail(`penalty pre-signature: ${check.reason}`);
    const base = { evidence: 'timelock', enforceableAfterHeight: deadlineHeight, penaltyTxid: check.txid, enforceable: check.enforceable };
    const tip = toInt(ctx.tipHeight);
    if (tip == null) return fail('chain view required: ctx.tipHeight', base);
    const depth = minConfirmations(ctx);
    if (tip < deadlineHeight + depth) return fail(`deadline height ${deadlineHeight} is not yet ${depth} blocks deep (tip ${tip})`, base);
    let alreadyEnforced = false;
    let withdrawn = false;
    if (typeof ctx.outpointSpend === 'function') {
      const spend = ctx.outpointSpend(depTxid, depVout);
      if (spend) {
        const leafId = String(spend.leafId || '');
        if (leafId === 'penalty') alreadyEnforced = true;
        else if (leafId === 'withdraw') withdrawn = true;
        else return fail(`deposit outpoint was spent${leafId ? ` through ${leafId}` : ''} — the provider checked in or answered`, base);
      }
    } else if (typeof ctx.outpointUnspent === 'function') {
      if (!ctx.outpointUnspent(depTxid, depVout)) return fail('deposit outpoint was spent — the provider checked in, answered, or was already penalized', base);
    } else {
      return fail('chain view required: ctx.outpointSpend or ctx.outpointUnspent', base);
    }
    Object.assign(base, { enforceable: check.enforceable && !alreadyEnforced && !withdrawn, alreadyEnforced, withdrawn });
    const acknowledged = hex64(a.penaltyPreSig.challengeHash) === challengeHash;
    const answerable = FraudProof._answerPathProven(challenge, bound.provider, check.spentScript, a.answerPath);
    if (acknowledged && answerable && check.enforceable) {
      return convict(bound.provider, `provider held challenge ${challengeHash.slice(0, 16)}… with a unilateral answer path and neither answered nor checked in by height ${deadlineHeight} (tip ${tip})`, base);
    }
    const why = !acknowledged
      ? 'the pre-signature does not acknowledge this challenge'
      : (!answerable ? 'the deposit has no provider-unilateral answer path for this challenge' : 'the penalty names no publisher destination');
    return Object.assign({
      ok: true,
      offender: null,
      reputational: false,
      accused: bound.provider,
      reason: `pre-signed penalty ${check.txid} is past its deadline, but this is not proof of non-response: ${why}`
    }, base);
  }

  /**
   * Whether `answerPath.controlBlockHex` commits the provider's `answer` leaf
   * for `challenge.answerHashHex` to the spent deposit output.
   * @private
   */
  static _answerPathProven (challenge, provider, spentScript, answerPath) {
    if (!answerPath || !spentScript) return false;
    const script = FraudProof.answerLeafScript(provider, challenge.answerHashHex);
    const control = hexBytes(answerPath.controlBlockHex);
    return !!script && !!control && FraudProof._controlBlockCommits(spentScript, script, control);
  }

  /**
   * Whether the publisher's pinned `blobHashHex` is proven to sit at the
   * challenged index (`challenge.pinProof`, or one carried beside it).
   * @private
   */
  static _pinProven (challenge, bound, extraProof) {
    const proof = challenge.pinProof || extraProof;
    return !!proof && verifyBlobPath({ merkleRootHex: bound.root, leafHex: challenge.blobHashHex, index: bound.blobIndex, leafCount: bound.blobTotal, proof });
  }

  /** @private provider-signed response to exactly this challenge */
  static _responseTo (challenge, response, provider) {
    if (!response || response.type !== RESPONSE_TYPE) return { ok: false, reason: 'response missing' };
    if (!Witness.verifyArtifact(response, provider)) return { ok: false, reason: 'response signature invalid' };
    if (hex64(response.challengeHash) !== Witness.artifactHash(challenge)) return { ok: false, reason: 'response answers another challenge' };
    return { ok: true };
  }

  /**
   * Seller-signed offer + paid, seller-signed delivery frame for the same
   * document, root, blob index, and payment (wrong-bytes, bad-key).
   * @private
   */
  static _offerDelivery (a = {}) {
    const no = (reason) => ({ ok: false, reason });
    const { offer, claim, delivery } = a;
    if (!offer || offer.type !== 'DocumentOffer') return no('signed DocumentOffer required');
    if (!Witness.verifyArtifact(offer)) return no('offer signature invalid');
    const seller = xOnlyHex(offer.pubkey);
    const documentId = typeof offer.documentId === 'string' ? offer.documentId.trim() : '';
    if (!documentId) return no('offer names no documentId');
    const root = hex64(offer.merkleRootHex);
    if (!root) return no('offer names no merkleRootHex');
    const blobIndex = toInt(offer.blobIndex);
    if (blobIndex == null) return no('offer names no integer blobIndex');
    const want = hex64(offer.blobHashHex);
    if (!want) return no('offer carries no blobHashHex');
    const offeredHash = hex64(offer.paymentHashHex);
    if (!offeredHash) return no('offer carries no paymentHashHex — payment cannot be bound to the delivery');
    const preimage = hex64(claim && claim.preimageHex);
    if (!preimage) return no('claim preimage missing');
    if (sha256Hex(Buffer.from(preimage, 'hex')) !== offeredHash) return no('claim preimage does not match the offered payment hash');
    const frameHex = delivery && (delivery.frameHex || delivery.frame);
    if (!frameHex) return no('delivery frame missing — needs the seller-signed P2P_FILE_SEND frame');
    const frame = verifyFrameAuthor(frameHex);
    if (!frame.ok) return no(`delivery frame: ${frame.reason}`);
    if (frame.type !== P2P_FILE_SEND) return no('delivery frame is not a P2P_FILE_SEND');
    if (frame.author !== seller) return no('delivery frame was not signed by the offer signer');
    let body = null;
    try { body = JSON.parse(frame.body.toString('utf8')); } catch (_) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return no('delivery frame body is not a P2P_FILE_SEND object');
    // Only the signed body binds the delivery to the payment; anything beside
    // the frame (e.g. `delivery.paymentHashHex`) is attacker-chosen.
    const onWire = hex64(body.paymentHashHex);
    if (!onWire) return no('delivery frame does not sign a paymentHashHex — it is not the paid delivery');
    if (onWire !== offeredHash) return no('delivery frame is for another payment hash');
    if (String(body.documentId || body.name || '').trim() !== documentId) return no('delivery frame is for another document');
    if (hex64(body.merkleRootHex) !== root) return no('delivery frame is for another tree root');
    if (toInt(body.blobIndex) !== blobIndex) return no('delivery frame is for another blob index');
    if (typeof body.body !== 'string') return no('delivery frame carries no blob body');
    return { ok: true, seller, want, preimage, offer, body, bytes: Buffer.from(body.body, 'base64') };
  }

  /**
   * Compressed `secret · G` (secret reduced mod n, as `Channel.commitmentPoint`).
   * @private
   */
  static _commitmentPoint (secretHex) {
    try {
      const n = secp256k1.Point.CURVE().n;
      const k = BigInt(`0x${secretHex}`) % n;
      return k === 0n ? null : secp256k1.Point.BASE.multiply(k).toHex(true);
    } catch (_) {
      return null;
    }
  }
}

/** @private verdict that names an offender and may move reputation */
function convict (offender, reason, extra = {}) {
  return Object.assign({ ok: true, offender, reputational: true, reason }, extra);
}

FraudProof.DEFAULT_CONFIRMATIONS = DEFAULT_CONFIRMATIONS;
FraudProof.TYPES = Object.freeze({
  COMMITMENT: COMMITMENT_TYPE,
  CHALLENGE: CHALLENGE_TYPE,
  RESPONSE: RESPONSE_TYPE,
  RECEIPT: RECEIPT_TYPE,
  ATTESTATION: ATTESTATION_TYPE,
  PENALTY_PRESIG: PRESIG_TYPE
});
FraudProof.verifyBlobPath = verifyBlobPath;
FraudProof.leafIndexFor = leafIndexFor;
FraudProof.toInt = toInt;

Witness.FraudProof = FraudProof;
Witness.verifyPenaltyPreSig = FraudProof.verifyPenaltyPreSig;
Witness.checkPenaltyPsbt = FraudProof.checkPenaltyPsbt;
Witness.verifyBlobPath = verifyBlobPath;
Witness.FRAUD_PROOF_KINDS = FRAUD_PROOF_KINDS;

module.exports = Witness;
