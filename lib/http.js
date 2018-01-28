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
  constructor (config) {
    if (!config) config = {};

    config = {
      precompile: config.precompile || true,
      port: config.port || 3000
    };

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

    this.http.set('views', 'assets');

    this.http.use(bodyParser.json());
    this.http.use(function(req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
      return next();
    });

    return this;
  }

  async start () {
    super.start();

    console.log('[HTTP]', 'starting...');

    if (this.config.bootstrap === true) {
      try {
        let assets = await this._load('./assets', {});
        console.log('initial assets:', assets);
      } catch (E) {
        console.error(E);
      }
    }

    let Asset = await this.define('Asset', require('../resources/asset'));

    try {
      this.server = await this.http.listen(3000);
      console.log('[HTTP]', 'listening', this.server.address());
    } catch (E) {
      console.error('[HTTP]', E);
    }

    return this;
  }

  async stop () {
    await this.server.close();

    console.log('[HTTP]', 'stopping...');

    try {
      await this.app.tips.close();
      await this.app.stash.close();
      await this.storage.close();

      for (var name in this.resources) {
        let resource = this.resources[name];
        await resource.store.close();
      }
    } catch (E) {
      console.error('[HTTP]', E);
    }
    
    console.log('[HTTP]', 'closed!');
    
    return this;
  }

  async route (link) {
    for (var route in this.routes) {
      let name = this.routes[route];
      let valid = pattern(route);
      let match = valid(link);

      if (match) {
        return {
          resource: name,
          method: (match && match.id) ? 'get' : 'list',
          query: match
        };
      }
    }
  }

  async define (name, definition) {
    //let real = await super.define(name, definition);
    let self = this;

    console.log('[HTTP]', 'defining...', name, definition);

    try {
      let app = await this.app.define(name, definition);
      let resource = app.resources[name];

      let source = definition.routes.query + '/:id';
      let query = definition.routes.query;

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
      console.error(E);
    }

    return this;
  }

  async router (request, response, skip) {
    let route = await this.route(request.path);
    let resource = this.resources[route.resource];

    console.log('route:', request.method, request.path, route);

    switch (request.method) {
      default:
        response.send({
          status: 'warning',
          message: `Received "${request.method} ${request.path}" for ${resource.name}, which is not yet implemented.  Use OPTIONS for a list of available methods.`
        });
        break;
      case 'OPTIONS':
        response.send(self.resources);
        break;
      case 'GET':
        try {
          let answer = await this._GET(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          console.log('answer:', answer);
          console.log('vector:', vector);

          response.send(vector);
        } catch (E) {
          console.error(E);
        }

        break;
      case 'PUT':
        try {
          let answer = await this._PUT(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          console.log('answer:', answer);
          console.log('vector:', vector);

          let result = await this._GET(request.path);
          let output = new Fabric.Vector(result)._sign();

          response.send(output);
        } catch (E) {
          console.error(E);
        }
        break;
    }

    return this;
  }
}

module.exports = HTTP;
