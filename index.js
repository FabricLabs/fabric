'use strict'

const Fabric = require('./lib/fabric');

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
API.App = require('./lib/app');

/**
 * General mechanism for storing immutable events over time.
 * @type {Chain}
 */
API.Chain = require('./lib/chain');

/**
 * Basic terminal interface for {@link module:Fabric}.
 * @type {CLI}
 */
API.CLI = require('./lib/cli');

/**
 * Persistent data storage for local environments.
 * @type {Datastore}
 */
API.Datastore = require('./lib/datastore');

/**
 * Fully-functional HTTP server for providing oracle services.  See also {@link module:Oracle}.
 * @type {HTTP}
 */
API.HTTP = require('./lib/http');

/**
 * General-purpose computer with verifiable execution.
 * @type {Machine}
 */
API.Machine = require('./lib/machine');

/**
 * {@link module:Vector} instances for potential application.
 * @type {Message}
 */
API.Message = require('./lib/message');

/**
 * External point of trust for {@link module:Contract} instances.
 * @type {Oracle}
 */
API.Oracle = require('./lib/oracle');

/**
 * Simple client which speaks the {@link module:Fabric} protocol.
 * @type {Remote}
 */
API.Remote = require('./lib/remote');

/**
 * Abstract long-term storage with isomorphic support for various clients.
 * @type {Storage}
 */
API.Storage = require('./lib/storage');

/**
 * An atomic unit of change within the system.
 * @type {Transaction}
 */
API.Transaction = require('./lib/transaction');

/**
 * Validates known assumptions.
 * @type {Validator}
 */
API.Validator = require('./lib/validator');

/**
 * Minimum possible unit.
 * @type {Vector}
 */
API.Vector = require('./lib/vector');

/**
 * Agent capable of walking a graph.
 * @type {Walker}
 */
API.Walker = require('./lib/walker');

export { API as default };
