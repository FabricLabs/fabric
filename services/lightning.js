'use strict';

// Dependencies
const net = require('net');
const children = require('child_process');
const path = require('path');
const fs = require('fs');
const BN = require('bn.js');
const { mkdirp } = require('mkdirp');

// Fabric Types
const Actor = require('../types/actor');
const Key = require('../types/key');
const Remote = require('../types/remote');
const Service = require('../types/service');
const Machine = require('../types/machine');

// Contracts
const OP_TEST = require('../contracts/test');

/**
 * Manage a Lightning node.
 */
class Lightning extends Service {
  /**
   * Create an instance of the Lightning {@link Service}.
   * @param {Object} [settings] Settings.
   * @returns {Lightning}
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      authority: 'http://127.0.0.1:8181',
      datadir: './stores/lightning',
      host: '127.0.0.1',
      hostname: '127.0.0.1',
      port: 9735,
      socket: 'lightningd.sock',
      mode: 'socket',
      interval: 60000,
      managed: false,
      network: 'regtest',
      bitcoin: {
        rpcport: 18443,
        rpcuser: 'bitcoinrpc',
        rpcpassword: 'password',
        host: '127.0.0.1',
        datadir: './stores/bitcoin-regtest'
      }
    }, settings);

    this.machine = new Machine(this.settings);
    this.rpc = null;
    this.rest = null;
    this.status = 'disconnected';
    this.plugin = null;

    this._state = {
      content: {
        actors: {},
        balances: {
          spendable: 0,
          total: 0,
          confirmed: 0,
          unconfirmed: 0
        },
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

  commit () {
    // this.emit('debug', `Committing...`);

    const commit = new Actor({
      type: 'Commit',
      state: this.state
    });

    // this.emit('debug', `Committing Actor: ${commit}`);

    this.emit('commit', {
      id: commit.id,
      object: commit.toObject()
    });

    return commit;
  }

  restErrorHandler (error) {
    this.emit('error', `Got REST error: ${error}`);
  }

  // format: id@ip:port
  async connectTo (remote) {
    const [ id, address ] = remote.split('@');
    if (!id || !address) throw new Error(`Invalid remote format: ${remote}. Expected format: id@ip:port`);
    const [ ip, port ] = address.split(':');
    const result = await this._makeRPCRequest('connect', [id, ip, port]);
    this._state.peers[id] = {
      id: id,
      address: address,
      direction: result.direction,
      features: result.features,
      connected: true
    };
    return this;
  }

  /**
   * Creates a new Lightning channel.
   * @param {String} peer Public key of the peer to create a channel with.
   * @param {String} amount Amount in satoshis to fund the channel.
   */
  async createChannel (peer, amount) {
    const result = await this._makeRPCRequest('fundchannel', [peer, amount]);
    return result;
  }

  /**
   * Create a new Lightning invoice.
   * @param {String} amount Amount in millisatoshi (msat).
   */
  async createInvoice (amount, label = 'Generic Invoice', description = 'Generic description.') {
    const result = await this._makeRPCRequest('invoice', [amount, label, description]);
    return {
      bolt11: result.bolt11,
      paymentHash: result.payment_hash,
      expiresAt: result.expires_at
    };
  }

  /**
   * Computes the total liquidity of the Lightning node.
   * @returns {Object} Liquidity in BTC.
   */
  async computeLiquidity () {
    await this._syncChannels();
    const funds = await this._makeRPCRequest('listfunds', []);

    // Calculate outbound (our_amount_msat) and inbound (amount_msat - our_amount_msat)
    const outbound = funds.channels.reduce((acc, c) => {
      return acc.add(new BN(c.our_amount_msat));
    }, new BN(0));

    const inbound = funds.channels.reduce((acc, c) => {
      const total = new BN(c.amount_msat);
      const our = new BN(c.our_amount_msat);
      return acc.add(total.sub(our));
    }, new BN(0));

    // Convert msat to BTC (1 BTC = 100,000,000,000 msat)
    const SATS_PER_BTC = new BN('100000000');
    const MSATS_PER_BTC = SATS_PER_BTC.mul(new BN('1000'));

    // Convert msat to BTC with 16 decimal places
    // First multiply by 10^16 to preserve decimal places, then divide by MSATS_PER_BTC
    const DECIMAL_PLACES = new BN('10000000000000000'); // 10^16
    const outboundBTC = outbound.mul(DECIMAL_PLACES).div(MSATS_PER_BTC);
    const inboundBTC = inbound.mul(DECIMAL_PLACES).div(MSATS_PER_BTC);

    // Convert to string with proper decimal formatting
    const formatBTC = (value) => {
      const str = value.toString().padStart(17, '0'); // Ensure we have at least 16 decimal places
      const whole = str.slice(0, -16);
      const decimal = str.slice(-16);
      return `${whole}.${decimal}`;
    };

    return {
      outbound: formatBTC(outboundBTC),
      inbound: formatBTC(inboundBTC),
    };
  }

