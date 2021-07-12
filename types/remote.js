'use strict';

// External Dependencies
const fetch = require('node-fetch');
const parser = require('content-type');
const querystring = require('querystring');

// Internal Types
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

    this.settings = Object.assign({
      authority: config.host || 'localhost',
      entropy: Math.random(),
      secure: true,
      port: 443
    }, config);

    this.secure = this.settings.secure;

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
    let parts = self.settings.authority.split(':');

    // TODO: use onion address for secure mode
    let host = parts[0] || ((self.secure) ? 'localhost' : 'localhost');
    let port = parts[1] || ((self.secure) ? 443 : 80);

    if (this.settings.port) {
      port = this.settings.port;
    }

    let protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${path}`;

    let result = null;
    let response = null;
    let body = null;
    let headers = {
      'Accept': CONTENT_TYPE,
      'Content-Type': CONTENT_TYPE
    };

    let opts = {
      method: type,
      headers: headers
    };

    // TODO: break out into independent auth module
    if (this.settings.username || this.settings.password) {
      headers['Authorization'] = `Basic ${Buffer.from([
        this.settings.username || '',
        this.settings.password || ''
      ].join(':')).toString('base64')}`;
    }

    if (params.body) {
      try {
        opts.body = JSON.stringify(params.body);
        delete params.body;
      } catch (E) {
        console.error('Could not prepare request:', E);
      }
    }

    if (params && Object.keys(params).length) {
      url += '?' + querystring.stringify(params);
    }

    try {
      response = await fetch(url, opts);
    } catch (e) {
      console.error('[REMOTE]', 'exception:', e);
    }

    if (!response) {
      return {
        status: 'error',
        message: 'No response to request.'
      };
    }

    switch (response.status) {
      default:
        if (response.ok) {
          const formatter = parser.parse(response.headers.get('content-type'));
          switch (formatter.type) {
            default:
              if (this.settings.verbosity >= 4) console.warn('[FABRIC:REMOTE]', 'Unhandled headers content type:', formatter.type);
              result = await response.text();
              break;
            case 'application/json':
              try {
                result = await response.json();
              } catch (E) {
                console.error('[REMOTE]', 'Could not parse JSON:', E);
              }
              break;
          }
        } else {
          if (this.settings.verbosity >= 4) console.warn('[FABRIC:REMOTE]', 'Unmanaged HTTP status code:', response.status);

          try {
            result = response.json();
          } catch (exception) {
            result = response.text();
          }
        }
        break;
      case 404:
        result = {
          status: 'error',
          message: 'Document not found.'
        };
        break;
    }

    return result;
  }

  /**
   * HTTP PUT against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} body - Map of parameters to supply.
   * @return {Mixed}        [description]
   */
  async _PUT (key, body) {
    return this.request('put', key, { body });
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
   * @return {Mixed}        Result of request.
   */
  async _POST (key, obj, params) {
    let result = null;

    const options = Object.assign({}, params, {
      body: obj
    });

    result = await this.request('post', key, options);

    return result;
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
   * @param  {Object} body - Map of parameters to supply.
   * @return {Object} - Full description of remote resource.
   */
  async _PATCH (key, body) {
    return this.request('patch', key, { body });
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

  async _SEARCH (key, params) {
    return this.request('search', key, params);
  }
}

module.exports = Remote;
