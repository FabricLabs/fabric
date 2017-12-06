'use strict';

var crypto = require('crypto');
var util = require('util');
var rest = require('wreck');

var _ = require('./functions');

var Stash = require('./stash');

const CONTENT_TYPE = 'application/json';

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

util.inherits(Remote, require('./vector'));

Remote.prototype.enumerate = async function () {
  var self = this;
  var options = await self._OPTIONS('/');

  if (!options) {
    console.log('nothing:', options);
    return [];
  }
  
  options.resources = options.resources.map(function(r) {
    return {
      name: r.name,
      description: r.description,
      // TODO: remove lodash
      components: _.merge({
        query: 'maki-resource-query',
        get: 'maki-resource-get'
      }, r.components),
      routes: r.routes,
      attributes: r.attributes,
      names: r.names,
    }
  });
  
  return options.resources;
}

/**
 * HTTP GET against the configured Authority.
 * @param  {String} path - HTTP Path to request.
 * @param  {Object} params - Map of parameters to supply.
 * @return {Mixed}        [description]
 */
Remote.prototype._GET = async function (key, params) {
  var self = this;
  var host = self['@data'].host;
  var url = 'https://' + host + key;
  
  var request = rest.request('GET', url, {
    headers: {
      'Accept': CONTENT_TYPE
    }
  });
  
  try {
    var response = await request;
    var result = await rest.read(response, {
      json: true
    });
  } catch (e) {
    console.error('[REMOTE]', e);
  }

  return result;
};

/**
 * HTTP OPTIONS on the configured Authority.
 * @param  {String} path - HTTP Path to request.
 * @param  {Object} params - Map of parameters to supply.
 * @return {Object} - Full description of remote resource.
 */
Remote.prototype._OPTIONS = async function (key, params) {
  var self = this;
  var host = self['@data'].host;
  var url = 'https://' + host + key;
  
  var request = rest.request('OPTIONS', url, {
    headers: {
      'Accept': CONTENT_TYPE
    }
  });

  try {
    var response = await request;
    var result = await rest.read(response, {
      json: true
    });
  } catch (e) {
    console.error('[REMOTE]', e);
  }

  return result;
};

module.exports = Remote;
