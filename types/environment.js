'use strict';

// Constants
const {
  FIXTURE_SEED
} = require('../constants');

// Dependencies
const fs = require('fs');
const merge = require('lodash.merge');

// Fabric Types
const Entity = require('./entity');
const EncryptedPromise = require('./promise');
const Wallet = require('./wallet');

// Filters
const any = (candidate => (candidate && typeof candidate !== 'undefined'));

/**
 * Interact with the user's Environment.
 */
class Environment extends Entity {
  /**
   * Create an instance of {@link Environment}.
   * @param {Object} [settings] Settings for the Fabric environment.
   * @returns {Environment} Instance of the Environment.
   */
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
      content: {},
      variables: process.env
    };

    return this;
  }

  get SEED_FILE () {
    return '.FABRIC_SEED';
  }

  get WALLET_FILE () {
    return this.settings.path;
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
    return [
      this.settings.seed,
      this['FABRIC_SEED'],
      this.readVariable('FABRIC_SEED')
    ].find(any);
  }

  get xprv () {
    return [
      this.settings.xprv,
      this['FABRIC_XPRV'],
      this.readVariable('FABRIC_XPRV')
    ].find(any);
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
    if (this.storeExists()) return true;

    try {
      fs.mkdirSync(this.settings.store);
    } catch (exception) {
      console.error('Could not make store:', exception);
      return false;
    }

    return this;
  }

  touchWallet () {
    const time = new Date();
    this.makeStore();

    try {
      fs.utimesSync(this.settings.path, time, time);
    } catch (err) {
      fs.closeSync(fs.openSync(this.settings.path, 'w'));
    }

    return true;
  }

  loadWallet () {
    if (this.seed) {
      this.wallet = new Wallet({
        key: {
          seed: this.seed,
          passphrase: this.passphrase
        }
      });
    } else if (this.xprv) {
      this.wallet = new Wallet({
        key: {
          xprv: this.xprv
        }
      });
    } else if (this.xpub) {
      this.wallet = new Wallet({
        key: {
          xpub: this.xpub
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

  destroyWallet () {
    try {
      fs.unlinkSync(this.WALLET_FILE);
      return true;
    } catch (exception) {
      console.error('[FABRIC:ENVIRONMENT]', 'Wallet destroyed.');
      return false;
    }
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

  /**
   * Read a variable from the environment.
   * @param {String} name Variable name to read.
   * @returns {String} Value of the variable (or an empty string).
   */
  readVariable (name) {
    return process.env[name] || '';
  }

  readWallet () {
    return fs.readFileSync(this.WALLET_FILE, {
      encoding: 'utf8'
    });
  }

  /**
   * Configure the Environment to use a Fabric {@link Wallet}.
   * @param {Wallet} wallet Wallet to attach.
   * @param {Boolean} force Force existing wallets to be destroyed.
   * @returns {Environment} The Fabric Environment.
   */
  setWallet (wallet, force = false) {
    // Attach before saving
    this.wallet = wallet;

    // Filter user error
    if (this.walletExists() && !force) throw new Error('Wallet file already exists.');
    if (!this.touchWallet()) throw new Error('Could not touch wallet.  Check permissions, disk space.');

    try {
      // Get standard object
      const object = wallet.export();
      // TODO: encrypt inner store with password (`object` property)
      const encrypted = Object.assign({
        // Defaults
        type: /*/ 'Encrypted' + /**/'FabricWallet',
        format: 'aes-256-cbc',
        version: object.version
      }, object);

      const content = JSON.stringify(encrypted, null, '  ') + '\n';
      fs.writeFileSync(this.WALLET_FILE, content);
    } catch (exception) {
      console.error('[FABRIC:ENV]', 'Could not write wallet file:', exception);
      process.exit(1);
    }

    return this;
  }

  readSeedFile () {
    const path = `${process.cwd()}/${this.SEED_FILE}`;
    if (fs.existsSync(path)) return fs.readFileSync(path, { encoding: 'utf8' });
    return false;
  }

  /**
   * Start the Environment.
   * @returns {Environment} The Fabric Environment.
   */
  start () {
    this._state.status = 'STARTING';
    this.local = this.readSeedFile();

    this.loadWallet();

    if (this.wallet) this.wallet.start();

    this._state.status = 'STARTED';
    return this;
  }

  stop () {
    this._state.status = 'STOPPING';
    this._state.status = 'STOPPED';
    return this;
  }
}

module.exports = Environment;
