'use strict';

var fs = require('fs');
var path = require('path');
var ssri = require('ssri');

var config = {
  precompile: true
}; //require('../config');

var express = require('express');
var router = express();

router.use(express.static('assets'));

router.set('views', path.join(__dirname, '../assets'));

if (config.client && config.client.precompile) {
  router.set('view engine', 'js');
  router.engine('js', require('compiled-jade-render'));
} else {
  router.set('view engine', 'jade');
}

config.scripts = [{
  link: '/app.js',
  integrity: ssri.fromData(fs.readFileSync('./assets/app.js')),
}];

router.get('/', function (req, res) {
  res.render('app', config);
});

router.listen(3000, function () {
  console.log('listening:', 'http://127.0.0.1:3000');
});
