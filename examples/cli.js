'use strict';

//const Oracle = require('./oracle');
const CLI = require('../lib/cli');

async function main () {
  const cli = new CLI({
    ui: './assets/cli.jade'
  });

  cli.start();
}

main();