  async _waitForLightningD (maxAttempts = 10, initialDelay = 1000) {
    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Waiting for lightningd to be ready...');
    let attempts = 0;
    let delay = initialDelay;

    while (attempts < maxAttempts) {
      try {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `Attempt ${attempts + 1}/${maxAttempts} to connect to lightningd...`);

        // Check if the RPC socket exists
        const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `Checking for socket at: ${socketPath}`);

        if (!fs.existsSync(socketPath)) {
          throw new Error(`RPC socket not found at ${socketPath}`);
        }

        // Wait a bit for lightningd to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check multiple RPC endpoints to ensure full readiness
        const checks = [
          this._makeRPCRequest('getinfo')
        ];

        // Wait for all checks to complete
        const results = await Promise.all(checks);

        if (this.settings.debug) {
          console.debug('[FABRIC:LIGHTNING]', 'Successfully connected to lightningd:');
          console.debug('[FABRIC:LIGHTNING]', '- Node info:', results[0]);
        }

        return true;
      } catch (error) {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `Connection attempt ${attempts + 1} failed:`, error.message);
        attempts++;

        // If we've exceeded max attempts, throw error
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to connect to lightningd after ${maxAttempts} attempts: ${error.message}`);
        }

        // Wait before next attempt with exponential backoff
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 10000); // Exponential backoff with max 10s delay
        continue; // Continue to next attempt
      }
    }

    // Should never reach here due to maxAttempts check in catch block
    throw new Error('Failed to connect to lightningd: Max attempts exceeded');
  }

  async createLocalNode () {
    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Creating local Lightning node...');
    const datadir = path.resolve(this.settings.datadir);
    const bitcoinDatadir = path.resolve(this.settings.bitcoin.datadir);
    const socketPath = path.join(datadir, this.settings.socket);

    // Ensure storage directory exists
    await mkdirp(datadir);

    // Configure Lightning node parameters
    const params = [
      `--addr=${this.settings.hostname}:${this.settings.port}`,
      '--network=regtest',
      `--lightning-dir=${datadir}`,
      `--rpc-file=${socketPath}`,
      `--bitcoin-datadir=${bitcoinDatadir}`,
      `--bitcoin-rpcuser=${this.settings.bitcoin.rpcuser}`,
      `--bitcoin-rpcpassword=${this.settings.bitcoin.rpcpassword}`,
      `--bitcoin-rpcconnect=${this.settings.bitcoin.host}`,
      `--bitcoin-rpcport=${this.settings.bitcoin.rpcport}`,
      '--log-level=debug'
    ];

    // Add plugin configurations if specified
    if (this.settings.plugins) {
      Object.entries(this.settings.plugins).forEach(([plugin, config]) => {
        Object.entries(config).forEach(([key, value]) => {
          params.push(`--${plugin}-${key}=${value}`);
        });
      });
    }

    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'LightningD parameters:', params);

    // Start lightningd
    if (this.settings.managed) {
      this._child = children.spawn('lightningd', params);

      this._child.stdout.on('data', (data) => {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', data.toString('utf8').trim());
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] ${data.toString('utf8').trim()}`);
      });

      this._child.stderr.on('data', (data) => {
        console.error('[FABRIC:LIGHTNING]', '[ERROR]', data.toString('utf8').trim());
        this.emit('error', `[FABRIC:LIGHTNING] ${data.toString('utf8').trim()}`);
      });

      this._child.on('close', (code) => {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Lightning node exited with code ' + code);
        this.emit('log', `[FABRIC:LIGHTNING] Lightning node exited with code ${code}`);
      });

      // Wait for lightningd to be ready
      await this._waitForLightningD();

      return this._child;
    } else {
      return null;
    }
  }

  async newDepositAddress () {
    const address = await this._makeRPCRequest('newaddr', ['p2tr']);
    return address.p2tr || address.bech32;
  }

  async start () {
    this.status = 'starting';

    // Wait for Lightning to be ready
    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Waiting for Lightning to be ready...');
    try {
      // Check Lightning connection
      const bitcoinCli = children.spawn('bitcoin-cli', [
        '-regtest',
        `-datadir=${this.settings.bitcoin.datadir}`,
        '-rpcclienttimeout=60',
        `-rpcconnect=${this.settings.bitcoin.host}`,
        `-rpcport=${this.settings.bitcoin.rpcport}`,
        `-rpcuser=${this.settings.bitcoin.rpcuser}`,
        '-stdinrpcpass',
        'getblockchaininfo'
      ]);

      bitcoinCli.stdin.write(this.settings.bitcoin.rpcpassword + '\n');
      bitcoinCli.stdin.end();

      await new Promise((resolve, reject) => {
        let output = '';
        bitcoinCli.stdout.on('data', (data) => {
          output += data.toString();
        });
        bitcoinCli.stderr.on('data', (data) => {
          console.error('[FABRIC:LIGHTNING]', 'Lightning CLI error:', data.toString());
        });
        bitcoinCli.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Lightning CLI exited with code ${code}`));
          }
        });
      });

      if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Lightning is ready');
    } catch (error) {
      throw new Error(`Could not connect to bitcoind using bitcoin-cli. Is lightningd running?\n\nMake sure you have bitcoind running and that bitcoin-cli is able to connect to bitcoind.\n\nYou can verify that your Bitcoin Core installation is ready for use by running:\n\n    $ bitcoin-cli -regtest -datadir=${this.settings.bitcoin.datadir} -rpcclienttimeout=60 -rpcconnect=${this.settings.bitcoin.host} -rpcport=${this.settings.bitcoin.rpcport} -rpcuser=${this.settings.bitcoin.rpcuser} -stdinrpcpass echo 'hello world'`);
    }

    await this.machine.start();

    if (this.settings.managed) {
      await this.createLocalNode();
    }

    await this.sync();

    this._heart = setInterval(this._heartbeat.bind(this), this.settings.interval);
    this.status = 'started';

    this.emit('ready', this.export());

    return this;
  }

  async listFunds () {
    try {
      const result = this._makeRPCRequest('listfunds');
      return result;
    } catch (exception) {
      this.emit('error', `Could not list funds: ${exception}`);
      return null;
    }
  }

  async _heartbeat () {
    await this.sync();
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
      const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
      const exists = fs.existsSync(socketPath);
      try {
        const client = net.createConnection({ path: socketPath });
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

        // Format request according to JSON-RPC 2.0 spec
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: method,
          params: params
        };

        client.write(JSON.stringify(request) + '\n');
      } catch (exception) {
        reject(exception);
      }
    });
  }

  async _syncChannels () {
    const channels = await this._makeRPCRequest('listchannels');
    if (!channels || !channels.channels) {
      this.emit('error', 'No channels found or error fetching channels');
      return this;
    }

    this._state.channels = channels.channels.reduce((acc, channel) => {
      const actor = new Actor(channel);
      acc[actor.id] = actor.state;
      return acc;
    }, {});

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

  async sync () {
    return this._sync();
  }

  async stop () {
    this.status = 'stopping';
    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Starting Lightning service shutdown...');

    // Clear heartbeat interval
    if (this._heart) {
      if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Clearing heartbeat interval...');
      clearInterval(this._heart);
      this._heart = null;
    }

    // Stop the machine
    if (this.machine) {
      if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Stopping machine...');
      await this.machine.stop();
    }

    // Stop lightningd if it was started
    if (this.settings.managed && this._child) {
      if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Stopping lightningd...');

      try {
        // Try graceful shutdown first with a timeout
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Attempting graceful shutdown...');
        const gracefulShutdown = this._makeRPCRequest('stop');
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Graceful shutdown timeout')), 5000)
        );

        await Promise.race([gracefulShutdown, timeout]);
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Graceful shutdown successful');

        // Wait a bit for graceful shutdown
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Waiting for graceful shutdown to complete...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Only force kill if process is still running
        if (this._child && !this._child.killed) {
          const exitCode = this._child.exitCode;
          if (exitCode === null) {
            if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Force killing lightningd...');
            this._child.kill('SIGKILL');
          } else {
            if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `lightningd already exited with code ${exitCode}`);
          }
        }
      } catch (error) {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Error during graceful shutdown:', error.message);
        // Force kill if graceful shutdown fails and process is still running
        if (this._child && !this._child.killed) {
          const exitCode = this._child.exitCode;
          if (exitCode === null) {
            if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Force killing lightningd after failed graceful shutdown...');
            this._child.kill('SIGKILL');
          } else {
            if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `lightningd already exited with code ${exitCode}`);
          }
        }
      }

      // Wait for process to exit with a timeout
      try {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Waiting for process to exit...');
        await Promise.race([
          new Promise((resolve) => {
            if (this._child) {
              if (this._child.exitCode !== null) {
                if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Process already exited with code:', this._child.exitCode);
                resolve();
              } else {
                this._child.on('exit', (code) => {
                  if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', `lightningd process exited with code ${code}`);
                  resolve();
                });
              }
            } else {
              if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'No child process to wait for');
              resolve();
            }
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Process exit timeout')), 5000)
          )
        ]);
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Process exit wait completed');
      } catch (error) {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Error waiting for process exit:', error.message);
        // Force kill if still running
        if (this._child && !this._child.killed) {
          if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Force killing process after exit timeout');
          this._child.kill('SIGKILL');
        }
      }

      this._child = null;
    }

    // Clean up socket file
    const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
    try {
      if (fs.existsSync(socketPath)) {
        if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Cleaning up socket file:', socketPath);
        fs.unlinkSync(socketPath);
      }
    } catch (error) {
      if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Error cleaning up socket file:', error.message);
    }

    this.status = 'stopped';
    this.emit('stopped');
    if (this.settings.debug) console.debug('[FABRIC:LIGHTNING]', 'Lightning service shutdown complete');

    return this;
  }
}

module.exports = Lightning;
