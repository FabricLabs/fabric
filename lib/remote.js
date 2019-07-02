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

  /**
   * HTTP PUT against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} obj - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _PUT (key, obj) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;

    let result = null;

    try {
      result = await fetch(url, {
        method: 'put',
        headers: {
          'Accept': CONTENT_TYPE
        },
        body: obj
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }

  /**
   * HTTP GET against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _GET (key, params) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;
    let result = null;
    let headers = {
      'Accept': CONTENT_TYPE
    };

    if (this.config.username && this.config.password) {
      headers['Authorization'] = `Basic ${Buffer.from([
        this.config.username,
        this.config.password
      ].join(':')).toString('base64')}`;
    }

    if (params) {
      url += '?' + querystring.stringify(params);
    }

    try {
      result = await fetch(url, {
        method: 'get',
        headers: headers
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }

  /**
   * HTTP POST against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _POST (key, obj, params) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;
    let result = null;

    try {
      result = await fetch(url, {
        method: 'post',
        headers: {
          'Accept': CONTENT_TYPE
        },
        body: obj
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    /* try {
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
    } */

    return result;
  }

  /**
   * HTTP OPTIONS on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _OPTIONS (key, params) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;
    let result = null;

    try {
      result = await fetch(url, {
        method: 'options',
        headers: {
          'Accept': CONTENT_TYPE
        }
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }

  /**
   * HTTP PATCH on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _PATCH (key, params) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;
    let result = null;

    try {
      result = await fetch(url, {
        method: 'patch',
        headers: {
          'Accept': CONTENT_TYPE
        },
        body: params
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }

  /**
   * HTTP DELETE on the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _DELETE (key, params) {
    let self = this;
    let host = self.config.authority;
    let port = self.config.port;
    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${key}`;
    let result = null;

    try {
      result = await fetch(url, {
        method: 'delete',
        headers: {
          'Accept': CONTENT_TYPE
        }
      });
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    return result;
  }
}

module.exports = Remote;
