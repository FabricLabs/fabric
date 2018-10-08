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

  cli.oracle.on('changes', function (changes) {
    console.log('[MAIN:CLI]', 'received changes:', changes);
  });

  cli.oracle.on('/messages', function (msg) {
    // TODO: standardize an API for addressable messages in Oracle/HTTP
    console.log('[MAIN:CLI]', 'received message:', msg);
  });
}

main();
