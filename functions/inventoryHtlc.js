'use strict';

/**
 * P2TR (BIP 341) script-path HTLC for inventory → paid document transfer.
 * Internal key is a fixed NUMS point; spending uses either:
 *   - Claim: sha256(preimage) == paymentHash, seller Schnorr signature
 *   - Refund: CLTV lock height, buyer signature
 *
 * **Payment hash / preimage (binding):** always go through
 * `@fabric/core/functions/documentPaymentHash` (`resolveDocumentContentHashHex`).
 *
 * - **Sealed (priced):** preimage = content key `K`; paymentHash = SHA256(K).
 * - **Legacy unsealed envelope:** preimage = SHA256(**unsigned**
 *   `documentPublishEnvelopeBuffer` bytes) — never a Schnorr-signed gossip frame;
 *   paymentHash = SHA256(preimage) (`purchaseContentHashHex`).
 *
 * Phase-2 AES-GCM for sealed docs uses `K`; legacy envelope path may use the
 * envelope-derived 32-byte preimage as the content key only when unsealed.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const { payments, networks, script, Psbt } = bitcoin;
const { encodeBitcoinUri } = require('./bip21');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('./bip125');

bitcoin.initEccLib(ecc);

/** bitcoinjs-lib Signer for taproot script-path (publicKey + sign + signSchnorr). */
function signerFromPriv32 (priv32) {
  const priv = asBuffer(priv32);
  if (!priv || priv.length !== 32) throw new Error('Private key must be 32 bytes.');
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

/** BIP341-style NUMS x-only internal key (nothing-up-my-sleeve). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return networks.regtest;
  if (n === 'testnet' || n === 'signet') return networks.testnet;
  return networks.bitcoin;
}

/** Coerce Buffer / Uint8Array / hex string to Buffer (bitcoinjs-lib 7 uses Uint8Array). */
function asBuffer (value, encoding = 'hex') {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, encoding);
  return null;
}

/** BIP-341 leaf version for tapscript (0xc0). */
const LEAF_VERSION_TAPSCRIPT = 0xc0;

/**
 * One BIP-371 `PSBT_IN_TAP_LEAF_SCRIPT` entry (script + control block + leaf version).
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.script
 * @param {Buffer|Uint8Array|string} opts.controlBlock
 * @param {number} [opts.leafVersion]
 * @returns {{ leafVersion: number, script: Buffer, controlBlock: Buffer }}
 */
function tapLeafScriptEntry (opts = {}) {
  const script = asBuffer(opts.script);
  const controlBlock = asBuffer(opts.controlBlock);
  if (!script || !script.length) {
    throw new Error('BIP371 tapLeafScript requires script bytes');
  }
  if (!controlBlock || controlBlock.length < 33 ||
      controlBlock.length > 33 + (32 * 128) ||
      ((controlBlock.length - 33) % 32) !== 0) {
    throw new Error('BIP371 controlBlock length must be 33 + 32*m bytes');
  }
  const leafVersion = opts.leafVersion != null
    ? Number(opts.leafVersion)
    : LEAF_VERSION_TAPSCRIPT;
  if (!Number.isInteger(leafVersion) || leafVersion < 0 || leafVersion > 255) {
    throw new Error('BIP371 leafVersion must be an 8-bit integer');
  }
  if ((leafVersion & 1) !== 0) {
    throw new Error('BIP371 leafVersion must be even (BIP-341 leaf version + parity bit)');
  }
  if ((controlBlock[0] & 0xfe) !== leafVersion) {
    throw new Error('BIP371 leafVersion must match the control block');
  }
  return { leafVersion, script, controlBlock };
}

/**
 * Taproot PSBT input fields for a script-path spend (BIP-371 bags).
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|string} opts.tapInternalKey 32-byte x-only internal key
 * @param {Buffer|Uint8Array|string} opts.script
 * @param {Buffer|Uint8Array|string} opts.controlBlock
 * @param {number} [opts.leafVersion]
 * @param {Buffer|Uint8Array|string} [opts.tapMerkleRoot]
 * @returns {Object}
 */
