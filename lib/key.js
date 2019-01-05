'use strict';

const Base58Check = require('base58check');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const State = require('./state');

class Key extends State {
  constructor (init) {
    super(init);

    this.config = Object.assign({}, init);
    this.keypair = ec.genKeyPair();

    this.private = this.keypair.getPrivate();
    this.public = this.keypair.getPublic();

    this.pubkey = this.public.encode('hex');

    this.ripe = crypto.createHash('ripemd160').update(this.pubkey).digest('hex');
    this.address = Base58Check.encode(this.ripe);

    this['@data'] = {
      'type': 'Key',
      'public': this.pubkey,
      'address': this.address
    };

    Object.defineProperty(this, 'keypair', {
      enumerable: false
    });

    Object.defineProperty(this, 'private', {
      enumerable: false
    });

    return this;
  }

  _sign (msg) {
    // console.log(`[KEY] signing: ${msg}...`);
    let signature = this.keypair.sign(msg);
    // console.log(`[KEY] signature:`, signature);
    return signature.toDER();
  }

  _verify (msg, sig) {
    let valid = this.keypair.verify(msg, sig);
    return valid;
  }
}

module.exports = Key;
