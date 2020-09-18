'use strict';

const crypto = require('crypto');

class HKDF {
  constructor (settings) {
    if (!settings.initial) throw new Error('Requires "initial" value in settings.');

    // Assign Settings
    this.settings = Object.assign({
      algorithm: 'sha256',
      initial: null,
      salt: null
    }, settings);

    // Properties
    this.size = crypto.createHash(this.settings.algorithm).digest().length;
    this.salt = this.settings.salt || this.zeroes(this.size);
    this.prk = crypto.createHmac(this.settings.algorithm, this.salt).update(this.settings.initial).digest();

    // Chainable
    return this;
  }

  zeroes (count) {
    return Buffer.alloc(count, '0').toString();
  }

  derive (info, size = 32) {
    if (!(info instanceof Buffer)) info = Buffer.from(info);

    const blocks = Math.ceil(size / this.size);
    const buffers = [];

    let previous = Buffer.from('');

    for (let i = 0; i < blocks; i++) {
      const hmac = crypto.createHmac(this.settings.algorithm, this.prk);
      const input = Buffer.concat([
        previous,
        info,
        Buffer.from(String.fromCharCode(i + 1))
      ]);

      previous = hmac.update(input).digest();

      buffers.push(previous);
    }

    return Buffer.concat(buffers, size);
  }
}

module.exports = HKDF;