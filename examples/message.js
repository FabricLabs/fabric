#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Message wire demo — create, sign, verify, dump size.
 *
 * Run: `node examples/message.js`
 */

const Key = require('../types/key');
const Message = require('../types/message');

async function main () {
  const key = new Key();
  const message = Message.fromVector(['P2P_BASE_MESSAGE', 'Hello, world!']);
  message.signWithKey(key);

  const verified = message.verifyWithKey(key);
  if (!verified) throw new Error('message signature invalid');

  const raw = message.asRaw();
  return {
    type: message.type,
    verified,
    author: message.raw.author.toString('hex').slice(0, 16) + '…',
    hash: message.raw.hash.toString('hex').slice(0, 16) + '…',
    bytes: Buffer.isBuffer(raw) ? raw.length : 0
  };
}

main().catch((exception) => {
  console.error('[EXAMPLES:MESSAGE]', 'Main Process Exception:', exception);
  process.exitCode = 1;
}).then((output) => {
  if (output) console.log('[EXAMPLES:MESSAGE]', 'Main Process Output:', output);
});
