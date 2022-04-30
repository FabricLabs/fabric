'use strict';

const Node = require('../types/node');
const Bitcoin = require('../services/bitcoin');
const settings = require('../settings/local');

async function main (input = {}) {
  const node = new Node({ service: Bitcoin, settings: input });
  await node.start();
}

main(settings).catch((E) => {
  console.trace('[ALERT]', 'Service threw exception:', E);
});
