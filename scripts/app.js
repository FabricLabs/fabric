#!/usr/bin/env node
'use strict';

const settings = require('../settings/local');
const Environment = require('../types/environment');
const OP_SHELL = require('../contracts/shell');

async function main () {
  const environment = new Environment();
  environment.start();
  return OP_SHELL.apply({ environment, settings });
}

main().catch((exception) => {
  console.error('[SCRIPTS:APP]', 'Shell failed:', exception);
  process.exitCode = 1;
}).then((output) => {
  if (output) console.log('[SCRIPTS:APP]', output);
});
