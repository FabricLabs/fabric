'use strict';

/**
 * @fileoverview State tree of pre-signed, timelocked exits for a Fabric
 * contract whose state advances off-chain (payment channels, provider
 * deposits, …). A state is **resolvable** when every exit it depends on
 * carries all required signatures, so either party can close it on L1 without
 * the counterparty's cooperation. Contracts refuse to treat a state as live
 * until it is resolvable — "lack of response" then always has an on-chain
 * answer (BOLT 2's funding_signed-before-broadcast, generalised).
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');

const Actor = require('./actor');
const Tree = require('./tree');
const Witness = require('./witness');
const ecc = require('./ecc');
const { signerFromPriv32 } = require('../functions/inventoryHtlc');
const { networkForFabricName } = require('../functions/contractTaproot');

const HEX64 = /^[0-9a-f]{64}$/;
const HEX66 = /^[0-9a-f]{66}$/;

/** Exit kinds. */
const EXIT_KINDS = Object.freeze({
  TIMEOUT: 'timeout',
  PENALTY: 'penalty',
  REFUND: 'refund',
  COMMITMENT: 'commitment',
  CHECKIN: 'checkin'
});

/** `CONTRACT_MESSAGE` body carrying one exit signature. */
const EXIT_SIGNATURE_TYPE = 'ContractExitSignature';

/**
 * Normalise a compressed (66) or x-only (64) hex pubkey to x-only lowercase.
 * @private
 * @param {string} pubkey
 * @returns {string}
 */
function xOnly (pubkey) {
  const s = String(pubkey || '').trim().toLowerCase();
  if (HEX66.test(s)) return s.slice(2);
  if (HEX64.test(s)) return s;
  throw new Error(`Resolutions: pubkey must be 32/33-byte hex, got ${s.length / 2} bytes`);
}

/**
 * Tapleaf hash of input 0's first `tapLeafScript` entry.
 * @private
 * @param {Object} psbt bitcoinjs Psbt
 * @returns {Buffer}
 */
function leafHashOf (psbt) {
  const input = psbt.data.inputs[0];
  const leaf = input && input.tapLeafScript && input.tapLeafScript[0];
  if (!leaf) throw new Error('Resolutions: exit PSBT input 0 carries no tapLeafScript');
  return bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
}

/**
 * State tree of pre-signed exits. Pure data plus Schnorr verification; no I/O.
 * @class Resolutions
 * @extends Actor
 */
