'use strict';

// Dependencies
const merge = require('lodash.merge');

// Fabric Types
const Collection = require('../types/collection');
const Entity = require('../types/entity');
const Service = require('../types/service');

/**
 * Implements a basic Exchange.
 */
class Exchange extends Service {
  /**
   * Create an instance of the Exchange.  You may run two instances at
   * once to simulate two-party contracts, or use the Fabric Market to
   * find and trade with real peers.
   * @param {Object} settings Map of settings to values.
   * @param {Object} settings.fees Map of fee settings (all values in BTC).
   * @param {Object} settings.fees.minimum Minimum fee (satoshis).
   * @returns Exchnge
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = merge({
      anchor: 'btc',
      path: './stores/exchange-playnet',
      orders: [],
      currencies: [
        {
          name: 'Bitcoin',
          symbol: 'BTC'
        },
        // Helix Chain
        {
          name: 'BTCA',
          symbol: 'BTCA'
        },
        {
          name: 'BTCB',
          symbol: 'BTCB'
        }
      ],
      fees: {
        minimum: 20000 // satoshis
      }
    }, settings, this.settings);

    // TODO: finalize Collection API in #docs-update
    this.orders = new Collection(this.settings.orders);
    this.currencies = new Collection(this.settings.currencies);

    return this;
  }

  async _postOrder (order) {
    if (!order) return new Error('Order must be provided.');
    if (!order.signature) return new Error('Order must be signed.');

    const entity = new Entity(order);
    this.emit('message', `Posting order [${entity.id}] ...`);

    const state = await this.orders.create(entity);
    this.emit('message', `Order [${entity.id}] posted: ${state}`);
  }

  async _matchOrders () {
    
  }
}

module.exports = Exchange;
