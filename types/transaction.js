'use strict';

const Actor = require('./actor');

class Transaction extends Actor {
  constructor (settings = {}) {
    if (settings instanceof Transaction) return settings;

    super(settings);

    this.settings = Object.assign({
      type: 'Transaction'
    }, settings);

    this._state = {
      settings: this.settings,
      content: Object.assign({
        type: this.settings.type,
      }, settings)
    };

    Object.defineProperty(this, 'history', { enumerable: false });

    return this;
  }
} 

module.exports = Transaction;
