'use strict';

const fs = require('fs');
const util = require('util');
const ssri = require('ssri');
const jade = require('jade');
const express = require('express');
const bodyParser = require('body-parser');

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

    let self = this;

    this.app = new App();
    this.config = config;
    this.router = express();

  if (config.client && config.client.precompile) {
    this.router.set('view engine', 'js');
    this.router.engine('js', require('compiled-jade-render'));
  } else {
    this.router.set('view engine', 'jade');
  }

    // TODO: use Resource
    this.router.use('/assets', express.static('assets'));
    this.router.set('views', 'assets');

    this.router.use(bodyParser.json());

    if (config.client && config.client.precompile) {
      this.router.set('view engine', 'js');
      this.router.engine('js', require('compiled-jade-render'));
    } else {
      this.router.set('view engine', 'jade');
      this.router.locals.pretty = true;
    }


    this.router.get('/assets', function (req, res, next) {
      return res.send([]); // empty array for now.
      // TODO: finish this endpoint
    });
  }
}

HTTP.prototype.define = async function (name, definition) {
  let self = this;
  let resource = await this.app.define(name, definition);
  
  resource.attach(self.app);

  this.router.post(resource.routes.query, async function (req, res, next) {
    let obj = await resource.create(req.body);
    //res.status(303, )
    return res.send(obj);
  });
  
  this.router.get(resource.routes.query, async function (req, res, next) {
    let obj = await resource.query(req.params);
    return res.send(obj);
  });

  self.keys.push(resource.routes.query);

};

HTTP.prototype.stop = async function () {
  this.server.close();

  console.log('[HTTP]', 'stopping...');

  try {
    await this.app.tips.close();
    await this.app.stash.close();
  } catch (E) {
    console.error(E);
  }

  return this;
};

HTTP.prototype.start = async function () {
  console.log('[HTTP]', 'starting...');
  try {
    this.server = await this.router.listen(3000);
  } catch (E) {
    console.error(E);
  }
};

module.exports = HTTP;
