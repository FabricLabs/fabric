'use strict';

// L1:L1 coinjoin against a managed regtest bitcoind: a taker and two makers,
// each with its own descriptor wallet, plus a fidelity bond. Gated:
//   FABRIC_E2E_REGTEST=1 npx mocha tests/bitcoin/coinjoin.regtest.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bitcoinjs = require('bitcoinjs-lib');

const Bitcoin = require('../../services/bitcoin');
const Message = require('../../types/message');
const CoinjoinBook = require('../../types/coinjoinBook');
const { CoinjoinTakerRound, CoinjoinMakerRound } = require('../../types/coinjoinRound');
const coinjoin = require('../../functions/coinjoin');
const fidelityBond = require('../../functions/fidelityBond');
const { buildMessage, tryParseLegacyBody } = require('../../functions/fabricMessageBodies');
const { getFreePort } = require('../helpers/peer');

const runRegtest = !!process.env.FABRIC_E2E_REGTEST;
const MINER_WALLET = 'coinjoin-e2e-miner';
const AMOUNT = 2000000;

// Every message crosses the wire as a CONTRACT_MESSAGE.
function wire (value) {
  const message = buildMessage('CONTRACT_MESSAGE', coinjoin.toContractMessage(value));
  const parsed = tryParseLegacyBody(Message.fromBuffer(message.toBuffer()));
  assert.strictEqual(parsed.ok, true);
  const read = coinjoin.fromContractMessage(parsed.value);
  assert.ok(read, 'coinjoin body survives the wire');
  return read;
}

