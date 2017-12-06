// # HTTP Oracles with Fabric
// Oracles are external points of reference for individual network actors.  They
// can be used to defer authority to an outside source, such as in the
// traditional client-server model.
//
// To run this example, simply try `node examples/oracle.js` from the command-
// line and visit [localhost:3000](http://localhost:3000) in a browser.
//
// ## Code
// Here, we designate ES5 Strict Mode, which causes modern browsers to constrain
// execution parameters for more secure and performant script execution.
'use strict';

// ## Dependencies
// Here we define two simple dependencies, `fs` for filesystem interaction and
// `ssri` to provide secure Sub-Resource Integrity (SRI), which mitigates a
// class of attacks in modern web browsers.
var fs = require('fs');
var ssri = require('ssri');

var config = {
  precompile: true
}; //require('../config');

var jade = require('jade');
var express = require('express');
var router = express();

router.use(express.static('assets'));

router.locals.pretty = true;

router.use('/assets', express.static('assets'));
router.set('views', 'assets');

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