function taprootPsbtInputFields (opts = {}) {
  const tapInternalKey = asBuffer(opts.tapInternalKey);
  if (!tapInternalKey || tapInternalKey.length !== 32) {
    throw new Error('BIP371 tapInternalKey must be 32 bytes (x-only)');
  }
  const fields = {
    tapInternalKey,
    tapLeafScript: [tapLeafScriptEntry(opts)]
  };
  if (opts.tapMerkleRoot != null && opts.tapMerkleRoot !== '') {
    const tapMerkleRoot = asBuffer(opts.tapMerkleRoot);
    if (!tapMerkleRoot || tapMerkleRoot.length !== 32) {
      throw new Error('BIP371 tapMerkleRoot must be 32 bytes');
    }
    fields.tapMerkleRoot = tapMerkleRoot;
  }
  return fields;
}

function toXOnly (pubkey33) {
  const key = asBuffer(pubkey33);
  if (!key || key.length !== 33) return null;
  if (key[0] !== 0x02 && key[0] !== 0x03) return null;
  return key.subarray(1, 33);
}

function buildInventoryHtlcP2tr (opts = {}) {
  const {
    networkName,
    sellerPubkeyCompressed,
    buyerRefundPubkeyCompressed,
    refundLocktimeHeight
  } = opts;

  const sellerX = toXOnly(sellerPubkeyCompressed);
  const buyerX = toXOnly(buyerRefundPubkeyCompressed);
  if (!sellerX || !buyerX) throw new Error('Invalid compressed public keys (expect 33-byte 02/03).');
  const paymentHash32 = asBuffer(opts.paymentHash32);
  if (!paymentHash32 || paymentHash32.length !== 32) {
    throw new Error('paymentHash32 must be a 32-byte Buffer.');
  }
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1 || lock >= 500000000) {
    throw new Error('refundLocktimeHeight must be a valid block height (< 500000000).');
  }

  const claimScript = script.compile([
    script.OPS.OP_SHA256,
    paymentHash32,
    script.OPS.OP_EQUALVERIFY,
    sellerX,
    script.OPS.OP_CHECKSIG
  ]);

  const refundScript = script.compile([
    script.number.encode(lock),
    script.OPS.OP_CHECKLOCKTIMEVERIFY,
    script.OPS.OP_DROP,
    buyerX,
    script.OPS.OP_CHECKSIG
  ]);

  const scriptTree = [{ output: claimScript }, { output: refundScript }];
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree,
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr() did not produce address/output.');

  return {
    address: pay.address,
    // bitcoinjs may yield Uint8Array; Hub/tests and Transaction.addOutput expect Buffer.
    output: asBuffer(pay.output),
    claimScript: asBuffer(claimScript),
    refundScript: asBuffer(refundScript),
    paymentHashHex: paymentHash32.toString('hex')
  };
}

function randomPreimage32 () {
  return crypto.randomBytes(32);
}

function hash256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * BIP21 bitcoin: URI and display amounts so wallets can pre-fill send-to Taproot (bc1p / bcrt1 / tb1).
 * @param {Object} opts
 * @param {string} opts.paymentAddress - Bech32m P2TR address
 * @param {number} opts.amountSats - Invoice amount in satoshis
 * @param {string} [opts.label] - Optional label (shortened for URI)
 * @returns {{ amountBtc: string, bitcoinUri: string, label: (string|undefined) }}
 */
