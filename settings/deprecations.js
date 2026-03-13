'use strict';

const FabricScribe = require('../types/scribe');
const FabricStack = require('../types/stack');
const FabricStash = require('../types/stash');
const FabricSwarm = require('../types/swarm');
const FabricValue = require('../types/value');

/**
 * Deprecated 2026-03-08.
 * @deprecated
 */
class Stack extends FabricStack {}

/**
 * Deprecated 2026-03-08.
 * @deprecated
 */
class Swarm extends FabricSwarm {}

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

/**
 * Deprecated 2021-11-06.
 * @deprecated
 */
class Value extends FabricValue {}

module.exports = {
  Scribe,
  Stash
};
