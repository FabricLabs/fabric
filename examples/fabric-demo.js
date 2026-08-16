'use strict';

/**
 * @fileoverview Library integration demo — collection + signed chat message round-trip.
 *
 * Run: `npm run example:demo`
 * Live literate page: https://fabriclabs.github.io/fabric/examples/fabric-demo.html
 */

const Collection = require('../types/collection');
const Key = require('../types/key');
const Message = require('../types/message');
const { chatTextOf, formatChatLogLine } = require('../functions/fabricChatText');

async function main () {
  const key = new Key();
  const collection = new Collection();

  await collection.create({
    label: 'hello-fabric-demo',
    note: 'signed-chat-demo'
  });
  const items = await collection.list();
  const count = Array.isArray(items) ? items.length : Object.keys(items || {}).length;

  const body = `Demo item count is ${count}`;
  const message = Message.fromVector(['P2P_CHAT_MESSAGE', body]);
  message.signWithKey(key);

  if (!message.verifyWithKey(key)) {
    throw new Error('signed demo message failed verification');
  }

  const author = message.raw.author.toString('hex');
  const line = formatChatLogLine(author, 'demo', chatTextOf({ text: body }));

  console.log('[EXAMPLES:DEMO] items:', count);
  console.log('[EXAMPLES:DEMO] message type:', message.type);
  console.log('[EXAMPLES:DEMO] verified:', true);
  console.log('[EXAMPLES:DEMO] shoutbox:', line);
}

main().catch((exception) => {
  console.error('[EXAMPLES:DEMO]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
