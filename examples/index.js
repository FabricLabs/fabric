// # Examples with Fabric
// Fabric is like an operating system for the distributed web.  It manages
// application state, storage, and network interactions behind the scenes while
// providing your application with a convenient event-oriented interface.
//
// We use [strict mode](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode) to improve error handling and debugging, so we recommend you do the same.
'use strict';

// ## Importing Fabric
// Fabric is easily imported into existing applications.  When using JavaScript,
// use the `require` semantic to import as a library.
const Fabric = require('@fabric/core');

// Most interactions with Fabric are asynchronous, so let's define our program's
// primary behavior.
async function main () {
  // 1. Create an instance of Fabric...
  let app = new Fabric();

  // 2. Add some data...
  await app._POST(`/inscriptions`, { input: 'Hello, world!' });

  // 3. Output some results!
  console.log('app:', app);
}

main();
// Now that we've defined our program, let's run it to see the results.

// ### Next Steps
// That's all there is to it!  Now, [on to the API Explorer](https://dev.fabric.pub/docs)!
