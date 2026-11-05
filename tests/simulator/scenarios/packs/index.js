'use strict';

const chat = require('./chat');
const contracts = require('./contracts');
const gossip = require('./gossip');
const inventory = require('./inventory');
const chaos = require('./chaos');
const session = require('./session');
const state = require('./state');
const bitcoin = require('./bitcoin');
const protocol = require('./protocol');
const documentMarket = require('./document-market');
const beaconRegistry = require('./beacon-registry');

const ALL = {
  chat,
  contracts,
  gossip,
  inventory,
  chaos,
  session,
  state,
  bitcoin,
  protocol,
  'document-market': documentMarket,
  'beacon-registry': beaconRegistry
};

/**
 * @param {string[]} names
 * @returns {{ weightMaps: object[], setups: Function[] }}
 */
function composeUseCases (names) {
  const weightMaps = [];
  const setups = [];
  for (const name of names) {
    const pack = ALL[name];
    if (!pack) throw new Error(`unknown use-case: ${name}`);
    weightMaps.push(pack.weights);
    if (typeof pack.setup === 'function') setups.push(pack.setup.bind(pack));
  }
  return {
    weightMaps,
    setups,
    async setup (ctx) {
      for (const fn of setups) await fn(ctx);
    }
  };
}

module.exports = {
  chat,
  contracts,
  gossip,
  inventory,
  chaos,
  session,
  state,
  bitcoin,
  protocol,
  documentMarket,
  beaconRegistry,
  ALL,
  composeUseCases
};
