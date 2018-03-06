'use strict';

const util = require('util');
const crypto = require('crypto');
const eccrypto = require('eccrypto');
const hash = require('hash.js');

function Key (init) {
  this['@data'] = init || {};

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.private = crypto.randomBytes(32);
  this.public = eccrypto.getPublic(this.private);

  this.init();
}

util.inherits(Key, require('./vector'));

Key.prototype._ripemd = function (input) {
  return hash.ripemd.ripemd160(input).digest('hex');
};

Key.prototype._sign = async function (msg) {
  let signature = await eccrypto.sign(this.private, msg);
  return signature;
};

Key.prototype._verify = async function (key, msg, sig) {
  let valid = await eccrypto.verify(key, msg, sig);
  return valid;
};

module.exports = Key;