class Resolutions extends Actor {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] Fabric network name
   * @param {Object} [settings.states] import snapshot (`export()` output)
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ network: 'regtest' }, settings);
    /** @type {Map<string, { parent: string|null, exits: Map<string, Object> }>} */
    this._states = new Map();
    if (settings.states) this.import({ states: settings.states });
    return this;
  }

  static get KINDS () { return EXIT_KINDS; }
  static get EXIT_SIGNATURE_TYPE () { return EXIT_SIGNATURE_TYPE; }

  /** @returns {string[]} known state ids (insertion order). */
  get stateIds () { return Array.from(this._states.keys()); }

  /**
   * Declare a state node (idempotent).
   * @param {string} stateId
   * @param {string|null} [parent] parent state id (tree edge)
   * @returns {Resolutions}
   */
  declare (stateId, parent = null) {
    const id = String(stateId);
    if (!this._states.has(id)) this._states.set(id, { parent: parent != null ? String(parent) : null, exits: new Map() });
    return this;
  }

  /**
   * Register an exit a state depends on. Signatures already present on the
   * PSBT are harvested into `signers.have`.
   * @param {string} stateId
   * @param {Object} exit
   * @param {string} exit.id unique within the state
   * @param {string} exit.kind one of {@link Resolutions.KINDS}
   * @param {string} exit.psbtBase64 unsigned (or partially signed) tapscript spend, input 0
   * @param {string[]} exit.required pubkeys (compressed or x-only hex) whose signatures make it broadcastable
   * @param {Object} [exit.locktime] `{ height }` (nLockTime / CLTV) and/or `{ csv }` (relative)
   * @param {Object} [exit.spends] `{ txid, vout }` the exit consumes
   * @param {Object} [exit.meta] free-form (never secrets)
   * @returns {Object} stored exit record
   */
  addExit (stateId, exit = {}) {
    const id = String(stateId);
    this.declare(id);
    if (!exit || !exit.id) throw new Error('addExit: exit.id required');
    if (!Object.values(EXIT_KINDS).includes(exit.kind)) throw new Error(`addExit: unknown exit kind ${exit.kind}`);
    if (!exit.psbtBase64) throw new Error('addExit: psbtBase64 required');
    const required = Array.from(new Set((exit.required || []).map(xOnly)));
    if (!required.length) throw new Error('addExit: at least one required signer');
    const psbt = this._psbt(exit.psbtBase64);
    const tx = psbt.__CACHE.__TX;
    const input = tx.ins[0];
    const record = {
      id: String(exit.id),
      kind: exit.kind,
      psbtBase64: psbt.toBase64(),
      txid: tx.getId(),
      locktime: Object.assign({}, exit.locktime || {}, tx.locktime > 0 && !(exit.locktime && exit.locktime.height) ? { height: tx.locktime } : {}),
      spends: exit.spends || (input ? { txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index } : null),
      signers: { required, have: {} },
      meta: exit.meta || {}
    };
    for (const s of (psbt.data.inputs[0].tapScriptSig || [])) {
      const pk = Buffer.from(s.pubkey).toString('hex');
      if (required.includes(pk)) record.signers.have[pk] = Buffer.from(s.signature).toString('hex');
    }
    this._states.get(id).exits.set(record.id, record);
    return record;
  }

  /**
   * @param {string} stateId
   * @param {string} exitId
   * @returns {Object|null}
   */
  getExit (stateId, exitId) {
    const node = this._states.get(String(stateId));
    return node ? node.exits.get(String(exitId)) || null : null;
  }

  /**
   * Sign an exit with a 32-byte private key and record the signature.
   * @param {string} stateId
   * @param {string} exitId
   * @param {Buffer|string} priv32
   * @returns {Object} `ContractExitSignature` artifact (JSON-safe) for the counterparty
   */
  signExit (stateId, exitId, priv32) {
    const exit = this._exitOrThrow(stateId, exitId);
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    if (priv.length !== 32) throw new Error('signExit: 32-byte private key required');
    const pubkey = Witness.xOnlyPubkeyHex(priv);
    if (!exit.signers.required.includes(pubkey)) throw new Error('signExit: key is not a required signer of this exit');
    const psbt = this._psbt(exit.psbtBase64);
    psbt.signInput(0, signerFromPriv32(priv));
    const sig = (psbt.data.inputs[0].tapScriptSig || []).find((s) => Buffer.from(s.pubkey).toString('hex') === pubkey);
    if (!sig) throw new Error('signExit: signer produced no tapscript signature');
    const signatureHex = Buffer.from(sig.signature).toString('hex');
    exit.signers.have[pubkey] = signatureHex;
    return Witness.signArtifact({
      type: EXIT_SIGNATURE_TYPE,
      version: 1,
      contractId: this.settings.contractId || null,
      stateId: String(stateId),
      exitId: String(exitId),
      txid: exit.txid,
      signerPubkey: pubkey,
      exitSignature: signatureHex
    }, priv);
  }

  /**
   * Accept a counterparty's `ContractExitSignature` artifact after verifying
   * both the artifact signature and the tapscript signature it carries.
   * @param {Object} artifact output of {@link Resolutions#signExit}
   * @returns {{ ok: boolean, reason: (string|undefined), stateId: (string|undefined), exitId: (string|undefined) }}
   */
  ingest (artifact) {
    if (!artifact || artifact.type !== EXIT_SIGNATURE_TYPE) return { ok: false, reason: 'not a ContractExitSignature' };
    if (!Witness.verifyArtifact(artifact)) return { ok: false, reason: 'artifact signature invalid' };
    if (String(artifact.signerPubkey).toLowerCase() !== String(artifact.pubkey).toLowerCase()) return { ok: false, reason: 'artifact signer differs from exit signer' };
    if (this.settings.contractId && artifact.contractId && String(artifact.contractId) !== String(this.settings.contractId)) {
      return { ok: false, reason: 'artifact names another contract' };
    }
    const exit = this.getExit(artifact.stateId, artifact.exitId);
    if (!exit) return { ok: false, reason: 'unknown exit' };
    if (exit.txid !== String(artifact.txid || '').toLowerCase()) return { ok: false, reason: 'signature is on a different transaction' };
    const pubkey = String(artifact.signerPubkey).toLowerCase();
    if (!exit.signers.required.includes(pubkey)) return { ok: false, reason: 'signer is not required by this exit' };
    const check = this._verifySignature(exit, pubkey, String(artifact.exitSignature || ''));
    if (!check.ok) return check;
    exit.signers.have[pubkey] = String(artifact.exitSignature).toLowerCase();
    return { ok: true, stateId: String(artifact.stateId), exitId: String(artifact.exitId) };
  }

  /**
   * Re-verify every held signature on an exit against its PSBT.
   * @param {string} stateId
   * @param {string} exitId
   * @returns {{ ok: boolean, reason: (string|undefined), missing: Array<string> }}
   */
  verifyExit (stateId, exitId) {
    const exit = this._exitOrThrow(stateId, exitId);
    for (const [pubkey, sig] of Object.entries(exit.signers.have)) {
      const check = this._verifySignature(exit, pubkey, sig);
      if (!check.ok) return Object.assign(check, { missing: this.missingSigners(exit) });
    }
    const missing = this.missingSigners(exit);
    return missing.length ? { ok: false, reason: `missing ${missing.length} signature(s)`, missing } : { ok: true, missing };
  }

  /**
   * @param {Object} exit
   * @returns {string[]} required x-only pubkeys without a held signature
   */
  missingSigners (exit) {
    return exit.signers.required.filter((pk) => !exit.signers.have[pk]);
  }

  /**
   * A state is resolvable when it (and every ancestor it inherits exits from)
   * holds all required signatures on all exits.
   * @param {string} stateId
   * @returns {boolean}
   */
  resolvable (stateId) {
    return this.missing(stateId).length === 0;
  }

  /**
   * What still has to be exchanged before `stateId` is live.
   * @param {string} stateId
   * @returns {Array<{ stateId: string, exitId: string, kind: string, missing: string[] }>}
   */
  missing (stateId) {
    const out = [];
    let id = String(stateId);
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      seen.add(id);
      const node = this._states.get(id);
      if (!node) { out.push({ stateId: id, exitId: null, kind: null, missing: ['state not declared'] }); break; }
      for (const exit of node.exits.values()) {
        const missing = this.missingSigners(exit);
        if (missing.length) out.push({ stateId: id, exitId: exit.id, kind: exit.kind, missing });
      }
      id = node.parent;
    }
    return out;
  }

  /**
   * Exits that become broadcastable at or after `height` (absolute locks only).
   * @param {number} height
   * @param {string} [stateId] restrict to one state
   * @returns {Object[]}
   */
  exitsAfter (height, stateId = null) {
    const h = Number(height);
    const out = [];
    for (const [id, node] of this._states) {
      if (stateId != null && id !== String(stateId)) continue;
      for (const exit of node.exits.values()) {
        const lock = exit.locktime && exit.locktime.height != null ? Number(exit.locktime.height) : 0;
        if (lock <= h) out.push(Object.assign({ stateId: id }, exit));
      }
    }
    return out;
  }

  /**
   * Fully-signed exit as a broadcastable transaction.
   * @param {string} stateId
   * @param {string} exitId
   * @returns {{ txHex: string, txid: string }}
   */
  finalizeExit (stateId, exitId) {
    const exit = this._exitOrThrow(stateId, exitId);
    const missing = this.missingSigners(exit);
    if (missing.length) throw new Error(`finalizeExit: missing ${missing.length} signature(s)`);
    const psbt = this._withSignatures(exit, exit.signers.have);
    const { finalizeSpendPsbt } = require('../functions/contractTaproot');
    return finalizeSpendPsbt({ psbt });
  }

  /**
   * Bitcoin-style Merkle tree over `SHA256(stateId|exitId|txid)` for audit.
   * @returns {Tree}
   */
  toTree () {
    const leaves = [];
    for (const [id, node] of this._states) {
      for (const exit of node.exits.values()) {
        leaves.push(crypto.createHash('sha256').update(`${id}|${exit.id}|${exit.txid}`).digest('hex'));
      }
    }
    return new Tree({ leaves, sortLeaves: true });
  }

  /** @returns {string} hex Merkle root (empty tree → 64 zeros). */
  get rootHex () {
    const tree = this.toTree();
    return tree.settings.leaves.length ? tree.rootHex : '0'.repeat(64);
  }

  /** @returns {Object} JSON-safe snapshot (no private material). */
  export () {
    const states = {};
    for (const [id, node] of this._states) {
      states[id] = { parent: node.parent, exits: Array.from(node.exits.values()).map((e) => JSON.parse(JSON.stringify(e))) };
    }
    return { type: 'ContractResolutions', version: 1, network: this.settings.network, states };
  }

  /**
   * @param {Object} snapshot output of {@link Resolutions#export}
   * @returns {Resolutions}
   */
  import (snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.states) return this;
    for (const [id, node] of Object.entries(snapshot.states)) {
      this.declare(id, node.parent);
      for (const exit of node.exits || []) {
        const record = this.addExit(id, Object.assign({}, exit, { required: exit.signers ? exit.signers.required : exit.required }));
        if (exit.signers && exit.signers.have) Object.assign(record.signers.have, exit.signers.have);
      }
    }
    return this;
  }

  // -- private ---------------------------------------------------------------

  /** @private */
  _psbt (base64) {
    return bitcoin.Psbt.fromBase64(String(base64), { network: networkForFabricName(this.settings.network) });
  }

  /** @private */
  _exitOrThrow (stateId, exitId) {
    const exit = this.getExit(stateId, exitId);
    if (!exit) throw new Error(`Resolutions: unknown exit ${stateId}/${exitId}`);
    return exit;
  }

  /** @private */
  _withSignatures (exit, have) {
    const psbt = this._psbt(exit.psbtBase64);
    const leafHash = leafHashOf(psbt);
    const existing = new Set((psbt.data.inputs[0].tapScriptSig || []).map((s) => Buffer.from(s.pubkey).toString('hex')));
    const add = [];
    for (const [pubkey, sig] of Object.entries(have)) {
      if (existing.has(pubkey)) continue;
      add.push({ pubkey: Buffer.from(pubkey, 'hex'), leafHash, signature: Buffer.from(sig, 'hex') });
    }
    if (add.length) psbt.updateInput(0, { tapScriptSig: add });
    return psbt;
  }

  /** @private */
  _verifySignature (exit, pubkey, signatureHex) {
    if (!/^[0-9a-f]{128}$/i.test(signatureHex) && !/^[0-9a-f]{130}$/i.test(signatureHex)) return { ok: false, reason: 'exit signature is not a Schnorr signature' };
    try {
      const psbt = this._withSignatures(exit, { [pubkey]: signatureHex.toLowerCase() });
      const ok = psbt.validateSignaturesOfInput(0, (pk, msghash, sig) => ecc.verifySchnorr(msghash, pk, sig), Buffer.from(pubkey, 'hex'));
      return ok ? { ok: true } : { ok: false, reason: 'invalid tapscript signature' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
}

module.exports = Resolutions;
