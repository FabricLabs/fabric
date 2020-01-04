// # Getting Started with Fabric
// Fabric provides an API for writing, compiling, and executing distributed
// applications.  In this example, we'll walk through a few of the basic
// operations a typical application might utilize, staying as close to
// production-quality code as we can.  :)

// Strict mode is used to enforce certain constraints on JavaScript, and is
// generally recommended for use when building applications with Fabric.
'use strict';

// Since our example begins _within_ the Fabric repository, we're going to
// call `require` against the local directory, but in a real-world
// application you'll want to use `const Fabric = require('@fabric/core');`
// to use the correct package (installed with `npm i @fabric/core` of
// course!)
const Fabric = require('../');

// We're going to contain our application withing a `main` function, defined
// here using the `async` prefix.
async function main() {
  let fabric = new Fabric();
  console.log('[EXAMPLE]', 'Fabric:', fabric);
}

// Finally, let's run our program.
main();