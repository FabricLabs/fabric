'use strict';

/**
 * @fileoverview P2TR (BIP 341) script-path hash time-locked contract: one
 * output, two leaves, over the NUMS internal key (no key-path spend).
 *
 *   - Claim: `OP_SHA256 <paymentHash> OP_EQUALVERIFY <claimX> OP_CHECKSIG`
 *     (the preimage plus the claimer's Schnorr signature)
 *   - Refund: `<lock> OP_CHECKLOCKTIMEVERIFY OP_DROP <refundX> OP_CHECKSIG`
 *     (the refunder's signature once the chain reaches `lock`)
 *
 * Leaves come from {@link Policy} (`buildHashlockLeaf`, `buildSpendLeaf`,
 * `composeTaprootTree`), so an HTLC is one composition of the contract tree
 * builders. Inventory sales, document-offer escrow, fidelity
 * bonds, channels, and liquidity swaps all use this one shape.
 *
 * **Payment hash / preimage (binding):** for document sales always go through
 * `functions/documentPaymentHash` (`resolveDocumentContentHashHex`).
 * - **Sealed (priced):** preimage = content key `K`; paymentHash = SHA256(K).
 * - **Legacy unsealed envelope:** preimage = SHA256(**unsigned**
 *   `documentPublishEnvelopeBuffer` bytes) — never a Schnorr-signed gossip
 *   frame; paymentHash = SHA256(preimage) (`purchaseContentHashHex`).
 *
 * Browser-safe: no `fs` / `net` (the Hub bundles it for in-browser claims).
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('./ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const {
  TAPROOT_INTERNAL_NUMS,
  networkForFabricName,
  buildHashlockLeaf,
  buildSpendLeaf,
  composeTaprootTree,
  buildControlBlockForLeaf
} = require('./policy');
const { taprootPsbtInputFields } = require('../functions/bip371');
const { toBuffer } = require('../functions/bytes');
const { encodeBitcoinUri } = require('./wallet/bip21');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('../functions/bip125');

bitcoin.initEccLib(ecc);

/** Smallest output the claim / refund transaction may pay. */
const DUST_SATS = 546;
/** Fee used when a spend names none. */
const DEFAULT_FEE_SATS = 1000;
/** BIP65: lock values at or above this are unix times, not heights. */
const LOCKTIME_THRESHOLD = 500000000;

/** @private */
function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * @private
 * @param {*} pubkey33 compressed key (Buffer / Uint8Array / hex)
 * @returns {Buffer|null} 32-byte x-only key
 */
function xOnlyOf (pubkey33) {
  let key;
  try {
    key = toBuffer(pubkey33);
  } catch (_) {
    return null;
  }
  if (key.length !== 33) return null;
  if (key[0] !== 0x02 && key[0] !== 0x03) return null;
  return key.subarray(1, 33);
}

/**
 * The funded HTLC output and the destination amount after the fee.
 * @private
 */
function fundedOutput ({ networkName, fundedTxHex, paymentAddress, feeSats }) {
  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = Htlc.findVout(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid HTLC output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || DEFAULT_FEE_SATS)));
  const destSats = inputSats - fee;
  if (destSats < DUST_SATS) throw new Error('Amount after fee is below dust threshold; lower fee or fund more sats.');
  return { network, tx, vout, out, inputSats, fee, destSats };
}

/**
 * Sign input 0 on its tapleaf and finalize with `[sig, ...extra, script, control]`.
 * @private
 */
