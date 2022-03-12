'use strict';

const {
  HTTP_SERVER_PORT,
  HTTPS_SERVER_PORT,
  MAXIMUM_PING,
  P2P_SESSION_ACK,
  WEBSOCKET_KEEPALIVE
} = require('../constants');

// Dependencies
const http = require('http');
const crypto = require('crypto');
const merge = require('lodash.merge');
// TODO: remove Express entirely...
// NOTE: current blockers include PeerServer...
const express = require('express');
const session = require('express-session');
// TODO: check with Riddle about this
const parsers = require('body-parser');
const monitor = require('fast-json-patch');
const extractor = require('express-bearer-token');
const pluralize = require('pluralize');
const stoppable = require('stoppable');

// Pathing
const pathToRegexp = require('path-to-regexp').pathToRegexp;

// Fabric Types
const Actor = require('@fabric/core/types/actor');
// const Oracle = require('@fabric/core/types/oracle');
const Collection = require('@fabric/core/types/collection');
// const Resource = require('@fabric/core/types/resource');
const Service = require('@fabric/core/types/service');
const Message = require('@fabric/core/types/message');
const Entity = require('@fabric/core/types/entity');
const State = require('@fabric/core/types/state');

// Internal Components
// const App = require('./app');
// const Client = require('./client');
// const Component = require('./component');
// const Browser = require('./browser');
// const SPA = require('./spa');

// Dependencies
const WebSocket = require('ws');
const PeerServer = require('peer').ExpressPeerServer;

/**
 * The primary web server.
 * @extends Service
 */
class FabricHTTPServer extends Service {
  /**
   * Create an instance of the HTTP server.
   * @param {Object} [settings] Configuration values.
   * @param {String} [settings.name="FabricHTTPServer"] User-friendly name of this server.
   * @param {Number} [settings.port=9999] Port to listen for HTTP connections on.
   * @return {FabricHTTPServer} Fully-configured instance of the HTTP server.
   */
  constructor (settings = {}) {
    super(settings);

    // Assign defaults
    this.settings = merge({
      name: 'FabricHTTPServer',
      description: 'Service delivering a Fabric application across the HTTP protocol.',
      // TODO: document host as listening on all interfaces by default
      host: '0.0.0.0',
      path: './stores/server',
      port: HTTP_SERVER_PORT,
      listen: true,
      resources: {},
      components: {},
      services: {
        audio: {
          address: '/devices/audio'
        }
      },
      // TODO: replace with crypto random
      seed: Math.random(),
      sessions: false
    }, settings);

    this.connections = {};
    this.definitions = {};
    this.methods = {};
    this.stores = {};

    // this.browser = new Browser(this.settings);
    // TODO: compile & boot (load state) SPA (React + Redux?)
    /* this.app = new SPA(Object.assign({}, this.settings, {
      path: './stores/server-application'
    })); */

    /* this.compiler = webpack({
      // webpack options
    }); */

    this.wss = null;
    this.http = null;

    this.express = express();
    this.sessions = session({
      resave: true,
      saveUninitialized: false,
      secret: this.settings.seed
    });

    this._state = {};
    this.observer = monitor.observe(this.state);
    this.coordinator = new PeerServer(this.express, {
      path: '/services/peering'
    });

    this.collections = [];
    this.routes = [];
    this.customRoutes = [];

    return this;
  }

  get link () {
    return `http://${this.settings.host}:${this.settings.port}`;
  }

  get state () {
    return this._state;
  }

  set state (value) {
    this._state = value;
  }

  async commit () {
    ++this.clock;

    this['@id'] = this.id;
    // TODO: define parent path
    // this['@parent'] = this.id;
    // this['@preimage'] = this.toString();
    this['@constructor'] = this.constructor;

    if (this.observer) {
      this['@changes'] = monitor.generate(this.observer);
    }

    if (this['@changes'] && this['@changes'].length) {
      const message = {
        '@type': 'Transaction',
        '@data': {
          changes: this['@changes'],
          state: this.state
        }
      };

      this.emit('changes', this['@changes']);
      this.emit('state', this.state);
      this.emit('message', message);

      // Broadcast to connected peers
      this.broadcast(message);
    }

    return this;
  }

