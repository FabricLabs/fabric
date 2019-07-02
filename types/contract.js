'use strict';

const parser = require('dotparser');
const State = require('./state');

class Contract extends State {
  constructor (graph) {
    super(graph);

    this['@data'] = graph;

    return this;
  }

  parse (input) {
    return parser(input);
  }
}

module.exports = Contract;
