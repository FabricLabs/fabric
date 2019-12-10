'use strict';

const Fabric = require('../');
const Authority = require('../lib/authority');
const server = new Authority();

async function main () {
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

  await server.start();
}

main();
