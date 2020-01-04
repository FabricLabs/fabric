'use strict';

const querystring = require('querystring');

const fetch = require('node-fetch');
const Resource = require('./resource');

const CONTENT_TYPE = 'application/json';

/**
 * Interact with a remote {@link Resource}.
 * @type {Remote}
 * @property {Object} config
 * @property {Boolean} secure
 */
class Remote extends Resource {
  /**
   * An in-memory representation of a node in our network.
   * @param       {Object} target - Target object.
   * @param       {String} target.host - Named host, e.g. "localhost".
   * @param       {String} target.secure - Require TLS session.
   * @constructor
   */
  constructor (config = {}) {
    super(config);

    this.config = Object.assign({
      authority: config.host || 'localhost',
      entropy: Math.random(),
      secure: true,
      port: 443
    }, config);

    this.secure = this.config.secure;

    return this;
  }

  /**
   * Enumerate the available Resources on the remote host.
   * @return {Configuration}
   */
  async enumerate () {
    let options = await this._OPTIONS('/');
    let results = [];

    for (let name in options) {
      let definition = options[name];
      results.push({
        name: definition.name,
        description: definition.description,
        components: Object.assign({
          list: 'maki-resource-list',
          view: 'maki-resource-view'
        }, definition.components),
        routes: definition.routes,
        attributes: definition.attributes,
        names: definition.names
      });
    }

    return options;
  }

  async request (type, path, params = {}) {
    let self = this;
    let parts = self.config.authority.split(':');

    // TODO: use onion address for secure mode
    let host = parts[0] || ((self.secure) ? 'localhost' : 'localhost');
    let port = parts[1] || ((self.secure) ? 443 : 80);

    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${path}`;

    let result = null;
    let headers = {
      'Accept': CONTENT_TYPE
    };

    // TODO: break out into independent auth module
    if (this.config.username && this.config.password) {
      headers['Authorization'] = `Basic ${Buffer.from([
        this.config.username,
        this.config.password
      ].join(':')).toString('base64')}`;
    }

    if (params && Object.keys(params).length) {
      url += '?' + querystring.stringify(params);
    }

    try {
      result = await fetch(url, {
        method: type,
        headers: headers
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    try {
      result = result.json();
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }

  /**
   * HTTP PUT against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} obj - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _PUT (key, obj) {
    return this.request('put', key, obj);
  }

  /**
   * HTTP GET against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _GET (key, params) {
    return this.request('get', key, params);
  }

  /**
   * HTTP POST against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _POST (key, obj, params) {
    return this.request('post', key, params);
  }

  /**
   * HTTP OPTIONS on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _OPTIONS (key, params) {
    return this.request('options', key, params);
  }

  /**
   * HTTP PATCH on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _PATCH (key, params) {
    return this.request('patch', key, params);
  }

  /**
   * HTTP DELETE on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _DELETE (key, params) {
    return this.request('delete', key, params);
  }
}

module.exports = Remote;
