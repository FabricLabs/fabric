'use strict';

const fs = require('fs');

const pointer = require('json-pointer');
const monitor = require('fast-json-patch');

const Transaction = require('./transaction');
const Ledger = require('./ledger');
const State = require('./state');
const Store = require('./store');

class Datastore extends Store {
  constructor (state) {
    super(state);

    this.config = Object.assign({
      path: './data/datastore'
    }, state);

    this.ledger = new Ledger();
    this.state = new State();
    this.data = {};

    this.observer = monitor.observe(this.state['@data']);

    return this;
  }

  route (path) {
    let parts = path.split('/');
    if (!parts.length) return '/';
    switch (parts.length) {
      case 1:
        return path;
      case 2:
        return parts[1];
      default:
        return null;
    }
  }

  /**
   * Emulate a POST request.
   * @param  {String}  name Human-friendly name of the collection.
   * @param  {Object}  data Generic object definition.
   */
  async _POST (name, data) {
    this.log(`_POST(${name}, ${data})`);

    // First, route the request.
    let route = this.route(name);
    let vector = new State(data);

    let buffer = vector['@buffer'];
    let string = vector.toString();
    let target = pointer.escape(route);
    let resolver = `@${target}`;
    let path = `/${target}`;

    if (!pointer.has(this.state['@data'], name)) {
      pointer.set(this.state['@data'], name, []);
    }

    let value = pointer.get(this.state['@data'], name);
    let local = await this._PUT(`/hashes/${vector.id}`, data);
    let pushed = await this._PUSH(target, vector.id);
    let commit = await this.commit();
    let entity = State.fromString(string);

    await this.commit();

    return entity;
  }

  async _PUT (key, value) {
    let vector = new State(value);
    let result = null;


    try {
      result = await this.set(key, vector.toString());
    } catch (E) {
      this.error('Could not set data:', E);
    }

    if (result) {
      pointer.set(this.state['@data'], key, vector['@data']);
    }

    return vector['@data'];
  }

  async _GET (key) {
    let response = null;
    let data = await super._GET(key);
    let vector = new State(data);


    try {
      response = JSON.parse(data);
    } catch (E) {
      console.error('Could not parse data:', E);
    }

    return response;
  }

  register (identity) {
    this.identity = identity;
  }

  _loadFrom (dir) {
    let self = this;
    let files = fs.readdirSync(dir);

    for (let i = 0; i < files.length; i++) {
      let content = fs.readFileSync(files[i]);
      self.log('_loadFrom', 'content:', content);
      self['@data'][files[i]] = content;
    }
  }

  _apply (delta) {
    let datastore = this;
    let document = monitor.applyPatch(datastore['@data'], delta);

    datastore._sign();
    document.commit();

    return datastore['@data'];
  }

  ping () {
    let datastore = this;
    let ping = new Transaction({
      entropy: Math.random(),
      timestamp: Date.now(),
      identity: datastore.identity
    });

    ping._sign(datastore.identity);

    this['@data']['/pings'].ledger.append(ping);
    // this['@data']['/pings'].ledger.compute();
    // this.compute();
  }

  pong () {
    this.log('PONG!');
  }

  spam () {
    var datastore = this;
    for (var i = 0; i < 10; i++) {
      datastore.ping();
    }
  }

  render () {
    return `<Datastore />`;
  }
}

module.exports = Datastore;
