'use strict';

const settings = require('../settings/local');
const Node = require('../contracts/node');

async function main (input = {}) {
  return Node(input);
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:NODE]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:NODE]', 'Main Process Output:', output);
});
