'use strict';

const Environment = require('@fabric/core/types/environment');
const environment = new Environment({ namespace: 'portal' });

const settings = {
  seed: environment.readVariable('FABRIC_SEED'),
  fullnode: true,
  authority: "http://ahp7iuGhae8mooBahFaYieyaixei6too:naiRe9wo5vieFayohje5aegheenoh4ee@localhost:20444",
  network: 'regtest',
  verbosity: 3
};

module.exports = settings;
