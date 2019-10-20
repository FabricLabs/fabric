'use strict';

const crypto = require('crypto');
const EC = require('elliptic').ec;
const Hash256 = require('./hash256');
const Key = require('./key');

class Witness {
  constructor (settings = {}) {
    this.ec = new EC('secp256k1');

    this.settings = Object.assign({
      curve: 'secp256k1',
      data: Buffer.alloc(32 * 256),
      keypair: this.ec.genKeyPair()
    }, settings);

    console.log('[AUDIT]', 'New Witness Created:', this.settings);

    this.signature = null;
  }

  get hash () {
    return Hash256.digest(this.settings.data);
  }

  _fromKeypair (keypair) {
    if (!keypair.public) throw new Error('Keypair must provide a public key.');
  }

  /**
   * Converts the Witness to a Compact DER format.
   */
  toCompactDER () {
    let payload = [
      0x02, // a header byte indicating an integer.
      0x00, // A 1-byte length descriptor for the R value
      // TODO: assign R coordinate
      0x00, // The R coordinate, as a big-endian integer.
      0x02, // a header byte indicating an integer.
      0x00, // A 1-byte length descriptor for the S value.
      // TODO: assign S coordinate
      0x00 // The S coordinate, as a big-endian integer.
    ];

    let msg = new WeakMap();
    let der = Buffer.from([
      0x30, // indicates compound structure
      Buffer.from(payload).size, // payload size
    ].concat(payload));

    return der;
  }

  fromBitcoinSignature (signature) {}) {

  }
}

module.exports = Witness;