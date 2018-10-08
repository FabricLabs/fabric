'use strict';

var util = require('util');

function Challenge (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.init();
}

util.inherits(Challenge, require('./vector'));

Challenge.prototype.validate = function (state) {
  var output = state._sign();
  if (output['@id'] === this['@id']) {
    return true;
  } else {
    return false;
  }
};

module.exports = Challenge;
