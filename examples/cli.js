'use strict';

require('debug-trace')({ always: true });

//const Oracle = require('./oracle');
const CLI = require('../lib/cli');

async function main () {
  const cli = new CLI({
    ui: './assets/cli.jade'
  });

  cli.start(function () {
    //cli.viewer.document.page[0].item[0].donut[0].data[0].m[0]['$'].percent = 50;
    //cli.viewer.renderPage(0);
  });
}

main();