function buildHtlcFundingHints ({ paymentAddress, amountSats, label = '' }) {
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
 * Find vout index paying exactly `paymentAddress` (P2TR script match).
 */
function findP2trVoutForAddress (tx, paymentAddress, network) {
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
 * Control block for spending a given tapleaf in the standard two-leaf HTLC tree
 * [claimScript, refundScript] (same order as {@link buildInventoryHtlcP2tr}).
 */
function buildTapLeafControlBlock (claimScript, refundScript, leafScript) {
  const claimBuf = asBuffer(claimScript);
  const refundBuf = asBuffer(refundScript);
  const leafBuf = asBuffer(leafScript);
  if (!claimBuf || !refundBuf || !leafBuf) throw new Error('Invalid HTLC tapleaf script bytes.');
  const scriptTree = [{ output: claimBuf }, { output: refundBuf }];
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: leafBuf, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Leaf script not found in HTLC tap tree.');
  const outputKey = bip341.tweakKey(TAPROOT_INTERNAL_NUMS, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed for HTLC script path.');
  return Buffer.concat([
    Buffer.from([leafVersion | outputKey.parity]),
    TAPROOT_INTERNAL_NUMS,
    ...path
  ]);
}

function buildClaimControlBlock (claimScript, refundScript) {
  const claimBuf = asBuffer(claimScript);
  if (!claimBuf) throw new Error('Invalid claim script bytes.');
  return buildTapLeafControlBlock(claimBuf, refundScript, claimBuf);
}

/**
 * Build unsigned PSBT spending the funded HTLC UTXO via the seller claim leaf (hashlock + CHECKSIG).
 * @param {Object} opts
 * @returns {Object} bundle for {@link signAndExtractInventoryHtlcSellerClaim}
 */
function prepareInventoryHtlcSellerClaimPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    paymentAddress,
    claimScript,
    refundScript,
    preimage32,
    destinationAddress,
    feeSats
  } = opts;

  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid HTLC output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust threshold; lower fee or fund more sats.');

  const claimBuf = asBuffer(claimScript);
  const refundBuf = asBuffer(refundScript);
  const preimage = asBuffer(preimage32);
  if (!claimBuf || !refundBuf) throw new Error('Invalid HTLC script bytes.');
  if (!preimage || preimage.length !== 32) throw new Error('preimage must be 32 bytes.');

  const controlBlock = buildClaimControlBlock(claimBuf, refundBuf);
  const psbt = new Psbt({ network });
  psbt.addInput({
    hash: tx.getId(),
    index: vout,
    witnessUtxo: {
      script: out.script,
      value: BigInt(inputSats)
    },
    ...taprootPsbtInputFields({
      tapInternalKey: TAPROOT_INTERNAL_NUMS,
      script: claimBuf,
      controlBlock,
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
    })
  });
  psbt.addOutput({
    address: String(destinationAddress || '').trim(),
    value: BigInt(destSats)
  });

  return {
    psbt,
    preimage32: preimage,
    claimScript: claimBuf,
    vout,
    inputSats,
    destSats,
    fee
  };
}

/**
 * Sign with seller secp256k1 private key (32 bytes) and finalize witness:
 * [schnorr_sig, preimage, script, control_block] per BIP341 script path.
 */
function signAndExtractInventoryHtlcSellerClaim (bundle, sellerPriv32) {
  if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
  const priv = asBuffer(sellerPriv32);
  if (!priv || priv.length !== 32) throw new Error('Seller private key must be 32 bytes.');
  const { psbt, preimage32 } = bundle;
  psbt.signInput(0, signerFromPriv32(priv));

  const preimage = asBuffer(preimage32);
  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    const lh = Buffer.from(bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion }));
    const tss = (input.tapScriptSig || []).find((t) => Buffer.from(t.leafHash).equals(lh));
    if (!tss) throw new Error('Missing tapscript signature.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, preimage, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

/**
 * Build unsigned PSBT spending the funded HTLC UTXO via the buyer/initiator refund leaf (CLTV + CHECKSIG).
 * Spending tx must use nLockTime ≥ refundLocktimeHeight and input sequence ≠ 0xffffffff.
 */
function prepareInventoryHtlcBuyerRefundPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    paymentAddress,
    claimScript,
    refundScript,
    refundLocktimeHeight,
    destinationAddress,
    feeSats
  } = opts;

  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid HTLC output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust threshold; lower fee or fund more sats.');

  const claimBuf = asBuffer(claimScript);
  const refundBuf = asBuffer(refundScript);
  if (!claimBuf || !refundBuf) throw new Error('Invalid HTLC script bytes.');
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1) throw new Error('refundLocktimeHeight is required.');

  const controlBlock = buildTapLeafControlBlock(claimBuf, refundBuf, refundBuf);
  const psbt = new Psbt({ network });
  psbt.setLocktime(lock);
  psbt.addInput({
    hash: tx.getId(),
    index: vout,
    sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
    witnessUtxo: {
      script: out.script,
      value: BigInt(inputSats)
    },
    ...taprootPsbtInputFields({
      tapInternalKey: TAPROOT_INTERNAL_NUMS,
      script: refundBuf,
      controlBlock,
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
    })
  });
  psbt.addOutput({
    address: String(destinationAddress || '').trim(),
    value: BigInt(destSats)
  });

  return {
    psbt,
    claimScript: claimBuf,
    refundScript: refundBuf,
    vout,
    inputSats,
    destSats,
    fee,
    locktime: lock
  };
}

/**
 * Sign with buyer secp256k1 private key (32 bytes) and finalize witness for refund leaf:
 * [schnorr_sig, script, control_block].
 */
