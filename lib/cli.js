'use strict';

const util = require('util');
const jade = require('jade');
const parse = require('xml2js').parseString;
const blessed = require('blessed');
const contrib = require('blessed-contrib');

const Fabric = require('../');
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
  let self = this;

  self.screen = blessed.screen({
    smartCSR: true,
    dockBorders: true
  });

  self.screen.key(['q', 'escape'], function(ch, key) {
    process.exit();
  });

  self.form = blessed.form({
    parent: self.screen,
    keys: true,
    top: '100%-1',
    //height: '100%',
    //width: '100%'
  });
  
  self.textbox = blessed.textbox({
    parent: self.form,
    name: 'input',
    input: true,
    focused: true,
    value: '',
    bottom: 0,
    width: '80%',
    mouse: true,
    //keys: true,
  });

  self.submit = blessed.button({
    parent: self.form,
    //parent: self.form,
    mouse: true,
    //keys: true,
    shrink: true,
    bottom: 0,
    right: 0,
    padding: {
      left: 1,
      right: 1
    },
    name: 'submit',
    content: 'Send',
    style: {
      bg: 'blue'
    }
  });
  
  /*self.log = contrib.log({
    parent: self.screen,
    label: 'History',
    bottom: 2
  });*/
  
  self.history = blessed.box({
    parent: self.screen,
    label: 'History',
    scrollable: true,
    keys: true,
    mouse: true,
    height: '100%-3',
    border: {
      type: 'line'
    },
    scrollbar: true
  });

  self.textbox.key(['enter'], function(ch, key) {
    self.form.submit();
    self.textbox.clearValue();
    self.textbox.readInput();
  });
  
  self.textbox.on('click', function () {
    this.readInput();
  });
  
  self.submit.on('press', function () {
    self.form.submit();
  });
  
  self.form.on('submit', function (data) {
    var now = new Date();
    //console.log('form submitted:', data);
    //self.log.log(data.input);
    
    self.form.reset();
    
    self.history.pushLine(now.toString() + ': ' + data.input);
    self.screen.render();
  });

  self.screen.render();

  //self.form.focus();
  self.textbox.readInput();
  
}

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
}

CLI.prototype.render = function (done) {
  const self = this;
  const render = jade.compileFile(this['@data'].ui);
  const xml = render(this['@data']);

  parse(xml, function(err, doc) {
    if (err) return console.error(err);
    //if (!doc || !doc.document) return console.error('Invalid UI definition.');

    console.log('doc:', doc);

    self.screen = blessed.screen();
    self.viewer = new Viewer(doc, self.screen);

    self.screen.key(['q', 'escape'], function(ch, key) {
      process.exit()
    });

    for (var i in doc) {
      var item = doc[i];
      var name = Object.keys(item)[1];
      var element = contrib[i] || blessed[i];
      
      console.log('loop:', item, name, element, opts);
      
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
