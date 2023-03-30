'use strict';

// Fabric Types
const Filesystem = require('../types/filesystem');

// Program Definition
async function OP_MOUNT (command) {
  const filesystem = new Filesystem({
    path: command.args[0] || '.fabric'
  });

  filesystem.on('activity', activity => {
    console.log('activity:', activity);
  });

  filesystem.on('log', log => {
    console.log('log:', log);
  });

  filesystem.on('message', message => {
    console.log('message:', message);
  });

  filesystem.on('error', error => {
    console.error('error:', error);
  });

  await filesystem.start();
  return JSON.stringify({
    id: filesystem.id,
    type: 'FabricFileSystem'
  });
}

// Module
module.exports = OP_MOUNT;