  /**
   * Define a {@link Type} by name.
   * @param  {String} name       Human-friendly name of the type.
   * @param  {Definition} definition Configuration object for the type.
   * @return {FabricHTTPServer}            Instance of the configured server.
   */
  async define (name, definition) {
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Defining:', name, definition);
    const server = this;
    const resource = await super.define(name, definition);

    const snapshot = Object.assign({
      name: name,
      names: { plural: pluralize(name) }
    }, resource);

    const address = snapshot.routes.list.split('/')[1];
    const store = new Collection(snapshot);

    if (this.settings.verbosity >= 6) console.log('[HTTP:SERVER]', 'Collection as store:', store);
    if (this.settings.verbosity >= 6) console.log('[HTTP:SERVER]', 'Snapshot:', snapshot);

    this.stores[name] = store;
    this.definitions[name] = snapshot;
    this.collections.push(snapshot.routes.list);
    this.keys.add(snapshot.routes.list);

    this.stores[name].on('error', async (error) => {
      console.error('[HTTP:SERVER]', '[ERROR]', error);
    });

    this.stores[name].on('warning', async (warning) => {
      console.warn('[HTTP:SERVER]', 'Warning:', warning);
    });

    this.stores[name].on('message', async (message) => {
      let entity = null;
      switch (message['@type']) {
        case 'Create':
          entity = new Entity({
            '@type': name,
            '@data': message['@data']
          });

          console.log('[HTTP:SERVER]', `Resource "${name}" created:`, entity.data);
          server.emit('message', entity.data);
          break;
        case 'Transaction':
          await server._applyChanges(message['@data'].changes);
          break;
        default:
          console.warn('[HTTP:SERVER]', 'Unhandled message type:', message['@type']);
          break;
      }

      server.broadcast({
        '@type': 'StateUpdate',
        '@data': server.state
      });
    });

    this.stores[name].on('commit', (commit) => {
      server.broadcast({
        '@type': 'StateUpdate',
        '@data': server.state
      });
    });

    this.routes.push({
      path: snapshot.routes.view,
      route: pathToRegexp(snapshot.routes.view),
      resource: name
    });

    this.routes.push({
      path: snapshot.routes.list,
      route: pathToRegexp(snapshot.routes.list),
      resource: name
    });

    // Also define on app
    await this.app.define(name, definition);

    // TODO: document pathing
    this.state[address] = {};
    this.app.state[address] = {};

    // if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Routes:', this.routes);
    return this;
  }

