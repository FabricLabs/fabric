// # Offline-first Applications with Fabric
// Build your first Fabric application.
//
// ## Warning
// This example is intended for downstream consumers — those seeking to implement client-facing applications using Fabric.
//
// ## Quickstart
// Ensure that you are using NodeJS `16.17.1` — execute in your clone of the Fabric Core repository.
//
// ### Cloning Fabric
// Run the following commands:
// ```
// git clone git@github.com:FabricLabs/fabric.git
// cd fabric
// git checkout v0.1.0-RC1
// ```
//
// You should now be on the latest branch.
//
// ### Running the `App` example:
// ```
// npm i
// node examples/app.js
// ```
//
// ## Browsers
// This example is intended to be run in the browser.
if (!window) throw new Error('Not running in browser.  Exiting.');

// ## Settings
// Settings include browser configuration; script paths, console settings, and consensus parameters.
const settings = {
  label: '[GUARDIAN]',
  // Denotes the JavaScript runtime scripts to execute on boot.
  scripts: ['app.js'],
  // Provides a map of named Resources to pre-configure.
  resources: {
    People: Person,
    Posts: Post,
    Relationships: Relationship,
  },
  authorities: {}
};

// ## Dependencies
const App = require('../types/app');

// ## Resources
const Person = require('../resources/person');
const Post = require('../resources/post');
const Relationship = require('../resources/relationship');

// ## Functions
// Error Handler
function _handleError (error) {
  console.error(settings.label, '[ERROR]', error);
}

// Output Handler
function _handleOutput (output) {
  console.log(settings.label, '[READY:OUTPUT]', output);
}

// Main Process
async function main (input = {}) {
  // Create and start the Fabric Application
  window.app = new App(input);
  window.app.start();

  // Return new Object
  return {
    app: window.app
  };
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/service.js').then(function(registration) {
      console.log(settings.label, 'ready: ', registration.scope);
    }, function(err) {
      console.log(settings.label, 'failed: ', err);
    });
  });
}

// Assign our onload function
window.onload = function () {
  app.attach(document.querySelector('fabric-application'));
  //app._load();

  // TODO: document defer as trust(authority) with Remote class
  /*/
  app._defer('localhost:3000');
  /*/
  app._defer('maki.io');
  /**/

  app._explore();
}

main(settings).catch(_handleError).then(_handleOutput);
