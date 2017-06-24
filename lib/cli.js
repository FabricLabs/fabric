'use strict';

var util = require('util');
var CLI = new Function();

// all user interfaces begin with a "Vector"
util.inherits(CLI, require('../lib/vector'));

module.exports = CLI;
