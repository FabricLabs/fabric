'use strict';

const Compiler = require('../types/compiler');

async function main () {
  const compiler = new Compiler();
  compiler._fromJavaScript('sample.js');
}

main();
