'use strict';

const CLI = require('../lib/cli');
const config = {
  path: `./data/${process.env['NAME'] || 'cli'}`,
  oracle: {
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
    cli.log('[MAIN:CLI]', 'changes:', msg);
  });

  cli.on('state', function (msg) {
    console.log('[MAIN:CLI]', 'state:', msg);
  });

  cli.on('state/tip', function (msg) {
    console.log('[MAIN:CLI]', 'state/tip:', msg);
  });
}

main();
