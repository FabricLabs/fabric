'use strict';

const SAMPLE = {
  debug: true,
  seed: 'cricket grocery kingdom wool double wood happy predict worth pave build pepper bullet farm churn exhibit grit isolate short theory help vehicle denial slide'
}

// const settings = require('../settings/local');
const Identity = require('../types/identity');

async function main (input = {}) {
  const identity = new Identity(input);

  return {
    id: identity.toString(),
    identity: {
      pubkey: identity.pubkey
    },
    derivation: identity.derivation
  };
}

main(SAMPLE).catch((exception) => {
  console.error('[FABRIC:IDENTITY]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:IDENTITY]', 'Current Identity:', output);
});