function signLeafAndExtract (psbt, priv, extra) {
  psbt.signInput(0, Htlc.signerFromPriv32(priv));
  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    const lh = Buffer.from(bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion }));
    const tss = (input.tapScriptSig || []).find((t) => Buffer.from(t.leafHash).equals(lh));
    if (!tss) throw new Error('Missing tapscript signature.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, ...extra, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });
  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

class Htlc {
  /**
   * @param {Object} settings
   * @param {string} [settings.network] Fabric network name (`regtest`, `signet`, `testnet`, `mainnet`)
   * @param {Buffer|string} settings.claimPubkey 33-byte compressed key of the claimer (seller / deliverer)
   * @param {Buffer|string} settings.refundPubkey 33-byte compressed key of the refunder (buyer / initiator)
   * @param {Buffer|string} settings.paymentHash SHA256(preimage), 32 bytes
   * @param {number} settings.refundLocktime CLTV block height for the refund leaf
   */
  constructor (settings = {}) {
    const networkName = settings.network;
    if (!xOnlyOf(settings.claimPubkey) || !xOnlyOf(settings.refundPubkey)) {
      throw new Error('Invalid compressed public keys (expect 33-byte 02/03).');
    }
    const paymentHash = toBuffer(settings.paymentHash, 'paymentHash');
    if (paymentHash.length !== 32) throw new Error('paymentHash must be 32 bytes.');
    const lock = Number(settings.refundLocktime);
    if (!Number.isInteger(lock) || lock < 1 || lock >= LOCKTIME_THRESHOLD) {
      throw new Error('refundLocktime must be a valid block height (< 500000000).');
    }

    const claimPubkeyHex = toBuffer(settings.claimPubkey).toString('hex');
    const refundPubkeyHex = toBuffer(settings.refundPubkey).toString('hex');
    const claim = buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHash.toString('hex'), pubkeyHex: claimPubkeyHex });
    const refund = buildSpendLeaf({ id: 'refund', keys: [refundPubkeyHex], threshold: 1, after: { type: 'cltv', height: lock } });
    const tree = composeTaprootTree({
      network: networkName || 'mainnet',
      leaves: [claim, refund],
      internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex')
    });

    this.networkName = String(networkName || '');
    this.network = networkForFabricName(this.networkName);
    this.claimPubkeyHex = claimPubkeyHex;
    this.refundPubkeyHex = refundPubkeyHex;
    this.paymentHash = Buffer.from(paymentHash);
    this.refundLocktime = lock;
    this.address = tree.address;
    this.output = Buffer.from(tree.output);
    this.claimScript = Buffer.from(claim.script);
    this.refundScript = Buffer.from(refund.script);
    this.merkleRootHex = tree.merkleRootHex;
    this._leaves = tree.leafScripts;
  }

  /** @returns {string} */
  get paymentHashHex () {
    return this.paymentHash.toString('hex');
  }

  /**
   * BIP-341 control block for one leaf.
   * @param {string} leaf `claim` or `refund`
   * @returns {Buffer}
   */
  controlBlock (leaf) {
    if (leaf !== 'claim' && leaf !== 'refund') throw new Error('Htlc: leaf must be "claim" or "refund"');
    const leafScript = leaf === 'claim' ? this.claimScript : this.refundScript;
    return buildControlBlockForLeaf(this._leaves, leafScript, TAPROOT_INTERNAL_NUMS);
  }

  /**
   * @param {Transaction} tx bitcoinjs-lib transaction
   * @returns {number} the output paying this HTLC, or -1
   */
  findVout (tx) {
    return Htlc.findVout(tx, this.address, this.network);
  }

  /**
   * BIP21 URI and display amount for funding this HTLC.
   * @param {Object} [opts]
   * @param {number} [opts.amountSats]
   * @param {string} [opts.label]
   * @returns {{ amountBtc: string, bitcoinUri: string, label: (string|undefined) }}
   */
  fundingHints (opts = {}) {
    return Htlc.fundingHints(Object.assign({}, opts, { paymentAddress: this.address }));
  }

  /**
   * Unsigned claim PSBT (see {@link Htlc.prepareClaimPsbt}).
   * @param {Object} opts `{ fundedTxHex, preimage, destinationAddress, feeSats }`
   * @returns {Object}
   */
  prepareClaim (opts = {}) {
    return Htlc.prepareClaimPsbt(Object.assign({}, this._spendBase(), opts, { preimage32: opts.preimage }));
  }

  /**
   * Unsigned refund PSBT (see {@link Htlc.prepareRefundPsbt}).
   * @param {Object} opts `{ fundedTxHex, destinationAddress, feeSats }`
   * @returns {Object}
   */
  prepareRefund (opts = {}) {
    return Htlc.prepareRefundPsbt(Object.assign({}, this._spendBase(), { refundLocktimeHeight: this.refundLocktime }, opts));
  }

  /** @private */
  _spendBase () {
    return {
      networkName: this.networkName,
      paymentAddress: this.address,
      claimScript: this.claimScript,
      refundScript: this.refundScript
    };
  }

  /** @returns {Object} public description (no secrets) */
  toJSON () {
    return {
      type: 'Htlc',
      network: this.networkName,
      address: this.address,
      claimPubkeyHex: this.claimPubkeyHex,
      refundPubkeyHex: this.refundPubkeyHex,
      paymentHashHex: this.paymentHashHex,
      refundLocktime: this.refundLocktime,
      claimScriptHex: this.claimScript.toString('hex'),
      refundScriptHex: this.refundScript.toString('hex'),
      merkleRootHex: this.merkleRootHex
    };
  }

  /**
   * bitcoinjs-lib Signer for taproot script-path (publicKey + sign + signSchnorr).
   * @param {Buffer|string} priv32
   * @returns {Object}
   */
  static signerFromPriv32 (priv32) {
    const priv = toBuffer(priv32, 'priv32');
    if (priv.length !== 32) throw new Error('Private key must be 32 bytes.');
    const publicKey = ecc.pointFromScalar(priv, true);
    if (!publicKey) throw new Error('Invalid private key (pointFromScalar failed).');
    return {
      publicKey: Buffer.from(publicKey),
      sign (hash) {
        return Buffer.from(ecc.sign(hash, priv));
      },
      signSchnorr (hash) {
        return Buffer.from(ecc.signSchnorr(hash, priv));
      }
    };
  }

  /** @returns {Buffer} a fresh 32-byte preimage */
  static randomPreimage () {
    return crypto.randomBytes(32);
  }

  /**
   * Single SHA-256 (the HTLC hashlock).
   * @param {Buffer} buf
   * @returns {Buffer}
   */
  static sha256 (buf) {
    return sha256(buf);
  }

  /**
   * Normalize compressed (66 hex) or x-only (64 hex) pubkey to lowercase x-only hex.
   * @param {string|Buffer|null|undefined} pk
   * @returns {string|null}
   */
  static toXOnly (pk) {
    if (pk == null) return null;
    if (Buffer.isBuffer(pk)) {
      if (pk.length === 32) return pk.toString('hex');
      if (pk.length === 33 && (pk[0] === 0x02 || pk[0] === 0x03)) {
        return pk.subarray(1).toString('hex');
      }
      return null;
    }
    let s = String(pk).trim().toLowerCase();
    if (s.startsWith('0x')) s = s.slice(2);
    if (/^[0-9a-f]{64}$/.test(s)) return s;
    if (/^[0-9a-f]{66}$/.test(s) && (s.startsWith('02') || s.startsWith('03'))) return s.slice(2);
    return null;
  }

  /**
   * @param {string|Buffer|null|undefined} a
   * @param {string|Buffer|null|undefined} b
   * @returns {boolean} same x-only key
   */
  static pubkeysMatchXOnly (a, b) {
    const xa = Htlc.toXOnly(a);
    const xb = Htlc.toXOnly(b);
    return !!(xa && xb && xa === xb);
  }

  /**
   * Find the vout paying exactly `paymentAddress`.
   * @param {Transaction} tx bitcoinjs-lib transaction
   * @param {string} paymentAddress
   * @param {Object} network bitcoinjs network
   * @returns {number} -1 when absent
   */
  static findVout (tx, paymentAddress, network) {
    const addr = String(paymentAddress || '').trim();
    if (!addr) return -1;
    const want = Buffer.from(bitcoin.address.toOutputScript(addr, network));
    for (let i = 0; i < tx.outs.length; i++) {
      const sc = tx.outs[i].script;
      if (sc && Buffer.from(sc).equals(want)) return i;
    }
    return -1;
  }

  /**
   * Control block for one leaf of the two-leaf tree `[claimScript, refundScript]`.
   * @param {Buffer|string} claimScript
   * @param {Buffer|string} refundScript
   * @param {Buffer|string} leafScript
   * @returns {Buffer}
   */
  static controlBlockFor (claimScript, refundScript, leafScript) {
    const claim = toBuffer(claimScript, 'claimScript');
    const refund = toBuffer(refundScript, 'refundScript');
    const leaf = toBuffer(leafScript, 'leafScript');
    try {
      return buildControlBlockForLeaf([{ script: claim }, { script: refund }], leaf, TAPROOT_INTERNAL_NUMS);
    } catch (err) {
      if (/not in tap tree/.test(err.message)) throw new Error('Leaf script not found in HTLC tap tree.');
      throw err;
    }
  }

  /**
   * BIP21 `bitcoin:` URI and display amounts so wallets can pre-fill the funding send.
   * @param {Object} opts
   * @param {string} opts.paymentAddress Bech32m P2TR address
   * @param {number} opts.amountSats
   * @param {string} [opts.label] shortened for the URI
   * @returns {{ amountBtc: string, bitcoinUri: string, label: (string|undefined) }}
   */
  static fundingHints ({ paymentAddress, amountSats, label = '' } = {}) {
    const addr = String(paymentAddress || '').trim();
    const sats = Math.round(Number(amountSats || 0));
    if (!addr || !Number.isFinite(sats) || sats <= 0) {
      return { amountBtc: '', bitcoinUri: '', label: label || undefined };
    }
    const amountBtc = (sats / 100000000).toFixed(8);
    const lab = String(label || '').trim().slice(0, 120);
    const bitcoinUri = encodeBitcoinUri({
      address: addr,
      amount: amountBtc,
      label: lab || undefined
    });
    return { amountBtc, bitcoinUri, ...(lab ? { label: lab } : {}) };
  }

  /**
   * Unsigned PSBT spending the funded HTLC through the claim leaf.
   * @param {Object} opts `{ networkName, fundedTxHex, paymentAddress, claimScript, refundScript, preimage32, destinationAddress, feeSats }`
   * @returns {Object} bundle for {@link Htlc.signClaim}
   */
  static prepareClaimPsbt (opts = {}) {
    const { network, tx, vout, out, inputSats, fee, destSats } = fundedOutput(opts);
    const claimBuf = toBuffer(opts.claimScript, 'claimScript');
    const refundBuf = toBuffer(opts.refundScript, 'refundScript');
    const preimage = toBuffer(opts.preimage32, 'preimage32');
    if (preimage.length !== 32) throw new Error('preimage must be 32 bytes.');

    const controlBlock = Htlc.controlBlockFor(claimBuf, refundBuf, claimBuf);
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: tx.getId(),
      index: vout,
      witnessUtxo: { script: out.script, value: BigInt(inputSats) },
      ...taprootPsbtInputFields({
        tapInternalKey: TAPROOT_INTERNAL_NUMS,
        script: claimBuf,
        controlBlock,
        leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
      })
    });
    psbt.addOutput({ address: String(opts.destinationAddress || '').trim(), value: BigInt(destSats) });
    return { psbt, preimage32: preimage, claimScript: claimBuf, vout, inputSats, destSats, fee };
  }

  /**
   * Sign a claim bundle with the claimer's key; witness
   * `[schnorr_sig, preimage, script, control_block]`.
   * @param {Object} bundle from {@link Htlc.prepareClaimPsbt}
   * @param {Buffer|string} priv32
   * @returns {{ txHex: string, txid: string }}
   */
  static signClaim (bundle, priv32) {
    if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
    const priv = toBuffer(priv32, 'priv32');
    if (priv.length !== 32) throw new Error('Seller private key must be 32 bytes.');
    return signLeafAndExtract(bundle.psbt, priv, [toBuffer(bundle.preimage32, 'preimage32')]);
  }

  /**
   * Unsigned PSBT spending the funded HTLC through the refund leaf: nLockTime
   * is the lock height and the input sequence enables it.
   * @param {Object} opts `{ networkName, fundedTxHex, paymentAddress, claimScript, refundScript, refundLocktimeHeight, destinationAddress, feeSats }`
   * @returns {Object} bundle for {@link Htlc.signRefund}
   */
  static prepareRefundPsbt (opts = {}) {
    const { network, tx, vout, out, inputSats, fee, destSats } = fundedOutput(opts);
    const claimBuf = toBuffer(opts.claimScript, 'claimScript');
    const refundBuf = toBuffer(opts.refundScript, 'refundScript');
    const lock = Number(opts.refundLocktimeHeight);
    if (!Number.isFinite(lock) || lock < 1) throw new Error('refundLocktimeHeight is required.');

    const controlBlock = Htlc.controlBlockFor(claimBuf, refundBuf, refundBuf);
    const psbt = new bitcoin.Psbt({ network });
    psbt.setLocktime(lock);
    psbt.addInput({
      hash: tx.getId(),
      index: vout,
      sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
      witnessUtxo: { script: out.script, value: BigInt(inputSats) },
      ...taprootPsbtInputFields({
        tapInternalKey: TAPROOT_INTERNAL_NUMS,
        script: refundBuf,
        controlBlock,
        leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
      })
    });
    psbt.addOutput({ address: String(opts.destinationAddress || '').trim(), value: BigInt(destSats) });
    return { psbt, claimScript: claimBuf, refundScript: refundBuf, vout, inputSats, destSats, fee, locktime: lock };
  }

  /**
   * Sign a refund bundle with the refunder's key; witness `[schnorr_sig, script, control_block]`.
   * @param {Object} bundle from {@link Htlc.prepareRefundPsbt}
   * @param {Buffer|string} priv32
   * @returns {{ txHex: string, txid: string }}
   */
  static signRefund (bundle, priv32) {
    if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
    const priv = toBuffer(priv32, 'priv32');
    if (priv.length !== 32) throw new Error('Buyer private key must be 32 bytes.');
    return signLeafAndExtract(bundle.psbt, priv, []);
  }

  /**
   * The 32-byte witness item whose SHA256 is `paymentHash`.
   * @param {Array<Buffer|string>|undefined} witness
   * @param {Buffer|string} paymentHash32
   * @returns {Buffer|null}
   */
  static extractPreimageFromWitness (witness, paymentHash32) {
    let want;
    try {
      want = toBuffer(paymentHash32);
    } catch (_) {
      return null;
    }
    if (want.length !== 32) return null;
    for (const item of Array.isArray(witness) ? witness : []) {
      let buf;
      try {
        buf = toBuffer(item);
      } catch (_) {
        continue;
      }
      if (buf.length !== 32) continue;
      if (sha256(buf).equals(want)) return Buffer.from(buf);
    }
    return null;
  }

  /**
   * Scan a claim transaction for the preimage (the content key for sealed sales).
   * @param {(string|Transaction)} txHexOrTx Raw hex, or a bitcoinjs-lib transaction
   * @param {string|Buffer} paymentHashHex
   * @returns {{ ok: boolean, preimage32: (Buffer|undefined), preimageHex: (string|undefined), vin: (number|undefined), error: (string|undefined) }}
   */
  static extractPreimage (txHexOrTx, paymentHashHex) {
    let tx;
    try {
      tx = typeof txHexOrTx === 'string'
        ? bitcoin.Transaction.fromHex(String(txHexOrTx).trim())
        : txHexOrTx;
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'invalid tx' };
    }
    if (!tx || !Array.isArray(tx.ins)) return { ok: false, error: 'invalid transaction' };
    const hashHex = Buffer.isBuffer(paymentHashHex)
      ? paymentHashHex.toString('hex')
      : String(paymentHashHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hashHex)) return { ok: false, error: 'paymentHashHex must be 64 hex chars' };
    for (let vin = 0; vin < tx.ins.length; vin++) {
      const input = tx.ins[vin];
      const preimage = Htlc.extractPreimageFromWitness(input && input.witness, hashHex);
      if (preimage) return { ok: true, preimage32: preimage, preimageHex: preimage.toString('hex'), vin };
    }
    return { ok: false, error: 'preimage not found in claim witnesses' };
  }

  /**
   * @param {number} tipHeight
   * @param {number} refundLocktimeHeight
   * @returns {boolean} the refund leaf is spendable at `tipHeight`
   */
  static refundMature (tipHeight, refundLocktimeHeight) {
    const tip = Math.round(Number(tipHeight));
    const lock = Math.round(Number(refundLocktimeHeight));
    if (!Number.isFinite(tip) || !Number.isFinite(lock) || lock < 1) return false;
    return tip >= lock;
  }

  /**
   * Rebuild a buyer-bound HTLC and check a seller-advertised address against
   * it. A seller-supplied address is never authoritative without a match.
   * @param {Object} opts constructor settings, plus:
   * @param {string} [opts.paymentAddress] seller-advertised address
   * @returns {Object} `{ ok: true, htlc }` or `{ ok: false, error, expectedAddress, htlc }`
   */
  static validateOffer (opts = {}) {
    let htlc;
    try {
      htlc = new Htlc(opts);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    const offered = opts.paymentAddress != null ? String(opts.paymentAddress).trim() : '';
    if (offered && offered !== htlc.address) {
      return {
        ok: false,
        error: 'Seller HTLC paymentAddress does not match buyer-bound P2TR script — refusing to fund',
        expectedAddress: htlc.address,
        htlc
      };
    }
    return { ok: true, htlc };
  }
}

Htlc.DUST_SATS = DUST_SATS;

module.exports = Htlc;
module.exports.Htlc = Htlc;
