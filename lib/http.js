'use strict';

const fs = require('fs');
const util = require('util');
const ssri = require('ssri');
const jade = require('jade');
const express = require('express');

function HTTP () {
  var config = {
    precompile: true
  };
  
  this.router = express();
  
  this.router.use('/assets', express.static('assets'));
  this.router.set('views', 'assets');

  if (config.client && config.client.precompile) {
    this.router.set('view engine', 'js');
    this.router.engine('js', require('compiled-jade-render'));
  } else {
    this.router.set('view engine', 'jade');
  }

  config.scripts = [
    '/assets/webcomponents-loader.js',
    '/assets/app.js'
  ].map(function(x) {
    return {
      link: x,
      integrity: ssri.fromData(fs.readFileSync('./' + x))
    };
  });

  config.stylesheets = [];

  // TODO: read from directory
  config.components = [
    '/components/application',
    '/components/component',
    '/components/index'
  ].map(function (x) {
    return {
      link: x,
      content: fs.readFileSync(__dirname + '/..' + x + '.jade')
    }
  });

  this.router.get('/', function (req, res) {
    res.render('app', config);
  });

  this.router.options('/', function (req, res) {
    res.send({
      'Test': { name: 'Test' }
    });
  });

  this.router.get('/components/:name', function (req, res, next) {
    return res.render('../components/' + req.param('name'), config);
  });

  this.router.get('/assets', function (req, res, next) {
    return res.send([]); // empty array for now.
    // TODO: finish this endpoint
  });

  this.router.get('/people', function (req, res) {
    return res.send([]);
  });
}

util.inherits(HTTP, require('./vector'));

HTTP.prototype.start = function () {
  this.router.listen(3000, function () {
    console.log('listening:', 'http://127.0.0.1:3000');
  });
}

module.exports = HTTP;
