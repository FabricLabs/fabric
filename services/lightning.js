'use strict';

// Fabric Types
const Service = require('../types/service');
const Machine = require('../types/machine');
const Remote = require('../types/remote');

const OP_TEST = require('../contracts/test');
const Actor = require('../types/actor');

class Lightning extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      path: './stores/lightning',
      mode: 'rpc',
      servers: ['http://localhost:8555'],
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
      peers: {},
      nodes: {}
    };

    return this;
  }

  get balances () {
    return this._state.balances;
  }

  async start () {
    const service = this;
    service.status = 'starting';
    await this.machine.start();

    if (this.settings.mode === 'rest') {
      const providers = service.settings.servers.map(x => new URL(x));
      // TODO: loop through all providers
      const provider = providers[0];

      this.rest = new Remote({
        authority: provider.hostname,
        username: provider.username,
        password: provider.password
      });

      await this._syncOracleInfo();
    }

    service.heartbeat = setInterval(service._heartbeat.bind(service), service.settings.interval);

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
