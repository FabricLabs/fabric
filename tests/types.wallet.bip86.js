'use strict';

const assert = require('assert');
const Key = require('../types/key');
const Wallet = require('../types/wallet');
const bip86 = require('../types/wallet/bip86');
const { decodeSegwitAddress } = require('../functions/bech32');

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
