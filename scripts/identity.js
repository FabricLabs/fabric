'use strict';

const {
  FIXTURE_SEED
} = require('../constants');

const DERIVATION = `m/44'/0'/0'/0/0`;
const PREFIX = 'id'; // <Buffer 69, 64>
const X_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

const crypto = require('crypto');

// const settings = require('../settings/local');
const Bech32 = require('../types/bech32');
const Environment = require('../types/environment');
const Hash256 = require('../types/hash256');
const Identity = require('../types/identity');
const Key = require('../types/key');

async function main (input = {}) {
  const master =  new Key(input);
  const child = master.derive(input.derivation);
  const pubkeyhash = Hash256.digest(X_PUBKEY);
  const truth = crypto.createHash('sha256').update(Buffer.from(X_PUBKEY, 'hex')).digest('hex');
  const obj = Identity.fromString('id163zfyfh2frw4ph7nruu3um7e8qyxw9exs8pahr3wvk4ndlz8lfhq40pmup');
  const identity = new Identity(input);
  const frompub = new Identity({ public: X_PUBKEY });

  const decoded = Bech32.decode(frompub.id);

  return {
    id: identity.toString(),
    identity: {
      pubkey: identity.pubkey
    },
    derivation: identity.derivation,
    decoded: decoded
  };
}

main({
  derivation: DERIVATION,
  seed: process.env['FABRIC_SEED'] || FIXTURE_SEED
}).catch((exception) => {
  console.error('[FABRIC:IDENTITY]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[FABRIC:IDENTITY]', 'Current Identity:', output);
});
