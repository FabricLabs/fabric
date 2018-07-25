'use strict';

import Fabric from '../';

const Swarm = require('../lib/swarm');

const config = {
  oracle: {
    path: `./data/${process.env['NAME'] || 'cli'}`,
    port: process.env['PORT'] || 3007
  }
};

async function main () {
  const cli = new Fabric.CLI(config);

  try {
    await cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }

  cli.oracle.on('changes', function (changes) {
    cli.debug('MAIN', 'received changes:', changes);
    cli.swarm.self.broadcast(changes);
  });

  cli.oracle.on('/messages', function (msg) {
    // TODO: standardize an API for addressable messages in Oracle/HTTP
    // console.log('MAIN', 'received message:', msg);
  });
}

main();
