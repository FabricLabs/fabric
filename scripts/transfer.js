'use strict';

const MIN_SWAP_BLOCKS = 1;
const MIN_FEE = '0.000011';
const TRANSFER_VALUE = 1;
const USE_MULTI_FUNDS = true;

const settings = require('../settings/local');

const BTCA = require('../settings/node-a');
const BTCB = require('../settings/node-b');

// const crypto = require('crypto');
const {
  Amount,
  Coin,
  KeyRing,
  MTX,
  Script
} = require('bcoin');

// const Node = require('../types/node');
const Bitcoin = require('../services/bitcoin');

async function main (input = {}) {
  const btca = new Bitcoin(BTCA);
  // const btcb = new Bitcoin(BTCB);

  await btca.start();
  // await btcb.start();

  // const network = btca.networks[btca.settings.network];
  // const secret = crypto.randomBytes(32);
  // const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const startHeightA = await btca.getChainHeight();
  // const startHeightB = await btcb.getChainHeight();
  const chaininfo = await btca._makeRPCRequest('getmempoolinfo');
  const minrelayfee = chaininfo.minrelaytxfee;

  console.log('chaininfo:', chaininfo);
  console.log('minrelayfe:', minrelayfee);

  const aliceA = await btca.getUnusedAddress();
  // const bobbyA = await btca.getUnusedAddress();

  // const aliceB = await btcb.getUnusedAddress();
  // const bobbyB = await btcb.getUnusedAddress();

  const aliceAKeyPair = await btca._dumpKeyPair(aliceA);
  // const bobbyAKeyPair = await btca._dumpKeyPair(bobbyA);
  // const aliceBKeyPair = await btcb._dumpKeyPair(aliceB);
  // const bobbyBKeyPair = await btcb._dumpKeyPair(bobbyB);

  const aliceRedeemAddress = await btca.getUnusedAddress();
  const aliceRedeemKeyPair = await btca._dumpKeyPair(aliceRedeemAddress);

  const initialmempool = await btca._makeRPCRequest('getrawmempool');
  console.log('initial mempool:', initialmempool);

  // mine a block if transactions in mempool
  if (initialmempool && initialmempool.length) {
    await btca.generateBlock();
  }

  const aliceUTXOs = await btca._listUnspent();
  // const bobbyUTXOs = await btcb._listUnspent();

  const contract = await btca._createContractProposal({
    change: aliceRedeemAddress
  });

  const scriptpubkey = null;

  console.log('contract:', contract);
  console.log('[!!!] Number of Keys matches number of Outputs:', (contract.keys.length === contract.inputs.length) === true);
  console.log('[!!!] Contract Transaction:', contract.tx);

  const coins = await btca._getCoinsFromInputs(aliceUTXOs);
  const keys = await btca._getKeysFromCoins(coins);

  console.log('keys:', keys);

  // TODO: add support for segwit, taproot
  // is the scriptpubkey still set?
  /* await btca._attachOutputToContract({
    scriptpubkey: scriptpubkey,
    value: Amount.fromBTC(utxo.amount).toValue()
  }, contract); */
  const utxo = aliceUTXOs[0];
  const keypair = await btca._dumpKeyPair(utxo.address);
  const raw = await btca._requestRawTransaction(utxo.txid);
  const tx = btca.lib.Transaction.fromHex(raw);

  const ring = new KeyRing(keypair.privateKey);
  const address = ring.getAddress();

  // const mtx = contract.mtx;
  const mtx = new MTX();
  console.log('mtx:', mtx);

  const info = {
    hash: Buffer.from(utxo.txid, 'hex').reverse(),
    index: utxo.vout,
    value: Amount.fromBTC(utxo.amount).toValue(),
    script: Script.fromAddress(address)
  };

  mtx.addOutput(aliceA, Amount.fromBTC(TRANSFER_VALUE).toValue());

  console.log('ring:', ring);

  await mtx.fund(coins, {
    rate: Amount.fromBTC(MIN_FEE).toValue(),
    changeAddress: aliceRedeemAddress
  });

  ring.witness = true;
  // ring.script = Script.fromAddress(aliceRedeemAddress);

  mtx.sign(ring);

  console.log('signed mtx:', mtx);

  const verified = mtx.verify();
  console.log('verified:', verified);

  const broadcastTX = mtx.toTX();
  console.log('broadcast TX:', broadcastTX);

  const broadcastRaw = broadcastTX.toRaw().toString('hex');
  console.log('broadcast raw:', broadcastRaw);

  const result = await btca._spendRawTX(broadcastRaw);
  console.log('result:', result);

  const mempool = await btca._getMempool();
  console.log('mempool after:', mempool);

  /* const p2wpkh = await btca._createP2WPKHTransaction({
    amount: TRANSFER_VALUE,
    pubkey: keypair.publicKey,
    destination: aliceRedeemAddress,
    change: aliceRedeemAddress,
    payment: {
      hash: tx.txid,
      index: tx.outs[0].vout
    }
  });
  console.log('p2wpkh tx:', p2wpkh); */

  return {

  };
}

main(settings).catch((exception) => {
  console.error('[SCRIPTS:SWAP]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:SWAP]', 'Main Process Output:', output);
});