  broadcast (message) {
    let peers = Object.keys(this.connections);
    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(JSON.stringify(message));
      } catch (E) {
        console.error('Could not send message to peer:', E);
      }
    }
  }

  trust (source) {
    super.trust(source);

    source.on('message', function (msg) {
      console.log('[HTTP:SERVER]', 'trusted source:', source.constructor.name, 'sent message:', msg);
    });
  }

  _registerMethod (name, method) {
    this.methods[name] = method.bind(this);
  }

  _handleAppMessage (msg) {
    console.trace('[HTTP:SERVER]', 'Internal app emitted message:', msg);
  }

  _handleCall (call) {
    if (!call.method) throw new Error('Call requires "method" parameter.');
    if (!call.params) throw new Error('Call requires "params" parameter.');
    if (!this.methods[call.method]) throw new Error(`Method "${call.method}" has not been registered.`);
    this.methods[call.method].apply(this, call.params);
  }

  /**
   * Connection manager for WebSockets.  Called once the handshake is complete.
   * @param  {WebSocket} socket The associated WebSocket.
   * @param  {http.IncomingMessage} request Incoming HTTP request.
   * @return {WebSocket} Returns the connected socket.
   */
  _handleWebSocket (socket, request) {
    const server = this;
    server.emit('debug', `Handling WebSocket: ${Object.keys(socket)}`);

    // TODO: check security of common defaults for `sec-websocket-key` params
    // Chrome?  Firefox?  Safari?  Opera?  What defaults do they use?
    const buffer = Buffer.from(request.headers['sec-websocket-key'], 'base64');
    const handle = buffer.toString('hex');
    const player = new State({
      connection: buffer.toString('hex'),
      entropy: buffer.toString('hex')
    });

    socket._resetKeepAlive = function () {
      clearInterval(socket._heartbeat);
      socket._heartbeat = setInterval(function () {
        const now = Date.now();
        const message = Message.fromVector(['Ping', now.toString()]);
        // TODO: refactor _sendTo to accept Message type
        const ping = JSON.stringify(message.toObject());

        try {
          server._sendTo(handle, ping);
        } catch (exception) {
          console.error('could not ping peer:', handle, exception);
        }
      }, WEBSOCKET_KEEPALIVE);
    };

    socket._timeout = null;
    socket._resetKeepAlive();

    // Clean up memory when the connection has been safely closed (ideal case).
    socket.on('close', function () {
      clearInterval(socket._heartbeat);
      delete server.connections[player['@data'].connection];
    });

    // TODO: message handler on base class
    socket.on('message', async function handler (msg) {
      console.log('[SERVER:WEBSOCKET]', 'incoming message:', typeof msg, msg);

      let message = null;
      let type = null;

      if (msg.type && msg.data) {
        console.log('spec:', {
          type: msg.type,
          data: msg.data
        });
      }

      try {
        message = Message.fromRaw(msg);
        type = message.type;
      } catch (exception) {
        console.error('could not parse message:', exception);
      }

      if (!message) {
        // Fall back to JSON parsing
        try {
          if (msg instanceof Buffer) {
            msg = msg.toString('utf8');
          }

          message = JSON.parse(msg);
          type = message['@type'] || message.type;
        } catch (E) {
          console.error('could not parse message:', typeof msg, msg, E);
          // TODO: disconnect from peer
          console.warn('you should disconnect from this peer:', handle);
        }
      }

      const obj = message.toObject();
      const actor = new Actor(obj);

      let local = null;

      switch (type) {
        default:
          console.log('[SERVER]', 'unhandled type:', type);
          break;
        case 'GET':
          let answer = await server._GET(message['@data']['path']);
          console.log('answer:', answer);
          return answer;
        case 'POST':
          let link = await server._POST(message['@data']['path'], message['@data']['value']);
          console.log('[SERVER]', 'posted link:', link);
          break;
        case 'PATCH':
          let result = await server._PATCH(message['@data']['path'], message['@data']['value']);
          console.log('[SERVER]', 'patched:', result);
          break;
        case 'Ping':
          let now = Date.now();
          local = Message.fromVector(['Pong', now.toString()]);
          let pong = JSON.stringify(local.toObject());
          return server._sendTo(handle, pong);
        case 'GenericMessage':
          local = Message.fromVector(['GenericMessage', JSON.stringify({
            type: 'GenericMessageReceipt',
            content: actor.id
          })]);

          let msg = null;

          try {
            msg = JSON.parse(obj.data);
          } catch (exception) {}

          if (msg) {
            server.emit('call', msg.data || {
              method: 'GenericMessage',
              params: [msg.data]
            });
          }

          break;
        case 'Pong':
          socket._resetKeepAlive();
          return;
          break;
        case 'Call':
          server.emit('call', {
            method: message['@data'].data.method,
            params: message['@data'].data.params
          });
          break;
      }

      // TODO: enable relays
      // server._relayFrom(handle, msg);

      // always send a receipt of acknowledgement
      socket.send(JSON.stringify({
        '@type': 'Receipt',
        '@actor': handle,
        '@data': message,
        '@version': 1
      }));
    });

    // set up an oracle, which listens to patches from server
    socket.oracle = server.on('patches', function (patches) {
      console.log('magic oracle patches:', patches);
    });

    // insert connection to library
    server.connections[player['@data'].connection] = socket;
    // server.players[player['@data'].connection] = player;

    const ack = Message.fromVector([P2P_SESSION_ACK, crypto.randomBytes(32).toString('hex')]);
    const raw = ack.toBuffer();
    socket.send(raw);

    // send result
    /* socket.send(JSON.stringify({
      '@type': 'VerAck',
      '@version': 1
    })); */

    if (this.app) {
      socket.send(JSON.stringify({
        '@type': 'Inventory',
        '@parent': server.app.id,
        '@version': 1
      }));

      socket.send(JSON.stringify({
        '@type': 'State',
        '@data': server.app.state,
        '@version': 1
      }));
    }

    return socket;
  }

  _sendTo (actor, msg) {
    console.log('[SERVER:WEBSOCKET]', 'sending message to actor', actor, msg);
    let target = this.connections[actor];
    if (!target) throw new Error('No such target.');
    let result = target.send(msg);
  }

  _relayFrom (actor, msg) {
    let peers = Object.keys(this.connections).filter(key => {
      return key !== actor;
    });

    this.log(`relaying message from ${actor} to peers:`, peers);

    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(msg);
      } catch (E) {
        console.error('Could not relay to peer:', E);
      }
    }
  }

  /**
   * Special handler for first-page requests.
   * @param {HTTPRequest} req Incoming request.
   * @param {HTTPResponse} res Outgoing response.
   */
  _handleIndexRequest (req, res) {
    console.log('[HTTP:SERVER]', 'Handling request for Index...');
    let html = '';

    if (this.app) {
      html = this.app.render(this.state);
    } else {
      html = '<fabric-application><fabric-card>Failed to load, as no application was available.</fabric-card></fabric-application>';
    }
    console.log('[HTTP:SERVER]', 'Generated HTML:', html);
    res.set('Content-Type', 'text/html');
    res.send(`${html}`);
  }

  _handleOptionsRequest (req, res) {
    res.send({
      name: this.settings.name,
      description: this.settings.description,
      resources: this.definitions
    });
  }

  _logMiddleware (req, res, next) {
    // if (!this.settings.verbosity < 2) return next();
    // TODO: switch to this.log
    console.log([
      `${req.hostname}:${this.settings.port}`,
      req.hostname,
      req.user,
      `"${req.method} ${req.path} HTTP/${req.httpVersion}"`,
      res.statusCode,
      res.getHeader('content-length')
    ].join(' '));
    return next();
  }

  _headerMiddleware (req, res, next) {
    res.header('X-Powered-By', '@fabric/http');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'content-type');
    return next();
  }

  _verifyClient (info, done) {
    console.log('[HTTP:SERVER]', '_verifyClient', info);
    if (!this.settings.sessions) return done();
    this.sessions(info.req, {}, () => {
      // TODO: reject unknown (!info.req.session.identity)
      done();
    });
  }

  /**
   * Add a route manually.
   * @param {String} method  HTTP verb.
   * @param {String} path    HTTP route.
   * @param {Function} handler HTTP handler (req, res, next)
   */
  _addRoute (method, path, handler) {
    this.emit('debug', `[HTTP:SERVER] Adding route: ${path}`);
    this.customRoutes.push({ method, path, handler });
  }

  _roleMiddleware (req, res, next) {
    next();
  }

  async _applyChanges (ops) {
    try {
      monitor.applyPatch(this.state, ops);
      await this.commit();
    } catch (E) {
      this.error('Error applying changes:', E);
    }

    return this;
  }

  async _handleRoutableRequest (req, res, next) {
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Handling routable request:', req.method, req.path);
    const server = this;

    // Prepare variables
    let result = null;
    let route = null;
    let resource = null;

    for (let i in this.routes) {
      let local = this.routes[i];
      if (req.path.match(local.route)) {
        route = local;
        resource = local.resource;
        break;
      }
    }

    switch (req.method.toUpperCase()) {
      // Discard unhandled methods
      default:
        return next();
      case 'HEAD':
        let existing = await server._GET(req.path);
        if (!existing) return res.status(404).end();
        break;
      case 'GET':
        if (resource) {
          try {
            result = await server.stores[resource].get(req.path);
          } catch (exception) {
            console.warn('[HTTP:SERVER]', 'Warning:', exception);
          }
        }

        // TODO: re-optimize querying from memory (i.e., don't touch disk / restore)
        // If a result was found, use it by breaking immediately
        // if (result) break;

        // No result found, call _GET locally
        result = await server._GET(req.path);
        // let content = await server.stores[resource].get(req.path);
        break;
      case 'PUT':
        result = await server._PUT(req.path, req.body);
        break;
      case 'POST':
        if (resource) {
          result = await server.stores[resource].create(req.body);
        }

        if (!result) return res.status(500).end();

        // Call parent method (2 options)
        // Option 1 (original): Assigns the direct result
        // let link = await server._POST(req.path, result);
        // Option 2 (testing): Assigns the raw body
        let link = await server._POST(req.path, req.body);

        // POST requests return a 303 header with a pointer to the object
        return res.redirect(303, link);
      case 'PATCH':
        let patch = await server._PATCH(req.path, req.body);
        result = patch;
        break;
      case 'DELETE':
        await server._DELETE(req.path);
        return res.sendStatus(204);
      case 'OPTIONS':
        return res.send({
          '@type': 'Error',
          '@data': 'Not yet supported.'
        });
    }

    // If no result found, return 404
    if (!result) {
      return res.status(404).send({
        status: 'error',
        message: 'Document not found.',
        request: {
          method: req.method.toUpperCase(),
          path: req.path
        }
      });
    }

    return res.format({
      json: function () {
        res.header('Content-Type', 'application/json');
        return res.send(result);
      },
      html: function () {
        // TODO: re-enable for HTML
        // let output = server.app._loadHTML(resource.render(result));
        // return res.send(server.app._renderWith(output));

        // TODO: re-write above code, render app with data
        res.header('Content-Type', 'application/json');
        return res.send(result);
      }
    });
  }

  async start () {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Starting...');
    const server = this;
    server.status = 'starting';

    if (!server.settings.resources || !Object.keys(server.settings.resources).length) {
      console.trace('[HTTP:SERVER]', 'No Resources have been defined for this server.  Please provide a "resources" map in the configuration.');
    }

    for (let name in server.settings.resources) {
      const definition = server.settings.resources[name];
      const resource = await server._defineResource(name, definition);
      if (server.settings.verbosity >= 6) console.log('[AUDIT]', 'Created resource:', resource);
    }

    // configure router
    server.express.use(server._logMiddleware.bind(server));
    server.express.use(server._headerMiddleware.bind(server));

    // TODO: defer to an in-memory datastore for requested files
    // NOTE: disable this line to compile on-the-fly
    server.express.use(express.static('assets'));
    server.express.use(extractor());
    server.express.use(server._roleMiddleware.bind(server));

    // configure sessions & parsers
    // TODO: migrate to {@link Session} or abolish entirely
    if (server.settings.sessions) server.express.use(server.sessions);

    // Other Middlewares
    server.express.use(parsers.urlencoded({ extended: true }));
    server.express.use(parsers.json());

    // TODO: render page
    server.express.options('/', server._handleOptionsRequest.bind(server));
    // TODO: enable this route by disabling or moving the static asset handler above
    // NOTE: see `server.express.use(express.static('assets'));`
    server.express.get('/', server._handleIndexRequest.bind(server));

    // handle custom routes.
    // TODO: abolish this garbage in favor of resources.
    for (let i = 0; i < server.customRoutes.length; i++) {
      const route = server.customRoutes[i];
      switch (route.method.toLowerCase()) {
        case 'get':
        case 'put':
        case 'post':
        case 'patch':
        case 'delete':
          server.express[route.method.toLowerCase()](route.path, route.handler);
          break;
      }
    }

    // Attach the internal router
    server.express.get('/*', server._handleRoutableRequest.bind(server));
    server.express.put('/*', server._handleRoutableRequest.bind(server));
    server.express.post('/*', server._handleRoutableRequest.bind(server));
    server.express.patch('/*', server._handleRoutableRequest.bind(server));
    server.express.delete('/*', server._handleRoutableRequest.bind(server));
    server.express.options('/*', server._handleRoutableRequest.bind(server));

    // create the HTTP server
    server.http = stoppable(http.createServer(server.express), 0);

    // attach a WebSocket handler
    server.wss = new WebSocket.Server({
      server: server.http,
      // TODO: validate entire verification chain
      // verifyClient: this._verifyClient.bind(this)
    });

    // set up the WebSocket connection handler
    server.wss.on('connection', server._handleWebSocket.bind(server));

    // Handle messages from internal app
    if (server.app) {
      server.app.on('snapshot', server._handleAppMessage.bind(server));
      server.app.on('message', server._handleAppMessage.bind(server));
      server.app.on('commit', server._handleAppMessage.bind(server));
    }

    // Handle interna call requests
    server.on('call', server._handleCall.bind(server));

    // TODO: convert to bound functions
    server.on('commit', async function (msg) {
      console.log('[HTTP:SERVER]', 'Internal commit:', msg);
    });

    server.on('message', async function (msg) {
      console.log('[HTTP:SERVER]', 'Internal message:', msg);
    });

    if (server.app) {
      try {
        await server.app.start();
      } catch (E) {
        console.error('Could not start server app:', E);
      }
    }

    if (this.settings.listen) {
      server.http.on('listening', notifyReady);
      await server.http.listen(this.settings.port, this.settings.host);
    } else {
      console.warn('[HTTP:SERVER]', 'Listening is disabled.  Only events will be emitted!');
      notifyReady();
    }

    function notifyReady () {
      server.status = 'STARTED';
      server.emit('ready', {
        id: server.id
      });
    }

    // commit to our results
    // await this.commit();

    // TODO: include somewhere
    // console.log('[FABRIC:WEB]', 'You should consider changing the `host` property in your config,');
    // console.log('[FABRIC:WEB]', 'or set up a TLS server to encrypt traffic to and from this node.');
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Started!');

    return server;
  }

  async flush () {
    // console.log('[HTTP:SERVER]', 'flush requested:', this.keys);

    for (let item of this.keys) {
      // console.log('...flushing:', item);
      try {
        await this._DELETE(item);
      } catch (E) {
        console.error(E);
      }
    }
  }

  async stop () {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopping...');
    const server = this;
    this.status = 'stopping';

    try {
      await server.http.stop();
    } catch (E) {
      console.error('Could not stop HTTP listener:', E);
    }

    if (server.app) {
      try {
        await server.app.stop();
      } catch (E) {
        console.error('Could not stop server app:', E);
      }
    }

    this.status = 'stopped';
    server.emit('stopped');

    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Stopped!');
    return server;
  }

  async _GET (path) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling GET to', path);
    let result = await this.app.store._GET(path);
    if (this.settings.verbosity >= 5) console.log('[HTTP:SERVER]', 'Retrieved:', result);
    if (!result && this.collections.includes(path)) result = [];
    return result;
  }

  async _PUT (path, data) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PUT to', path, data);
    return this.app.store._PUT(path, data);
  }

  async _POST (path, data) {
    if (this.settings.verbosity >= 4) console.trace('[HTTP:SERVER]', 'Handling POST to', path, data);
    return this.app.store._POST(path, data);
  }

  async _PATCH (path, data) {
    if (!this.app || !this.app.store) return null;
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling PATCH to', path, data);
    return this.app.store._PATCH(path, data);
  }

  async _DELETE (path) {
    if (this.settings.verbosity >= 4) console.log('[HTTP:SERVER]', 'Handling DELETE to', path);
    return this.app.store._DELETE(path);
  }
}

module.exports = FabricHTTPServer;
