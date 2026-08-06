'use strict';

const Fabric = require('../');

async function main () {
  const fabric = new Fabric();
  const address = (fabric && typeof fabric.address !== 'undefined') ? fabric.address : '(not-set)';

  console.log('[EXAMPLES:BASIC]', 'id:', fabric.id);
  console.log('[EXAMPLES:BASIC]', 'address:', address);
  console.log('[EXAMPLES:BASIC]', 'clock:', fabric.clock);
}

main().catch((exception) => {
  console.error('[EXAMPLES:BASIC]', 'Main Process Exception:', exception);
  process.exitCode = 1;
});
