'use strict';

const settings = require('../settings/local');
const Bech32 = require('../types/bech32');

async function main (input = {}) {
  const identity = new Bech32({
    content: settings.public,
    hrp: 'id'
  });

  return {
    identity: {
      pubkey: settings.public
    },
    bech32m: identity.toString()
  };
}

main(settings).catch((exception) => {
  console.error('[FABRIC:IDENTITY]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:IDENTITY]', 'Current Identity:', output);
});
