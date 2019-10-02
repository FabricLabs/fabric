'use strict';

const Fabric = require('../');
const Bitcoin = require('../services/bitcoin');

async function main () {
  let fabric = new Fabric();
  let bitcoin = new Bitcoin();

  fabric.use(bitcoin);

  console.log('fabric:', fabric);
  console.log('bitcoin:', bitcoin);
}

module.exports = main();