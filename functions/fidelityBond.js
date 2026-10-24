'use strict';

/**
 * @fileoverview Fidelity bonds for the coinjoin market. A maker locks coins
 * in a P2TR output that only its bond key can spend, and only after a block
 * height (`<locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <bondXOnly> OP_CHECKSIG`
 * under the NUMS internal key, so there is no key path). Locked capital is
 * costly to fake, so takers weight makers by bond value and a Sybil attacker
 * must lock coins for every identity it runs.
 *
 * The bond key signs a certificate binding the bond to the maker's offer key
 * until `certExpiresAt` (a block height), so the bond key itself can stay
 * cold. Takers check the certificate, then the UTXO on chain: unspent, the
 * expected script, confirmed. Value follows JoinMarket's formula (interest
 * on the locked amount over the lock period, decaying once the lock has
 * expired, raised to an exponent so splitting a bond across identities
 * loses value). Mainnet locktimes sit on a 4320-block grid (about a month)
 * so bonds are not fingerprinted by odd heights.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const ecc = require('../types/ecc');
const { stableStringify, jsonSafe } = require('./fabricCanonicalJson');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('./bip125');
const {
  TAPROOT_INTERNAL_NUMS,
  networkForFabricName,
  signerFromPriv32
} = require('./inventoryHtlc');

bitcoin.initEccLib(ecc);

/** Blocks in a year (10-minute blocks). */
const YEAR_BLOCKS = 52560;
const DEFAULT_INTEREST_RATE = 0.015;
const DEFAULT_EXPONENT = 1.3;
/** Mainnet bond locktimes are multiples of this height. */
const MAINNET_LOCKTIME_GRID = 4320;
/** Furthest ahead a certificate may expire: about a year. */
const DEFAULT_MAX_CERT_BLOCKS = 2016 * 26;
const DEFAULT_MIN_CONFS = 6;
/** Leaf version for BIP342 tapscript. */
const LEAF_VERSION = 0xc0;
const LOCKTIME_MAX_HEIGHT = 499999999;
const CERTIFICATE_TYPE = 'FidelityBondCertificate';
const CERTIFICATE_VERSION = 1;

