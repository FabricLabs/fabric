'use strict';

// Dependencies
const fs = require('fs');
const merge = require('lodash.merge');

// Fabric Types
const Entity = require('./entity');
const EncryptedPromise = require('./promise');

class Environment extends Entity {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      home: process.env.HOME,
      path: process.env.HOME + '/.fabric/wallet.json',
      store: process.env.HOME + '/.fabric'
    }, this.settings, settings);

    return this;
  }

  storeExists () {
    return fs.existsSync(this.settings.store);
  }

  walletExists () {
    return fs.existsSync(this.settings.path);
  }

  makeStore () {
    fs.mkdirSync(this.settings.store);
  }

  touchWallet () {
    const time = new Date();
    this.makeStore();

    try {
      fs.utimesSync(this.settings.path, time, time);
    } catch (err) {
      fs.closeSync(fs.openSync(this.settings.path, 'w'));
    }
  }

  readVariable (name) {
    return process.env[name] || '';
  }

  readWallet (password) {
    let data = fs.readFileSync(this.settings.path);
    let seed = null;
    let secret = null;

    try {
      seed = JSON.parse(data);
      secret = new EncryptedPromise({
        password: password,
        ciphertext: seed['@data']
      });
    } catch (exception) {
      console.error('[FABRIC:KEYGEN]', 'Could not load wallet data:', exception);
    }

    return seed;
  }
}

module.exports = Environment;