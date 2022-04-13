'use strict';

const ZMQ = require('../services/zmq');

async function main () {
  const zmq = new ZMQ();
  zmq.on('log', function (msg) {
    console.log('log:', msg);
  });
  await zmq.start();
}

main().catch((exception) => {
  console.error('exception:', exception);
}).then((output) => {
  console.log('output:', output);
});
