'use strict';

// L1/L2 liquidity swap against a managed regtest bitcoind and two Core
// Lightning nodes. Gated like tests/lightning/lightning.service.js:
//   FABRIC_E2E_REGTEST=1 npx mocha tests/lightning/swap.regtest.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ecc = require('../../types/ecc');
const Bitcoin = require('../../services/bitcoin');
const Lightning = require('../../services/lightning');
const Swap = require('../../types/swap');
const Htlc = require('../../types/htlc');

const { getFreePort } = require('../helpers/peer');

const runRegtest = !!process.env.FABRIC_E2E_REGTEST;
const MINER_WALLET = 'liquidity-swap-e2e';

function randomPriv () {
  let priv;
  do {
    priv = crypto.randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return priv;
}

async function waitFor (label, fn, { tries = 45, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('@fabric/core/types/swap (regtest)', function () {
  this.timeout(300000);

  let bitcoin;
  let makerLn;
  let takerLn;
  let miner;
  let chain;
  const dirs = [];

  const mine = (n = 1) => bitcoin._makeRPCRequest('generatetoaddress', [n, miner]);
  const wallet = (method, params = []) => bitcoin._makeWalletRequest(method, params, MINER_WALLET);

  function makeOrder (side, overrides = {}) {
    const makerKey = randomPriv();
    const order = Swap.signBody(Swap.toBody(Swap.BODY_TYPES.ORDER, Object.assign({
      side,
      premiumPpm: 2000,
      feeSats: 100,
      minSats: 10000,
      maxSats: 500000,
      prepaySats: 0,
      refundLockBlocks: 144,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      makerPubkey: Swap.pubkeyFromPrivate(makerKey),
      lightningNodeId: makerLn.state.node.id,
      network: 'regtest',
      nonce: Swap.randomNonce()
    }, overrides)), makerKey);
    const maker = new Swap({
      order,
      role: 'maker',
      identityKey: makerKey,
      htlcKey: randomPriv(),
      adapters: { bitcoin: chain, lightning: Swap.lightningAdapter(makerLn) }
    });
    const taker = new Swap({
      order,
      role: 'taker',
      identityKey: randomPriv(),
      htlcKey: randomPriv(),
      lightningNodeId: takerLn.state.node.id,
      adapters: { bitcoin: chain, lightning: Swap.lightningAdapter(takerLn) }
    });
    return { order, maker, taker };
  }

  async function negotiate ({ maker, taker }, amountSats) {
    const take = await taker.createTake({ amountSats });
    const accept = await maker.acceptTake(JSON.parse(JSON.stringify(take)));
    await taker.applyAccept(JSON.parse(JSON.stringify(accept)));
  }

  before(async function () {
    if (!runRegtest) return this.skip();
    try {
      execSync('which lightningd', { stdio: 'ignore' });
    } catch {
      console.warn('[FABRIC:LIQUIDITY] lightningd not found in PATH, skipping');
      return this.skip();
    }

    const stamp = `${process.pid}-${Date.now()}`;
    const bitcoinDatadir = `./stores/bitcoin-regtest-liquidity-${stamp}`;
    const lightningDatadir = `./stores/lightning-regtest-liquidity-${stamp}`;
    dirs.push(bitcoinDatadir, `${lightningDatadir}-maker`, `${lightningDatadir}-taker`);
    const rpcPort = await getFreePort();
    const zmqPort = await getFreePort();

    bitcoin = new Bitcoin({
      debug: false,
      network: 'regtest',
      mode: 'fabric',
      host: '127.0.0.1',
      port: await getFreePort(),
      rpcport: rpcPort,
      zmqport: zmqPort,
      zmq: { host: '127.0.0.1', port: zmqPort },
      managed: true,
      listen: 0,
      enforceIsolatedRegtest: true,
      username: 'bitcoinrpc',
      password: 'password',
      datadir: bitcoinDatadir,
      walletName: MINER_WALLET
    });
    bitcoin.on('error', (msg) => console.error('[FABRIC:LIQUIDITY]', msg));
    await bitcoin.start();
    await bitcoin._loadWallet(MINER_WALLET);
    miner = await wallet('getnewaddress', []);
    await mine(101);
    chain = Swap.bitcoinAdapter(bitcoin, { wallet: MINER_WALLET });

    const lightningDefaults = {
      debug: false,
      bitcoin: {
        rpcport: rpcPort,
        rpcuser: 'bitcoinrpc',
        rpcpassword: 'password',
        host: '127.0.0.1',
        datadir: bitcoinDatadir
      },
      managed: true,
      socket: 'lightningd.sock',
      mode: 'socket',
      network: 'regtest'
    };
    makerLn = new Lightning(Object.assign({}, lightningDefaults, {
      datadir: `${lightningDatadir}-maker`,
      port: await getFreePort()
    }));
    takerLn = new Lightning(Object.assign({}, lightningDefaults, {
      datadir: `${lightningDatadir}-taker`,
      port: await getFreePort(),
      disablePlugins: ['cln-grpc']
    }));
    await makerLn.start();
    await takerLn.start();

    // The taker pays L2, so it opens the channel and holds the outbound side.
    const deposit = await takerLn.newDepositAddress();
    await wallet('sendtoaddress', [deposit, 1]);
    await mine(1);
    await waitFor('taker on-chain funds', async () => {
      const funds = await takerLn.listFunds();
      return (funds.outputs || []).some((o) => o.status === 'confirmed');
    });
    await takerLn.connectTo(`${makerLn.state.node.id}@127.0.0.1:${makerLn.settings.port}`);
    await takerLn.createChannel(makerLn.state.node.id, 1000000);
    await mine(6);
    const takerId = takerLn.state.node.id;
    const makerId = makerLn.state.node.id;
    await waitFor('channel active in both directions', async () => {
      const channels = await takerLn._makeRPCRequest('listchannels', []);
      const active = (channels.channels || []).filter((c) => c.active &&
        ((c.source === takerId && c.destination === makerId) || (c.source === makerId && c.destination === takerId)));
      return new Set(active.map((c) => c.source)).size >= 2;
    });
  });

  after(async function () {
    for (const node of [takerLn, makerLn, bitcoin]) {
      if (!node) continue;
      try {
        await node.stop();
      } catch (error) {
        console.error('[FABRIC:LIQUIDITY]', 'stop failed:', error && error.message);
      }
    }
    for (const dir of dirs) {
      try {
        fs.rmSync(path.resolve(dir), { recursive: true, force: true });
      } catch {}
    }
  });

  it('settles an ask: maker funds the HTLC, taker pays the invoice and claims', async function () {
    const ctx = makeOrder('ask');
    await negotiate(ctx, 100000);
    assert.strictEqual(ctx.taker.quote.l2Msat, (100200 + 100) * 1000);

    const funded = await ctx.maker.fund();
    assert.strictEqual((await ctx.taker.applyFunded(JSON.parse(JSON.stringify(funded)))).pending, true);
    await mine(1);
    assert.strictEqual((await ctx.taker.applyFunded(JSON.parse(JSON.stringify(funded)))).ok, true);

    const preimageHex = await ctx.taker.payInvoice();
    assert.strictEqual(await ctx.maker.checkPaid(), true);

    const destination = await chain.getNewAddress();
    const claimTxid = await ctx.taker.claim({ destinationAddress: destination });
    await mine(1);
    const claim = await bitcoin._makeRPCRequest('getrawtransaction', [claimTxid, true]);
    assert.ok(claim.confirmations >= 1, 'claim confirmed');
    const paid = claim.vout.find((o) => o.scriptPubKey && o.scriptPubKey.address === destination);
    assert.strictEqual(Math.round(paid.value * 1e8), 100000 - 1000);

    const found = Htlc.extractPreimage(claim.hex, ctx.taker.terms.paymentHashHex);
    assert.strictEqual(found.preimageHex, preimageHex);
    assert.strictEqual(ctx.maker.observeClaim(claim.hex), true);
    assert.strictEqual(ctx.maker.status, 'l1Claimed');
    assert.strictEqual(ctx.taker.status, 'l1Claimed');
  });

  it('refunds the maker after the lock when the invoice is never paid', async function () {
    const ctx = makeOrder('ask', { refundLockBlocks: 24 });
    await negotiate(ctx, 50000);
    await ctx.maker.fund();
    await mine(1);
    await assert.rejects(ctx.maker.refund(), /refund lock opens/);

    const tip = await chain.getTipHeight();
    await mine(ctx.maker.terms.refundLockHeight - tip);
    const refundTxid = await ctx.maker.refund();
    await mine(1);
    const refund = await bitcoin._makeRPCRequest('getrawtransaction', [refundTxid, true]);
    assert.ok(refund.confirmations >= 1, 'refund confirmed');
    assert.strictEqual(ctx.maker.status, 'refunded');
  });
});
