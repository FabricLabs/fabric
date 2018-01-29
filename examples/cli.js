'use strict';

import Fabric from '../';

//const Oracle = require('./oracle');
//const CLI = require('../lib/cli');

async function main () {
  const cli = new Fabric.CLI({
    ui: './assets/cli.jade'
  });

  try {
    cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }
}

main();
