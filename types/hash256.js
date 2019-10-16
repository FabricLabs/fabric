'use strict';

const crypto = require('crypto');

class Hash256 {
  constructor (settings = {}) {
    if (typeof settings === 'string') settings = { input: settings };
    if (!settings.input) settings.input = crypto.randomBytes(32).toString('hex');

    this.settings = Object.assign({
      hash: Hash256.digest(settings.input)
    }, settings);
  }

  static digest (input) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  get value () {
    return Hash256.digest(this.settings.input);
  }
}