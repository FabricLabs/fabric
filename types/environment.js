'use strict';

// Dependencies
const fs = require('fs');
const merge = require('lodash.merge');

// Fabric Types
const Entity = require('./entity');
const EncryptedPromise = require('./promise');
const Wallet = require('./wallet');

class Environment extends Entity {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      home: process.env.HOME,
      path: process.env.HOME + '/.fabric/wallet.json',
      store: process.env.HOME + '/.fabric'
    }, this.settings, settings);

    this.local = null;
    this.wallet = null;

    this._state = {
      status: 'INITIALIZED',
      variables: process.env
    };

    this.loadWallet();

    return this;
  }

  get SEED_FILE () {
    return '.FABRIC_SEED';
  }

  get XPRV_FILE () {
    return '.FABRIC_XPRV';
  }

  get XPUB_FILE () {
    return '.FABRIC_XPUB';
  }

  get passphrase () {
    return this.readVariable('PASSPHRASE');
  }

  get seed () {
    const any = (candidate => (candidate && typeof candidate !== 'undefined'));
    const seed = [
      this.settings.seed,
      this['FABRIC_SEED'],
      this.readVariable('FABRIC_SEED')
    ].find(any);

    return seed;
  }

  storeExists () {
    return fs.existsSync(this.settings.store);
  }

  walletExists () {
    return fs.existsSync(this.settings.path);
  }

  makeContractStore () {
    fs.mkdirSync(this.settings.store);
  }

  makeStore () {
    fs.mkdirSync(this.settings.store);
  }

  touchWallet () {
    const time = new Date();
    this.makeStore();

    try {
      fs.utimesSync(this.settings.path, time, time);
    } catch (err) {
      fs.closeSync(fs.openSync(this.settings.path, 'w'));
    }
  }

  loadWallet () {
    if (this.seed) {
      this.wallet = new Wallet({
        key: {
          seed: this.seed,
          passphrase: this.passphrase
        }
      });
    } else if (this.walletExists()) {
      const data = this.readWallet();

      try {
        const input = JSON.parse(data);

        if (!input.object || !input.object.xprv) {
          throw new Error(`Corrupt or out-of-date wallet: ${this.settings.path}`);
        }

        this.wallet = new Wallet({
          key: {
            xprv: input.object.xprv
          }
        });
      } catch (exception) {
        console.error('[FABRIC:KEYGEN]', 'Could not load wallet data:', exception);
      }
    } else {
      this.wallet = false;
    }

    return this;
  }

  readContracts () {
    const prefix = `${__dirname}/..`;
    return fs.readdirSync(`${prefix}/contracts`).filter((x) => {
      const parts = x.split('.');
      return (parts[parts.length - 1] === 'js');
    }).map((x) => {
      const contract = fs.readFileSync(`${prefix}/contracts/${x}`);
      const entity = new Entity(contract);
      return {
        '@id': entity.id,
        '@data': entity.data
      };
    });
  }

  readVariable (name) {
    return process.env[name] || '';
  }

  readWallet () {
    return fs.readFileSync(this.settings.path, {
      encoding: 'utf8'
    });;
  }

  readSeedFile () {
    const path = `${process.cwd()}/${this.SEED_FILE}`;
    if (fs.existsSync(path)) return fs.readFileSync(path, { encoding: 'utf8' });
    return false;
  }

  start () {
    this._state.status = 'STARTING';
    this.local = this.readSeedFile();

    this.loadWallet();
    this.wallet.start();

    this._state.status = 'STARTED';
    return this;
  }
}

module.exports = Environment;
