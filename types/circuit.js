'use strict';

// External dependencies
const crypto = require('crypto');
const parser = require('dotparser');
const visualize = require('javascript-state-machine/lib/visualize');
const StateMachine = require('javascript-state-machine');

// Fabric Types
const Machine = require('./machine');
const Service = require('./service');

/**
 * The {@link Circuit} is the mechanism through which {@link Fabric}
 * operates, a computable directed graph describing a network of
 * {@link Peer} components and their interactions (side effects).
 * See also {@link Swarm} for deeper *inspection of {@link Machine}
 * mechanics.
 */
class Circuit extends Service {
  constructor (config = {}) {
    super(config);

    this.settings = Object.assign({
      edges: [],
      gates: [],
      loops: [],
      nodes: [],
      wires: []
    }, config);

    this['@data'] = this.settings;

    this.gates = [];
    this.transitions = [];
    this.methods = {};

    // External State
    this.state = {
      edges: [],
      nodes: []
    };

    for (let i in this.settings.gates) {
      this.transitions.push({
        name: `step`,
        from: 'cycle()',
        to: `${this.settings.gates[i]}`
      });
    }

    for (let i in this.settings.wires) {
      let wire = this.settings.wires[i];
      this.transitions.push({ name: wire.name, from: wire.from, to: wire.to });
    }

    this.graph = new StateMachine({
      init: 'start()',
      data: this.state,
      transitions: this.transitions,
      methods: this.methods
    });

    // Internal State
    this._state = {
      steps: [
        'load', // load from storage
        'bootstrap', // configure memory
        'step', // single cycle before start
        'start', // create services
        'listen' // listen for input
      ]
    };

    return this;
  }

  get hash () {
    return crypto.createHash('sha256').update(this.dot).digest('hex');
  }

  get dot () {
    // TODO: generate polynomial for circuit
    return visualize(this.graph, {
      orientation: 'horizontal'
    });
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

  scramble () {
    let key = crypto.randomBytes(32);
    let machine = new Machine({ seed: key });
    let seed = machine.sip();
    let gates = [];

    for (let i = 0; i < this._state.steps.length; i++) {
      gates.push({
        name: this._state.steps[i],
        seed: machine.sip()
      });
    }

    gates.sort((a, b) => {
      return a.seed - b.seed;
    });

    return gates;
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
