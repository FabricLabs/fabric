'use strict';

var crypto = require('crypto');
var util = require('util');
var rest = require('wreck');

var Stash = require('./stash');

/**
 * An in-memory representation of a node in our network.
 * @param       {Object} initial - Target object.
 * @constructor
 */
 function Remote (init) {
   this['@data'] = init || {};
   this.clock = 0;
   this.stack = [];
   this.known = {};
   this.init();
 }

// could be looked up by name of parameter in #3
util.inherits(Remote, require('./vector'));

Remote.prototype._GET = async function (key, params) {
  var self = this;
  var host = self['@data'].host;
  var url = 'http://' + host + key;
  
  var response = await rest.get(url);

  return response.payload.toString();
};

module.exports = Remote;