function signAndExtractInventoryHtlcBuyerRefund (bundle, buyerPriv32) {
  if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
  const priv = asBuffer(buyerPriv32);
  if (!priv || priv.length !== 32) throw new Error('Buyer private key must be 32 bytes.');
  const { psbt } = bundle;
  psbt.signInput(0, signerFromPriv32(priv));

  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    const lh = Buffer.from(bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion }));
    const tss = (input.tapScriptSig || []).find((t) => Buffer.from(t.leafHash).equals(lh));
    if (!tss) throw new Error('Missing tapscript signature.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

/**
 * Find a 32-byte witness stack item whose SHA256 equals paymentHash.
 * Seller claim witness is typically [schnorr_sig, preimage, script, control_block].
 *
 * @param {Array<Buffer|string>|undefined} witness
 * @param {Buffer|string} paymentHash32
 * @returns {Buffer|null}
 */
function extractPreimageFromWitnessStack (witness, paymentHash32) {
  const want = asBuffer(paymentHash32) || Buffer.from(String(paymentHash32 || '').trim(), 'hex');
  if (want.length !== 32) return null;
  const wantHex = want.toString('hex');
  const stack = Array.isArray(witness) ? witness : [];
  for (const item of stack) {
    let buf = asBuffer(item);
    if (!buf && typeof item === 'string') {
      try { buf = Buffer.from(item, 'hex'); } catch (_) { continue; }
    }
    if (!buf || buf.length !== 32) continue;
    if (hash256(buf).toString('hex') === wantHex) return Buffer.from(buf);
  }
  return null;
}

/**
 * Scan a claim transaction for the HTLC preimage (content key for sealed sales).
 *
 * @param {string|import('bitcoinjs-lib').Transaction} txHexOrTx
 * @param {string|Buffer} paymentHashHex
 * @returns {{ ok: boolean, preimage32?: Buffer, preimageHex?: string, vin?: number, error?: string }}
 */
function extractPreimageFromClaimTx (txHexOrTx, paymentHashHex) {
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
    const witness = input && input.witness;
    const preimage = extractPreimageFromWitnessStack(witness, hashHex);
    if (preimage) {
      return {
        ok: true,
        preimage32: preimage,
        preimageHex: preimage.toString('hex'),
        vin
      };
    }
  }
  return { ok: false, error: 'preimage not found in claim witnesses' };
}

/**
 * True when chain tip height is high enough for the buyer refund leaf.
 * @param {number} tipHeight
 * @param {number} refundLocktimeHeight
 */
function refundLocktimeMature (tipHeight, refundLocktimeHeight) {
  const tip = Math.round(Number(tipHeight));
  const lock = Math.round(Number(refundLocktimeHeight));
  if (!Number.isFinite(tip) || !Number.isFinite(lock) || lock < 1) return false;
  return tip >= lock;
}

function normalizeHex (label, hex, byteLen) {
  const h = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]*$/i.test(h) || h.length !== byteLen * 2) {
    throw new Error(`${label} must be ${byteLen * 2} hex characters.`);
  }
  return h.toLowerCase();
}

/**
 * Document-offer L1 escrow: same Taproot HTLC as inventory, with roles renamed.
 * Deliverer claims with preimage + Schnorr (seller leaf); initiator refunds after CLTV (buyer leaf).
 *
 * @param {object} opts
 * @param {string} opts.networkName - e.g. regtest, mainnet
 * @param {string} opts.delivererPubkeyHex - 33-byte compressed (claim path)
 * @param {string} opts.initiatorRefundPubkeyHex - 33-byte compressed (refund path)
 * @param {string} opts.paymentHashHex - SHA256(preimage), 32 bytes hex
 * @param {number} opts.refundLockHeight - block height for CLTV refund leg
 * @param {number} [opts.amountSats]
 * @param {string} [opts.label]
 */
