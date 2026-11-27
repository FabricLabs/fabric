'use strict';

const Collection = require('../types/collection');
const Message = require('../types/message');

async function main () {
  const collection = new Collection();

  await collection.create({ label: 'hello-fabric-demo' });
  const items = await collection.list();
  const count = Array.isArray(items) ? items.length : Object.keys(items || {}).length;

  const message = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
    type: 'DemoMessage',
    object: {
      count
    }
  })]);

  console.log('[EXAMPLES:DEMO]', 'items:', count);
  console.log('[EXAMPLES:DEMO]', 'message type:', message.type);
}

main().catch((exception) => {
  console.error('[EXAMPLES:DEMO]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
