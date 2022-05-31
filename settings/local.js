'use strict';

const Environment = require('../types/environment');
const environment = new Environment({ namespace: 'fabric' });

const settings = {
  seed: environment.readVariable('FABRIC_SEED'),
  public: '0223cffd5e94da3c8915c6b868f06d15183c1aeffad8ddf58fcb35a428e3158e71',
  fullnode: true,
  authority: 'http://ahp7iuGhae8mooBahFaYieyaixei6too:naiRe9wo5vieFayohje5aegheenoh4ee@localhost:20444',
  network: 'regtest',
  verbosity: 3
};

module.exports = settings;
