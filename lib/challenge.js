'use strict';

var util = require('util');

var _ = require('lodash');

function Challenge (goal) {
  this.name = goal;
  this.from = 'alpha';
  this.to = 'omega';
  this.stack = [];
  
  this['@data'] = {
    state: goal
  };

}

util.inherits(Challenge, require('./vector'));

Challenge.prototype.validate = function (state) {
  console.log('validating:', state);
  
  var output = state.compute();
  
  if (output === this['@data'].state) {
    return true;
  } else {
    return false;
  }
}

Challenge.prototype.compute = function (input) {
  var challenge = this;

  return true;
}

module.exports = Challenge;
