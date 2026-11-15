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
      const { BITCOIN_KEY_DERIVATION_PATH } = require('../constants');
      const derived = wallet.derive(BITCOIN_KEY_DERIVATION_PATH);
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
      assert.strictEqual(exported.object.master, undefined);
      assert.strictEqual(exported.object.seed, undefined);
      assert.ok(exported.object.xprv);
      assert.match(String(exported.object.xprv), /^tprv/, 'a regtest wallet exports a regtest master');
    });

    it('watches and derives the same addresses as its account keys', function () {
      const { deriveAccount, importSeed, walletReceiveAddress, walletChangeAddress, walletAddress } = require('../functions/accountKeys');
      const { FIXTURE_SEED, bitcoinReceiveDerivationPath } = require('../constants');
      const wallet = new Wallet({ network: 'regtest', gapLimit: 2, key: { seed: FIXTURE_SEED } });
      const account = deriveAccount(importSeed(FIXTURE_SEED), { network: 'regtest' }).wallet;
      const watched = new Set(wallet.getWatchSet().addresses.keys());
      for (const i of [0, 1]) {
        assert.ok(watched.has(walletReceiveAddress(account, 'regtest', i)), `receive ${i}`);
        assert.ok(watched.has(walletChangeAddress(account, 'regtest', i)), `change ${i}`);
        assert.ok(watched.has(walletAddress({ xpub: account.standard.xpub, network: 'regtest', script: 'pkh', index: i })), `standard ${i}`);
      }
      for (const address of watched) assert.ok(!/^(bc1|tb1)/.test(address), `regtest only: ${address}`);
      assert.strictEqual(wallet.derive().publicKey.encodeCompressed('hex'), wallet.derive(bitcoinReceiveDerivationPath(0, 0, 'regtest')).publicKey.encodeCompressed('hex'));
      assert.notStrictEqual(wallet.derive().publicKey.encodeCompressed('hex'), wallet.derive(bitcoinReceiveDerivationPath(0, 0, 'mainnet')).publicKey.encodeCompressed('hex'));
    });

    it('export() is the plaintext payload Environment seals (secrets stay in object)', function () {
      const wallet = new Wallet({ key: { seed: require('../constants').FIXTURE_SEED } });
      const exported = wallet.export();
      const json = JSON.stringify(exported.object);
      assert.ok(json.includes('xprv'));
      assert.ok(!json.includes('abandon'), 'mnemonic is never exported');
      assert.strictEqual(exported.passwordProtected, undefined);
      assert.strictEqual(exported.seal, undefined);
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

const {
  BITCOIN_KEY_DERIVATION_PATH,
  bitcoinReceiveDerivationPath,
  bitcoinChangeDerivationPath,
  bitcoinBip49ReceiveDerivationPath,
  bitcoinBip49ChangeDerivationPath,
  bitcoinBip84ReceiveDerivationPath,
  bitcoinBip84ChangeDerivationPath,
  bitcoinBip86ReceiveDerivationPath,
  bitcoinBip86ChangeDerivationPath,
  bitcoinBip48P2shP2wshReceiveDerivationPath,
  bitcoinBip48P2shP2wshChangeDerivationPath,
  bitcoinBip48P2wshReceiveDerivationPath,
  bitcoinBip48P2wshChangeDerivationPath
} = require('../constants');
const bip86 = require('../types/wallet/bip86');
const { decodeSegwitAddress } = require('../functions/bech32');

describe('@fabric/core Bitcoin derivation path templates', function () {
  it('puts default funds on BIP-84', function () {
    assert.strictEqual(BITCOIN_KEY_DERIVATION_PATH, "m/84'/0'/0'/0/0");
    assert.strictEqual(bitcoinReceiveDerivationPath(0, 0), "m/84'/0'/0'/0/0");
    assert.strictEqual(bitcoinChangeDerivationPath(1, 7), "m/84'/0'/1'/1/7");
    assert.strictEqual(bitcoinReceiveDerivationPath(0, 3, 'regtest'), "m/84'/1'/0'/0/3");
  });

  it('names BIP-49 wrapped-SegWit paths without making them the default', function () {
    assert.strictEqual(bitcoinBip49ReceiveDerivationPath(), "m/49'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip49ChangeDerivationPath(2, 1), "m/49'/0'/2'/1/1");
  });

  it('names BIP-84 native SegWit paths', function () {
    assert.strictEqual(bitcoinBip84ReceiveDerivationPath(0, 0), "m/84'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip84ChangeDerivationPath(0, 3), "m/84'/0'/0'/1/3");
  });

  it('names BIP-86 Taproot paths', function () {
    assert.strictEqual(bitcoinBip86ReceiveDerivationPath(), "m/86'/0'/0'/0/0");
    assert.strictEqual(bitcoinBip86ChangeDerivationPath(1, 0), "m/86'/0'/1'/1/0");
  });

  it('names BIP-48 multisig paths without switching group vaults', function () {
    assert.strictEqual(bitcoinBip48P2shP2wshReceiveDerivationPath(), "m/48'/0'/0'/1'/0/0");
    assert.strictEqual(bitcoinBip48P2wshReceiveDerivationPath(), "m/48'/0'/0'/2'/0/0");
    assert.strictEqual(bitcoinBip48P2wshChangeDerivationPath(0, 1), "m/48'/0'/0'/2'/1/1");
    assert.strictEqual(bitcoinBip48P2shP2wshChangeDerivationPath(1, 0), "m/48'/0'/1'/1'/1/0");
  });

  it('rejects out-of-range account or index', function () {
    assert.throws(() => bitcoinReceiveDerivationPath(-1, 0), /account/);
    assert.throws(() => bitcoinBip84ReceiveDerivationPath(0, 0x80000000), /index/);
    assert.throws(() => bitcoinBip86ChangeDerivationPath(1.5, 0), /account/);
  });
});

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// BIP-86 test vectors (mainnet, account 0).
const VECTORS = [
  { change: 0, index: 0, internal: 'cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115', output: 'a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c', address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr' },
  { change: 0, index: 1, internal: '83dfe85a3151d2517290da461fe2815591ef69f2b18a2ce63f01697a8b313145', output: 'a82f29944d65b86ae6b5e5cc75e294ead6c59391a1edc5e016e3498c67fc7bbb', address: 'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh' },
  { change: 1, index: 0, internal: '399f1b2f4393f29a18c937859c5dd8a77350103157eb880f02e8c08214277cef', output: '882d74e5d0572d5a816cef0041a96b6c1de832f6f9676d9605c44d5e9a97d3dc', address: 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7' }
];

describe('BIP-86 Taproot wallet', function () {
  const key = new Key({ mnemonic: MNEMONIC, network: 'main' });

  describe('types/wallet/bip86', function () {
    it('matches the BIP-86 internal keys, output keys, and addresses', function () {
      for (const v of VECTORS) {
        const pubkey = Buffer.from(key.master.derivePath(`m/86'/0'/0'/${v.change}/${v.index}`).publicKey);
        assert.strictEqual(bip86.internalKey(pubkey).toString('hex'), v.internal);
        assert.strictEqual(bip86.outputKey(pubkey).toString('hex'), v.output);
        assert.strictEqual(bip86.outputKey(v.internal).toString('hex'), v.output);
      }
    });

    it('names the path per network', function () {
      assert.strictEqual(bip86.path(0, 0, 5, 'mainnet'), "m/86'/0'/0'/0/5");
      assert.strictEqual(bip86.path(2, 1, 0, 'regtest'), "m/86'/1'/2'/1/0");
    });

    it('refuses keys that are neither compressed nor x-only', function () {
      assert.throws(() => bip86.internalKey(Buffer.alloc(65, 4)), TypeError);
      assert.throws(() => bip86.address(VECTORS[0].internal, {}), TypeError);
    });
  });

  describe('Wallet.deriveTaprootAddress', function () {
    it('matches the BIP-86 vectors on mainnet', function () {
      for (const v of VECTORS) {
        const out = Wallet.deriveTaprootAddress(key, { change: v.change, index: v.index, network: 'mainnet' });
        assert.strictEqual(out.address, v.address);
        assert.strictEqual(out.path, `m/86'/0'/0'/${v.change}/${v.index}`);
        assert.strictEqual(out.outputKey, v.output);
      }
    });

    it('derives on coin type 1 with the right prefix on every other network', function () {
      const testKey = key.master.derivePath("m/86'/1'/0'/0/0").publicKey;
      const expected = bip86.outputKey(Buffer.from(testKey));
      const prefixes = { testnet: 'tb', testnet4: 'tb', signet: 'tb', regtest: 'bcrt' };
      for (const [network, hrp] of Object.entries(prefixes)) {
        const out = Wallet.deriveTaprootAddress(key, { network });
        assert.strictEqual(out.path, "m/86'/1'/0'/0/0", network);
        const decoded = decodeSegwitAddress(hrp, out.address);
        assert.ok(decoded, `${network}: ${out.address}`);
        assert.strictEqual(decoded.version, 1, network);
        assert.ok(Buffer.from(decoded.program).equals(expected), network);
      }
      assert.notStrictEqual(Wallet.deriveTaprootAddress(key, { network: 'testnet' }).address, VECTORS[0].address);
    });

    it('refuses a key without a master', function () {
      assert.throws(() => Wallet.deriveTaprootAddress({ public: VECTORS[0].internal }), /master/);
    });
  });

  describe('Wallet#receiveAddress / getUnusedAddress', function () {
    it('hand out sequential BIP-86 receive addresses and watch them', async function () {
      const wallet = new Wallet({ network: 'mainnet', key: { mnemonic: MNEMONIC } });
      const first = await wallet.getUnusedAddress();
      const second = await wallet.receiveAddress();
      assert.strictEqual(first, VECTORS[0].address);
      assert.strictEqual(second, VECTORS[1].address);
      assert.deepStrictEqual(wallet._state.addresses[first], { index: 0, type: 'p2tr', change: 0, used: false });
      const watched = wallet.getWatchSet();
      const has = (a) => (watched.addresses instanceof Set ? watched.addresses.has(a) : (watched.addresses || []).includes(a));
      assert.ok(has(first) && has(second));
    });

    it('watch the Taproot change chain with the rest of the gap window', function () {
      const wallet = new Wallet({ network: 'mainnet', key: { mnemonic: MNEMONIC } });
      const watched = wallet.getWatchSet();
      const has = (a) => (watched.addresses instanceof Set ? watched.addresses.has(a) : (watched.addresses || []).includes(a));
      assert.ok(has(VECTORS[2].address));
    });
  });

  describe('accounts', function () {
    const master = Wallet.importSeed(MNEMONIC);

    it('derive a Taproot account beside SegWit and standard', function () {
      const derived = Wallet.deriveAccount(master, { network: 'mainnet' });
      assert.strictEqual(derived.wallet.taproot.path, "m/86'/0'/0'");
      assert.strictEqual(derived.wallet.receive, 'segwit');
      assert.ok(derived.wallet.descriptors.watch.includes(`tr(${derived.wallet.taproot.xpub}/0/*)`));
      assert.ok(derived.wallet.descriptors.watch.includes(`tr(${derived.wallet.taproot.xpub}/1/*)`));
      for (const v of VECTORS) {
        const address = Wallet.walletAddress({ xpub: derived.wallet.taproot.xpub, network: 'mainnet', script: 'tr', change: v.change, index: v.index });
        assert.strictEqual(address, v.address);
      }
      assert.strictEqual(Wallet.deriveAccount(master, { network: 'regtest' }).wallet.taproot.path, "m/86'/1'/0'");
    });

    it('open a vault cached before the Taproot account, and refuse an edited Taproot xpub', function () {
      const vault = Wallet.createAccountVault({ master, lockPassword: 'correct horse', network: 'regtest' });
      const id = Object.keys(vault.accounts)[0];
      const view = vault.accounts[id];

      const old = JSON.parse(JSON.stringify(vault));
      delete old.accounts[id].wallet.taproot;
      assert.strictEqual(Wallet.openAccountVault(old, 'correct horse'), master);
      const current = Wallet.currentVaultAccount(old, master);
      assert.strictEqual(current.wallet.taproot.xpub, view.wallet.taproot.xpub);

      const edited = JSON.parse(JSON.stringify(vault));
      edited.accounts[id].wallet.taproot.xpub = Wallet.deriveAccount(master, { account: 1, network: 'regtest' }).wallet.taproot.xpub;
      assert.throws(() => Wallet.openAccountVault(edited, 'correct horse'), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');
    });
  });
});
