// # Exposing ARCs with HTTP
// Fabric makes it easy to publish applications to the Web,
// giving downstream users access to a hosted instance of the
// application.
//
// By using `@fabric/http` we can import an existing Fabric
// application, and run an HTTP server which exposes a rendered
// HTML user interface, complete with progressive enhancement of
// features such as real-time updates and hardware-based key
// management.
//
// ## Quick Start

// Import the `@fabric/http` library:
const HTTP = require('@fabric/http');

// Define the `main` program:
async function main () {
  // Create an instance of a [Server](https://dev.fabric.pub/docs/service.html):
  const server = new HTTP.Server();

  // Define a [Resource](https://dev.fabric.pub/docs/resource.html):
  await server.define('Person', {
    name: 'Person',
    properties: {
      username: { type: String , maxLength: 55 }
    },
    routes: {
      list: '/people',
      view: '/people/:id'
    }
  });

  // Start the Server instance:
  await server.start();
}

// Run Program:
main().catch((exception) => {
  console.log('[EXAMPLES:HTTP]', 'HTTP Exception:', exception);
});

// That's it!  You can now visit `https://localhost:` to interact
// using the HTTP interface for your program.
//
// Take a look at the other examples to learn more!
