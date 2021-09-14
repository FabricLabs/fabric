'use strict';

const fs = require('fs');
const Compiler = require('../types/compiler');
const target = process.argv[2] || './contracts/node.js';
const data = fs.readFileSync(target);

async function main () {
  const compiler = Compiler._fromJavaScript(data);
  console.log('[SCRIPTS:AST]', compiler);
}

main().catch((exception) => {
  console.error('[SCRIPTS:AST]', 'Main Process Exception:', exception);
});
