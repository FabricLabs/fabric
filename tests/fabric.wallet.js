'use strict';

// require('debug-trace')({ always: true });
const assert = require('assert');
const Wallet = require('../types/wallet');
const Bitcoin = require('../services/bitcoin');
const Key = require('../types/key');

// const message = require('../assets/message');
const settings = require('../settings/test');
const options = Object.assign({}, settings, {
  network: 'regtest',
  verbosity: 2
});

describe('@fabric/core/types/wallet', function () {
  describe('Wallet', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Wallet instanceof Function, true);
    });

    it('can create a wallet from seed', function () {
      const seed = Wallet.createSeed();
      const wallet = Wallet.fromSeed(seed);
      assert.ok(wallet);
      assert.ok(wallet.key);
      assert.ok(wallet.key.seed);
    });

    xit('can restore a public key', async function () {
      async function test () {
        const wallet = new Wallet(options);
        const origin = await wallet.generateCleanKeyPair();
        const key = new Key({ public: origin.public });
        assert.equal(origin.public.toString('hex'), key.public.toString('hex'));
      }

      await test();
    });

    it('can derive keys from a path', function () {
      const wallet = new Wallet(options);
      const derived = wallet.derive('m/7777\'/7777\'/0\'/0/0');
      assert.ok(derived);
      assert.ok(derived.privateKey);
      assert.ok(derived.publicKey);
    });

    xit('can load a key into the wallet', async function () {
      const wallet = new Wallet(options);
      const keypair = await wallet.generateCleanKeyPair();
      const key = new Key({ public: keypair.public });
      const result = wallet.loadKey(key, ['test']);
      assert.ok(result);
      assert.ok(wallet.keys);
      assert.ok(wallet.keys.get(`/${key.public.toString('hex')}`));
    });

    it('can export wallet state', function () {
      const wallet = new Wallet(options);
      const exported = wallet.export();
      assert.ok(exported);
      assert.equal(exported.type, 'FabricWallet');
      assert.ok(exported.object);
      assert.ok(exported.object.master);
      assert.ok(exported.object.seed);
      assert.ok(exported.object.xprv);
    });

    it('can get an unused address', async () => {
      const wallet = new Wallet();
      const address = await wallet.getUnusedAddress();
      assert(address);
      assert(typeof address === 'string');
    });

    it('can get a receive address', async () => {
      const wallet = new Wallet();
      const address = await wallet.receiveAddress();
      assert(address);
      assert(typeof address === 'string');
    });

    it('marks addresses as used and tracks lastUsedIndex', async function () {
      const wallet = new Wallet();

      // Seed internal address state
      wallet._state.addresses = {
        addr1: { index: 0, used: false },
        addr2: { index: 1, used: false }
      };
      wallet._state.lastUsedIndex = -1;

      await wallet.markAddressAsUsed('addr1');
      assert.strictEqual(wallet._state.addresses.addr1.used, true);
      assert.strictEqual(wallet._state.lastUsedIndex, 0);

      await wallet.markAddressAsUsed('addr2');
      assert.strictEqual(wallet._state.addresses.addr2.used, true);
      assert.strictEqual(wallet._state.lastUsedIndex, 1);
    });

    it('returns only used addresses by default', async function () {
      const wallet = new Wallet();
      wallet._state.addresses = {
        used1: { index: 0, used: true },
        unused1: { index: 1, used: false }
      };

      const addrs = await wallet.getAddresses();
      const ids = addrs.map(x => x.address);
      assert.deepStrictEqual(ids, ['used1']);
    });

    it('can return all addresses when requested', async function () {
      const wallet = new Wallet();
      wallet._state.addresses = {
        used1: { index: 0, used: true },
        unused1: { index: 1, used: false }
      };

      const addrs = await wallet.getAddresses(true);
      const ids = addrs.map(x => x.address).sort();
      assert.deepStrictEqual(ids, ['unused1', 'used1']);
    });

    it('can get unspent transaction outputs', async function () {
      const wallet = new Wallet(options);
      const utxos = await wallet.getUnspentTransactionOutputs();
      assert.ok(Array.isArray(utxos));
    });

    it('exposes version, xprv, and xpub from key', function () {
      const wallet = new Wallet(options);
      assert.strictEqual(typeof wallet.version, 'number');
      assert.ok(typeof wallet.xprv === 'string' || wallet.xprv === null);
      assert.ok(typeof wallet.xpub === 'string' || wallet.xpub === null);
    });

    it('start transitions status to STARTED', function () {
      const wallet = new Wallet(options);
      wallet.start();
      assert.strictEqual(wallet.status, 'STARTED');
    });

    it('loadTransaction requires id', function () {
      const wallet = new Wallet(options);
      assert.throws(() => wallet.loadTransaction(null), /must provide/);
      assert.throws(() => wallet.loadTransaction({}), /id/);
    });

    it('loadTransaction records spendable transaction', function () {
      const wallet = new Wallet(options);
      const tx = { id: 'abc123', spendable: true };
      wallet.loadTransaction(tx);
      assert.ok(wallet._state.content.transactions.abc123);
    });

    it('trust wires emitter to wallet', function () {
      const wallet = new Wallet(options);
      const emitter = new (require('events').EventEmitter)();
      assert.strictEqual(wallet.trust(emitter), wallet);
      assert.ok(wallet.marshall.agents.length >= 1);
    });

    xit('can trust an existing chain service', function (done) {
      const bitcoin = new Bitcoin(options);
      const wallet = new Wallet(options);

      wallet.trust(bitcoin);

      async function test () {
        wallet.on('synced', function (state) {
          console.log('Wallet emitted "synced" event:', state);
          done();
        });

        await wallet.start();
        await bitcoin.start();
      }

      test();
    });
  });
});
