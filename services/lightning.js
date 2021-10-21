'use strict';

// Fabric Types
const Service = require('../types/service');
const Machine = require('../types/machine');
const Remote = require('../types/remote');

const OP_TEST = require('../contracts/test');
const Actor = require('../types/actor');
const Key = require('../types/key');

class Lightning extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      authority: 'http://localhost:8555',
      path: './stores/lightning',
      mode: 'rpc',
      interval: 1000
    }, this.settings, settings);

    this.machine = new Machine(this.settings);
    this.rpc = null;
    this.rest = null;
    this.status = 'disconnected';
    this.plugin = null;

    this._state = {
      balances: {
        total: 0,
        confirmed: 0,
        unconfirmed: 0
      },
      channels: {},
      invoices: {},
      peers: {},
      nodes: {}
    };

    return this;
  }

  static plugin (state) {
    const lightning = new Lightning(state);
    const plugin = new LightningPlugin(state);
    plugin.addMethod('test', OP_TEST.bind(lightning));
    // plugin.addMethod('init');
    return plugin;
  }

  get balances () {
    return this._state.balances;
  }

  async start () {
    this.status = 'starting';
    await this.machine.start();

    if (this.settings.mode === 'rest') {
      const provider = new URL(this.settings.authority);
      this.rest = new Remote({
        authority: provider.hostname,
        username: provider.username,
        password: provider.password
      });
      await this._syncOracleInfo();
    }

    this.heartbeat = setInterval(this._heartbeat.bind(this), this.settings.interval);
    this.status = 'started';

    return this;
  }

  async listFunds () {
    return this._makeRPCRequest('listfunds');
  }

  async _heartbeat () {
    await this._syncOracleInfo();
    return this;
  }

  async _generateSmallestInvoice () {
    return await this._generateInvoice(1);
  }

  async _generateInvoice (amount, expiry = 120, description = 'nothing relevant') {
    let result = null;

    if (this.settings.mode === 'rest') {
      const key = new Key();
      const actor = new Actor({
        id: key.id,
        type: 'LightningInvoice',
        data: { amount, expiry }
      });

      const invoice = await this.rest._POST('/invoice/genInvoice', {
        label: actor.id,
        amount: amount,
        expiry: expiry,
        description: description
      });

      result = Object.assign({}, actor.state, {
        encoded: invoice.bolt11,
        expiry: invoice.expires_at,
        data: invoice
      });

      this._state.invoices[key.id] = result;
      await this.commit();
    }

    return result;
  }

  async _syncOracleInfo () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/getInfo');

      if (result && result.id) {
        this._state.id = result.id;
        this._state.name = result.alias;
        this._state.network = result.network;
      }

      await this._syncOracleBalance();
      await this._syncOracleChannels();
    }

    return this._state;
  }

  async _syncOracleBalance () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/getBalance');
      if (result) {
        this._state.balances.total = result.totalBalance;
        this._state.balances.confirmed = result.confBalance;
        this._state.balances.unconfirmed = result.unconfBalance;
        await this.commit();
      }
    }
    return this._state;
  }

  async _syncOracleChannels () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/channel/listChannels');
      const channels = result.map(x => new Actor(x));
      this._state.channels = channels.reduce((obj, me) => {
        obj[me.id] = me.data;
        return obj;
      }, {});
      await this.commit();
    }

    return this._state;
  }
}

module.exports = Lightning;
