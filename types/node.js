'use strict';

// Settings
const merge = require('lodash.merge');
const defaults = require('../settings/default');

// Fabric Types
const Peer = require('../types/peer');
const Service = require('../types/service');
const Bitcoin = require('../services/bitcoin');

// Environment
// TODO: re-evaluate, remove
const Environment = require('../types/environment');
const environment = new Environment();

/**
 * Full definition of a Fabric node.
 */
class Node extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: '@fabric/node',
      full: true,
      bitcoin: {
        authority: 'http://localhost:18443'
      },
      service: Service
    }, defaults, settings);

    this.node = null;
    this.bitcoin = null;
    this.program = null;

    return this;
  }

  /**
   * Explicitly trusts an {@link EventEmitter}.
   * @param {EventEmitter} source Actor to listen to.
   * @param {Object|String} settings Label for the trusted messages, or a configuration object.
   */
  trust (source, settings = {}) {
    let extra = '';

    if (typeof settings === 'string') {
      extra = `[${settings}]`;
    }

    source.on('debug', function (debug) {
      console.debug(`[FABRIC:DEBUG] ${extra}`, debug);
    });

    source.on('info', function (info) {
      console.log(`[FABRIC:INFO] ${extra}`, info);
    });

    source.on('log', function (log) {
      console.log(`[FABRIC:LOG] ${extra}`, log);
    });

    source.on('warning', function (warn) {
      console.warn(`[FABRIC:WARNING] ${extra}`, warn);
    });

    source.on('error', function (error) {
      console.error(`[FABRIC:ERROR] ${extra}`, error);
    });

    source.on('exception', function (error) {
      console.error(`[FABRIC:EXCEPTION] ${extra}`, error);
    });

    source.on('message', function (msg) {
      console.log(`[FABRIC:MESSAGE] ${extra}`, msg);
    });

    source.on('ready', function () {
      console.log(`[FABRIC] ${extra}`, `<${source.constructor.name}>`, 'Claimed ready!');
    });
  }

  async start () {
    // Read Environment
    environment.start();

    // Prepare Input
    const input = merge({
      debug: (!environment.readVariable('DEBUG')),
      seed: environment.readVariable('FABRIC_SEED'),
      port: environment.readVariable('FABRIC_PORT')
    }, this.settings);

    // Local Services
    this.node = new Peer();
    this.program = new this.settings.service(input);
    this.bitcoin = new Bitcoin(this.settings);

    this.trust(this.node, 'PEER:LOCAL');
    this.trust(this.program, 'PROGRAM'); // TODO: debug why 'ready' events come twice?
    this.trust(this.bitcoin, 'BITCOIN');

    await this.program.start();
    await this.bitcoin.start();
    await this.node.start();

    this.emit('ready', {
      id: this.id
    });

    return this;
  }
}

module.exports = Node;
