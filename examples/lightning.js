'use strict';

const Lightning = require('@fabric/core/services/lightning');

async function main () {
  const lightning = new Lightning({
    mode: 'socket',
    path: './stores/lightning-playnet/regtest/lightning-rpc'
  });

  await lightning.start();

  const funds = await lightning._makeRPCRequest('listfunds');

  return {
    id: lightning.id,
    funds: funds
  };
}

main().catch((exception) => {
  console.error('[EXAMPLES:LIGHTNING]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[EXAMPLES:LIGHTNING]', 'Main Process Output:', output);
});
