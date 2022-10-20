'use strict';

// Fabric Types
const Filesystem = require('../types/filesystem');

// Program Definition
async function OP_MOUNT (settings = {}) {
  const filesystem = new Filesystem(settings);
  await filesystem.start();
  return JSON.stringify({
    id: filesystem.id,
    type: 'FabricFileSystem'
  });
}

// Module
module.exports = OP_MOUNT;
