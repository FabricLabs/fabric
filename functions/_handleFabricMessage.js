'use strict';

// Fabric Types
const Message = require('../types/message');

// Define the _handleFabricMessage
async function _handleFabricMessage (...data) {
  const message = Message.fromVector([...data]); // TODO: redefine...
  console.log('[FABRIC:MESSAGE]', message);
}

// CommonJS export
// Example:
// ```js
// const _handleFabricMessage = require('@fabric/core/functions/_handleFabricMessage');
// ```
module.exports = _handleFabricMessage;
