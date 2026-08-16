'use strict';

/**
 * @fileoverview Flagship basic demo — identity, message, Schnorr sign/verify.
 *
 * Run: `npm run example:basic`
 * Live literate page: https://fabriclabs.github.io/fabric/examples/fabric-basic-usage.html
 */

const Key = require('../types/key');
const Message = require('../types/message');

async function main () {
  const key = new Key();
  const text = 'Hello, Fabric Protocol!';

  const message = Message.fromVector(['P2P_CHAT_MESSAGE', text]);
  message.signWithKey(key);

  const ok = message.verifyWithKey(key);
  if (!ok) {
    throw new Error('signature verification failed');
  }

  const author = message.raw.author.toString('hex');
  const hash = message.raw.hash.toString('hex');
  const sig = message.raw.signature.toString('hex').slice(0, 16);

  console.log('[EXAMPLES:BASIC] pubkey (x-only author):', author.slice(0, 16) + '…');
  console.log('[EXAMPLES:BASIC] body:', text);
  console.log('[EXAMPLES:BASIC] type:', message.type);
  console.log('[EXAMPLES:BASIC] hash:', hash.slice(0, 16) + '…');
  console.log('[EXAMPLES:BASIC] signature:', sig + '…');
  console.log('[EXAMPLES:BASIC] verified:', ok);
}

main().catch((exception) => {
  console.error('[EXAMPLES:BASIC]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
