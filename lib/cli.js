'use strict';

import Fabric from '../';

const util = require('util');
const jade = require('jade');
const parse = require('xml2js').parseString;
const blessed = require('blessed');
const contrib = require('blessed-contrib');

//const Fabric = require('../');
const Viewer = require('wopr');

/**
 * Base class for a terminal-like interface to the Fabric network.
 * @param       {Object} configuration Configuration object for the CLI.
 * @constructor
 * @property storage {Storage} - Instance of {@link Storage}.
 */
function CLI (init) {
  this['@data'] = init || {};

  this.config = Object.assign({
    oracle: true,
    ui: './assets/cli.jade'
  }, init);

  if (this.config.oracle) {
    this.oracle = new Fabric.HTTP();
  }

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

CLI.prototype._createInstance = function () {
  let self = this;

  self.screen = blessed.screen({
    smartCSR: true,
    dockBorders: true
  });

  self.screen.key(['escape'], function(ch, key) {
    process.exit();
  });

  self.oracle = new Fabric.HTTP({
    name: 'fabric'
  });

};

CLI.prototype.start = function () {
  let self = this;

  self._createInstance();

  self.controls = blessed.box({
    parent: self.screen,
    border: {
      type: 'line'
    },
    bottom: 0,
    height: 3
  });

  self.form = blessed.form({
    parent: self.screen,
    keys: true,
    //top: '100%-1',
    //height: '100%',
    //width: '100%'
  });

  self.textbox = blessed.textbox({
    parent: self.form,
    name: 'input',
    input: true,
    inputOnFocus: true,
    focused: true,
    value: '',
    bottom: 1,
    width: '80%',
    mouse: true,
    height: 3,
    width: '100%',
    border: {
      type: 'line'
    },
    keys: true
  });

  self.submit = blessed.button({
    parent: self.form,
    //parent: self.form,
    mouse: true,
    //keys: true,
    shrink: true,
    bottom: 0,
    right: 0,
    name: 'submit',
    content: '[ENTER] Send',
    style: {
      bg: 'blue'
    },
    padding: {
      left: 1,
      right: 1
    }
  });
  
  self.instructions = blessed.box({
    parent: self.screen,
    content: '[ESCAPE (2x)] exit]',
    bottom: 0,
    height: 1,
    width: '100%-20',
    padding: {
      left: 1,
      right: 1
    }
  });
  
  /*self.labels = blessed.box({
    parent: self.screen,
    content: 'Messaging as Anonymous:',
    detached: true,
    bottom: 5,
    style: {
      
    }
  }),*/

  self.history = blessed.box({
    parent: self.screen,
    label: 'History',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    height: '100%-3',
    border: {
      type: 'line'
    },
    scrollbar: {}
  });

  self.textbox.key(['enter'], function(ch, key) {
    self.form.submit();
    self.textbox.clearValue();
    self.textbox.readInput();
  });

  self.submit.on('press', function () {
    self.form.submit();
  });

  self.form.on('submit', async function (data) {
    var now = new Date();

    self.form.reset();

    let result = await self.oracle._POST('/chats', {
      input: data.input
    });

    self.history.pushLine(now.toString() + ': ' + JSON.stringify(result, '  ', '  '));
    self.history.setScrollPerc(100);

    self.screen.render();
  });

  self.screen.render();

  //self.form.focus();
  self.textbox.readInput();

};

CLI.prototype.stop = function () {
  this.screen.destroy();
};

CLI.prototype.inspect = function () {
  let self = this;

  self.screen = blessed.screen();
  self.screen.key(['q', 'escape'], function(ch, key) {
    process.exit();
  });

  self.grid = new contrib.grid({ rows: 12, cols: 12, screen: self.screen });

  self.log = self.grid.set(0, 0, 10, 9, contrib.log, {
    label: 'History',
    fg: 'green',
    selectedFg: 'green'
  });
  
  self.tree = self.grid.set(0, 9, 12, 3, contrib.tree, {
    label: 'Menu',
    fg: 'green'
  });
  
  /*self.form = self.grid.set(11, 2, 0, 9, blessed.form, {
    label: 'Input',
    fg: 'green'
  });*/

  self.tree.setData({
    extended: true,
    children: {
      'RPG': {
        children: []
      }
    }
  });

  self.screen.render();

  /*setInterval(function() {
    self.log.log(Math.random() + '');
  }, 100);*/
};

CLI.prototype.render = function (done) {
  const self = this;
  const render = jade.compileFile(this['@data'].ui);
  const xml = render(this['@data']);

  parse(xml, function(err, doc) {
    if (err) return console.error(err);
    //if (!doc || !doc.document) return console.error('Invalid UI definition.');

    console.debug('doc:', doc);

    self.screen = blessed.screen();
    self.viewer = new Viewer(doc, self.screen);

    self.screen.key(['q', 'escape'], function(ch, key) {
      process.exit()
    });

    for (var i in doc) {
      var item = doc[i];
      var name = Object.keys(item)[1];
      var element = contrib[i] || blessed[i];
      
      console.debug('loop:', item, name, element, opts);
      
      if (!element) throw new Error('Unexpected interface element: ' + name);
      
      var opts = self.viewer.readOptions(item, element);


      self.screen.append(element);
    }

    self.screen.render();
    //self.viewer.render();

    done();
  });
  
};

module.exports = CLI;
