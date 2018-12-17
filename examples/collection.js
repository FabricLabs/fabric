'use strict';

// # Hello, Collections!
console.log('# Hello, Collections!');
console.log('Beginning program...');

// The `Collection` example demonstrates how a list of items can be managed.
// ## Requirements
// We'll set `Collection` to a relative path, but in practice you'll use the
// `@fabric/core` package directly.
const Collection = require('../lib/collection');

// Our `main` function runs asynchronously, here we define that behavior.
async function main () {
  // Our first operation is to allocate memory for a new Collection.
  let collection = new Collection();

  // Using the familiar `push` and `pop` semantics, we can add and remove items
  // from our collection.
  collection.push({
    text: 'Hello, world!',
    entropy: Math.random()
  });

  // Fabric can serialize the object to a JSON-formatted string.
  console.log('[EXAMPLE]', 'collection:', collection.render());

  // Collections are maps of their contents.  To re-hydrate elements, use the
  // `populate` method.
  console.log('[EXAMPLE]', 'collection.populate():', await collection.populate());
}

// Lastly, run the program as defined.
main();
