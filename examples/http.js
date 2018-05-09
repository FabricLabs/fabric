'use strict';

var Fabric = require('../');
var server = new Fabric.HTTP();

async function main () {
  await server.define('Person', {
    name: 'Person',
    properties: {
      username: { type: String , maxLength: 55 }
    },
    routes: {
      query: '/people',
      get: '/people/:id'
    }
  });

  server.start();
}

main();
