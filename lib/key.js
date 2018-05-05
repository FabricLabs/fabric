'use strict';

const util = require('util');

const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

function Key (init) {
  this['@data'] = init || {};

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.keypair = ec.genKeyPair();

  this.private = this.keypair.getPrivate();
  this.public = this.keypair.getPublic();

  this.init();
}

util.inherits(Key, require('./vector'));

Key.prototype._sign = function (msg) {
  // console.log(`[KEY] signing: ${msg}...`);
  let signature = this.keypair.sign(msg);
  // console.log(`[KEY] signature:`, signature);
  return signature.toDER();
};

Key.prototype._verify = function (msg, sig) {
  let valid = this.keypair.verify(msg, sig);
  return valid;
};

module.exports = Key;
