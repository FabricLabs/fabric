'use strict'

import 'babel-polyfill';

//require('debug-trace')({ always: true });

const Fabric = require('./lib/fabric');
const App = require('./lib/app');
const Block = require('./lib/block');
const Chain = require('./lib/chain');
const CLI = require('./lib/cli');
const Datastore = require('./lib/datastore');
const HTTP = require('./lib/http');
const Machine = require('./lib/machine');
const Message = require('./lib/message');
const Oracle = require('./lib/oracle');
const Remote = require('./lib/remote');
const Resource = require('./lib/resource');
const Storage = require('./lib/storage');
const Store = require('./lib/store');
const Transaction = require('./lib/transaction');
const Validator = require('./lib/validator');
const Vector = require('./lib/vector');
const Walker = require('./lib/walker');
const Worker = require('./lib/worker');

/**
 * Fabric's Developer API.  Exposes immutable types for all requisite components.
 * @exports Fabric
 * @type {Fabric}
 */
class API extends Fabric {
  constructor (configuration) {
    super(configuration);
  }
}

/**
 * Offers complex functionality for managing user interfaces bound to real-time data.
 * @type {App}
 */
API.App = App;

/**
 * A batch of Transactions.
 * @type {Block}
 */
API.Block = Block;

/**
 * General mechanism for storing immutable events over time.
 * @type {Chain}
 */
API.Chain = Chain;

/**
 * Basic terminal interface for {@link module:Fabric}.
 * @type {CLI}
 */
API.CLI = CLI;

/**
 * Persistent data storage for local environments.
 * @type {Datastore}
 */
API.Datastore = Datastore;

/**
 * Fully-functional HTTP server for providing oracle services.  See also {@link module:Oracle}.
 * @type {HTTP}
 */
API.HTTP = HTTP;

/**
 * General-purpose computer with verifiable execution.
 * @type {Machine}
 */
API.Machine = Machine;

/**
 * {@link module:Vector} instances for potential application.
 * @type {Message}
 */
API.Message = Message;

/**
 * External point of trust for {@link module:Contract} instances.
 * @type {Oracle}
 */
API.Oracle = Oracle;

/**
 * Simple client which speaks the {@link module:Fabric} protocol.
 * @type {Remote}
 */
API.Remote = Remote;

/**
 * Interactive datastore.
 * @type {Resource}
 */
API.Resource = Resource;

/**
 * Abstract long-term storage with isomorphic support for various clients.
 * @type {Storage}
 */
API.Storage = Storage;

/**
 * Simple storage class.  Uses LevelDB by default.
 * @type {Store}
 */
API.Store = Store;

/**
 * An atomic unit of change within the system.
 * @type {Transaction}
 */
API.Transaction = Transaction;

/**
 * Validates known assumptions.
 * @type {Validator}
 */
API.Validator = Validator;

/**
 * Minimum possible unit.
 * @type {Vector}
 */
API.Vector = Vector;

/**
 * Agent capable of walking a graph.
 * @type {Walker}
 */
API.Walker = Walker;

/**
 * Simple job processing agent.
 * @type {Worker}
 */
API.Worker = Worker;

API.test = new Vector(API)._sign();

export { API as default };
