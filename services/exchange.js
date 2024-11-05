'use strict';

// Constants
const BTC = require('../currencies/btc');
const BTCA = require('../currencies/btca');
const BTCB = require('../currencies/btcb');

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
const Actor = require('../types/actor');
const Entity = require('../types/entity');
const Collection = require('../types/collection');
const Message = require('../types/message');
const Service = require('../types/service');

class Exchange extends Service {
  constructor (settings = {}) {
    super(settings);

    // Configures Defaults
    this.settings = merge({
      anchor: 'BTC', // Symbol of Primary Timestamping Asset (PTA)
      path: './stores/exchange-playnet',
      debug: false,
      orders: [], // Pre-define a list of Orders
      premium: {
        type: 'bips',
        value: 2000 // 2000 bips === 20%
      },
      currencies: [
        BTC,
        BTCA,
        BTCB
      ],
      fees: {
        minimum: 20000 // satoshis
      }
    }, settings, this.settings);

    // TODO: finalize Collection API in #docs-update
    this.orders = new Collection(this.settings.orders);
    this.currencies = new Collection(this.settings.currencies);

    // Internal State
    this._state = {
      actors: {}, // Fabric Actors
      blocks: {}, // Fabric Blocks
      chains: {}, // Fabric Chains
      channels: {}, // Fabric Channels
      oracles: {}, // Fabric Oracles
      pairs: {}, // Portal Pairs
      transactions: {}, // Fabric Transactions
      witnesses: {}, // Fabric Witnesses
      orders: {} // Portal Orders
    };

    // Chainable
    return this;
  }

  async bootstrap () {
    if (!this.settings.debug) return;
    for (let i = 0; i < this.settings.orders.length; i++) {
      const order = this.settings.orders[i];
      order.signature = Buffer.alloc(64);
      const posted = await this._postOrder(order);
      this.emit('message', `Posted Order: ${posted}`);
    }
    return this;
  }

  async start () {
    // Set a heartbeat
    this.heartbeat = setInterval(this._heartbeat.bind(this), this.settings.interval);
    await this.bootstrap();
    this.emit('message', `[FABRIC:EXCHANGE] Started!`);
    this.emit('ready');
  }

  async _heartbeat () {
    await super._heartbeat();
    await this._matchOrders(this._state.orders);
  }

  async _postOrder (order) {
    if (!order) return new Error('Order must be provided.');
    if (!order.signature) return new Error('Order must be signed.');

    const entity = new Entity(order);
    this.emit('message', `Posting order [${entity.id}] ...`);

    const state = await this.orders.create(entity);
    this.emit('message', `Order [${entity.id}] posted: ${state}`);

    if (!this._state.orders[entity.id]) this._state.orders[entity.id] = entity;

    await this.commit();
    this.emit('message', Message.fromVector(['PostedExchangeOrder', state]));

    return state;
  }

  async _matchOrders (orders) {
    const exchange = this;
    const incomplete = Object.values(orders).filter(x => (x.status !== 'completed'));
    const haves = incomplete.filter(x => (x.have === exchange.settings.anchor));
    const wants = incomplete.filter(x => (x.want === exchange.settings.anchor));
    return {
      type: 'ExchangeOrderExecution',
      data: {
        haves,
        wants
      }
    };
  }
}

module.exports = Exchange;
