'use strict';

const util = require('util');
const rest = require('wreck');


const CONTENT_TYPE = 'application/json';

/**
 * An in-memory representation of a node in our network.
 * @exports Remote
 * @type {Vector}
 * @param       {Object} target - Target object.
 * @param       {String} target.host - Named host, e.g. "localhost".
 * @param       {String} target.secure - Require TLS session.
 * @constructor
 */
function Remote (init) {
  this['@data'] = init || {};

  this.clock = 0;
  this.stack = [];
  this.known = {};

  this.secure = (init.secure) ? true : false;

  this.init();
}

util.inherits(Remote, require('./vector'));

Remote.prototype.enumerate = async function () {
  let options = await this._OPTIONS('/');
  let results = [];

  for (let name in options) {
    let definition = options[name];
    results.push({
      name: definition.name,
      description: definition.description,
      components: Object.assign({
        query: 'maki-resource-query',
        get: 'maki-resource-get'
      }, definition.components),
      routes: definition.routes,
      attributes: definition.attributes,
      names: definition.names
    });
  }

  return options;
};

/**
 * HTTP PUT against the configured Authority.
 * @param  {String} path - HTTP Path to request.
 * @param  {Object} obj - Map of parameters to supply.
 * @return {Mixed}        [description]
 */
Remote.prototype._PUT = async function (key, obj) {
  var self = this;
  var host = self['@data'].host;
  var protocol = (!self.secure) ? 'http' : 'https';
  var url = protocol + '://' + host + key;

  var result = null;

  try {
    let response = await rest.request('PUT', url, {
      headers: {
        'Accept': CONTENT_TYPE
      },
      payload: obj
    });

    console.log('[REMOTE]', '_PUT', key, obj, typeof response, response.length);
    result = await rest.read(response, { json: true });

    console.log('[REMOTE]', '_PUT', 'response:', key, typeof result, result);
  } catch (e) {
    console.error('[REMOTE]', 'exception:', e);
  }

  return result;
};

/**
 * HTTP GET against the configured Authority.
 * @param  {String} path - HTTP Path to request.
 * @param  {Object} params - Map of parameters to supply.
 * @return {Mixed}        [description]
 */
Remote.prototype._GET = async function (key, params) {
  let self = this;
  let host = self['@data'].host;
  let protocol = (!self.secure) ? 'http' : 'https';
  let url = protocol + '://' + host + key;
  let result = null;

  try {
    let response = await rest.request('GET', url, {
      headers: {
        'Accept': CONTENT_TYPE
      }
    });
    result = await rest.read(response, { json: true });
  } catch (e) {
    console.error('[REMOTE]', 'exception:', e);
  }

  return result;
};

/**
 * HTTP POST against the configured Authority.
 * @param  {String} path - HTTP Path to request.
 * @param  {Object} params - Map of parameters to supply.
 * @return {Mixed}        [description]
 */
Remote.prototype._POST = async function (key, obj, params) {
  let self = this;
  let host = self['@data'].host;
  let protocol = (!self.secure) ? 'http' : 'https';
  let url = protocol + '://' + host + key;
  let result = null;

  try {
    let response = await rest.request('POST', url, {
      headers: {
        'Accept': CONTENT_TYPE
      },
      payload: obj,
      // TODO: report to `wreck` as NOT WORKING
      redirect303: true
    });

    if (response.statusCode === 303) {
      result = await self._GET(response.headers.location);
    } else {
      result = await rest.read(response, { json: true });
    }
  } catch (e) {
    console.error('[REMOTE]', 'exception:', e);
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
  let self = this;
  let host = self['@data'].host;
  let protocol = (!self.secure) ? 'http' : 'https';
  let url = protocol + '://' + host + key;
  let result = null;

  try {
    let response = await rest.request('OPTIONS', url, {
      headers: {
        'Accept': CONTENT_TYPE
      }
    });
    result = await rest.read(response, { json: true });
  } catch (e) {
    console.error('[REMOTE]', 'exception:', e);
  }

  return result;
};

Remote.prototype._PATCH = async function (key, params) {
  let self = this;
  let host = self['@data'].host;
  let protocol = (!self.secure) ? 'http' : 'https';
  let url = protocol + '://' + host + key;
  let result = null;

  try {
    let response = await rest.request('PATCH', url, {
      headers: {
        'Accept': CONTENT_TYPE
      },
      payload: params
    });
    result = await rest.read(response, { json: true });
  } catch (e) {
    console.error('[REMOTE]', 'exception:', e);
  }

  return result;
};

module.exports = Remote;
