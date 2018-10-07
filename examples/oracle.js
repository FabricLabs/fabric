// An example of an [Oracle](https://dev.fabric.pub/docs/Oracle.html) built with [@fabric/core](https://github.com/FabricLabs/fabric), a framework for building high-throughput distributed systems with Bitcoin.

// An **Oracle** offers a simple, self- contained
// [Service](https://dev.fabric.pub/docs/Service.html) for establishing and
// verifying claims made against an underlying trust anchor.

// When combined with an HTML browser, an Oracle can be used to manage
// long-running [State](https://dev.fabric.pub/docs/State.html) for
// offline-first applications.

// ### Quick Start
// Run locally with `node examples/oracle.js` — use Node 8, _a la_ `nvm use 8`
// if you're using [NVM](https://nvm.sh), or from
// [nodejs.org](https://nodejs.org) if not!

// TODO: use bottom panel for inline execution (_a la_ "Run this Code &raquo;")
// ### Source

// First, let's ensure [strict mode](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Strict_mode) is used to parse our code.
'use strict';

// Require `@fabric/core` as the `Fabric` constant.  This allows us to use [the
// Fabric API](https://dev.fabric.pub) directly: `new Fabric.<type>()`
const Fabric = require('@fabric/core');

// An example configuration object, encoded as [JSON](https://json.org/):
// ```json
// {
//   "name": "@examples/oracle",
//   "description": "a simple Oracle example",
//   "version": "0.1.0"
// }
// ```
// Configuration files are most commonly stored in `config.json`, but you can
// also use an existing `package.json` to pre-load an Oracle with some state.

const config = require('./config');

/**
 * An {@link Oracle} offers a simple, self-contained {@link Service} for Fabric-
 * capable agents.  The `main()` function allocates necessary resources, then
 * starts the service.
 */
async function main () {
  // Our primary objective is to create an Oracle, so we do that next by passing
  // the `config` constant from earlier into the `Fabric.Oracle` constructor.
  let oracle = new Fabric.Oracle(config);
  // The `oracle` variable contains our Oracle, so now let's define a Resource
  // for it to manage.

  // ### Resources
  // An Oracle's purpose is to provide a canonical reference for a list of
  // [Resources](https://dev.fabric.pub/resources), which require both a `name`
  // and a `definition`.  Resources can be thought of as "typed collections",
  // with atomic operations such as `POP` and `PUSH` for managing their
  // contents.

  // Here, we define a `Request` as a resource with one field, `input`, which is
  // both `required` and restricted to a maximum size of 2048 bytes.
  oracle.define('Request', {
    attributes: {
      input: { type: 'String', required: true, max: 2048 }
    }
  });

  // Now that a Resource has been defined, start the Oracle.
  await oracle.start();

  // Log some output.
  console.log('oracle started!');
  console.log('oracle:', oracle);
}

// We've defined our program.  Start the main process!
module.exports = main();

// Fabric exposes a powerful API through `@fabric/core`, a standard library for
// building decentralized applications.  You can install it now by using the
// `npm install --save @fabric/core` command, or use
// `npm install FabricLabs/fabric#develop` for bleeding-edge [#beta](https://to.fabric.pub/#beta:fabric.pub) testing.
