#!/usr/bin/env node
'use strict';

const Message = require('../types/message');

async function main () {
  const message = Message.fromVector(['GenericMessage', '"Hello, world!"']);
  return {
    message: message,
    raw: message.asRaw()
  };
}

main().catch((exception) => {
  console.error('[EXAMPLES:MESSAGE]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[EXAMPLES:MESSAGE]', 'Main Process Output:', output);
});