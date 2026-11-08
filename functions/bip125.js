/**
 * BIP-125 opt-in full replace-by-fee signaling via nSequence.
 *
 * A transaction opts in if **any** input has nSequence &lt; 0xffffffff − 1.
 * `0xfffffffe` is non-final (enables nLockTime / CLTV) but does **not**
 * signal RBF. Wallets that want both typically use `0xfffffffd` (MAX − 2).
 *
 * @fileoverview BIP-125 RBF nSequence helpers.
 * @module functions/bip125
 */
'use strict';

/** nSequence / nLockTime maximum (2^32 − 1). */
const SEQUENCE_MAX = (2 ** 32) - 1;
/** Final sequence (does not enable nLockTime; does not signal BIP-125 RBF). */
const BIP125_SEQUENCE_FINAL = SEQUENCE_MAX;
/**
 * Non-final for nLockTime / CLTV, does **not** opt in to BIP-125 RBF.
 * Used by inventory HTLC refund spends.
 */
const BIP125_SEQUENCE_LOCKTIME_ONLY = SEQUENCE_MAX - 1;
/** Common wallet RBF sequence (MAX − 2). */
const BIP125_SEQUENCE_RBF = SEQUENCE_MAX - 2;

/**
 * BIP-125: nSequence &lt; 0xfffffffe opts this input into replace-by-fee.
 *
 * @param {number} nSequence
 * @returns {boolean}
 */
function sequenceSignalsOptInRbf (nSequence) {
  const n = Number(nSequence);
  if (!Number.isInteger(n) || n < 0 || n > SEQUENCE_MAX) return false;
  return n < BIP125_SEQUENCE_LOCKTIME_ONLY;
}

/**
 * True when any input's nSequence signals BIP-125 RBF.
 *
 * @param {Array<{sequence: (number|undefined), nSequence: (number|undefined)}>} inputs
 * @returns {boolean}
 */
function transactionSignalsOptInRbf (inputs) {
  if (!Array.isArray(inputs) || !inputs.length) return false;
  for (const inp of inputs) {
    const seq = inp && (inp.sequence != null ? inp.sequence : inp.nSequence);
    if (sequenceSignalsOptInRbf(seq)) return true;
  }
  return false;
}

module.exports = {
  SEQUENCE_MAX,
  BIP125_SEQUENCE_FINAL,
  BIP125_SEQUENCE_LOCKTIME_ONLY,
  BIP125_SEQUENCE_RBF,
  sequenceSignalsOptInRbf,
  transactionSignalsOptInRbf
};
