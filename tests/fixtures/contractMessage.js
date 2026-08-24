'use strict';

const Message = require('../../types/message');

/**
 * Shared CONTRACT_MESSAGE wire-format signer for contract queue/accumulate suites.
 * @param {Key} key
 * @param {string} contractId
 * @param {string} type
 * @param {object} object
 * @returns {Message}
 */
function signContractMessage (key, contractId, type, object) {
  const body = JSON.stringify({
    contract: contractId,
    type,
    object
  });
  return Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key);
}

module.exports = {
  signContractMessage
};
