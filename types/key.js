'use strict';

const Base58Check = require('base58check');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

const Entity = require('./entity');

class Key extends Entity {
  constructor (init = {}) {
    super(init);

    this.config = Object.assign({
      prefix: '00',
      private: null
    }, init);

    if (init.pubkey) {
      this.keypair = ec.keyFromPublic(init.pubkey, 'hex');
    } else if (this.config.private) {
      this.keypair = ec.keyFromPrivate(this.config.private, 16);
    } else {
      this.keypair = ec.genKeyPair();
    }

    this.private = this.keypair.getPrivate();
    this.public = this.keypair.getPublic(true);

    this.pubkey = this.public.encodeCompressed('hex');
    this.pubkeyhash = crypto.createHash('sha256').update(this.pubkey).digest('hex');

    let input = `${this.config.prefix}${this.pubkeyhash}`;
    let hash = crypto.createHash('sha256').update(input).digest('hex');
    let safe = crypto.createHash('sha256').update(hash).digest('hex');
    let checksum = safe.substring(0, 8);
    let address = `${input}${checksum}`;

    this.ripe = crypto.createHash('ripemd160').update(input).digest('hex');
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

  get id () {
    return this.pubkeyhash;
  }

  _sign (msg) {
    // console.log(`[KEY] signing: ${msg}...`);
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    let hmac = crypto.createHash('sha256').update(msg).digest('hex');
    let signature = this.keypair.sign(hmac);
    // console.log(`[KEY] signature:`, signature);
    return signature.toDER();
  }

  _verify (msg, sig) {
    let valid = this.keypair.verify(msg, sig);
    return valid;
  }
}

module.exports = Key;
