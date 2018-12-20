'use strict';

const Fabric = require('../');
const name = 'martindale';
const key = new Fabric.Key();
const pointer = require('json-pointer');

async function main () {
  let fabric = new Fabric({
    name: '@fabric/examples/store',
    path: './data/examples',
    persistent: false
  });

  // start
  await fabric.start().catch(fabric.error.bind(fabric));

  let mem = `/players`;
  let path = pointer.escape(mem);
  let router = Fabric.sha256(path);

  // put info
  let link = await fabric._POST(mem, { name, key }).catch(fabric.error.bind(fabric));
  let player = await fabric._GET(`${link}`).catch(fabric.error.bind(fabric));
  let players = await fabric._GET(mem).catch(fabric.error.bind(fabric));
  let collection = await fabric._GET(`/collections/${router}`).catch(fabric.error.bind(fabric));

  // clean up after ourselves
  await fabric.stop().catch(fabric.error.bind(fabric));

  console.log('[HTTP]', 201, 'Created', 'link:', `fabric:${link}`);
  console.log('player:', player);
  console.log('players:', players);
  console.log('collection:', collection);
  console.log('fabric:', fabric);
  console.log('state:', fabric.store.state);

  // console.log('players:', players.constructor.name, players);
}

try {
  main();
} catch (E) {
  console.trace(E);
}
