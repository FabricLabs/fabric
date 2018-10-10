'use strict';

const fs = require('fs');
const monitor = require('fast-json-patch');

const Store = require('./store');
const Ledger = require('./ledger');
const Transaction = require('./transaction');

class Datastore extends Store {
  constructor (state) {
    super(state);

    this.config = Object.assign({
      path: './data/datastore'
    }, state);

    this.ledger = new Ledger();
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

  register (identity) {
    this.identity = identity;
  }

  _loadFrom (dir) {
    let self = this;
    let files = fs.readdirSync(dir);

    this.log('_loadFrom', dir, 'files:', files);

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

    this.log('[DATASTORE]', '_apply', 'document:', document);
    this.log('[DATASTORE]', '_apply', 'datastore:', datastore);

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
