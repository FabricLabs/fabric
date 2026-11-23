'use strict';

const Message = require('../../types/message');

/**
 * Shared CONTRACT_MESSAGE (field body) signer for contract queue/accumulate suites.
 * @param {Key} key
 * @param {string} contractId
 * @param {string} type
 * @param {object} object
 * @returns {Message}
 */
function signContractMessage (key, contractId, type, object) {
  return Message.fromLegacyBody('CONTRACT_MESSAGE', {
    contract: contractId,
    type,
    object
  }).signWithKey(key);
}

module.exports = {
  signContractMessage
};
