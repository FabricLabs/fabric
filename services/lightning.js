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

function redactSensitiveCommandArg (arg) {
  return String(arg).replace(
    /((?:--?rpcpassword|--?rpcuser|--?rpcauth|--bitcoin-rpcpassword|--bitcoin-rpcuser)=).*/i,
    '$1[REDACTED]'
  );
}

/**
 * Manage a Lightning node.
 */
class Lightning extends Service {
  /**
   * Default TCP port lightningd listens on when {@link settings.port} is omitted (BOLT / common conventions).
   * @param {string} [network]
   * @returns {number}
   */
  static defaultListenPortForNetwork (network) {
    const n = String(network || 'mainnet').toLowerCase();
    if (n === 'testnet' || n === 'testnet4') return 19735;
    if (n === 'signet') return 39735;
    return 9735;
  }

  /**
   * Create an instance of the Lightning {@link Service}.
   * @param {Object} [settings] Settings.
   * @returns {Lightning}
   */
  constructor (settings = {}) {
    super(settings);

    // Increase max listeners to accommodate multiple services
    process.setMaxListeners(20);

    this.settings = Object.assign({
      authority: 'http://127.0.0.1:8181',
      datadir: './stores/lightning',
      host: '127.0.0.1',
      hostname: '127.0.0.1',
      port: null,
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

    if (this.settings.port == null || this.settings.port === '') {
      this.settings.port = Lightning.defaultListenPortForNetwork(this.settings.network);
    }

    // Accept both rpcuser/rpcpassword and username/password shapes.
    this.settings.bitcoin.rpcuser = this.settings.bitcoin.rpcuser || this.settings.bitcoin.username;
    this.settings.bitcoin.rpcpassword = this.settings.bitcoin.rpcpassword || this.settings.bitcoin.password;

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

    // Store handler references for cleanup
    this._errorHandlers = {
      uncaughtException: null,
      unhandledRejection: null,
      SIGINT: null,
      SIGTERM: null,
      exit: null
    };

    return this;
  }

  _clnNetworkCliName () {
    const n = String(this.settings.network || 'regtest').toLowerCase();
    if (n === 'mainnet' || n === 'bitcoin' || n === 'main') return 'bitcoin';
    if (n === 'testnet4') return 'testnet4';
    if (n === 'testnet' || n === 'test') return 'testnet';
    if (n === 'signet') return 'signet';
    return 'regtest';
  }

  _bitcoinCliNetworkFlag () {
    const network = this.settings.network || 'regtest';
    switch (network) {
      case 'mainnet': return null;
      case 'testnet': return '-testnet';
      case 'testnet4': return '-testnet4';
      case 'signet': return '-signet';
      case 'regtest':
      default:
        return '-regtest';
    }
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

  // format: id@ip:port (CLN accepts this as single param)
  async connectTo (remote) {
    const [id, address] = remote.split('@');
    if (!id || !address) throw new Error(`Invalid remote format: ${remote}. Expected format: id@ip:port`);
    const result = await this._makeRPCRequest('connect', [remote]);
    if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Connected to remote node ${id} at ${address}`);
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
   * @param {Number|null} [pushMsat=null] Optional push amount in millisatoshis.
   * @param {Object} [options={}] Optional overrides (e.g. minconf for regtest).
   */
  async createChannel (peer, amount, pushMsat = null, options = {}) {
    const pushVal = pushMsat != null && Number.isFinite(Number(pushMsat)) ? Number(pushMsat) : null;
    const network = String(this.settings.network || 'bitcoin').toLowerCase();
    const useMinconfZero = network === 'regtest' || network === 'signet' || network === 'testnet';
    const params = {
      id: peer,
      amount: String(amount),
      ...(pushVal != null ? { push_msat: pushVal } : {}),
      ...(useMinconfZero ? { minconf: 0 } : {}),
      ...(options.minconf !== undefined ? { minconf: Number(options.minconf) } : {}),
      ...(Array.isArray(options.utxos) && options.utxos.length > 0 ? { utxos: options.utxos } : {}),
      ...(options.feerate !== undefined ? { feerate: options.feerate } : useMinconfZero ? { feerate: '253perkw' } : {})
    };
    const result = await this._makeRPCRequest('fundchannel', params);
    if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Created channel with peer ${peer} for amount ${amount}`);
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
    if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Waiting for lightningd to be ready...');
    let attempts = 0;
    let delay = initialDelay;

    while (attempts < maxAttempts) {
      try {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Attempt ${attempts + 1}/${maxAttempts} to connect to lightningd...`);

        // Check if the RPC socket exists
        const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Checking for socket at: ${socketPath}`);

        if (!fs.existsSync(socketPath)) {
          throw new Error(`RPC socket not found at ${socketPath}`);
        }

        // Brief pause for lightningd to finish initializing after socket appears
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check multiple RPC endpoints to ensure full readiness
        const checks = [
          this._makeRPCRequest('getinfo')
        ];

        // Wait for all checks to complete
        const results = await Promise.all(checks);

        if (this.settings.debug) {
          this.emit('debug', '[FABRIC:LIGHTNING] Successfully connected to lightningd');
        }

        return true;
      } catch (error) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Connection attempt ${attempts + 1} failed: ${error.message}`);
        attempts++;

        // If we've exceeded max attempts, throw error
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to connect to lightningd after ${maxAttempts} attempts: ${error.message}`);
        }

        // Wait before next attempt with exponential backoff
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 10000); // Exponential backoff with max 10s delay
        continue; // Continue to next attempt
      }
    }

    // Should never reach here due to maxAttempts check in catch block
    throw new Error('Failed to connect to lightningd: Max attempts exceeded');
  }

  async createLocalNode () {
    if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Creating local Lightning node...');
    const datadir = path.resolve(this.settings.datadir);
    const bitcoinDatadir = path.resolve(this.settings.bitcoin.datadir);
    const socketPath = path.join(datadir, this.settings.socket);

    // Ensure storage directory exists
    await mkdirp(datadir);

    // Configure Lightning node parameters
    const params = [
      `--addr=${this.settings.hostname}:${this.settings.port}`,
      `--network=${this._clnNetworkCliName()}`,
      `--lightning-dir=${datadir}`,
      `--rpc-file=${socketPath}`,
      `--bitcoin-datadir=${bitcoinDatadir}`,
      `--bitcoin-rpcuser=${this.settings.bitcoin.rpcuser}`,
      `--bitcoin-rpcpassword=${this.settings.bitcoin.rpcpassword}`,
      `--bitcoin-rpcconnect=${this.settings.bitcoin.host}`,
      `--bitcoin-rpcport=${this.settings.bitcoin.rpcport}`,
      '--log-level=debug',
      // Regtest fee estimates are unreliable; force 253 perkw (min) for all feerate types
      '--force-feerates=253'
    ];

    // Add plugin configurations if specified and supported
    // Note: Only add plugin configurations for known supported plugins
    // to avoid invalid command-line arguments on systems without certain plugins
    if (this.settings.plugins) {
      const supportedPlugins = ['experimental-offers', 'experimental-features'];
      Object.entries(this.settings.plugins).forEach(([plugin, config]) => {
        if (supportedPlugins.includes(plugin)) {
          Object.entries(config).forEach(([key, value]) => {
            params.push(`--${plugin}-${key}=${value}`);
          });
        } else {
          if (this.settings.debug) {
            if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Skipping unsupported plugin configuration: ${plugin}`);
          }
        }
      });
    }

    // Disable specific plugins if requested
    if (this.settings.disablePlugins && Array.isArray(this.settings.disablePlugins)) {
      this.settings.disablePlugins.forEach(plugin => {
        params.push(`--disable-plugin=${plugin}`);
        if (this.settings.debug) {
          if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Disabling plugin: ${plugin}`);
        }
      });
    }

    if (this.settings.debug) {
      const safeParams = params.map(redactSensitiveCommandArg);
      this.emit('debug', `[FABRIC:LIGHTNING] LightningD parameters: ${safeParams.join(' ')}`);
    }

    // Start lightningd
    if (this.settings.managed) {
      this._child = children.spawn('lightningd', params);

      this._child.stdout.on('data', (data) => {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] ${data.toString('utf8').trim()}`);
      });

      this._child.stderr.on('data', (data) => {
        this.emit('error', `[FABRIC:LIGHTNING] ${data.toString('utf8').trim()}`);
      });

      this._child.on('close', (code) => {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Lightning node exited with code ${code}`);
        this.emit('log', `[FABRIC:LIGHTNING] Lightning node exited with code ${code}`);
      });

      // Add cleanup handler
      const cleanup = async () => {
        const child = this._child;
        if (!child) return;

        try {
          if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Cleaning up Lightning node...');

          if (child.exitCode === null && !child.killed) {
            child.kill('SIGTERM');
          }

          await Promise.race([
            new Promise((resolve) => child.once('close', () => resolve())),
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);

          // Force terminate if graceful shutdown did not complete in time.
          if (child.exitCode === null) {
            try {
              child.kill('SIGKILL');
            } catch (error) {
              // Ignore if process already exited between checks.
            }

            await Promise.race([
              new Promise((resolve) => child.once('close', () => resolve())),
              new Promise((resolve) => setTimeout(resolve, 3000))
            ]);
          }
        } catch (e) {
          this.emit('error', `[FABRIC:LIGHTNING] Error during cleanup: ${e.message || e}`);
        } finally {
          if (this._child === child) this._child = null;
        }
      };

      // Store and attach handlers with proper error attribution
      this._errorHandlers.SIGINT = cleanup;
      this._errorHandlers.SIGTERM = cleanup;
      this._errorHandlers.exit = cleanup;
      this._errorHandlers.uncaughtException = async (err) => {
        // Only handle errors from this service's child process
        if (err.source === 'lightning' || (this._child && err.pid === this._child.pid)) {
          this.emit('error', `[FABRIC:LIGHTNING] Uncaught exception from Lightning service: ${err.message || err}`);
          // await cleanup();
          // this.emit('error', err);
        }
      };
      this._errorHandlers.unhandledRejection = async (reason, promise) => {
        // Only handle rejections from this service's operations
        if (reason.source === 'lightning' || (this._child && reason.pid === this._child.pid)) {
          this.emit('error', '[FABRIC:LIGHTNING] Unhandled rejection from Lightning service');
          // await cleanup();
          // this.emit('error', reason);
        }
      };

      // Attach the handlers
      process.on('SIGINT', this._errorHandlers.SIGINT);
      process.on('SIGTERM', this._errorHandlers.SIGTERM);
      process.on('exit', this._errorHandlers.exit);
      process.on('uncaughtException', this._errorHandlers.uncaughtException);
      process.on('unhandledRejection', this._errorHandlers.unhandledRejection);

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

    // When managed, verify bitcoind is reachable before spawning lightningd.
    // When unmanaged (external socket), skip—the external lightningd has its own bitcoind.
    if (this.settings.managed && this.settings.bitcoin) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Waiting for Lightning to be ready...');
      try {
        const bitcoinCliArgs = [
          `-datadir=${this.settings.bitcoin.datadir}`,
          '-rpcclienttimeout=60',
          `-rpcconnect=${this.settings.bitcoin.host}`,
          `-rpcport=${this.settings.bitcoin.rpcport}`,
          `-rpcuser=${this.settings.bitcoin.rpcuser}`,
          '-stdinrpcpass',
          'getblockchaininfo'
        ];
        const networkFlag = this._bitcoinCliNetworkFlag();
        if (networkFlag) bitcoinCliArgs.unshift(networkFlag);
        const bitcoinCli = children.spawn('bitcoin-cli', bitcoinCliArgs);

      bitcoinCli.stdin.write(this.settings.bitcoin.rpcpassword + '\n');
      bitcoinCli.stdin.end();

      await new Promise((resolve, reject) => {
        let output = '';
        bitcoinCli.stdout.on('data', (data) => {
          output += data.toString();
        });
        bitcoinCli.stderr.on('data', (data) => {
          const line = data.toString();
          // Route Lightning CLI errors into the service error channel so the TUI can render them safely.
          this.emit('error', `[FABRIC:LIGHTNING] Lightning CLI error: ${line.trim()}`);
        });
        bitcoinCli.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Lightning CLI exited with code ${code}`));
          }
        });
      });

        if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Lightning is ready');
      } catch (error) {
        const networkFlag = this._bitcoinCliNetworkFlag();
        const networkHint = networkFlag ? `${networkFlag} ` : '';
        throw new Error(`Could not connect to bitcoind using bitcoin-cli. Is lightningd running?\n\nMake sure you have bitcoind running and that bitcoin-cli is able to connect to bitcoind.\n\nYou can verify that your Bitcoin Core installation is ready for use by running:\n\n    $ bitcoin-cli ${networkHint}-datadir=${this.settings.bitcoin.datadir} -rpcclienttimeout=60 -rpcconnect=${this.settings.bitcoin.host} -rpcport=${this.settings.bitcoin.rpcport} -rpcuser=${this.settings.bitcoin.rpcuser} -stdinrpcpass echo 'hello world'`);
      }
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
      const result = await this._makeRPCRequest('listfunds');
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
   * @param {Number} [timeoutMs] Optional timeout in ms; default 30000. Prevents hanging when lightningd is busy.
   * @returns {Object|String} Respond from the Lightning node.
   */
  async _makeRPCRequest (method, params = [], timeoutMs = 30000) {
    if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Making RPC request to method ${method}`);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        try { client.destroy(); } catch (_) {}
        fn(arg);
      };

      const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
      let client;
      const timeoutId = timeoutMs > 0 ? setTimeout(() => {
        finish(reject, new Error(`Lightning RPC timeout after ${timeoutMs}ms (${method})`));
      }, timeoutMs) : null;

      try {
        let buffer = '';
        client = net.createConnection({ path: socketPath });
        client.on('error', (err) => finish(reject, err));
        client.on('data', (data) => {
          buffer += data.toString('utf8');
          try {
            const response = JSON.parse(buffer);
            if (response.result !== undefined) return finish(resolve, response.result);
            if (response.error) return finish(reject, Object.assign(new Error(response.error.message || 'RPC error'), response.error));
          } catch (_) {
            if (buffer.length > 2 * 1024 * 1024) finish(reject, new Error('Lightning RPC response too large'));
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
        finish(reject, exception);
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
    if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Starting Lightning service shutdown...');

    // Remove custom error handlers
    if (this._errorHandlers) {
      Object.entries(this._errorHandlers).forEach(([event, handler]) => {
        if (handler) {
          process.removeListener(event, handler);
          this._errorHandlers[event] = null;
        }
      });
    }

    // Remove all other event listeners
    this.removeAllListeners();

    // Clear heartbeat interval
    if (this._heart) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Clearing heartbeat interval...');
      clearInterval(this._heart);
      this._heart = null;
    }

    // Stop the machine
    if (this.machine) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Stopping machine...');
      await this.machine.stop();
    }

    // Stop lightningd if it was started
    if (this.settings.managed && this._child) {
      if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Stopping lightningd...');

      try {
        // Try graceful shutdown first with a timeout
        if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Attempting graceful shutdown...');
        const gracefulShutdown = this._makeRPCRequest('stop');
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Graceful shutdown timeout')), 5000)
        );

        await Promise.race([gracefulShutdown, timeout]);
        if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Graceful shutdown successful');

        // Wait a bit for graceful shutdown
        if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Waiting for graceful shutdown to complete...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Only force kill if process is still running
        if (this._child && !this._child.killed) {
          const exitCode = this._child.exitCode;
          if (exitCode === null) {
            if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Force killing lightningd...');
            this._child.kill('SIGKILL');
          } else {
            if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] lightningd already exited with code ${exitCode}`);
          }
        }

        if (this._child) {
          await Promise.race([
            new Promise((resolve) => this._child.once('close', () => resolve())),
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);
        }
      } catch (error) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Error during graceful shutdown: ${error.message}`);
        // Force kill if graceful shutdown fails and process is still running
        if (this._child && !this._child.killed) {
          const exitCode = this._child.exitCode;
          if (exitCode === null) {
            if (this.settings.debug) this.emit('debug', '[FABRIC:LIGHTNING] Force killing lightningd after failed graceful shutdown...');
            this._child.kill('SIGKILL');
          } else {
            if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] lightningd already exited with code ${exitCode}`);
          }
        }

        if (this._child) {
          await Promise.race([
            new Promise((resolve) => this._child.once('close', () => resolve())),
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);
        }
      }

      // Clean up socket file
      const socketPath = path.resolve(this.settings.datadir, this.settings.socket);
      try {
        if (fs.existsSync(socketPath)) {
          if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Cleaning up socket file: ${socketPath}`);
          fs.unlinkSync(socketPath);
        }
      } catch (error) {
        if (this.settings.debug) this.emit('debug', `[FABRIC:LIGHTNING] Error cleaning up socket file: ${error.message}`);
      }
    }

    this.status = 'stopped';
    return this;
  }
}

/**
 * Core Lightning JSON-RPC method names invoked by this service (see docs/LIGHTNING_COMPAT.md).
 * @type {ReadonlyArray<string>}
 */
Lightning.CLN_RPC_METHODS = Object.freeze([
  'connect',
  'fundchannel',
  'getinfo',
  'invoice',
  'listchannels',
  'listfunds',
  'newaddr',
  'stop'
]);

Lightning.redactSensitiveCommandArg = redactSensitiveCommandArg;

module.exports = Lightning;
