'use strict';

import Fabric from '../';

const Swarm = require('../lib/swarm');

const config = {
  oracle: {
    path: `./data/${process.env['NAME'] || 'cli'}`,
    port: process.env['PORT'] || 3007
  }
};

const network = {
  peer: {
    port: process.env['PEER_PORT'] || 7777
  },
  peers: [
    'fabric.pub:7777',
    // 'localhost:7450', // for `examples/network.js`
    // 'localhost:7777'
  ]
};

async function main () {
  const cli = new Fabric.CLI(config);
  const swarm = new Swarm(network);

  // TODO: move to lib/chat.js
  cli.oracle.define('Message', {
    routes: {
      list: '/messages',
      get: '/messages/:id'
    }
  });

  // TODO: move into Fabric proper (Oracle?)
  cli.oracle.define('Peer', {
    routes: {
      list: '/peers',
      get: '/peers/:id'
    }
  });

  try {
    await cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }

  swarm.on('info', cli.inform.bind(cli));
  swarm.on('peer', cli._handlePeerMessage.bind(cli));
  swarm.on('part', cli._handlePartMessage.bind(cli));
  swarm.on('changes', async function (changes) {
    cli.oracle.machine.applyChanges(changes);
    await cli.oracle._sync();
    cli.log('state is now:', cli.oracle.machine.state);
  });

  swarm.start();

  cli.oracle.on('changes', function (changes) {
    cli.log('MAIN', 'received changes:', changes);
    swarm.self.broadcast(changes);
  });

  cli.oracle.on('/messages', function (msg) {
    // TODO: standardize an API for addressable messages in Oracle/HTTP
    // console.log('MAIN', 'received message:', msg);
  });
}

main();
