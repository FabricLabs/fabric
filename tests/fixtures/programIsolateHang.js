'use strict';

const { parentPort } = require('worker_threads');

if (parentPort) {
  parentPort.on('message', () => {});
  setInterval(() => {}, 1000);
}
