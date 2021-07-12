'use strict';

const BN = require('bn.js');
const jayson = require('jayson');

const Label = require('../types/label');
const Entity = require('../types/entity');
const Service = require('../types/service');
const Message = require('../types/message');
const Transition = require('../types/transition');

// Ethereum
const VM = require('ethereumjs-vm').default;
const Actor = require('../types/actor');
// TODO: re-evaluate inclusion of Ethereum toolchain
// const Account = require('ethereumjs-account').default;
// const Blockchain = require('ethereumjs-blockchain').default;
// const Block = require('ethereumjs-block');

const Opcodes = {
  STOP: '00',
  ADD: '01',
  PUSH1: '60'
};

class Ethereum extends Service {
  constructor (settings = {}) {
    super(settings);

    this.status = 'constructing';
    this.settings = Object.assign({
      name: '@services/ethereum',
      mode: 'rpc',
      network: 'main',
      ETHID: 1,
      hosts: [],
      stack: [],
      servers: ['http://127.0.0.1:8545'],
      interval: 15000
    }, this.settings, settings);

    // Internal State
    this._state = {
      stack: this.settings.stack,
      tip: null,
      height: null
    };

    // Internal Properties
    this.rpc = null;
    this.vm = new VM();
    this.status = 'constructed';

    // Chainable
    return this;
  }

  set tip (value) {
    if (this._state.tip !== value) {
      this.emit('block', Message.fromVector(['EthereumBlock', value]));
      this._state.tip = value;
    }
  }

  set height (value) {
    if (this._state.height !== value) {
      this.emit('height', Message.fromVector(['EthereumBlockNumber', value]));
      this._state.height = value;
    }
  }

  get tip () {
    return this._state.tip;
  }

  get height () {
    return this._state.height;
  }

  async _test () {
    let program = [
      Opcodes.PUSH1,
      '03',
      Opcodes.PUSH1,
      '05',
      Opcodes.ADD, 
      Opcodes.STOP
    ];

    return this.execute(program);
  }

  async _handleVMStep (step) {
    console.log('[SERVICES:ETHEREUM]', '[VM]', `Executed Opcode: ${step.opcode.name}\n\tStack:`, step.stack);
    let transition = Transition.between(this._state.stack, step.stack);
    this._state.stack = step.stack;
    console.log('transition:', transition);``
  }

  async execute (program) {
    if (!(program instanceof Array)) throw new Error('Cannot process program unless it is an Array.');
    return this.vm.runCode({
      code: Buffer.from(program.join(''), 'hex'),
      gasLimit: new BN(0xffff),
    }).then(results => {
      console.log('Returned : ' + results.returnValue.toString('hex'));
      console.log('Gas used : ' + results.gasUsed.toString());
    }).catch(err => console.log('Error    : ' + err));
  }

  async _executeRPCRequest (name, params = [], callback = new Function()) {
    const start = Date.now();
    const service = this;
    const actor = new Actor({
      type: 'GenericRPCRequest',
      method: name,
      params: params,
      status: 'queued'
    });

    const promise = new Promise((resolve, reject) => {
      try {
        service.rpc.request(name, params, function (err, response) {
          const finish = Date.now();
          const duration = finish - start;
          if (err) {
            actor.status = 'error';
            service.emit('error', Message.fromVector(['GenericServiceError', err]));
            reject(new Error(`Could not call: ${err}`));
          } else {
            actor.status = 'completed';
            resolve({
              request: actor,
              duration: duration,
              result: response.result
            });
          }
        });
      } catch (exception) {
        reject(new Error(`Request exception:`, exception));
      }
    });
    return promise;
  }

  async _checkRPCBlockNumber () {
    const service = this;
    const request = service._executeRPCRequest('eth_blockNumber');
    request.then((response) => {
      this.height = response.result;
    });
    return request;
  }

  async _heartbeat () {
    try {
      const blockNumberRequest = await this._checkRPCBlockNumber();
    } catch (exception) {
      this.emit('error', `Could not retrieve current block from RPC: ${exception}`);
    }
  }

  async stop () {
    this.status = 'stopping';
    // await this.vm.destroy();

    if (this.settings.mode === 'rpc') {
      clearInterval(this.heartbeat);
    }

    this.status = 'stopped';
  }

  async start () {
    const service = this;
    let secure = false;

    // Assign Status
    service.status = 'starting';

    // Local Variables
    let client = null;

    if (service.settings.mode === 'rpc') {
      const providers = service.settings.servers.map(x => new URL(x));
      // TODO: loop through all providers
      let provider = providers[0];

      if (provider.protocol === 'https:') secure = true;
      const config = {
        username: provider.username,
        password: provider.password,
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

      // Assign Heartbeat
      service.heartbeat = setInterval(service._heartbeat.bind(service), service.settings.interval);
    }

    service.vm.on('step', service._handleVMStep.bind(service));
    service.status = 'started';
    service.emit('warning', `Service started!`);
    service.emit('ready', { id: service.id });
  }

  async _RPCErrorHandler (error) {
    this.emit('error', `[RPC] Error: ${error}`);
  }
}

module.exports = Ethereum;
