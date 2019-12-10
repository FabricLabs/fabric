'use strict';

const CLI = require('../types/cli');
const config = {
  path: `./stores/${process.env['NAME'] || 'cli'}`,
  persistent: true,
  oracle: {
    port: process.env['PORT'] || 3007
  }
};

async function main () {
  const cli = new CLI(config);

  try {
    await cli.start();
  } catch (E) {
    cli.error(`λ`, 'main()', E);
  }

  cli.on('changes', async function (msg) {
    cli.log('[MAIN:CLI]', 'cli event changes:', msg);
  });

  cli.on('state', function (msg) {
    cli.log('[MAIN:CLI]', 'state:', msg);
  });

  cli.on('state/tip', function (msg) {
    cli.log('[MAIN:CLI]', 'state/tip:', msg);
  });

  cli.on('error', function (E) {
    console.error('EXCEPTION:', E);
  });
}

main();
