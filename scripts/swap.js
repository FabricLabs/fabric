'use strict';

const MIN_SWAP_BLOCKS = 1;

const settings = require('../settings/local');

const BTCA = require('../settings/node-a');
const BTCB = require('../settings/node-b');

const crypto = require('crypto');

const Node = require('../types/node');
const Bitcoin = require('../services/bitcoin');

async function main (input = {}) {
  const btca = new Bitcoin(BTCA);
  const btcb = new Bitcoin(BTCB);

  await btca.start();
  await btcb.start();

  const secret = crypto.randomBytes(32);
  const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const startHeightA = await btca.getChainHeight();
  const startHeightB = await btca.getChainHeight();

  const aliceA = await btca.getUnusedAddress();
  const bobbyA = await btca.getUnusedAddress();

  const aliceB = await btcb.getUnusedAddress();
  const bobbyB = await btcb.getUnusedAddress();

  const aliceAKeyPair = await btca._dumpKeyPair(aliceA);
  const bobbyAKeyPair = await btca._dumpKeyPair(bobbyA);
  const aliceBKeyPair = await btcb._dumpKeyPair(aliceB);
  const bobbyBKeyPair = await btcb._dumpKeyPair(bobbyB);

  const aliceUTXOs = await btca._listUnspent();
  const bobbyUTXOs = await btcb._listUnspent();

  const aliceRedeemAddress = await btca.getUnusedAddress();

  console.log('secret:', secret);
  console.log('utxos:', aliceUTXOs);
  console.log('key:', aliceAKeyPair);

  const aliceOffer = await btca._createSwapScript({
    inputs: aliceUTXOs,
    offer: { amount: 1 },
    ask: { amount: 1 },
    initiator: aliceAKeyPair.publicKey,
    counterparty: bobbyAKeyPair.publicKey,
    destination: aliceRedeemAddress,
    hash: hash,
    constraints: {
      blocktime: startHeightA + MIN_SWAP_BLOCKS
    }
  });

  console.log('aliceOffer:', aliceOffer);
  const aliceBondTX = await btca._createSwapTX({
    amount: 1,
    script: aliceOffer,
    destination: aliceRedeemAddress,
    inputs: [ aliceUTXOs[0] ],
    constraints: {
      blocktime: startHeightA + MIN_SWAP_BLOCKS
    }
  });
  console.log('bond tx:', aliceBondTX);

  const spend = await btca._spendSwapTX({
    tx: aliceBondTX,
    script: aliceOffer,
    signer: aliceAKeyPair
  });

  console.log('spend:', spend);
  console.log('spend hex:', spend.toHex());

  const psbt = await btca._buildPSBT();
  console.log('psbt:', psbt);

  const result = await btca._spendRawTX(spend.toHex());
  console.log('result:', result);

  const bobClaim = await btca._createSwapSpend({});
  const aliceRedeem = await btcb._createSwapRedeem({});

  return {
    assets: {
      BTCA: btca.id,
      BTCB: btcb.id
    },
    addresses: {
      alice: {
        BTCA: aliceA,
        BTCB: aliceB
      },
      bobby: {
        BTCA: bobbyA,
        BTCB: bobbyB
      }
    },
    keys: {
      alice: {
        BTCA: aliceAKeyPair.publicKey,
        BTCB: aliceBKeyPair.publicKey
      },
      bobby: {
        BTCA: bobbyAKeyPair.publicKey,
        BTCB: bobbyBKeyPair.publicKey
      }
    },
    swap: {
      offer: aliceOffer,
      claim: bobClaim,
      redeem: aliceRedeem
    },
    utxos: {
      alice: aliceUTXOs,
      bobby: bobbyUTXOs
    }
  };
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:SWAP]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:SWAP]', 'Main Process Output:', output);
});
