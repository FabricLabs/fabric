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
const Lightning = require('../services/lightning');

async function main (input = {}) {
  const bitcoin = new Bitcoin(BTCA);

  await bitcoin.start();

  // const network = btca.networks[btca.settings.network];
  // const secret = crypto.randomBytes(32);
  // const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const initialmempool = await bitcoin._makeRPCRequest('getrawmempool');
  console.log('initial mempool:', initialmempool);

  // mine a block if transactions in mempool
  if (initialmempool && initialmempool.length) {
    await bitcoin.generateBlock();
  }

  const startHeight = await bitcoin.getChainHeight();
  const chaininfo = await bitcoin._makeRPCRequest('getmempoolinfo');
  const minrelayfee = chaininfo.minrelaytxfee;

  console.log('chaininfo:', chaininfo);
  console.log('minrelayfee:', minrelayfee);

  const aliceFirstAddress = await bitcoin.getUnusedAddress();
  const aliceFirstKeyPair = await bitcoin._dumpKeyPair(aliceFirstAddress);

  const aliceRedeemAddress = await bitcoin.getUnusedAddress();
  const aliceRedeemKeyPair = await bitcoin._dumpKeyPair(aliceRedeemAddress);

  const aliceUTXOs = await bitcoin._listUnspent();
  // const bobbyUTXOs = await btcb._listUnspent();

  const contract = await bitcoin._createContractProposal({
    change: aliceRedeemAddress
  });

  const scriptpubkey = null;

  console.log('contract:', contract);
  console.log('[!!!] Number of Keys matches number of Outputs:', (contract.keys.length === contract.inputs.length) === true);
  console.log('[!!!] Contract Transaction:', contract.tx);

  const coins = await bitcoin._getCoinsFromInputs(aliceUTXOs);
  const keys = await bitcoin._getKeysFromCoins(coins);

  console.log('keys:', keys);

  // TODO: add support for segwit, taproot
  // is the scriptpubkey still set?
  /* await btca._attachOutputToContract({
    scriptpubkey: scriptpubkey,
    value: Amount.fromBTC(utxo.amount).toValue()
  }, contract); */
  const utxo = aliceUTXOs[0];
  const keypair = await bitcoin._dumpKeyPair(utxo.address);
  const raw = await bitcoin._requestRawTransaction(utxo.txid);
  const tx = bitcoin.lib.Transaction.fromHex(raw);

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

  mtx.addOutput(aliceFirstAddress, Amount.fromBTC(TRANSFER_VALUE).toValue());

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

  const result = await bitcoin._spendRawTX(broadcastRaw);
  console.log('result:', result);

  const mempool = await bitcoin._getMempool();
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
