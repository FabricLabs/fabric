'use strict';

const Store = require('./store');

class Keystore extends Store {
  constructor (settings = {}) {
    super(Store.encryptedSettings(settings));
  }
}

module.exports = Keystore;
