'use strict';

import Fabric from '../';

const fs = require('fs');
const util = require('util');
const ssri = require('ssri');
const jade = require('jade');
const express = require('express');
const bodyParser = require('body-parser');
const pattern = require('path-match')();

const App = require('./app');
const Oracle = require('./oracle');
const Resource = require('./resource');

class HTTP extends Oracle {
  /**
   * Builds an HTTP server for a Contract.  Useful for servicing the legacy web.
   * @param  {Object} config General configuration object for the server.
   * @param  {Object} config.secure Disable security.  Defaults to true fn (!).
   * @param  {Object} config.bootstrap Load Assets from `./assets`.
   * @return {HTTP}        Instance of the resulting Authority.
   */
  constructor (config) {
    if (!config) config = {};

    config = Object.assign({
      name: 'fabric',
      directories: {
        components: 'components'
      },
      precompile: true,
      port: 3000
    }, config);

    super(config);

    this.app = new App();
    this.config = config;

    this.http = express();

    this.resources = {};
    this.routes = {};

    if (config.client && config.client.precompile) {
      this.http.set('view engine', 'js');
      this.http.engine('js', require('compiled-jade-render'));
    } else {
      this.http.set('view engine', 'jade');
    }

    if (config.resources) {
      this.consume(config.resources);
    }

    this.http.set('views', 'assets');

    this.http.use(bodyParser.json());
    this.http.use(function (req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
      return next();
    });

    return this;
  }

  async start () {
    await super.start();

    if (this.config.bootstrap === true) {
      try {
        let assets = await this._load('./assets', {});
        console.debug('initial assets:', assets);
      } catch (E) {
        console.error('[HTTP]', 'failed bootstrap:', E);
      }
    }


    await this.define('Asset', require('../resources/asset'));
    await this.define('Index', {
      routes: {
        list: '/'
      },
      components: {
        list: 'fabric-index'
      },
      // TODO: fully describe application in this field
      data: this['@data']
    });

    // iterate through defined resources, populate their trees
    for (let name in this.resources) {
      let resource = this.resources[name];
      // TODO: specify loading cases
      let result = await this._GET(resource.routes.list);
      this.machine.state[resource.routes.list] = result;
    }

    try {
      this.server = await this.http.listen(this.config.port);
      console.log('[HTTP]', 'listening', this.server.address());
    } catch (E) {
      console.error('[HTTP]', E);
    }

    let prior = this.machine.commit();

    return this;
  }

  async stop () {
    await super.stop();

    try {
      await this.server.close();
      await this.app.tips.close();
      await this.app.stash.close();
      await this.storage.close();

      for (var name in this.resources) {
        let resource = this.resources[name];
        if (resource.store) {
          await resource.store.close();
        }
      }
    } catch (E) {
      console.error('[HTTP]', E);
    }

    return this;
  }

  consume (resources) {
    for (let key in resources) {
      this.define(resources[key].name, resources[key]);
    }
  }

  /**
   * Creates associations in memory by defining a resource by its `name`.
   * @param  {String}  name       Human-friendly name of this {@link Resource}.
   * @param  {Object}  definition Resource description object.
   * @return {Promise}            [description]
   */
  async define (name, definition) {
    let self = this;

    definition = Object.assign({ name }, definition);

    try {
      let app = await this.app.define(name, definition);
      let resource = app.resources[name];

      let source = resource.routes.list + '/:id';
      let query = resource.routes.list;

      self.routes[source] = name;
      self.routes[query] = name;

      self.resources[name] = resource;

      this.http.put('/*', self.router.bind(self));
      this.http.get('/*', self.router.bind(self));
      this.http.post('/*', self.router.bind(self));
      this.http.patch('/*', self.router.bind(self));
      this.http.delete('/*', self.router.bind(self));
      this.http.options('/*', self.router.bind(self));

      self.keys.push(query);
    } catch (E) {
      console.error('[HTTP]', 'defining:', name, E);
    }

    return this;
  }

  async _OPTIONS (link) {
    let map = {};
    for (let name in this.resources) {
      map[name] = this.resources[name]['@data'];
    }
    let options = new Fabric.Vector(map)._sign();
    return options['@data'];
  }

  async route (link) {
    console.debug('[HTTP]', '[ROUTER]', link, this.routes);
    
    for (var route in this.routes) {
      let name = this.routes[route];
      let valid = pattern(route);
      let match = valid(link);

      if (match) {
        return {
          resource: name,
          method: (match && match.id) ? 'view' : 'list',
          query: match
        };
      }
    }
  }

  async router (request, response, skip) {
    let self = this;
    let route = await this.route(request.path);

    if (!route) {
      return response.send({
        status: 'error',
        message: `Received "${request.method} ${request.path}", which is not yet implemented.  Use OPTIONS for a list of available methods.`
      });
    }

    let resource = this.resources[route.resource];
    let output = null;

    switch (request.method) {
      default:
        output = {
          status: 'warning',
          message: `Received "${request.method} ${request.path}" for ${resource.name}, which is not yet implemented.  Use OPTIONS for a list of available methods.`
        };
        break;
      case 'OPTIONS':
        try {
          let answer = await this._OPTIONS(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          output = vector;
        } catch (E) {
          console.error(E);
        }
        break;
      case 'GET':
        try {
          let answer = await this._GET(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          output = vector;
        } catch (E) {
          console.error(E);
        }
        break;
      case 'PUT':
        try {
          let answer = await this._PUT(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          let result = await this._GET(request.path);
          let signed = new Fabric.Vector(result)._sign();

          output = signed;
        } catch (E) {
          console.error(E);
        }
        break;
      case 'POST':
        try {
          let answer = await this._POST(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          return response.redirect(303, [request.path, vector.id].join('/'));
        } catch (E) {
          console.error(E);
        }
        break;
      case 'PATCH':
        try {
          let answer = await this._PATCH(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          let result = await this._GET(request.path);
          let signed = new Fabric.Vector(result)._sign();

          output = signed;
        } catch (E) {
          console.error(E);
        }
        break;
      case 'DELETE':
        try {
          let answer = await this._DELETE(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          output = vector;
        } catch (E) {
          console.error(E);
        }
        break;
    }


    response.send(output['@data']);

    return this;
  }

  async render (path) {
    return this['@data'];
  }
}

module.exports = HTTP;
