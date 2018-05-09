'use strict';

import Fabric from '../';

async function main () {
  const cli = new Fabric.CLI();

  cli.oracle.define('Message', {
    routes: {
      list: '/messages',
      get: '/messages/:id'
    }
  });

  try {
    cli.start();
    // cli.oracle.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }
}

main();
