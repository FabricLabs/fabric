'use strict';

// External Dependencies
const fetch = require('node-fetch');
const parser = require('content-type');
const querystring = require('querystring');

// Internal Types
const Resource = require('./resource');
const CONTENT_TYPE = 'application/json';

/**
 * Interact with a remote {@link Resource}.  This is currently the only
 * HTTP-related code that should remain in @fabric/core — all else must
 * be moved to @fabric/http before final release!
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
      authority: 'localhost',
      entropy: Math.random(),
      secure: true,
      port: 443
    }, config);

    this.secure = this.settings.secure;

    return this;
  }

  /**
   * Enumerate the available Resources on the remote host.
   * @return {Configuration} An object with enumerable key/value pairs for the Application Resource Contract.
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
   * Make an HTTP request to the configured authority.
   * @param {String} type One of `GET`, `PUT`, `POST`, `DELETE`, or `OPTIONS`.
   * @param {String} path The path to request from the authority.
   * @param {Object} [params] Options.
   * @returns {FabricHTTPResult}
   */
  async request (type, path, params = {}) {
    const self = this;
    const parts = self.settings.authority.split(':');

    // TODO: use onion address for secure mode
    const host = parts[0] || ((self.secure) ? 'localhost' : 'localhost');
    let port = parts[1] || ((self.secure) ? 443 : 80);

    if (this.settings.port) {
      port = this.settings.port;
    }

    const protocol = (!self.secure) ? 'http' : 'https';
    let url = `${protocol}://${host}:${port}${path}`;

    let result = null;
    let response = null;
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

    switch (params.mode) {
      case 'query':
        url += '?' + querystring.stringify(params.body);
        break;
      default:
        try {
          opts.body = JSON.stringify(params.body);
        } catch (exception) {
          console.error('[FABRIC:REMOTE] Could not prepare request:', exception);
        }

        opts = Object.assign(opts, {
          body: params.body || null
        });
        break;
    }

    // Core Logic
    try {
      response = await fetch(url, opts);
    } catch (e) {
      self.emit('error', `[REMOTE] exception: ${e}`);
    }

    if (!response) {
      return {
        status: 'error',
        message: 'No response to request.'
      };
    }

    switch (response.status) {
      case 404:
        result = {
          status: 'error',
          message: 'Document not found.'
        };
        break;
      default:
        if (response.ok) {
          const formatter = parser.parse(response.headers.get('content-type'));
          switch (formatter.type) {
            case 'application/json':
              try {
                result = await response.json();
              } catch (E) {
                console.error('[REMOTE]', 'Could not parse JSON:', E);
              }
              break;
            default:
              if (this.settings.verbosity >= 4) self.emit('warning', `[FABRIC:REMOTE] Unhandled headers content type: ${formatter.type}`);
              result = await response.text();
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
    }

    return result;
  }

  /**
   * HTTP PUT against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} body - Map of parameters to supply.
   * @return {FabricHTTPResult|String} Result of request.
   */
  async _PUT (key, body) {
    return this.request('put', key, { body });
  }

  /**
   * HTTP GET against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {FabricHTTPResult|String} Result of request.
   */
  async _GET (key, params) {
    return this.request('get', key, params);
  }

  /**
   * HTTP POST against the configured Authority.
   * @param  {String} path - HTTP Path to request.
   * @param  {Object} params - Map of parameters to supply.
   * @return {FabricHTTPResult|String} Result of request.
   */
  async _POST (key, obj, params = {}) {
    let result = null;
    let options = null;

    switch (params.mode) {
      case 'query':
        options = Object.assign({}, {
          body: obj,
          mode: 'query'
        });
        break;
      default:
        options = Object.assign({}, params, {
          body: obj,
          mode: 'body'
        });
        break;
    }

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
