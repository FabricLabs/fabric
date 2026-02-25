'use strict';

const FabricScribe = require('../types/scribe');
const FabricStash = require('../types/stash');

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
