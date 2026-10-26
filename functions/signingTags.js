'use strict';

/**
 * @fileoverview BIP340 tags for every string Fabric keys sign.
 * `Key#signSchnorr(msg, tag)` signs `taggedHash(tag, msg)`, so a signature
 * made for one purpose never verifies for another, nor as a plain-sha256
 * signature from another protocol. Add a tag here for every new purpose.
 * @module functions/signingTags
 */

module.exports = Object.freeze({
  // Generic `Key#sign` / `Key#verify`.
  SIGN: 'Fabric/Sign',
  // Threshold witnesses over canonical JSON naming its `kind` (Beacon epochs,
  // federation blocks, execution runs, `Federation#sign`).
  FEDERATION_WITNESS: 'Fabric/FederationWitness',
  CONTRACT_STATE: 'Fabric/ContractState',
  SIDECHAIN_STATE: 'Fabric/SidechainState',
  BLOCK_AUTHOR: 'Fabric/BlockAuthor',
  BLS_BINDING: 'Fabric/BLSBinding',
  SESSION_KEY: 'Fabric/SessionKey',
  MESSAGE_RECEIPT: 'Fabric/MessageReceipt',
  CONTRACT_WITHDRAWAL_WITNESS: 'Fabric/ContractWithdrawalWitness',
  CIRCUIT_DECISION: 'Fabric/CircuitDecision',
  GROUP_CHANGE: 'Fabric/GroupChange',
  IDENTITY_CROSS_SIGN: 'Fabric/IdentityCrossSign',
  IDENTITY_CROSS_SIGN_REVOKE: 'Fabric/IdentityCrossSignRevoke',
  DEVICE_LINK_OFFER: 'Fabric/DeviceLinkOffer',
  DEVICE_LINK: 'Fabric/DeviceLink',
  DELEGATION: 'Fabric/Delegation',
  ORACLE_ATTESTATION: 'Fabric/OracleAttestation',
  FEDERATION_INVITE: 'Fabric/FederationInvite'
});
