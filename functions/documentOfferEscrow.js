'use strict';

/**
 * Document-offer L1 escrow: same Taproot HTLC as inventory, with roles renamed.
 * Deliverer claims with preimage + Schnorr (seller leaf); initiator refunds after CLTV (buyer leaf).
 */

const inventoryHtlc = require('./inventoryHtlc');

function normalizeHex (label, hex, byteLen) {
  const h = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]*$/i.test(h) || h.length !== byteLen * 2) {
    throw new Error(`${label} must be ${byteLen * 2} hex characters.`);
  }
  return h.toLowerCase();
}

function paymentHashBufferFromHex (paymentHashHex) {
  const h = normalizeHex('paymentHashHex', paymentHashHex, 32);
  return Buffer.from(h, 'hex');
}

/**
 * @param {string} pubkeyHex - 33-byte compressed secp256k1 public key (hex)
 * @returns {Buffer}
 */
function compressedPubkeyBufferFromHex (pubkeyHex) {
  const h = normalizeHex('pubkeyHex', pubkeyHex, 33);
  return Buffer.from(h, 'hex');
}

/**
 * @param {object} opts
 * @param {string} opts.networkName - e.g. regtest, mainnet
 * @param {string} opts.delivererPubkeyHex - 33-byte compressed (claim path)
 * @param {string} opts.initiatorRefundPubkeyHex - 33-byte compressed (refund path)
 * @param {string} opts.paymentHashHex - SHA256(preimage), 32 bytes hex (single SHA-256)
 * @param {number} opts.refundLockHeight - block height for CLTV refund leg
 */
function buildDocumentOfferEscrow (opts = {}) {
  const built = inventoryHtlc.buildInventoryHtlcP2tr({
    networkName: opts.networkName || 'regtest',
    sellerPubkeyCompressed: compressedPubkeyBufferFromHex(opts.delivererPubkeyHex),
    buyerRefundPubkeyCompressed: compressedPubkeyBufferFromHex(opts.initiatorRefundPubkeyHex),
    paymentHash32: paymentHashBufferFromHex(opts.paymentHashHex),
    refundLocktimeHeight: Number(opts.refundLockHeight)
  });
  const hints = inventoryHtlc.buildHtlcFundingHints({
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

module.exports = {
  buildDocumentOfferEscrow,
  paymentHashBufferFromHex,
  compressedPubkeyBufferFromHex,
  inventoryHtlc
};
