'use strict';

const parser = require('dotparser');
const visualize = require('javascript-state-machine/lib/visualize');

const StateMachine = require('javascript-state-machine');
const Service = require('./service');

class Circuit extends Service {
  constructor (config = {}) {
    super(config);

    this.config = Object.assign({
      gates: []
    }, config);

    this['@data'] = this.config;

    let changes = this.config.gates.map((x) => {
      return { name: `constructor`, from: 'init', to: `${x}` };
    });

    this.graph = new StateMachine({
      transitions: changes
    });

    return this;
  }

  get dot () {
    // TODO: generate polynomial for circuit
    return visualize(this.graph);
  }

  parse (input) {
    return parser(input);
  }

  compute (input) {
    let output = input;

    // empty resolves to Identity function f(x) = x

    return output;
  }

  render () {
    return `<fabric-circuit data-bind="test" data-blob="${JSON.stringify(this['@data'])}">
  <code>${this.dot}</code>
</fabric-circuit>`;
  }
}

module.exports = Circuit;
