// Storing Data in Fabric
// ======================
// One of Fabric's utilities is as a storage layer for your application.  By
// using the `Fabric.Store` constructor, you can interact with the network as if
// it were local storage.
//
// In this example, we'll run a single process `main()` demonstrating common
// interactions with Fabric's Storage Engine.
'use strict';

const Fabric = require('../');
const name = 'martindale';
const key = new Fabric.Key();
const pointer = require('json-pointer');

// ## Primary Process
// Here, we define our main process.
async function main () {
  let fabric = new Fabric({
    name: '@fabric/examples/store',
    path: './data/examples',
    persistent: false
  });

  // Start the Fabric instance, and log any errors.
  await fabric.start().catch(fabric.error.bind(fabric));

  // Let's use `/players` as the "address" for a collection of data.
  let mem = `/players`;
  let path = pointer.escape(mem);
  let router = Fabric.sha256(path);

  // Use `_POST(collection, item)` to insert an `item` into a named `collection`
  // for later retrieval.
  let link = await fabric._POST(mem, {
    name: name,
    key: key['@data']
  }).catch(fabric.error.bind(fabric));

  console.log('[HTTP]', 201, 'Created', 'link:', `fabric:${link}`);
  console.log('link:', link);

  let player = await fabric._GET(link).catch(fabric.error.bind(fabric));
  console.log('player:', player);

  let players = await fabric._GET(mem).catch(fabric.error.bind(fabric));
  let collection = await fabric._GET(`/collections/${router}`).catch(fabric.error.bind(fabric));

  // clean up after ourselves
  await fabric.stop().catch(fabric.error.bind(fabric));

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
