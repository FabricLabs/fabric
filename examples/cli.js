'use strict';

import Fabric from '../';

//const Oracle = require('./oracle');
//const CLI = require('../lib/cli');

async function main () {
  const cli = new Fabric.CLI({
    ui: './assets/cli.jade'
  });

  cli.oracle.define('Chat', {
    routes: {
      query: '/chats'
    }
  });

  try {
    cli.start();
    cli.oracle.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }
}

main();
