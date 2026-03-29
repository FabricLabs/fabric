'use strict';

// require('debug-trace')({ always: true });
const assert = require('assert');
const Wallet = require('../types/wallet');
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

    it('fromSeed rejects malformed seed objects', function () {
      assert.throws(() => Wallet.fromSeed(null), /Seed object must provide/);
      assert.throws(() => Wallet.fromSeed({}), /Seed object must provide/);
      assert.throws(() => Wallet.fromSeed({ phrase: 'not a mnemonic' }), /valid BIP39 mnemonic/);
    });

    it('generateCleanKeyPair round-trips through publicKeyFromString', async function () {
      const wallet = new Wallet(options);
      const origin = await wallet.generateCleanKeyPair();
      const hex = origin.public.encodeCompressed('hex');
      const restored = wallet.publicKeyFromString(hex);
      assert.strictEqual(hex, restored.pubkey);
    });

    it('can derive keys from a path', function () {
      const wallet = new Wallet(options);
      const derived = wallet.derive('m/7777\'/7777\'/0\'/0/0');
      assert.ok(derived);
      assert.ok(derived.privateKey);
      assert.ok(derived.publicKey);
    });

    it('can load a key into the wallet', async function () {
      const wallet = new Wallet(options);
      const keypair = await wallet.generateCleanKeyPair();
      const key = new Key({ public: keypair.public.encodeCompressed('hex') });
      const result = wallet.loadKey(key, ['test']);
      assert.ok(result);
      assert.ok(wallet.keys);
      assert.ok(wallet.keys.get(`/${key.pubkey}`));
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

    it('_importSeed validates BIP39 phrase', async function () {
      const wallet = new Wallet(options);
      await assert.rejects(() => wallet._importSeed(123), /Seed must be a string/);
      await assert.rejects(() => wallet._importSeed('not a mnemonic'), /valid BIP39 mnemonic phrase/);
      const created = Wallet.createSeed();
      const loaded = await wallet._importSeed(` ${created.phrase} `);
      assert.strictEqual(typeof loaded, 'string');
    });

    it('_loadSeed validates BIP39 phrase', async function () {
      const wallet = new Wallet(options);
      await assert.rejects(() => wallet._loadSeed(false), /Seed must be a string/);
      await assert.rejects(() => wallet._loadSeed('not a mnemonic'), /valid BIP39 mnemonic phrase/);
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

    it('publicKeyFromString accepts hex pubkey string', function () {
      const wallet = new Wallet(options);
      const k = new Key();
      const w = wallet.publicKeyFromString(k.pubkey);
      assert.strictEqual(w.pubkey, k.pubkey);
    });

    describe('publicKeyFromString', function () {
      it('passes null and undefined through to Key constructor', function () {
        const wallet = new Wallet(options);
        assert.ok(wallet.publicKeyFromString(null) instanceof Key);
        assert.ok(wallet.publicKeyFromString(undefined) instanceof Key);
      });

      it('coerces number to string before Key parsing', function () {
        const wallet = new Wallet(options);
        assert.throws(() => wallet.publicKeyFromString(12345), /bad point|Invalid|type/i);
      });

      it('accepts Buffer and Uint8Array pubkey bytes', function () {
        const wallet = new Wallet(options);
        const k = new Key();
        const raw = Buffer.from(k.pubkey, 'hex');
        const fromBuf = wallet.publicKeyFromString(raw);
        const fromU8 = wallet.publicKeyFromString(new Uint8Array(raw));
        assert.strictEqual(fromBuf.pubkey, k.pubkey);
        assert.strictEqual(fromU8.pubkey, k.pubkey);
      });

      it('accepts curve point objects with encode()', function () {
        const wallet = new Wallet(options);
        const k = new Key();
        const w = wallet.publicKeyFromString(k.public);
        assert.strictEqual(w.pubkey, k.pubkey);
      });

      it('fallback wraps other values for Key (invalid objects throw)', function () {
        const wallet = new Wallet(options);
        assert.throws(() => wallet.publicKeyFromString({ unexpected: true }), /./);
      });
    });

    it('balanceFromState returns 0 for empty transactions', function () {
      const wallet = new Wallet(options);
      assert.strictEqual(wallet.balanceFromState({ transactions: [] }), 0);
    });

    it('balanceFromState throws when transactions missing', function () {
      const wallet = new Wallet(options);
      assert.throws(() => wallet.balanceFromState({}), /transactions/);
    });

    it('_countUnusedAddresses and _getHighestUsedIndex reflect address map', async function () {
      const wallet = new Wallet();
      wallet._state.addresses = {
        u1: { index: 0, used: false },
        u2: { index: 1, used: true }
      };
      assert.strictEqual(await wallet._countUnusedAddresses(), 1);
      assert.strictEqual(await wallet._getHighestUsedIndex(), 1);
    });

    it('_checkGapLimit compares unused count to gapLimit', async function () {
      const wallet = new Wallet({ gapLimit: 5 });
      wallet._state.addresses = { only: { used: false } };
      assert.strictEqual(await wallet._checkGapLimit(), true);

      wallet._state.addresses = {};
      for (let i = 0; i < 25; i++) {
        wallet._state.addresses[`k${i}`] = { used: false };
      }
      assert.strictEqual(await wallet._checkGapLimit(), false);
    });

    it('can trust an existing chain service', function () {
      const emitter = new (require('events').EventEmitter)();
      const wallet = new Wallet(options);

      wallet.trust(emitter);
      emitter.emit('transaction', { id: 'tx-trusted', spendable: true });
      assert.ok(wallet.marshall.agents.length >= 1);
    });

    it('_handleGenericMessage routes ServiceMessage payload', function () {
      const wallet = new Wallet(options);
      let seen = null;
      wallet._processServiceMessage = function (msg) {
        seen = msg;
        return 'ok';
      };

      const out = wallet._handleGenericMessage({
        '@type': 'ServiceMessage',
        '@data': { '@type': 'BitcoinTransaction', '@data': { id: 'x' } }
      });

      assert.strictEqual(out, 'ok');
      assert.ok(seen);
      assert.strictEqual(seen['@type'], 'BitcoinTransaction');
    });

    it('_handleGenericMessage returns null for unknown message types', function () {
      const wallet = new Wallet(options);
      const out = wallet._handleGenericMessage({
        '@type': 'UnknownMessageType',
        '@data': {}
      });
      assert.strictEqual(out, null);
    });

    it('Wallet.purchaseContentHashHex matches publishedDocumentEnvelope', function () {
      const { purchaseContentHashHex: envHash } = require('../functions/publishedDocumentEnvelope');
      const docId = 'wallet-l1-doc';
      const buf = Buffer.from('verify before spend', 'utf8');
      const parsed = {
        id: docId,
        name: 'x.txt',
        mime: 'text/plain',
        revision: 1,
        contentBase64: buf.toString('base64'),
        size: buf.length,
        sha256: require('crypto').createHash('sha256').update(buf).digest('hex')
      };
      assert.strictEqual(Wallet.purchaseContentHashHex(docId, parsed), envHash(docId, parsed));
    });

    it('_attachTXID validates format and delegates creation', async function () {
      const wallet = new Wallet(options);
      wallet.txids = {
        create: async (txid) => ({ id: txid })
      };

      await assert.rejects(() => wallet._attachTXID('abc'), /64-character hex string/);
      const sample = 'a'.repeat(64);
      const result = await wallet._attachTXID(sample);
      assert.deepStrictEqual(result, { id: sample });
    });

    it('_findAddressInCurrentShard locates known address or returns null', async function () {
      const wallet = new Wallet(options);
      wallet.shard = [
        { string: 'addr-a' },
        { string: 'addr-b' }
      ];

      const found = await wallet._findAddressInCurrentShard('addr-b');
      const missing = await wallet._findAddressInCurrentShard('addr-z');
      assert.deepStrictEqual(found, { string: 'addr-b' });
      assert.strictEqual(missing, null);
    });

    it('_scanChainForTransactions aggregates block scan results', async function () {
      const wallet = new Wallet(options);
      wallet._scanBlockForTransactions = async (block) => [{ id: `${block}-tx` }];

      const out = await wallet._scanChainForTransactions({
        blocks: ['a', 'b', 'c']
      });

      assert.deepStrictEqual(out, [
        { id: 'a-tx' },
        { id: 'b-tx' },
        { id: 'c-tx' }
      ]);
    });
  });
});
