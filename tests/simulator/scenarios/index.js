'use strict';

const smoke = require('./smoke');
const meshChat = require('./mesh-chat');
const contractMesh = require('./contract-mesh');
const mixedFuzz = require('./mixed-fuzz');
const protocolFlow = require('./protocol-flow');
const documentSwarm = require('./document-swarm');
const documentRelayPrivate = require('./document-relay-private');
const beaconRegistry = require('./beacon-registry');

const SCENARIOS = {
  smoke,
  'mesh-chat': meshChat,
  'contract-mesh': contractMesh,
  'protocol-flow': protocolFlow,
  'mixed-fuzz': mixedFuzz,
  'document-swarm': documentSwarm,
  'document-relay-private': documentRelayPrivate,
  'beacon-registry': beaconRegistry
};

/**
 * @param {string} name
 */
function getScenario (name) {
  const key = String(name || 'smoke');
  const s = SCENARIOS[key];
  if (!s) {
    throw new Error(`unknown scenario "${key}"; known: ${Object.keys(SCENARIOS).join(', ')}`);
  }
  return s;
}

function listScenarios () {
  return Object.keys(SCENARIOS);
}

module.exports = {
  SCENARIOS,
  getScenario,
  listScenarios
};
