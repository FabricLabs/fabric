'use strict';

const crypto = require('crypto');
const parser = require('dotparser');
const visualize = require('javascript-state-machine/lib/visualize');

const StateMachine = require('javascript-state-machine');
const Service = require('./service');

class Circuit extends Service {
  constructor (config = {}) {
    super(config);

    this.config = Object.assign({
      gates: [],
      loops: [],
      wires: []
    }, config);

    this['@data'] = this.config;

    this.transitions = [];
    this.methods = {};
    this.state = {};

    for (let i in this.config.gates) {
      this.transitions.push({
        name: `start`,
        from: 'init',
        to: `${this.config.gates[i]}`
      });
    }

    for (let i in this.config.wires) {
      let wire = this.config.wires[i];
      this.transitions.push({ name: wire.name, from: wire.from, to: wire.to });
    }

    console.log('transitions:', this.transitions);
    console.log('wires:', this.wires);

    this.graph = new StateMachine({
      init: 'init',
      data: this.state,
      transitions: this.transitions,
      methods: this.methods
    });

    return this;
  }

  get hash () {
    return crypto.createHash('sha256').update(this.dot).digest('hex');
  }

  get dot () {
    // TODO: generate polynomial for circuit
    return visualize(this.graph);
  }

  _registerMethod (name, method) {
    this.methods[name] = method;
  }

  toObject () {
    return parser(this.dot);
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
    let hash = crypto.createHash('sha256').update(this.dot).digest('base64');
    return `<fabric-circuit>
  <fabric-code-snippet data-bind="${this.hash}" data-integrity="sha256-${hash}">${this.dot}</fabric-code-snippet>
  <fabric-canvas>
    <fabric-grid>
      <fabric-grid-row>
        <textarea data-bind="${this.hash}" placeholder="Purity contract here...">${this.dot}</textarea>
      </fabric-grid-row>
      <fabric-grid-row>
        <button data-action="_step">step</button>
      </fabric-grid-row>
      <fabric-grid-row>
        <fabric-svg id="svg"></fabric-svg>
      </fabric-grid-row>
      <fabric-grid-row>
        <canvas id="output" data-bind="output"></canvas>
        <canvas id="canvas" data-bind="${this.hash}"></canvas>
      </fabric-grid-row>
  </fabric-canvas>
</fabric-circuit>`;
  }

  _draw () {
    return this;
  }

  async _step () {
    let circuit = this;
    let origin = circuit.hash + '';

    console.log('[CIRCUIT:STEP]', this.graph);
    console.log('[CIRCUIT:STEP]', 'woo:', this.toObject());
    console.log('[CIRCUIT:STEP]', 'zkc:', this.toObject().map((x) => {
      return x.children.filter(x => {
        return x.type === 'edge_stmt';
      }).map((y) => {
        return y.edge_list.map(z => {
          return z.id;
        });
      });
    })[0]);

    console.log('[CIRCUIT:STEP]', 'fsm:', this.graph._fsm);
    console.log('[CIRCUIT:STEP]', 'origin:', origin);
    console.log('[CIRCUIT:STEP]', 'origin hash:', this.hash);
    console.log('[CIRCUIT:STEP]', 'origin data:', this.dot);
    console.log('[CIRCUIT:STEP]', 'current:', this.graph.state);

    switch (this.graph.state) {
      default:
        console.error('unhandled state:', this.graph.state);
        break;
      case 'init':
        this.graph.ready();
        break;
      case 'ready':
        this.graph.step1();
        break;
      case '1':
        this.graph.step2();
        break;
      case '2':
        this.graph.step3();
        break;
      case '3':
        this.graph.done();
        break;
      case 'complete':
        console.log('#winning');
        this.emit('complete');
        break;
    }

    console.log('[CIRCUIT:STEP]', 'after:', this.graph.state);

    this.emit(origin, this.dot);

    await this._PUT(`/output`, Buffer.alloc((256 ** 3) / 8), false);
    await this._PUT(`/source`, this.dot, false);
    await this._PUT(`/status`, this.graph.state, false);

    let commit = await this.commit();

    console.log('commit:', commit);

    return commit;
  }

  async start () {
    return this;
  }
}

module.exports = Circuit;
