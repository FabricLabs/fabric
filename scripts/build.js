'use strict';

// Settings
const settings = require('../settings/local');

// Types
const Peer = require('../types/peer');
const Site = require('@fabric/http/types/site');
const Compiler = require('@fabric/http/types/compiler');

// Program Body
async function main (input = {}) {
  const peer = new Peer();
  const site = new Site(input);
  const compiler = new Compiler({
    document: site
  });

  await compiler.compileTo('assets/index.html');

  return {
    site: site.id,
    peer: peer
  };
}

// Run Program
main(settings).catch((exception) => {
  console.error('[BUILD:SITE]', '[EXCEPTION]', exception);
}).then((output) => {
  console.log('[BUILD:SITE]', '[OUTPUT]', output);
});
