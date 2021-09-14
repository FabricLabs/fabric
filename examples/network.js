'use strict';

const playnet = require('../settings/playnet');
const Peer = require('../types/peer');
const Message = require('../types/message');

const NODE_COUNT = 3;
const PEERING_PORT = 7450;

/**
 * Simulate a Fabric network based on the constants above.
 * @return {[type]} [description]
 */
async function simulate () {
  const nodes = {};
  const ids = [];

  for (let i = 0; i < NODE_COUNT; i++) {
    const node = new Peer({
      listen: true,
      port: PEERING_PORT + i // Each peer (after the first) uses port n + 1,
    });

    console.log(`Created node id: ${node.id}`, node.id);

    nodes[node.id] = node;
    ids.push(node.id);
  }

  console.log('nodes:', nodes);

  for (const id in nodes) {
    console.log(`starting ${id}...`);
    const node = nodes[id];

    node.on('ready', function () {
      console.log(`node ${id} is ready!`);
      const peers = Object.keys(nodes).filter(x => x !== id);
      console.log(`node ${id} knows peers:`, peers);

      for (const i in peers) {
        const peerID = peers[i];
        const address = `${nodes[peerID].address}:${nodes[peerID].port}`;
        console.log(`node ${id} connecting to ${address}...`);
        node._connect(address);
      }
    });

    nodes[id].listen();
  }

  const origin = nodes[ids[0]];
  const message = Message.fromVector([0x00000012, Date.now() + '']); // ping

  console.log('broadcasting message to all peers:', message);

  origin.broadcast(message);
}

simulate();
