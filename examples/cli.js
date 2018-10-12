'use strict';

const CLI = require('../lib/cli');
const config = {
  oracle: {
    path: `./data/${process.env['NAME'] || 'cli'}`,
    port: process.env['PORT'] || 3007
  }
};

async function main () {
  const cli = new CLI(config);

  try {
    await cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }

  cli.on('changes', function (msg) {
    console.log('[MAIN:CLI]', 'changes:', msg);
  });
}

main();
