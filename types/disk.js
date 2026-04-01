'use strict';

const fs = require('fs');

/**
 * Minimal host-path file accessor. Roadmap: align with virtual-node / overlay filesystem
 * work (namespaces, lazy mounts, remote-backed paths) once that stack lands — no behavioral
 * change here until then.
 * @class Disk
 */
class Disk {
  constructor (root) {
    this.type = 'Disk';
    this.root = root || process.env.PWD;
  }

  exists (path) {
    let full = [this.root, path].join('/');
    return fs.existsSync(full);
  }

  get (path) {
    let full = [this.root, path].join('/');
    return require(full);
  }
}

module.exports = Disk;
