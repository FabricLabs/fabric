'use strict';

/**
 * Public entry for the Fabric Core network simulator.
 */

const { createRng, normalizeSeed } = require('./lib/rng');
const { Metrics } = require('./lib/metrics');
const { NetworkHarness } = require('./lib/network');
const { ActionScheduler } = require('./lib/scheduler');
const {
  action,
  builtInActions,
  actionsWithWeights,
  mergeWeights
} = require('./lib/actions');
const { runScenario, writeReport, DEFAULT_REPORT } = require('./lib/runner');
const { getScenario, listScenarios, SCENARIOS } = require('./scenarios');
const { composeUseCases, ALL: USE_CASES } = require('./usecases');

module.exports = {
  createRng,
  normalizeSeed,
  Metrics,
  NetworkHarness,
  ActionScheduler,
  action,
  builtInActions,
  actionsWithWeights,
  mergeWeights,
  runScenario,
  writeReport,
  DEFAULT_REPORT,
  getScenario,
  listScenarios,
  SCENARIOS,
  composeUseCases,
  USE_CASES
};
