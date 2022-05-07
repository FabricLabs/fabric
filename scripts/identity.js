'use strict';

const SAMPLE = {
  debug: true,
  seed: 'cricket grocery kingdom wool double wood happy predict worth pave build pepper bullet farm churn exhibit grit isolate short theory help vehicle denial slide'
}

const DERIVATION = `m/44'/0'/0'/0/0`;
const X_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

// const settings = require('../settings/local');
const Identity = require('../types/identity');
const Key = require('../types/key');

async function main (input = {}) {
  const master =  new Key({ seed: SAMPLE.seed });
  const key = new Key({ public: X_PUBKEY });
  const identity = new Identity(input);
  const frompub = new Identity({ public: X_PUBKEY });

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
