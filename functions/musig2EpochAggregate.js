'use strict';

/**
 * MuSig2 aggregate epoch witness — **explicit stub**, not a production seal.
 *
 * Do not treat this module as a finished MuSig2 path. Production Beacon
 * Federation accumulates **independent BIP340 Schnorr signatures** per
 * validator (`beaconFederationSigning.addSignature`) until `threshold` is met
 * (threshold multi-sig). A future MuSig2 single-sig aggregate would replace
 * `tryAggregateEpochWitness` and flip `supported` — until then both exports
 * advertise incompleteness so agents do not invent callers around a no-op.
 *
 * @fileoverview Stub only — MuSig2 beacon epoch aggregation is NOT enabled.
 * @module functions/musig2EpochAggregate
 * @see functions/beaconFederationSigning.js
 * @see docs/SIGNATURE_PROOF_MODEL.md
 */

/**
 * @returns {{ supported: false, mode: string, message: string, incomplete: true }}
 */
function musig2EpochAggregateStatus () {
  return {
    supported: false,
    incomplete: true,
    mode: 'threshold-schnorr-accumulate',
    message: 'MuSig2 epoch aggregate not enabled; use beaconFederationSigning k-of-n BIP340 accumulation'
  };
}

/**
 * Always returns null. Callers must use {@link module:functions/beaconFederationSigning}.
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
