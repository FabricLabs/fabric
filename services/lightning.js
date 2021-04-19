'use strict';

// External Dependencies
const jayson = require('jayson');

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
      servers: ['unix:' + process.env.HOME + '/.lightning/bitcoin/lightning-cli']
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
      channels: {}
    };

    return this;
  }

  set balances (value) {
    this._state.balances = value;
    this.commit();
    return this
  }

  get balances () {
    return this._state.balances;
  }

  async _syncOracleInfo () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/getInfo');
      if (result && result.id) {
        this._state.id = result.id;
        this._state.name = result.name;
      }
      await this.commit();
    }
    return this._state;
  }

  async _syncBalanceFromOracle () {
    const funds = await this.listFunds();
    const balances = {
      total: 0,
      confirmed: 0,
      unconfirmed: 0
    };

    for (let i = 0; i < funds.outputs.length; i++) {
      if (funds.outputs[i].status === 'confirmed') {
        balances.confirmed = balances.confirmed + funds.outputs[i].value;
      } else if (funds.outputs[i].status === 'unconfirmed') {
        balances.unconfirmed = balances.unconfirmed + funds.outputs[i].value;
      }
    }

    balances.total = balances.confirmed + balances.unconfirmed;

    const actor = new Actor(balances);
    this.balances = balances;

    return {
      type: 'OracleBalance',
      data: { content: balance },
      signature: actor.sign().signature
    };
  }

  async start () {
    const service = this;
    let secure = false;

    // Assign Status
    service.status = 'starting';

    // Local Variables
    let client = null;

    await super.start();
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

    if (this.settings.mode === 'rpc') {
      const providers = service.settings.servers.map(x => new URL(x));
      // TODO: loop through all providers
      let provider = providers[0];

      if (provider.protocol === 'https:') secure = true;
      const auth = provider.username + ':' + provider.password;
      const config = {
        headers: { 'Authorization': `Basic ${Buffer.from(auth, 'utf8').toString('base64')}` },
        host: provider.hostname,
        port: provider.port
      };

      if (secure) {
        client = jayson.client.https(config);
      } else {
        client = jayson.client.http(config);
      }

      // Link generated client to `rpc` property
      service.rpc = client;

      await service._syncBalanceFromOracle();

      // Assign Heartbeat
      service.heartbeat = setInterval(service._heartbeat.bind(service), service.settings.interval);
    }

    this.status = 'started';

    return this;
  }

  async listFunds () {
    return this._makeRPCRequest('listfunds');
  }

  async _makeRPCRequest (method, params = []) {
    const self = this;
    return new Promise((resolve, reject) => {
      self.rpc.request(method, params, function (err, response) {
        if (err) return reject(err);
        return resolve(response.result);
      });
    });
  }
}

module.exports = Lightning;
