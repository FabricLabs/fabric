'use strict';

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
const Peer = require('../types/peer');
const Service = require('../types/service');
// const Bitcoin = require('../services/bitcoin');

// Environment
// TODO: re-evaluate, remove
const Environment = require('../types/environment');
const environment = new Environment();

/**
 * Full definition of a Fabric node.
 */
class Node extends Service {
  /**
   * Manage a Fabric service.
   * @param {Object} settings Configuration for the node.
   * @returns {Node} Instance of the managed service.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = merge({
      name: '@fabric/node',
      full: true,
      autorun: true,
      bitcoin: false,
      peering: true,
      service: Service,
      settings: {}
    }, this.settings, settings);

    // Local Services
    this.node = new Peer(this.settings);
    // this.bitcoin = new Bitcoin(this.settings.bitcoin);
    this.program = null;

    return this;
  }

  get service () {
    return this.program;
  }

  /**
   * Explicitly trusts an {@link EventEmitter}.
   * @param {EventEmitter} source Actor to listen to.
   * @param {Object|String} settings Label for the trusted messages, or a configuration object.
   */
  trust (source, settings = {}) {
    const self = this;
    const extra = (typeof settings === 'string') ? `[${settings}] ` : '';

    source.on('debug', function (debug) {
      self.emit('debug', `[FABRIC:DEBUG] ${extra}${debug}`);
    });

    source.on('info', function (info) {
      console.log(`[FABRIC:INFO] ${extra}`, info);
    });

    source.on('log', function (log) {
      self.emit('log', `[FABRIC:LOG] ${extra}${log}`);
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

    source.on('commit', function (msg) {
      console.log(`[FABRIC:COMMIT] ${extra}`, msg);
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
    }, this.settings.settings);

    // Local Contract
    this.program = new this.settings.service(input);

    // Attach Listeners
    this.trust(this.node, 'PEER:LOCAL');
    this.trust(this.program, 'PROGRAM'); // TODO: debug why 'ready' events come twice?
    // this.trust(this.bitcoin, 'BITCOIN');

    // Start Services
    if (this.settings.autorun) await this.program.start();
    // if (this.settings.bitcoin) await this.bitcoin.start();

    // Start Fabric Node
    if (this.settings.peering) await this.node.start();

    // Notify Listeners
    this.emit('ready', {
      id: this.id
    });

    return this;
  }

  async _call (method, params) {
    return this.program[method].call(this.program, params);
  }
}

module.exports = Node;
