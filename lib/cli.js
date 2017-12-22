'use strict';

const util = require('util');
const jade = require('jade');
const parse = require('xml2js').parseString;
const blessed = require('blessed');

const Viewer = require('wopr');

function CLI (init) {
  this['@data'] = init || {};
  this.clock = 0;
  this.stack = [];
  this.known = {};
  this.init();
}

// all user interfaces begin with a "Vector"
util.inherits(CLI, require('../lib/vector'));

CLI.prototype.define = async function (xml) {
  var parsed = await parse(xml, function(err, doc) {
    
  });
  
  console.log('parsed:', parsed);
};

CLI.prototype.start = function () {
  console.log('ui:', this['@data'].ui);
  
  var render = jade.compileFile(this['@data'].ui);
  var xml = render(this['@data']);
  
  console.log(xml);

  parse(xml, function(err, doc) {
    if (err) return console.error(err);
    if (!doc || !doc.document) return console.error('Invalid UI definition.');
    
    console.log('doc:', doc);

    var screen = blessed.screen();
    var viewer = new Viewer(doc.document, screen);

    screen.key(['q', 'escape'], function(ch, key) {
      process.exit()
    });
    
    viewer.renderPage(0);
  });
  
};

module.exports = CLI;