describe('@fabric/core coinjoin (regtest)', function () {
  this.timeout(300000);

  let bitcoin;
  let chain;
  let miner;
  const dirs = [];

  const rpc = (method, params = []) => bitcoin._makeRPCRequest(method, params);
  const walletCall = (name, method, params = []) => bitcoin._makeWalletRequest(method, params, name);
  const mine = (n = 1) => rpc('generatetoaddress', [n, miner]);
  const balance = async (name) => {
    const b = await walletCall(name, 'getbalances', []);
    return Math.round(Number(b.mine.trusted) * 1e8);
  };

  async function fundWallet (name, btcAmounts) {
    await bitcoin._loadWallet(name);
    for (const btc of btcAmounts) {
      const address = await walletCall(name, 'getnewaddress', ['', 'bech32m']);
      await walletCall(MINER_WALLET, 'sendtoaddress', [address, btc]);
    }
  }

  before(async function () {
    if (!runRegtest) return this.skip();
    const datadir = `./stores/bitcoin-regtest-coinjoin-${process.pid}-${Date.now()}`;
    dirs.push(datadir);
    const zmqPort = await getFreePort();
    bitcoin = new Bitcoin({
      debug: false,
      network: 'regtest',
      mode: 'fabric',
      host: '127.0.0.1',
      port: await getFreePort(),
      rpcport: await getFreePort(),
      zmqport: zmqPort,
      zmq: { host: '127.0.0.1', port: zmqPort },
      managed: true,
      listen: 0,
      enforceIsolatedRegtest: true,
      username: 'bitcoinrpc',
      password: 'password',
      datadir,
      walletName: MINER_WALLET
    });
    bitcoin.on('error', (msg) => console.error('[FABRIC:COINJOIN]', msg));
    await bitcoin.start();
    await bitcoin._loadWallet(MINER_WALLET);
    miner = await walletCall(MINER_WALLET, 'getnewaddress', []);
    await mine(101);
    chain = CoinjoinTakerRound.bitcoinAdapter(bitcoin);

    await fundWallet('coinjoin-e2e-taker', [0.03, 0.01]);
    await fundWallet('coinjoin-e2e-maker-a', [0.025]);
    await fundWallet('coinjoin-e2e-maker-b', [0.015, 0.015]);
    // PoDLE coins must be 5 blocks old.
    await mine(6);
  });

  after(async function () {
    if (bitcoin) {
      try {
        await bitcoin.stop();
      } catch (error) {
        console.error('[FABRIC:COINJOIN]', 'stop failed:', error && error.message);
      }
    }
    for (const dir of dirs) {
      try {
        fs.rmSync(path.resolve(dir), { recursive: true, force: true });
      } catch {}
    }
  });

  it('mixes a taker and two makers into one broadcast transaction', async function () {
    const now = Date.now();
    const book = new CoinjoinBook({ network: 'regtest' });
    const makers = ['a', 'b'].map((label) => {
      const identityKey = coinjoin.randomPrivateKey();
      const offer = coinjoin.signBody({
        type: coinjoin.BODY_TYPES.OFFER,
        network: 'regtest',
        minSats: 100000,
        maxSats: 5000000,
        feeSats: 500,
        feePpm: 100,
        txFeeContributionSats: 200,
        createdAt: now,
        expiresAt: now + 3600000,
        makerPubkey: coinjoin.pubkeyFromPrivate(identityKey),
        nonce: coinjoin.randomNonce()
      }, identityKey);
      const heard = wire(offer);
      assert.strictEqual(heard.kind, 'offer');
      assert.strictEqual(book.ingestOffer(heard.body).ok, true);
      const wallet = `coinjoin-e2e-maker-${label}`;
      return {
        wallet,
        offer,
        round: new CoinjoinMakerRound({
          offer,
          identityKey,
          adapters: { bitcoin: chain, wallet: CoinjoinTakerRound.walletAdapter(bitcoin, { wallet }) }
        })
      };
    });
    const before = {};
    for (const m of makers) before[m.wallet] = await balance(m.wallet);

    const taker = new CoinjoinTakerRound({
      network: 'regtest',
      amountSats: AMOUNT,
      adapters: { bitcoin: chain, wallet: CoinjoinTakerRound.walletAdapter(bitcoin, { wallet: 'coinjoin-e2e-taker' }) }
    });
    const deliver = async (messages) => {
      const next = [];
      for (const msg of messages) {
        const sealed = wire(msg.envelope);
        assert.strictEqual(sealed.kind, 'sealed');
        const maker = makers.find((m) => m.offer.makerPubkey === msg.to);
        const reply = await maker.round.receive(sealed.envelope);
        if (reply) next.push(...await taker.receive(wire(reply).envelope));
      }
      return next;
    };

    const chosen = book.choose(AMOUNT, 2);
    assert.strictEqual(chosen.length, 2);
    await deliver(await deliver(await taker.start(chosen)));
    await deliver(await taker.buildTx({ feeRateSatVb: 2 }));
    assert.strictEqual(taker.status, 'signed');
    const final = await taker.finalize();
    await mine(1);

    const tx = bitcoinjs.Transaction.fromHex(final.txHex);
    assert.strictEqual(tx.outs.filter((o) => Number(o.value) === AMOUNT).length, 3);
    const confirmed = await walletCall('coinjoin-e2e-taker', 'gettransaction', [final.txid]);
    assert.ok(confirmed.confirmations >= 1);
    for (const m of makers) {
      const earned = coinjoin.makerFee(m.offer, AMOUNT) - m.offer.txFeeContributionSats;
      assert.strictEqual(await balance(m.wallet), before[m.wallet] + earned, `${m.wallet} earns its fee less its contribution`);
    }
  });

  it('funds, verifies, and redeems a fidelity bond only after its lock', async function () {
    const makerKey = coinjoin.randomPrivateKey();
    const makerPubkey = coinjoin.pubkeyFromPrivate(makerKey);
    const bondKey = coinjoin.randomPrivateKey();
    const tip = await chain.getTipHeight();
    const locktime = tip + 20;
    const out = fidelityBond.buildBondP2tr({ bondPubkey: coinjoin.pubkeyFromPrivate(bondKey), locktime });
    const txid = await walletCall(MINER_WALLET, 'sendtoaddress', [out.address, 0.1]);
    await mine(6);
    const raw = await walletCall(MINER_WALLET, 'gettransaction', [txid, false, true]);
    const vout = raw.decoded.vout.find((o) => o.scriptPubKey.hex === out.scriptPubKeyHex).n;

    const bond = fidelityBond.signBondCertificate({
      network: 'regtest',
      txid,
      vout,
      locktime,
      makerPubkey,
      certExpiresAt: tip + 1000,
      bondPrivateKey: bondKey
    });
    const verifier = new fidelityBond.BondVerifier({ bitcoin: chain, network: 'regtest' });
    const verified = await verifier.verify(bond, makerPubkey);
    assert.strictEqual(verified.ok, true, verified.reason);
    assert.strictEqual(verified.valueSats, 10000000);
    assert.ok(verified.value > 0);
    assert.strictEqual((await verifier.verify(bond, coinjoin.pubkeyFromPrivate(coinjoin.randomPrivateKey()))).ok, false);

    const now = Date.now();
    const offer = coinjoin.signBody({
      type: coinjoin.BODY_TYPES.OFFER,
      network: 'regtest',
      minSats: 100000,
      maxSats: 5000000,
      feeSats: 500,
      createdAt: now,
      expiresAt: now + 3600000,
      makerPubkey,
      nonce: coinjoin.randomNonce(),
      fidelityBond: bond
    }, makerKey);
    const book = new CoinjoinBook({ network: 'regtest' });
    book.ingestOffer(wire(offer).body);
    const refreshed = await book.refreshBonds(verifier);
    assert.strictEqual(refreshed.valid, 1);
    assert.ok(book.listOffers()[0].bondValue > 0);

    const redeem = (feeSats) => fidelityBond.signAndExtractBondRedeem(fidelityBond.buildBondRedeemPsbt({
      bond: { txid, vout, valueSats: 10000000, locktime, bondXOnly: bond.bondXOnly },
      destinationAddress: miner,
      feeSats
    }), bondKey);
    const early = redeem(1000);
    await assert.rejects(rpc('sendrawtransaction', [early.txHex]), /non-final/);

    const height = await chain.getTipHeight();
    await mine(locktime - height);
    const spent = await rpc('sendrawtransaction', [early.txHex]);
    assert.strictEqual(spent, early.txid);
    await mine(1);
    assert.strictEqual(await chain.getTxOut(txid, vout), null);
    verifier.clear();
    assert.strictEqual((await verifier.verify(bond, makerPubkey)).reason, 'bond output is spent or unknown');
  });
});
