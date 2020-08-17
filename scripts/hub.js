'use strict';

const Peer = require('../types/peer');
const settings = {
  listen: true
};

async function main () {
  // TODO: save generated keypair
  const hub = new Peer(settings);

  hub.on('peer', function (peer) {
    console.log('[SCRIPTS:HUB]', `New peer connected: ${JSON.stringify(peer)}`);
  });

  await hub.start();
}

main().catch((exception) => {
  console.error('[SCRIPTS:HUB]', 'Main process threw Exception:', exception);
});