/** @private */
function fail (message) {
  throw new Error(`fidelityBond: ${message}`);
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
function bondPath (index, networkName = 'regtest') {
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
function isValidLocktime (locktime, networkName = 'regtest') {
  const n = Number(locktime);
  if (!Number.isSafeInteger(n) || n < 1 || n > LOCKTIME_MAX_HEIGHT) return false;
  return !isMainnet(networkName) || n % MAINNET_LOCKTIME_GRID === 0;
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
function bondLocktimes (opts = {}) {
  const tip = intOf('tipHeight', opts.tipHeight, 0, LOCKTIME_MAX_HEIGHT);
  const count = intOf('count', opts.count == null ? 12 : opts.count, 1, 120);
  const step = isMainnet(opts.networkName) ? MAINNET_LOCKTIME_GRID : intOf('step', opts.step || MAINNET_LOCKTIME_GRID, 1, YEAR_BLOCKS * 10);
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
function buildBondP2tr (opts = {}) {
  const networkName = opts.networkName || 'regtest';
  const bondXOnly = xOnlyOf('bondPubkey', opts.bondPubkey);
  const locktime = Number(opts.locktime);
  if (!isValidLocktime(locktime, networkName)) fail(`invalid locktime ${opts.locktime} for ${networkName}`);
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
function buildBondRedeemPsbt (opts = {}) {
  const networkName = opts.networkName || 'regtest';
  const bond = opts.bond || {};
  const valueSats = intOf('bond.valueSats', bond.valueSats, 1, Number.MAX_SAFE_INTEGER);
  const fee = intOf('feeSats', opts.feeSats == null ? 500 : opts.feeSats, 1, valueSats);
  if (valueSats - fee < 330) fail('bond value after fee is dust');
  const out = buildBondP2tr({ networkName, bondPubkey: bond.bondXOnly, locktime: bond.locktime });
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
 * @param {string} psbtBase64 {@link buildBondRedeemPsbt} output
 * @param {Buffer|string} bondPriv32
 * @returns {{ txHex: string, txid: string }}
 */
function signAndExtractBondRedeem (psbtBase64, bondPriv32) {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || ''));
  psbt.signInput(0, signerFromPriv32(privOf(bondPriv32)));
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
    type: CERTIFICATE_TYPE,
    version: CERTIFICATE_VERSION,
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
function signBondCertificate (opts = {}) {
  const priv = privOf(opts.bondPrivateKey);
  const bondXOnly = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1).toString('hex');
  const fields = Object.assign({}, opts, { bondXOnly });
  const certSig = Buffer.from(ecc.signSchnorr(certificateHash(fields), priv)).toString('hex');
  return normalizeBond({
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
function normalizeBond (input = {}) {
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
function verifyBondCertificate (bond, opts = {}) {
  try {
    const b = normalizeBond(bond);
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
function bondValue (opts = {}) {
  const valueSats = Number(opts.valueSats);
  const locktime = Number(opts.locktime);
  const confirmHeight = Number(opts.confirmHeight);
  const tip = Number(opts.tipHeight);
  if (![valueSats, locktime, confirmHeight, tip].every(Number.isFinite) || valueSats <= 0) return 0;
  const r = opts.interestRate != null ? Number(opts.interestRate) : DEFAULT_INTEREST_RATE;
  const exponent = opts.exponent != null ? Number(opts.exponent) : DEFAULT_EXPONENT;
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
async function verifyFidelityBond (bond, opts = {}) {
  const bad = (reason) => ({ ok: false, reason, valueSats: 0, confirmHeight: null, value: 0 });
  let b;
  try {
    b = normalizeBond(bond);
  } catch (err) {
    return bad(err.message);
  }
  const network = String(opts.network || '').trim().toLowerCase();
  if (!isValidLocktime(b.locktime, network)) return bad('locktime not allowed on this network');
  if (!verifyBondCertificate(b, { makerPubkey: opts.makerPubkey, network })) return bad('bad certificate');
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
  const maxCert = opts.maxCertBlocks != null ? Number(opts.maxCertBlocks) : DEFAULT_MAX_CERT_BLOCKS;
  if (b.certExpiresAt > tip + maxCert) return bad('certificate runs too far ahead');
  if (!utxo) return bad('bond output is spent or unknown');
  const expected = buildBondP2tr({ networkName: network, bondPubkey: b.bondXOnly, locktime: b.locktime });
  if (String(utxo.scriptPubKeyHex || '').toLowerCase() !== expected.scriptPubKeyHex) return bad('bond output script does not match');
  const confs = Number(utxo.confirmations);
  const minConfs = opts.minConfs != null ? Number(opts.minConfs) : DEFAULT_MIN_CONFS;
  if (!Number.isSafeInteger(confs) || confs < Math.max(1, minConfs)) return bad('bond not confirmed enough');
  const valueSats = Number(utxo.valueSats);
  const confirmHeight = tip - confs + 1;
  const value = bondValue({
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
class BondVerifier {
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
   * @returns {Promise<Object>} {@link verifyFidelityBond} result
   */
  async verify (bond, makerPubkey) {
    const tip = Number(await this.settings.bitcoin.getTipHeight());
    if (tip !== this._tip) {
      this._tip = tip;
      this._cache.clear();
    }
    const key = `${bond && bond.txid}:${bond && bond.vout}:${makerPubkey}:${bond && bond.certSig}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const result = await verifyFidelityBond(bond, Object.assign({}, this.settings, { makerPubkey, tipHeight: tip }));
    this._cache.set(key, result);
    return result;
  }

  clear () {
    this._tip = null;
    this._cache.clear();
  }
}

module.exports = {
  YEAR_BLOCKS,
  DEFAULT_INTEREST_RATE,
  DEFAULT_EXPONENT,
  MAINNET_LOCKTIME_GRID,
  DEFAULT_MAX_CERT_BLOCKS,
  DEFAULT_MIN_CONFS,
  CERTIFICATE_TYPE,
  bondPath,
  isValidLocktime,
  bondLocktimes,
  buildBondP2tr,
  buildBondRedeemPsbt,
  signAndExtractBondRedeem,
  signBondCertificate,
  normalizeBond,
  verifyBondCertificate,
  bondValue,
  verifyFidelityBond,
  BondVerifier
};
