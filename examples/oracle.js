'use strict';

import Fabric from '../';

const config = require('../package');
const oracle = new Fabric.HTTP(config);

async function main () {
  await oracle.start();

  let address = oracle.server.address();

  console.log('oracle started.');
  console.log('listening:', address);

  // TODO: compute link, require SSL/TLS

  console.log('link:', 'http://localhost:' + address.port);
}

module.exports = main();
