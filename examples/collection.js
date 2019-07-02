'use strict';

// # Hello, Collections!
console.log('# Hello, Collections!');
console.log('Beginning program...');
// Some examples include "frontmatter", or short snippets of YAML-encoded
// metadata about a particular document.  Feel encouraged to explore any files
// in the Fabric repository, as they'll help you learn more about the overall
// design.  If in doubt, check [the documentation](https://dev.fabric.pub/docs)!
console.log('---');

// The `Collection` example demonstrates how a list of items can be managed.
// ## Requirements
// We'll set `Collection` to a relative path, but in practice you'll use the
// `@fabric/core` package directly.
const Collection = require('../lib/collection');
const Machine = require('../lib/machine');

// Our `main` function runs asynchronously, here we define that behavior.
async function main () {
  // Our first operation is to allocate memory for a new Collection.
  let collection = new Collection();
  // Fabric has an entire library full of tools, but here we only need a way to
  // reproduce our results — for more information on the Machine class, see
  // [the `Machine` class Documentation](https://dev.fabric.pub/docs/Machine.html).
  let machine = new Machine();

  // Using the familiar `push` and `pop` semantics, we can add and remove items
  // from our collection.
  collection.push({
    text: 'Hello, world!',
    entropy: machine.sip()
  });

  // Fabric can serialize the object to a JSON-formatted string.
  console.log('[EXAMPLE]', 'collection:', collection.render());

  // Collections are maps of their contents.  To re-hydrate elements, use the
  // `populate` method.
  console.log('[EXAMPLE]', 'collection.populate():', await collection.populate());

  console.log('---');
  console.log('### Next Steps');
  console.log('Now, try adding elements of your own to the collection.  See: `examples/collection.js`');
}

// Lastly, run the program as defined.
main();
