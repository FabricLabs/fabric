'use strict';

import Fabric from '../';

async function main () {
  const cli = new Fabric.CLI();

  // TODO: move to lib/chat.js
  cli.oracle.define('Message', {
    routes: {
      list: '/messages',
      get: '/messages/:id'
    }
  });

  try {
    await cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }
}

main();
