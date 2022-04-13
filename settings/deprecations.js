'use strict';

const FabricScribe = require('../types/scribe');
const FabricHTTPServer = require('../types/server');
const FabricStash = require('../types/stash');

/**
 * Deprecated 2021-10-16.
 * @deprecated
 */
class HTTPServer extends FabricHTTPServer {}

/**
 * Deprecated 2021-11-06.
 * @deprecated
 */
class Scribe extends FabricScribe {}

/**
 * Deprecated 2021-11-06.
 * @deprecated
 */
class Stash extends FabricStash {}

module.exports = {
  HTTPServer,
  Scribe,
  Stash
};
