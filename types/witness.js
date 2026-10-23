'use strict';

const crypto = require('crypto');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');
const { stableStringify } = require('../functions/fabricCanonicalJson');
const { verifyBlob, createBlobMerkleTree, parseFileSendObject } = require('../functions/documentBlobManifest');
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

/**
 * Self-contained proof that a market counterparty broke a signed obligation.
 * Shape: `{ type: 'FraudProof', kind, artifacts, claim }`. `verify()` is pure
 * over the artifacts; the few kinds that assert an **on-chain fact** (a
 * broadcast happened, an outpoint is still unspent, the tip passed a height)
 * take that fact from `ctx` — the verifier's own chain view — and refuse to
 * conclude without it. No kind ever infers fraud from a *missing* message
 * alone: absence is always anchored to a timelock (decision 6).
 *
 * Kinds:
 * - `wrong-leaf`: signed challenge + provider-signed response whose leaf does
 *   not belong to the committed root (or names the wrong blob hash).
 * - `non-response`: signed challenge + provider's signed availability
 *   commitment and either (a) a response signed after the deadline epoch, or
 *   (b) **timelock evidence**: the challenge names `deadlineHeight` + the
 *   deposit outpoint, the provider's `DepositPenaltyPreSig` on a penalty
 *   transaction with `nLockTime = deadlineHeight`, and the verifier's chain
 *   view shows the tip past the deadline with the outpoint **unspent** (no
 *   check-in). The pre-signed penalty is itself the enforcement.
 * - `wrong-bytes`: seller-signed offer row (with `paymentHashHex`) + the
 *   claim preimage that opens that payment hash + the seller-signed AMP
 *   `P2P_FILE_SEND` frame whose delivered bytes miss the offered
 *   `blobHashHex`. The frame author must be the offer signer.
 * - `wrongful-penalty`: publisher-signed challenge + the provider's valid,
 *   Merkle-proven, in-time response + the penalty transaction that spent
 *   the deposit outpoint anyway — publisher fraud. The penalty's spent
 *   outputs (`prevouts`) let the verifier check that the penalty leaf is
 *   committed to the deposit output and signed by both parties.
 * - `stale-commitment`: a payment-channel party's own signed `ChannelRevoke`
 *   (naming the commitment txid it revoked) plus that very transaction and
 *   evidence it was broadcast: an SPV `inclusion` artifact
 *   (`functions/bitcoinTxInclusion.js`) or `ctx.txConfirmed(txid)`.
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
   * @param {object} [ctx] verifier's chain view
   * @param {number} [ctx.tipHeight] current block height (timelocked non-response)
   * @param {function} [ctx.outpointUnspent] `(txid, vout) → boolean` (timelocked non-response)
   * @param {function} [ctx.txConfirmed] `(txid) → boolean` (stale-commitment / wrongful-penalty broadcast evidence)
   * @param {function} [ctx.headerKnown] `(blockHash) → boolean` — whether an inclusion artifact's block is in the verifier's header chain
   * @returns {{ ok: boolean, offender: (string|null), reason: (string|null), evidence: (string|undefined), enforceableAfterHeight: (number|undefined) }}
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
        if (commitment.fromEpoch != null && !(Number(challenge.epoch) >= Number(commitment.fromEpoch))) {
          return fail('challenge issued before the commitment began');
        }
        if (commitment.publisherPubkey && xOnlyHex(commitment.publisherPubkey) !== xOnlyHex(challenge.pubkey)) {
          return fail('challenge was not issued by the committed publisher');
        }
        const deadline = Number(challenge.deadlineEpoch);
        if (response) {
          if (!Witness.verifyArtifact(response, commitment.pubkey)) return fail('response signature invalid');
          if (String(response.challengeHash) !== Witness.artifactHash(challenge)) return fail('response answers another challenge');
          if (Number(response.epoch) <= deadline) return fail('response was in time — no non-response fraud');
          return { ok: true, offender: commitment.pubkey, reason: `response signed in epoch ${response.epoch} after deadline ${deadline}` };
        }
        // Absence. Never inferred from silence: the challenge must bind a
        // block-height deadline and the deposit outpoint, the provider must
        // have pre-signed the penalty for exactly that deadline, and the
        // verifier's own chain view must show the deadline passed with the
        // deposit still unspent (the provider did not check in).
        return FraudProof._timelockedAbsence(challenge, commitment, a, ctx, fail);
      }
      case FRAUD_PROOF_KINDS.WRONG_BYTES: {
        const { offer, claim, delivery } = a;
        if (!Witness.verifyArtifact(offer)) return fail('offer signature invalid');
        const want = String(offer.blobHashHex || '').toLowerCase();
        if (!HEX64.test(want)) return fail('offer carries no blobHashHex');
        const offeredHash = String(offer.paymentHashHex || '').toLowerCase();
        if (!HEX64.test(offeredHash)) return fail('offer carries no paymentHashHex — payment cannot be bound to the delivery');
        if (!claim || !HEX64.test(String(claim.preimageHex || '').toLowerCase())) return fail('claim preimage missing');
        const paymentHash = crypto.createHash('sha256').update(Buffer.from(claim.preimageHex, 'hex')).digest('hex');
        if (paymentHash !== offeredHash) return fail('claim preimage does not match the offered payment hash');
        const frameHex = delivery && (delivery.frameHex || delivery.frame);
        if (!frameHex) return fail('delivery frame missing — wrong-bytes needs the seller-signed P2P_FILE_SEND frame');
        const frame = verifyFrameAuthor(frameHex);
        if (!frame.ok) return fail(`delivery frame: ${frame.reason}`);
        if (frame.type !== P2P_FILE_SEND) return fail('delivery frame is not a P2P_FILE_SEND');
        if (frame.author !== xOnlyHex(offer.pubkey)) return fail('delivery frame was not signed by the offer signer');
        let parsed;
        try { parsed = parseFileSendObject(JSON.parse(frame.body.toString('utf8'))); } catch (_) { return fail('delivery frame body is not a P2P_FILE_SEND object'); }
        if (!parsed.ok) return fail(`delivery frame body: ${parsed.error}`);
        // Only the signed body binds the delivery to the payment; anything
        // beside the frame (e.g. `delivery.paymentHashHex`) is attacker-chosen.
        let bodyObj = null;
        try { bodyObj = JSON.parse(frame.body.toString('utf8')); } catch (_) { bodyObj = null; }
        const onWire = bodyObj ? String(bodyObj.paymentHashHex || '').toLowerCase() : '';
        if (!HEX64.test(onWire)) return fail('delivery frame does not sign a paymentHashHex — it is not the paid delivery');
        if (onWire !== offeredHash) return fail('delivery frame is for another payment hash');
        if (offer.blobIndex != null && Number(parsed.blobIndex) !== Number(offer.blobIndex)) return fail('delivery frame is for another blob index');
        if (verifyBlob(parsed.bytes, want)) return fail('delivered bytes match the offer — no wrong-bytes fraud');
        return { ok: true, offender: xOnlyHex(offer.pubkey), reason: 'seller-signed delivery does not hash to the offered blob', evidence: 'signed-frame', deliveredBlobHashHex: parsed.blobHashHex };
      }
      case FRAUD_PROOF_KINDS.WRONGFUL_PENALTY: {
        const { challenge, response, penaltyTxHex, inclusion } = a;
        const basic = FraudProof._challengePair(challenge, response);
        if (!basic.ok) return fail(basic.reason);
        if (response.blobIndex !== challenge.blobIndex) return fail('response answers a different blob index');
        if (challenge.blobHashHex && String(response.blobHashHex).toLowerCase() !== String(challenge.blobHashHex).toLowerCase()) {
          return fail('response names the wrong blob hash');
        }
        if (!FraudProof._inclusionOk(response, challenge.merkleRootHex)) return fail('response leaf is not in the committed tree');
        if (Number(response.epoch) > Number(challenge.deadlineEpoch)) return fail('response was late');
        if (challenge.deadlineHeight != null && response.height != null && Number(response.height) > Number(challenge.deadlineHeight)) return fail('response was late (height)');
        // The penalty must actually have been taken: a transaction spending
        // the deposit outpoint the challenge names.
        const dep = challenge.deposit || {};
        if (!HEX64.test(String(dep.txid || '').toLowerCase())) return fail('challenge names no deposit outpoint');
        let penalty;
        try { penalty = bitcoinjs().Transaction.fromHex(String(penaltyTxHex || '').trim()); } catch (_) { return fail('penaltyTxHex missing or not a transaction'); }
        const spendIndex = penalty.ins.findIndex((inp, i) => inputTxid(penalty, i) === String(dep.txid).toLowerCase() && (dep.vout == null || Number(inp.index) === Number(dep.vout)));
        if (spendIndex < 0) return fail('penalty transaction does not spend the deposit outpoint');
        const witness = penalty.ins[spendIndex].witness || [];
        if (!witness.length || witness.every((w) => !w || !w.length)) return fail('penalty transaction carries no witness for the deposit input');
        // Check-in (CSV 1) and withdraw (provider-only) also spend the deposit:
        // only a spend through the 2-of-2 `penalty` leaf is a penalty.
        const path = FraudProof._scriptPathOf(witness);
        if (!path) return fail('deposit input is not a tapscript spend');
        const penaltyLeaves = FraudProof._penaltyLeafScripts(challenge.pubkey, challenge.providerPubkey);
        if (!penaltyLeaves.some((s) => s.equals(path.script))) return fail('deposit input does not spend the penalty leaf (check-in or withdraw is not a penalty)');
        // The txid does not commit to the witness: the spend could be a check-in
        // or withdraw re-dressed with a penalty leaf. The control block must
        // commit that leaf to the deposit output, and both parties' signatures
        // must verify over this spend through it.
        const prevouts = FraudProof._prevouts(a.prevouts, penalty);
        if (!prevouts) return fail('prevouts required: [{ scriptHex, valueSats }] for every penalty input');
        if (!FraudProof._controlBlockCommits(prevouts.scripts[spendIndex], path.script, path.controlBlock)) {
          return fail('control block does not commit the penalty leaf to the deposit output');
        }
        if (!FraudProof._scriptPathSignedBy(penalty, spendIndex, prevouts, path, [xOnlyHex(challenge.pubkey), xOnlyHex(challenge.providerPubkey)])) {
          return fail('penalty leaf signatures do not verify for the deposit spend');
        }
        const evidence = FraudProof._broadcastEvidence(penalty, inclusion, ctx);
        if (!evidence.ok) return fail(evidence.reason);
        return { ok: true, offender: xOnlyHex(challenge.pubkey), reason: 'valid in-time response was penalized', evidence: evidence.kind, penaltyTxid: penalty.getId(), blockHash: evidence.blockHash || null };
      }
      case FRAUD_PROOF_KINDS.STALE_COMMITMENT: {
        const { revoke, staleTxHex, inclusion } = a;
        if (!revoke || revoke.type !== 'ChannelRevoke') return fail('ChannelRevoke artifact missing');
        if (!Witness.verifyArtifact(revoke)) return fail('revoke signature invalid');
        if (!HEX64.test(String(revoke.commitmentTxid || '').toLowerCase())) return fail('revoke names no commitment txid');
        if (!HEX64.test(String(revoke.perCommitmentSecret || '').toLowerCase())) return fail('revoke carries no per-commitment secret');
        let tx;
        try {
          tx = bitcoinjs().Transaction.fromHex(String(staleTxHex || '').trim());
        } catch (_) {
          return fail('staleTxHex is not a transaction');
        }
        const txid = tx.getId();
        if (txid !== String(revoke.commitmentTxid).toLowerCase()) return fail('transaction is not the revoked commitment');
        // Possessing the signed bytes proves nothing (the verifier may simply
        // hold the old commitment): require evidence it reached the chain.
        const evidence = FraudProof._broadcastEvidence(tx, inclusion, ctx);
        if (!evidence.ok) return fail(evidence.reason);
        return { ok: true, offender: xOnlyHex(revoke.pubkey), reason: `revoked commitment ${revoke.number} (${txid}) was broadcast`, evidence: evidence.kind, blockHash: evidence.blockHash || null };
      }
      default:
        return fail(`unknown fraud proof kind: ${this.kind}`);
    }
  }

  /**
   * Verify a provider's `DepositPenaltyPreSig`: a signed artifact wrapping a
   * penalty PSBT that spends the deposit outpoint with `nLockTime` equal to
   * the challenge deadline height and carries the provider's valid tapscript
   * signature on the canonical publisher + provider penalty leaf, whose
   * control block commits to the spent deposit output. Pure.
   * @param {object} preSig artifact `{ type: 'DepositPenaltyPreSig', psbtBase64, deposit: { txid, vout }, deadlineHeight, txid, pubkey, signature }`
   * @param {object} expect `{ providerPubkey (x-only), publisherPubkey, deposit: { txid, vout, penaltyAddress?, minPenaltySats? }, deadlineHeight, depositAddress?, destinationAddress?, destinationScriptHex?, minValueSats? }` — a destination (top-level or from the challenge's signed `deposit`) is mandatory when named; `depositAddress` binds the spent output
   * @returns {{ ok: boolean, reason: (string|undefined), txid: (string|undefined), psbt: (object|undefined) }}
   */
  static verifyPenaltyPreSig (preSig, expect = {}) {
    if (!preSig || preSig.type !== 'DepositPenaltyPreSig') return { ok: false, reason: 'DepositPenaltyPreSig artifact missing' };
    const provider = xOnlyHex(expect.providerPubkey);
    if (!Witness.verifyArtifact(preSig, provider)) return { ok: false, reason: 'pre-signature artifact not signed by the provider' };
    let psbt;
    try { psbt = bitcoinjs().Psbt.fromBase64(String(preSig.psbtBase64 || '')); } catch (_) { return { ok: false, reason: 'pre-signature PSBT invalid' }; }
    const tx = psbt.__CACHE.__TX;
    if (!tx.ins.length) return { ok: false, reason: 'penalty spends nothing' };
    const dep = expect.deposit || {};
    if (inputTxid(tx, 0) !== String(dep.txid || '').toLowerCase() || (dep.vout != null && Number(tx.ins[0].index) !== Number(dep.vout))) {
      return { ok: false, reason: 'penalty does not spend the challenged deposit outpoint' };
    }
    const deadline = Number(expect.deadlineHeight);
    if (!Number.isFinite(deadline) || deadline <= 0) return { ok: false, reason: 'deadlineHeight required' };
    if (Number(tx.locktime) !== deadline) return { ok: false, reason: `penalty nLockTime ${tx.locktime} is not the deadline ${deadline}` };
    if (Number(preSig.deadlineHeight) !== deadline) return { ok: false, reason: 'pre-signature names another deadline' };
    if (String(preSig.txid || '').toLowerCase() !== tx.getId()) return { ok: false, reason: 'pre-signature txid does not match its PSBT' };
    const destination = FraudProof._penaltyDestination(expect);
    if (destination) {
      if (!destination.scripts.length) return { ok: false, reason: `penalty destination ${destination.label} is not a valid address or script` };
      const min = destination.minValueSats;
      const pays = tx.outs.some((o) => destination.scripts.some((s) => Buffer.from(o.script).equals(s)) && (!min || Number(o.value) >= min));
      if (!pays) return { ok: false, reason: `penalty does not pay ${min ? `at least ${min} sats to ` : ''}${destination.label}` };
    }
    // The provider signs the PSBT and so chooses its leaf: only the canonical
    // 2-of-2 penalty leaf, committed to the deposit output, is a penalty.
    const penaltyLeaves = FraudProof._penaltyLeafScripts(expect.publisherPubkey, provider);
    if (!penaltyLeaves.length) return { ok: false, reason: 'publisherPubkey required to identify the penalty leaf' };
    const input = psbt.data.inputs[0];
    const leaves = input.tapLeafScript || [];
    if (!leaves.length) return { ok: false, reason: 'PSBT names no tapscript leaf' };
    if (!leaves.every((l) => penaltyLeaves.some((s) => s.equals(Buffer.from(l.script))))) {
      return { ok: false, reason: 'PSBT spends a leaf other than the penalty leaf' };
    }
    const spent = input.witnessUtxo ? Buffer.from(input.witnessUtxo.script) : null;
    if (!spent) return { ok: false, reason: 'PSBT carries no witnessUtxo for the deposit' };
    if (expect.depositAddress) {
      const scripts = FraudProof._addressScripts(expect.depositAddress);
      if (!scripts.some((s) => s.equals(spent))) return { ok: false, reason: 'penalty does not spend the deposit address' };
    }
    if (!leaves.every((l) => FraudProof._controlBlockCommits(spent, Buffer.from(l.script), Buffer.from(l.controlBlock)))) {
      return { ok: false, reason: 'control block does not commit the penalty leaf to the deposit output' };
    }
    const b = bip341();
    const leafHashes = leaves.map((l) => Buffer.from(b.tapleafHash({ output: Buffer.from(l.script), version: l.leafVersion })));
    const sigs = input.tapScriptSig || [];
    const mine = sigs.find((s) => Buffer.from(s.pubkey).toString('hex') === provider && leafHashes.some((h) => h.equals(Buffer.from(s.leafHash))));
    if (!mine) return { ok: false, reason: 'PSBT carries no provider tapscript signature on the penalty leaf' };
    let valid = false;
    try {
      valid = psbt.validateSignaturesOfInput(0, (pk, msghash, sig) => schnorr.verify(sig, msghash, pk), Buffer.from(provider, 'hex'));
    } catch (e) {
      return { ok: false, reason: `tapscript signature check failed: ${e.message}` };
    }
    if (!valid) return { ok: false, reason: 'provider tapscript signature invalid' };
    return { ok: true, txid: tx.getId(), psbt };
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
   * Evidence that `tx` reached the verifier's chain: an SPV inclusion proof
   * whose header meets its target **and** is in the verifier's header chain
   * (`ctx.headerKnown`), or the verifier's own `ctx.txConfirmed`. Without a
   * chain view nothing verifies — a header anyone can build proves nothing.
   * @private
   * @param {object} tx bitcoinjs Transaction
   * @param {object} [inclusion] `BitcoinTxInclusion` artifact
   * @param {object} ctx verifier chain view
   * @returns {{ ok: boolean, reason: (string|undefined), kind: (string|undefined), blockHash: (string|undefined) }}
   */
  static _broadcastEvidence (tx, inclusion, ctx = {}) {
    const txid = tx.getId();
    // A 64-byte transaction can masquerade as an inner Merkle node.
    if (tx.byteLength(false) === 64) return { ok: false, reason: '64-byte transaction cannot be proven by a Merkle branch' };
    if (inclusion && typeof inclusion === 'object') {
      if (String(inclusion.txid || '').toLowerCase() !== txid) return { ok: false, reason: 'inclusion artifact is for another transaction' };
      const check = verifyInclusion(inclusion);
      if (!check.ok) return { ok: false, reason: `inclusion artifact invalid: ${check.reason}` };
      if (typeof ctx.headerKnown === 'function') {
        if (!ctx.headerKnown(check.blockHash)) return { ok: false, reason: `block ${check.blockHash} is not in the verifier's header chain` };
        return { ok: true, kind: 'inclusion', blockHash: check.blockHash };
      }
      if (typeof ctx.txConfirmed === 'function') {
        if (!ctx.txConfirmed(txid)) return { ok: false, reason: 'transaction is not confirmed in the verifier\'s chain view' };
        return { ok: true, kind: 'chain-view', blockHash: check.blockHash };
      }
      return { ok: false, reason: 'chain view required: ctx.headerKnown or ctx.txConfirmed' };
    }
    if (typeof ctx.txConfirmed === 'function') {
      if (!ctx.txConfirmed(txid)) return { ok: false, reason: 'transaction is not confirmed in the verifier\'s chain view' };
      return { ok: true, kind: 'chain-view' };
    }
    return { ok: false, reason: 'broadcast evidence required: inclusion artifact with ctx.headerKnown, or ctx.txConfirmed' };
  }

  /** @private non-response absence anchored to a timelock (see class doc) */
  static _timelockedAbsence (challenge, commitment, a, ctx, fail) {
    const deadlineHeight = Number(challenge.deadlineHeight);
    if (!Number.isFinite(deadlineHeight) || deadlineHeight <= 0) return fail('absence needs a challenge with deadlineHeight — silence alone is not provable');
    const dep = challenge.deposit || {};
    if (!HEX64.test(String(dep.txid || '').toLowerCase())) return fail('challenge names no deposit outpoint');
    const check = Witness.verifyPenaltyPreSig(a.penaltyPreSig, { providerPubkey: commitment.pubkey, publisherPubkey: challenge.pubkey, deposit: dep, deadlineHeight, depositAddress: commitment.depositAddress || null });
    if (!check.ok) return fail(`penalty pre-signature: ${check.reason}`);
    const tip = ctx.tipHeight != null ? Number(ctx.tipHeight) : null;
    if (tip == null || !Number.isFinite(tip)) return fail('chain view required: ctx.tipHeight');
    if (typeof ctx.outpointUnspent !== 'function') return fail('chain view required: ctx.outpointUnspent');
    const base = {
      offender: xOnlyHex(commitment.pubkey),
      evidence: 'timelock',
      enforceableAfterHeight: deadlineHeight,
      penaltyTxid: check.txid
    };
    if (tip < deadlineHeight) return Object.assign(fail(`deadline height ${deadlineHeight} not yet reached (tip ${tip})`), base, { offender: null });
    if (!ctx.outpointUnspent(String(dep.txid).toLowerCase(), dep.vout != null ? Number(dep.vout) : 0)) {
      return Object.assign(fail('deposit outpoint was spent — the provider checked in (or was already penalized)'), base, { offender: null });
    }
    return Object.assign({ ok: true, reason: `no check-in by height ${deadlineHeight} (tip ${tip}); pre-signed penalty ${check.txid} is enforceable` }, base);
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
Witness.verifyPenaltyPreSig = FraudProof.verifyPenaltyPreSig;
Witness.FRAUD_PROOF_KINDS = FRAUD_PROOF_KINDS;

module.exports = Witness;