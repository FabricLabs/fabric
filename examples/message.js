#!/usr/bin/env node
'use strict';

// Dependencies
const Message = require('../types/message');

// Main Process
async function main () {
  // Create Message instance
  const message = Message.fromVector(['GenericMessage', '"Hello, world!"']);

  // Return generic Object
  return {
    message: message,
    raw: message.asRaw()
  };
}

// Execution
main().catch((exception) => {
  console.error('[EXAMPLES:MESSAGE]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[EXAMPLES:MESSAGE]', 'Main Process Output:', output);
});
