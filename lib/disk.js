'use strict';

const fs = require('fs');

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
