'use strict';

const crypto = require('crypto');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');
const { stableStringify } = require('../functions/fabricCanonicalJson');
const { verifyBlob, createBlobMerkleTree } = require('../functions/documentBlobManifest');

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Fraud proof kinds. Each is a self-contained bundle of signed artifacts that
 * any third party verifies from the artifacts alone (decision 6).
 * @private
 */
const FRAUD_PROOF_KINDS = Object.freeze({
  WRONG_LEAF: 'wrong-leaf',
  NON_RESPONSE: 'non-response',
  WRONG_BYTES: 'wrong-bytes',
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

/**
 * Self-contained proof that a market counterparty broke a signed obligation.
 * Shape: `{ type: 'FraudProof', kind, artifacts, claim }`. `verify()` is pure —
 * it needs nothing but the artifacts (plus the epoch clock for non-response).
 *
 * Kinds:
 * - `wrong-leaf`: signed challenge + provider-signed response whose leaf does
 *   not belong to the committed root (or names the wrong blob hash).
 * - `non-response`: signed challenge + provider's signed availability
 *   commitment, and either no response or one signed after the deadline epoch.
 * - `wrong-bytes`: seller-signed offer row + on-chain claim (preimage) + the
 *   received ciphertext whose hash misses the offered `blobHashHex`.
 * - `wrongful-penalty`: publisher-signed challenge + the provider's valid,
 *   Merkle-proven, in-time response (+ the penalty spend) — publisher fraud.
 * - `stale-commitment`: a payment-channel party's own signed `ChannelRevoke`
 *   (naming the commitment txid it revoked) plus that very transaction seen
 *   on-chain — the revoker broadcast a state it had already revoked.
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

  static fromBody (body) {
    if (!body || body.type !== FRAUD_PROOF_TYPE) return null;
    return new FraudProof(body);
  }

  /**
   * @param {object} [ctx]
   * @param {number} [ctx.epoch] current Beacon epoch (non-response)
   * @returns {{ ok: boolean, offender: string|null, reason: string|null }}
   */
  verify (ctx = {}) {
    const a = this.artifacts;
    const fail = (reason) => ({ ok: false, offender: null, reason });
    switch (this.kind) {
      case FRAUD_PROOF_KINDS.WRONG_LEAF: {
        const { challenge, response } = a;
        const basic = FraudProof._challengePair(challenge, response);
        if (!basic.ok) return fail(basic.reason);
        if (response.blobIndex !== challenge.blobIndex) {
          return { ok: true, offender: response.pubkey, reason: 'response answers a different blob index' };
        }
        const expected = challenge.blobHashHex || null;
        if (expected && String(response.blobHashHex).toLowerCase() !== String(expected).toLowerCase()) {
          return { ok: true, offender: response.pubkey, reason: 'response names a blob hash other than the committed leaf' };
        }
        if (!FraudProof._inclusionOk(response, challenge.merkleRootHex)) {
          return { ok: true, offender: response.pubkey, reason: 'response leaf is not in the committed tree' };
        }
        return fail('response is valid — no wrong-leaf fraud');
      }
      case FRAUD_PROOF_KINDS.NON_RESPONSE: {
        const { challenge, commitment, response } = a;
        if (!Witness.verifyArtifact(challenge)) return fail('challenge signature invalid');
        if (!Witness.verifyArtifact(commitment)) return fail('commitment signature invalid');
        if (String(commitment.merkleRootHex).toLowerCase() !== String(challenge.merkleRootHex).toLowerCase()) {
          return fail('commitment does not cover the challenged tree');
        }
        if (String(challenge.providerPubkey).toLowerCase() !== String(commitment.pubkey).toLowerCase()) {
          return fail('challenge is addressed to another provider');
        }
        if (commitment.untilEpoch != null && Number(challenge.epoch) > Number(commitment.untilEpoch)) {
          return fail('challenge issued after the commitment expired');
        }
        const deadline = Number(challenge.deadlineEpoch);
        if (response) {
          if (!Witness.verifyArtifact(response, commitment.pubkey)) return fail('response signature invalid');
          if (String(response.challengeHash) !== Witness.artifactHash(challenge)) return fail('response answers another challenge');
          if (Number(response.epoch) <= deadline) return fail('response was in time — no non-response fraud');
          return { ok: true, offender: commitment.pubkey, reason: `response signed in epoch ${response.epoch} after deadline ${deadline}` };
        }
        const now = ctx.epoch != null ? Number(ctx.epoch) : null;
        if (now == null) return fail('current epoch required to prove absence');
        if (now <= deadline) return fail('deadline epoch not yet passed');
        return { ok: true, offender: commitment.pubkey, reason: `no response by epoch ${deadline} (now ${now})` };
      }
      case FRAUD_PROOF_KINDS.WRONG_BYTES: {
        const { offer, claim, bytesHex } = a;
        if (!Witness.verifyArtifact(offer)) return fail('offer signature invalid');
        const want = String(offer.blobHashHex || '').toLowerCase();
        if (!HEX64.test(want)) return fail('offer carries no blobHashHex');
        if (!claim || !HEX64.test(String(claim.preimageHex || '').toLowerCase())) return fail('claim preimage missing');
        const paymentHash = crypto.createHash('sha256').update(Buffer.from(claim.preimageHex, 'hex')).digest('hex');
        if (offer.paymentHashHex && paymentHash !== String(offer.paymentHashHex).toLowerCase()) {
          return fail('claim preimage does not match the offered payment hash');
        }
        let bytes;
        try { bytes = Buffer.from(String(bytesHex || ''), 'hex'); } catch (_) { return fail('bytesHex invalid'); }
        if (verifyBlob(bytes, want)) return fail('delivered bytes match the offer — no wrong-bytes fraud');
        return { ok: true, offender: offer.pubkey, reason: 'delivered bytes do not hash to the offered blob' };
      }
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: {
        const { challenge, response } = a;
        const basic = FraudProof._challengePair(challenge, response);
        if (!basic.ok) return fail(basic.reason);
        if (response.blobIndex !== challenge.blobIndex) return fail('response answers a different blob index');
        if (challenge.blobHashHex && String(response.blobHashHex).toLowerCase() !== String(challenge.blobHashHex).toLowerCase()) {
          return fail('response names the wrong blob hash');
        }
        if (!FraudProof._inclusionOk(response, challenge.merkleRootHex)) return fail('response leaf is not in the committed tree');
        if (Number(response.epoch) > Number(challenge.deadlineEpoch)) return fail('response was late');
        return { ok: true, offender: challenge.pubkey, reason: 'valid in-time response was penalized' };
      }
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: {
        const { revoke, staleTxHex } = a;
        if (!revoke || revoke.type !== 'ChannelRevoke') return fail('ChannelRevoke artifact missing');
        if (!Witness.verifyArtifact(revoke)) return fail('revoke signature invalid');
        if (!HEX64.test(String(revoke.commitmentTxid || '').toLowerCase())) return fail('revoke names no commitment txid');
        if (!HEX64.test(String(revoke.perCommitmentSecret || '').toLowerCase())) return fail('revoke carries no per-commitment secret');
        let tx;
        try {
          tx = require('bitcoinjs-lib').Transaction.fromHex(String(staleTxHex || '').trim());
        } catch (_) {
          return fail('staleTxHex is not a transaction');
        }
        if (tx.getId() !== String(revoke.commitmentTxid).toLowerCase()) return fail('transaction is not the revoked commitment');
        return { ok: true, offender: revoke.pubkey, reason: `revoked commitment ${revoke.number} (${tx.getId()}) was broadcast` };
      }
      default:
        return fail(`unknown fraud proof kind: ${this.kind}`);
    }
  }

  /** @private */
  static _challengePair (challenge, response) {
    if (!Witness.verifyArtifact(challenge)) return { ok: false, reason: 'challenge signature invalid' };
    if (!response) return { ok: false, reason: 'response missing' };
    if (!Witness.verifyArtifact(response, challenge.providerPubkey || null)) return { ok: false, reason: 'response signature invalid' };
    if (String(response.challengeHash) !== Witness.artifactHash(challenge)) return { ok: false, reason: 'response answers another challenge' };
    return { ok: true };
  }

  /** @private */
  static _inclusionOk (response, merkleRootHex) {
    const root = String(merkleRootHex || '').toLowerCase();
    const leaf = String(response.blobHashHex || '').toLowerCase();
    if (!HEX64.test(root) || !HEX64.test(leaf)) return false;
    const proof = response.proof;
    if (!proof || typeof proof !== 'object') return false;
    try {
      const tree = createBlobMerkleTree([leaf]);
      return tree.verifyInclusion(Object.assign({}, proof, { leaf, root }), root);
    } catch (_) {
      return false;
    }
  }
}

Witness.FraudProof = FraudProof;
Witness.FRAUD_PROOF_KINDS = FRAUD_PROOF_KINDS;

module.exports = Witness;