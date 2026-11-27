'use strict';

/**
 * Sign one chat message and verify it with the same key.
 * Run: node examples/fabric-basic-usage.js
 *
 * Leaf imports: types/key, types/message. See PUBLIC_API.md.
 */

const Key = require('../types/key');
const Message = require('../types/message');

function fail (message) {
  console.error('[EXAMPLES:BASIC]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function main () {
  const key = new Key();
  const message = Message.fromVector(['P2P_CHAT_MESSAGE', 'Hello, Fabric.']);
  message.signWithKey(key);

  if (message.verifyWithKey(key) !== true) fail('signature did not verify');
  if (message.parent !== Message.ZERO_PARENT) fail('a new message should have a genesis parent');

  console.log('[EXAMPLES:BASIC]', 'author', message.author.slice(0, 16) + '…');
  console.log('[EXAMPLES:BASIC]', 'type', message.type);
  console.log('[EXAMPLES:BASIC]', 'verified', true);
}

main();
