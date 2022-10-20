'use strict';

// Dependencies
const net = require('net');

// Fabric Types
const Service = require('../types/service');
const Machine = require('../types/machine');

// Fabric Edge
const Remote = require('@fabric/http/types/remote');

const OP_TEST = require('../contracts/test');
const Actor = require('../types/actor');
const Key = require('../types/key');

class Lightning extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      authority: 'http://127.0.0.1:8182',
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
      content: {
        actors: {},
        balances: {},
        channels: {},
        blockheight: null,
        node: {
          id: null,
          alias: null,
          color: null
        }
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
    return this.state.balances;
  }

  async start () {
    this.status = 'starting';
    await this.machine.start();

    switch (this.settings.mode) {
      default:
        throw new Error(`Unknown mode: ${this.settings.mode}`);
        break;
      case 'grpc':
        throw new Error('Disabled.');
        break;
      case 'rest':
        const provider = new URL(this.settings.authority);
        this.rest = new Remote({
          host: this.settings.host,
          macaroon: this.settings.macaroon,
          username: provider.username,
          password: provider.password,
          port: this.settings.port,
          secure: this.settings.secure
        });
        await this._syncOracleInfo();
        break;
      case 'rpc':
        break;
      case 'socket':
        this.emit('debug', 'Beginning work on Lightning socket compatibility...')
        await this._sync();
        break;
    }

    this._heart = setInterval(this._heartbeat.bind(this), this.settings.interval);
    this.status = 'started';

    this.emit('ready', this.export());

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

  async _makeGRPCRequest (method, params = []) {
    return new Promise((resolve, reject) => {
      try {
        this.grpc.on('data', (data) => {
          try {
            const response = JSON.parse(data.toString('utf8'));
            if (response.result) {
              return resolve(response.result);
            } else if (response.error) {
              return reject(response.error);
            }
          } catch (exception) {
            this.emit('error', `Could not make RPC request: ${exception}\n${data.toString('utf8')}`);
          }
        });

        this.grpc.write(JSON.stringify({
          method: method,
          params: params,
          id: 0
        }), null, '  ');
      } catch (exception) {
        reject(exception);
      }
    });
  }

  /**
   * Make an RPC request through the Lightning UNIX socket.
   * @param {String} method Name of method to call.
   * @param {Array} [params] Array of parameters.
   * @returns {Object|String} Respond from the Lightning node.
   */
  async _makeRPCRequest (method, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const client = net.createConnection({ path: this.settings.path });

        client.on('data', (data) => {
          try {
            const response = JSON.parse(data.toString('utf8'));
            if (response.result) {
              return resolve(response.result);
            } else if (response.error) {
              return reject(response.error);
            }
          } catch (exception) {
            this.emit('error', `Could not make RPC request: ${exception}\n${data.toString('utf8')}`);
          }
        });

        client.write(JSON.stringify({
          method: method,
          params: params,
          id: 0
        }), null, '  ');
      } catch (exception) {
        reject(exception);
      }
    });
  }

  async _syncOracleInfo () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/v1/channel/getInfo');

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
      const result = await this.rest._GET('/v1/channel/localRemoteBal');
      if (result) {
        this._state.content.balances.spendable = result.totalBalance;
        this._state.content.balances.confirmed = result.confBalance;
        this._state.content.balances.unconfirmed = result.unconfBalance;
        this.commit();
      }
    }

    return this.state;
  }

  async _syncOracleChannels () {
    if (this.settings.mode === 'rest') {
      const result = await this.rest._GET('/v1/channel/listChannels');
      if (!result || !result.map) return this.state;
      this._state.content.channels = result.map((x) => {
        return new Actor(x);
      }).reduce((obj, item) => {
        obj[item.id] = item.state;
        return obj;
      }, {});

      this.commit();
    }

    return this.state;
  }

  async _syncChannels () {
    switch (this.settings.mode) {
      default:
        try {
          const result = await this._makeRPCRequest('listfunds');
          this._state.channels = result.channels;
        } catch (exception) {
          this.emit('error', `Could not sync channels: ${exception}`);
        }
        break;
      case 'rest':
        try {
          const result = await this.rest.get('/v1/channels/listChannels');
          this._state.channels = result.channels;
        } catch (exception) {
          this.emit('error', `Could not sync channels: ${exception}`);
        }
        break;
    }

    this.commit();

    return this;
  }

  async _syncInfo () {
    try {
      const result = await this._makeRPCRequest('getinfo');
      this._state.content.node.id = result.id;
      this._state.content.node.alias = result.alias;
      this._state.content.node.color = result.color;
      this._state.content.blockheight = result.blockheight;
      this.commit();
    } catch (exception) {
      this.emit('error', `Could not sync node info: ${exception}`);
    }

    return this;
  }

  async _sync () {
    await this._syncChannels();
    await this._syncInfo();
    this.emit('sync', this.state);
    return this;
  }
}

module.exports = Lightning;
