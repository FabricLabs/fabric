'use strict';

const {
  OP_DONE,
  OP_SEPARATOR
} = require('../constants');

const Circuit = require('../types/circuit');
const Component = require('@fabric/http/components/component');

const d3 = require('d3');
const d3Graphviz = require('d3-graphviz');

class CircuitView extends Component {
  constructor (settings = {}) {
    super(settings);

    this.d3 = d3;
    this.d3Graphviz = d3Graphviz;

    this.settings = Object.assign({
      title: 'Circuit View',
      handle: 'fabric-circuit-view'
    });

    this.circuit = new Circuit();
    this.state = {
      status: 'ready'
    };

    return this;
  }

  _advanceCircuit (event) {
    event.preventDefault();
    console.log('advancing circuit:', this, this.circuit.settings.program);

    this.circuit = new Circuit(Object.assign({}, this.circuit.settings, {
      program: this.circuit.settings.program,
      wires: [{
        name: 'start',
        from: 'init',
        to: this.circuit.settings.program[0]
      }].concat(this.circuit.settings.program.map((instruction, i) => {
        return {
          name: instruction,
          from: instruction,
          to: this.circuit.settings.program[i + 1] || OP_DONE
        };
      })).concat([{
        name: OP_DONE,
        from: OP_DONE,
        to: OP_DONE
      }])
    }));

    let transition = d3.transition().delay(100).duration(1000);
    d3.select('#circuit-svg').style('width', '100%').style('width', '500px').graphviz().transition(transition).renderDot(this.circuit.dot);
    d3.select('#circuit-svg svg').style('width', '100%').style('width', '500px');
  }

  _loadFromPath () {
    let path = document.location.pathname;
    let parts = path.split('/')[2];
    let wires = parts.split(OP_SEPARATOR).map((instruction, i) => {
      return {
        name: instruction,
        from: instruction,
        to: parts.split(OP_SEPARATOR)[i + 1]
      };
    });

    this.circuit = new Circuit({
      script: parts,
      program: parts.split(OP_SEPARATOR),
      wires: wires
    });

    return this.circuit;
  }

  async connectedCallback () {
    await super.connectedCallback();

    window.app.circuit._registerMethod('_advanceCircuit', this._advanceCircuit.bind(this));

    let svg = this.querySelector('#circuit-svg');
    let circuit = this._loadFromPath();

    return this;
  }

  _getInnerHTML () {
    return `<div class="ui segment">
      <h3>${this.settings.title}</h3>
      <button data-action="_advanceCircuit" class="ui mini right labeled icon button">advance<i class="fast forward icon"></i></button>
      <div class="canvas">
        <div id="circuit-svg"></div>
      </div>
    </div>`;
  }
}

module.exports = CircuitView;
