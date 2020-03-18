'use strict';

const {
  GENESIS_HASH,
  BLOCK_ONE,
  BLOCK_ONE_COINBASE,
  BLOCK_ONE_PRIVKEY,
  BLOCK_ONE_PRIVKEY_BASE58,
  REMOTE_FUNDING_PUBKEY,
  FUNDING_WITNESS_SCRIPT,
  FUNDING_INPUT_TXID,
  FUNDING_INPUT_INDEX,
  FUNDING_INPUT_SATOSHIS,
  FUNDING_INPUT_FUNDING_SATOSHIS,
  FUNDING_INPUT_WITNESS_SCRIPT,
  FUNDING_FEERATE_PER_KW,
  FUNDING_CHANGE_SATOSHIS,
  FUNDING_OUTPUT_INDEX,
  FUNDING_TX,
  FUNDING_TXID,
  LOCAL_FUNDING_PRIVKEY,
  LOCAL_FUNDING_PUBKEY,
  LOCAL_PRIVKEY,
  LOCALPUBKEY,
  REMOTEPUBKEY,
  LOCAL_DELAYEDPUBKEY,
  LOCAL_REVOCATION_PUBKEY
} = require('./fixtures/lightning');

// Testing
const assert = require('assert');
const Fabric = require('../');

const config = require('../settings/test');
const handler = require('../functions/handleException');
const Lightning = require('../services/lightning');

describe('@fabric/core/services/lightning', function () {
  describe('Lightning', function () {
    it('can create an instance', async function provenance () {
      let lightning = new Lightning({
        name: 'Test'
      });

      assert.ok(lightning);
    });
  });
});