function buildDocumentOfferEscrow (opts = {}) {
  const paymentHashHex = normalizeHex('paymentHashHex', opts.paymentHashHex, 32);
  const delivererHex = normalizeHex('pubkeyHex', opts.delivererPubkeyHex, 33);
  const initiatorHex = normalizeHex('pubkeyHex', opts.initiatorRefundPubkeyHex, 33);
  const built = buildInventoryHtlcP2tr({
    networkName: opts.networkName || 'regtest',
    sellerPubkeyCompressed: Buffer.from(delivererHex, 'hex'),
    buyerRefundPubkeyCompressed: Buffer.from(initiatorHex, 'hex'),
    paymentHash32: Buffer.from(paymentHashHex, 'hex'),
    refundLocktimeHeight: Number(opts.refundLockHeight)
  });
  const hints = buildHtlcFundingHints({
    paymentAddress: built.address,
    amountSats: Math.round(Number(opts.amountSats || 0)),
    label: String(opts.label || 'document-offer').slice(0, 120)
  });
  return {
    paymentAddress: built.address,
    claimScriptHex: built.claimScript.toString('hex'),
    refundScriptHex: built.refundScript.toString('hex'),
    paymentHashHex: built.paymentHashHex,
    amountBtc: hints.amountBtc,
    bitcoinUri: hints.bitcoinUri
  };
}

/**
 * Normalize compressed (66 hex) or x-only (64 hex) pubkey to lowercase x-only hex.
 * @param {string|Buffer|null|undefined} pk
 * @returns {string|null}
 */
function toXOnlyPubkeyHex (pk) {
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
 * @returns {boolean}
 */
function pubkeysMatchXOnly (a, b) {
  const xa = toXOnlyPubkeyHex(a);
  const xb = toXOnlyPubkeyHex(b);
  return !!(xa && xb && xa === xb);
}

/**
 * Rebuild buyer-bound P2TR and optionally verify a seller-advertised paymentAddress.
 * Never treat seller-supplied address as authoritative without a match.
 *
 * @param {object} opts
 * @param {string} opts.networkName
 * @param {Buffer|string} opts.sellerPubkeyCompressed
 * @param {Buffer|string} opts.buyerRefundPubkeyCompressed
 * @param {Buffer|string} opts.paymentHash32
 * @param {number} opts.refundLocktimeHeight
 * @param {string} [opts.paymentAddress] seller-advertised address (optional)
 * @returns {{ ok: true, built: object } | { ok: false, error: string, expectedAddress?: string, built?: object }}
 */
function validateInventoryHtlcOffer (opts = {}) {
  let seller = opts.sellerPubkeyCompressed;
  let buyer = opts.buyerRefundPubkeyCompressed;
  let hash = opts.paymentHash32;
  try {
    if (!Buffer.isBuffer(seller)) seller = Buffer.from(String(seller || ''), 'hex');
    if (!Buffer.isBuffer(buyer)) buyer = Buffer.from(String(buyer || ''), 'hex');
    if (!Buffer.isBuffer(hash)) hash = Buffer.from(String(hash || ''), 'hex');
  } catch (e) {
    return { ok: false, error: `Invalid HTLC key/hash material: ${e.message}` };
  }
  let built;
  try {
    built = buildInventoryHtlcP2tr({
      networkName: opts.networkName || 'regtest',
      sellerPubkeyCompressed: seller,
      buyerRefundPubkeyCompressed: buyer,
      paymentHash32: hash,
      refundLocktimeHeight: Number(opts.refundLocktimeHeight)
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  const offered = opts.paymentAddress != null ? String(opts.paymentAddress).trim() : '';
  if (offered && offered !== built.address) {
    return {
      ok: false,
      error: 'Seller HTLC paymentAddress does not match buyer-bound P2TR script — refusing to fund',
      expectedAddress: built.address,
      built
    };
  }
  return { ok: true, built };
}

module.exports = {
  LEAF_VERSION_TAPSCRIPT,
  tapLeafScriptEntry,
  taprootPsbtInputFields,
  buildInventoryHtlcP2tr,
  buildHtlcFundingHints,
  buildDocumentOfferEscrow,
  validateInventoryHtlcOffer,
  toXOnlyPubkeyHex,
  pubkeysMatchXOnly,
  randomPreimage32,
  hash256,
  networkForFabricName,
  TAPROOT_INTERNAL_NUMS,
  findP2trVoutForAddress,
  buildTapLeafControlBlock,
  buildClaimControlBlock,
  prepareInventoryHtlcSellerClaimPsbt,
  signAndExtractInventoryHtlcSellerClaim,
  prepareInventoryHtlcBuyerRefundPsbt,
  signAndExtractInventoryHtlcBuyerRefund,
  extractPreimageFromWitnessStack,
  extractPreimageFromClaimTx,
  refundLocktimeMature
};
