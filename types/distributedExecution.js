'use strict';

/**
 * @deprecated Not a Fabric type. Prefer:
 * - `functions/fabricCanonicalJson` (jsonSafe / stableStringify)
 * - `functions/beaconFederationSigning` (epoch signing / federation verify)
 * - `functions/fabricProgramManifest` / `Machine.parseManifest` (manifest v1)
 * - `types/program` + `types/machine` for execution
 *
 * Thin re-export kept for one release so Hub / older requires keep working.
 */

const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const beaconFederationSigning = require('../functions/beaconFederationSigning');
const { parseProgramManifestV1, parseDistributedManifestV1 } = require('../functions/fabricProgramManifest');

module.exports = {
  stableStringify: fabricCanonicalJson.stableStringify || fabricCanonicalJson,
  jsonSafe: fabricCanonicalJson.jsonSafe,
  signingStringForBeaconEpoch: beaconFederationSigning.signingStringForBeaconEpoch,
  epochCommitmentDigestHex: beaconFederationSigning.epochCommitmentDigestHex,
  verifyFederationWitnessOnMessage: beaconFederationSigning.verifyFederationWitnessOnMessage,
  parseDistributedManifestV1,
  parseProgramManifestV1,
  BEACON_EPOCH_SIGNING_KIND: beaconFederationSigning.BEACON_EPOCH_SIGNING_KIND
};
