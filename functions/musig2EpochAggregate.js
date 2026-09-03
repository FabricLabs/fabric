'use strict';

/**
 * MuSig2 aggregate epoch witness — stub for a future single-signature k-of-n
 * seal. Production Beacon Federation today accumulates **independent BIP340
 * Schnorr signatures** per validator (`beaconFederationSigning.addSignature`)
 * until `threshold` is met. That is threshold Schnorr multi-sig, not MuSig2.
 *
 * @fileoverview Stub for MuSig2 beacon epoch aggregation (not yet enabled).
 * @module functions/musig2EpochAggregate
 * @see functions/beaconFederationSigning.js
 */

/**
 * @returns {{ supported: false, mode: string, message: string }}
 */
function musig2EpochAggregateStatus () {
  return {
    supported: false,
    mode: 'threshold-schnorr-accumulate',
    message: 'MuSig2 epoch aggregate not enabled; use beaconFederationSigning k-of-n BIP340 accumulation'
  };
}

/**
 * @param {object} [_round]
 * @returns {null}
 */
function tryAggregateEpochWitness (_round) {
  return null;
}

module.exports = {
  musig2EpochAggregateStatus,
  tryAggregateEpochWitness
};
