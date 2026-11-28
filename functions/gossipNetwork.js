'use strict';

/**
 * Gossip catalog now lives on {@link Network}. This module re-exports it.
 * @deprecated Require `@fabric/core/types/network`.
 * @module functions/gossipNetwork
 */

module.exports = require('../types/network');
