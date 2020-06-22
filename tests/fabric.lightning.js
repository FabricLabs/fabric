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
  LIGHTNING_TEST_HEADER,
  LIGHTNING_BMM_HEADER,
  LIGHTNING_SIDECHAIN_NUM,
  LIGHTNING_SIDEBLOCK_HASH,
  LIGHTNING_PARENT_SIDEBLOCK_HASH,
  REMOTEPUBKEY,
  LOCAL_DELAYEDPUBKEY,
  LOCAL_REVOCATION_PUBKEY
} = require('./fixtures/lightning');

// Testing
const assert = require('assert');
const crypto = require('crypto');

const Fabric = require('../');
const Message = require('../types/message');

const config = require('../settings/test');
const handler = require('../functions/handleException');
const Lightning = require('../services/lightning');
const LightningMessage = require('../types/lightning/message');

describe('@fabric/core/services/lightning', function () {
  describe('Lightning', function () {
    it('can create an instance', async function provenance () {
      let lightning = new Lightning({
        name: 'Test'
      });

      assert.ok(lightning);
    });

    it('can create a message', async function provenance () {
      let lightning = new Lightning({
        name: 'Test'
      });

      let entropy = await lightning.machine.sip();
      let message = Message.fromVector(['Cycle', entropy.toString(8)]);
      let next = await lightning.machine.sip();
      let prediction = Message.fromVector(['Cycle', next.toString(8)]);

      assert.ok(lightning);
      assert.ok(message);
      assert.ok(prediction);
    });
  });
});