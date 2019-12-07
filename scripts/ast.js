'use strict';

const Compiler = require('../types/compiler');

async function main () {
  let compiler = new Compiler();
  compiler._fromJavaScript('sample.js');
}

main();
