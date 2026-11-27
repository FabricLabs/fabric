'use strict';

const { parentPort } = require('worker_threads');

if (parentPort) parentPort.on('message', (message) => {
  const reply = {
    sawXprv: Object.prototype.hasOwnProperty.call(process.env, 'FABRIC_XPRV'),
    isolate: process.env.FABRIC_PROGRAM_ISOLATE || null
  };
  if (message && message.port && typeof message.port.postMessage === 'function') {
    message.port.postMessage(reply);
    return;
  }
  parentPort.postMessage(reply);
});
