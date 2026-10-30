'use strict';

const assert = require('assert');
const { FIXTURE_SEED } = require('../constants');
const {
  WALLET_GAP_LIMIT,
  normalizeAccountNetwork,
  extendedKeyForNetwork,
  shareableAccountXpub,
  generateMnemonic,
  importSeed,
  deriveAccount,
  walletDescriptors,
  walletAddress,
  walletReceiveAddress,
  walletChangeAddress,
  cosignerProof,
  verifyCosignerProof,
  sealMaster,
  unsealMaster,
  createAccountVault,
  verifyVaultAccounts,
  openAccountVault,
  selectVaultAccount,
  currentVaultAccount
} = require('../functions/accountKeys');

// BIP84 / BIP44 test vectors share this master ("abandon … about", no passphrase).
const MASTER = 'xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu';
const LOCK = 'correct horse battery';

describe('@fabric/core/functions/accountKeys', function () {
  this.timeout(30000);

  it('imports a seed into the master xprv; the BIP39 passphrase changes it', function () {
    assert.strictEqual(importSeed(FIXTURE_SEED), MASTER);
    assert.notStrictEqual(importSeed(FIXTURE_SEED, 'TREZOR'), MASTER);
    assert.throws(() => importSeed('not a mnemonic'));
  });

  it('generates 24-word mnemonics by default', function () {
    assert.strictEqual(generateMnemonic().split(' ').length, 24);
  });

  it('normalizes networks', function () {
    assert.strictEqual(normalizeAccountNetwork('main'), 'mainnet');
    assert.strictEqual(normalizeAccountNetwork('bitcoin'), 'mainnet');
    assert.strictEqual(normalizeAccountNetwork('regtest'), 'regtest');
    assert.throws(() => normalizeAccountNetwork('dogecoin'));
  });

  it('derives the mainnet paths (BIP84 and BIP44 vectors)', function () {
    const a = deriveAccount(MASTER, { account: 0, network: 'mainnet' });
    assert.strictEqual(a.identity.path, "m/7777'/7777'/0'/0/0");
    assert.strictEqual(a.wallet.segwit.path, "m/84'/0'/0'");
    assert.strictEqual(a.wallet.standard.path, "m/44'/0'/0'");
    assert.strictEqual(a.cosigner.path, "m/87'/0'/0'/0/0");
    assert.strictEqual(a.wallet.receive, 'segwit');
    // BIP84 account xpub (xpub6CatWdiZ…) with depth, parent fingerprint, and child number zeroed.
    assert.strictEqual(a.wallet.segwit.xpub, 'xpub661MyMwAqRbcFHMVYpCiBTXd2Caj7vZhNFHJSgE59Aue2yYkXSrz5q9GaQ4rRjJVhHZTsCiHWSzgMS5beaaTHWVmhpGC7SMdqMXHRXZi8as');
    assert.strictEqual(shareableAccountXpub('xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V', 'mainnet'), a.wallet.segwit.xpub);
    assert.strictEqual(walletReceiveAddress(a.wallet, 'mainnet', 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.strictEqual(walletChangeAddress(a.wallet, 'mainnet', 0), 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
    assert.strictEqual(
      walletAddress({ xpub: a.wallet.standard.xpub, network: 'mainnet', script: 'pkh' }),
      '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'
    );
  });

  it('derives the same account index on a different path per network', function () {
    const r0 = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    const r1 = deriveAccount(MASTER, { account: 1, network: 'regtest' });
    const m1 = deriveAccount(MASTER, { account: 1, network: 'mainnet' });
    assert.strictEqual(r0.identity.path, "m/7777'/7778'/0'/0/0");
    assert.strictEqual(r0.wallet.segwit.path, "m/84'/1'/0'");
    assert.strictEqual(r0.wallet.standard.path, "m/44'/1'/0'");
    assert.strictEqual(r0.cosigner.path, "m/87'/1'/0'/0/0");
    assert.strictEqual(r1.identity.path, "m/7777'/7778'/1'/0/0");
    assert.strictEqual(m1.wallet.segwit.path, "m/84'/0'/1'");
    assert.match(r0.wallet.segwit.xpub, /^tpub/);
    assert.match(walletReceiveAddress(r0.wallet, 'regtest'), /^bcrt1q/);
    assert.match(walletReceiveAddress(deriveAccount(MASTER, { network: 'signet' }).wallet, 'signet'), /^tb1q/);
    const ids = new Set([r0, r1, m1, deriveAccount(MASTER)].map((d) => d.identity.pubkey));
    assert.strictEqual(ids.size, 4);
    assert.match(r0.identity.id, /^id1/);
  });

  it('keeps identity, wallet, and cosigner keys apart', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const keys = new Set([
      a.identity.pubkey,
      a.cosigner.pubkey,
      a.wallet.segwit.key.pubkey,
      a.wallet.standard.key.pubkey
    ]);
    assert.strictEqual(keys.size, 4);
  });

  it('hands out addresses only from 84\' and watches every account', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const d = walletDescriptors(a.wallet);
    const s = a.wallet.segwit.xpub;
    const t = a.wallet.taproot.xpub;
    const l = a.wallet.standard.xpub;
    assert.strictEqual(d.receive, `wpkh(${s}/0/*)`);
    assert.strictEqual(d.change, `wpkh(${s}/1/*)`);
    assert.deepStrictEqual(d.watch, [
      `wpkh(${s}/0/*)`, `wpkh(${s}/1/*)`,
      `tr(${t}/0/*)`, `tr(${t}/1/*)`,
      `pkh(${l}/0/*)`, `pkh(${l}/1/*)`
    ]);
    const { taproot, ...withoutTaproot } = a.wallet;
    assert.ok(taproot);
    assert.strictEqual(walletDescriptors(withoutTaproot).watch.length, 4, 'a wallet from before 86\' still has a watch set');
    for (const descriptor of d.watch) assert.ok(!descriptor.includes('['), 'no key origin / fingerprint');
    assert.strictEqual(WALLET_GAP_LIMIT, 20);
  });

  it('shares account xpubs that point to no parent', function () {
    const header = (xpub) => {
      const bs58check = require('bs58check');
      const raw = (bs58check.default || bs58check).decode(xpub);
      return { depth: raw[4], fingerprint: Buffer.from(raw.subarray(5, 9)).toString('hex'), child: Buffer.from(raw.subarray(9, 13)).toString('hex') };
    };
    for (const network of ['mainnet', 'regtest']) {
      for (const account of [0, 1]) {
        const w = deriveAccount(MASTER, { account, network }).wallet;
        for (const xpub of [w.segwit.xpub, w.taproot.xpub, w.standard.xpub]) {
          assert.deepStrictEqual(header(xpub), { depth: 0, fingerprint: '00000000', child: '00000000' });
        }
      }
    }
    assert.throws(() => shareableAccountXpub(MASTER, 'mainnet'), /only public/);
  });

  it('swaps extended key versions between networks', function () {
    const a = deriveAccount(MASTER);
    const tpub = extendedKeyForNetwork(a.wallet.segwit.xpub, 'regtest');
    assert.match(tpub, /^tpub/);
    assert.strictEqual(extendedKeyForNetwork(tpub, 'mainnet'), a.wallet.segwit.xpub);
  });

  it('binds a cosigner key to an identity within a scope', function () {
    const a = deriveAccount(MASTER, { network: 'regtest' });
    const b = deriveAccount(MASTER, { account: 1, network: 'regtest' });
    const scope = 'group:abc';
    const proof = cosignerProof(a.cosigner.key, { identityPubkey: a.identity.pubkey, scope });
    const params = { cosigner: a.cosigner.pubkey, identityPubkey: a.identity.pubkey, scope, proof };
    assert.strictEqual(verifyCosignerProof(params), true);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { scope: 'group:other' })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { identityPubkey: b.identity.pubkey })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { cosigner: b.cosigner.pubkey })), false);
    assert.strictEqual(verifyCosignerProof(Object.assign({}, params, { proof: '00'.repeat(64) })), false);
  });

  it('seals only the master xprv; the lock password never changes keys', function () {
    const sealed = sealMaster(MASTER, LOCK);
    const json = JSON.stringify(sealed);
    assert.ok(!json.includes('xprv9s21'));
    assert.strictEqual(unsealMaster(sealed, LOCK), MASTER);
    assert.strictEqual(unsealMaster(sealMaster(MASTER, 'another lock pw'), 'another lock pw'), MASTER);
    assert.throws(() => unsealMaster(sealed, 'wrong password'));
  });

  it('refuses a tampered seal', function () {
    const sealed = sealMaster(MASTER, LOCK);
    const tampered = JSON.parse(JSON.stringify(sealed));
    const field = ['ciphertext', 'data', 'ct'].find((k) => typeof tampered[k] === 'string')
      || Object.keys(tampered).find((k) => typeof tampered[k] === 'string' && tampered[k].length > 40);
    const value = tampered[field];
    tampered[field] = (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
    assert.throws(() => unsealMaster(tampered, LOCK));
  });

  it('keeps a vault of the sealed master and public account views', function () {
    const vault = createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'regtest' });
    assert.ok(!JSON.stringify(vault).includes('xprv9s21'));
    assert.deepStrictEqual(vault.current, { account: 0, network: 'regtest' });
    const view = currentVaultAccount(vault);
    assert.strictEqual(view.identity.pubkey, deriveAccount(MASTER, { network: 'regtest' }).identity.pubkey);
    assert.strictEqual(view.wallet.receive, 'segwit');
    assert.strictEqual(view.cosigner.key, undefined);

    assert.throws(() => selectVaultAccount(vault, { account: 1, network: 'regtest' }), (err) => err.code === 'FABRIC_ACCOUNT_LOCKED');
    const master = unsealMaster(vault.seal, LOCK);
    const switched = selectVaultAccount(vault, { account: 1, network: 'signet', master, label: 'Alt' });
    assert.deepStrictEqual(switched.current, { account: 1, network: 'signet' });
    assert.strictEqual(currentVaultAccount(switched).label, 'Alt');
    const back = selectVaultAccount(switched, { account: 0, network: 'regtest' });
    assert.strictEqual(currentVaultAccount(back).identity.pubkey, view.identity.pubkey);
  });

  it('opens a vault only when its cached accounts match the master', function () {
    const master = unsealMaster(createAccountVault({ master: MASTER, lockPassword: LOCK }).seal, LOCK);
    const vault = selectVaultAccount(createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'regtest' }), { account: 1, network: 'signet', master });
    assert.strictEqual(openAccountVault(vault, LOCK), MASTER);
    assert.throws(() => openAccountVault(vault, 'wrong password'));

    const other = deriveAccount(importSeed(FIXTURE_SEED, 'TREZOR'), { network: 'regtest' });
    const swapped = JSON.parse(JSON.stringify(vault));
    swapped.accounts['regtest:0'].wallet.segwit.xpub = other.wallet.segwit.xpub;
    assert.throws(() => openAccountVault(swapped, LOCK), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');

    function sortKeys (value) {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
        return out;
      }
      return value;
    }
    assert.strictEqual(openAccountVault(sortKeys(JSON.parse(JSON.stringify(vault))), LOCK), MASTER);

    const moved = JSON.parse(JSON.stringify(vault));
    moved.accounts['regtest:5'] = moved.accounts['regtest:0'];
    assert.throws(() => verifyVaultAccounts(moved, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');

    const lost = JSON.parse(JSON.stringify(vault));
    lost.current = { account: 9, network: 'regtest' };
    assert.throws(() => verifyVaultAccounts(lost, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');
  });

  it('hands out addresses only from a vault view the master checked', function () {
    const vault = createAccountVault({ master: MASTER, lockPassword: LOCK, network: 'mainnet' });
    const unverified = (err) => err.code === 'FABRIC_ACCOUNT_UNVERIFIED';

    const locked = currentVaultAccount(vault);
    assert.strictEqual(locked.verified, false);
    assert.strictEqual(locked.wallet.verified, false);
    assert.throws(() => walletReceiveAddress(locked.wallet, 'mainnet', 0), unverified);
    assert.throws(() => walletChangeAddress(locked.wallet, 'mainnet', 0), unverified);
    assert.strictEqual(walletDescriptors(locked.wallet).watch.length, 6, 'watch-only display still works');

    const master = openAccountVault(vault, LOCK);
    const open = currentVaultAccount(vault, master);
    assert.strictEqual(open.verified, true);
    assert.strictEqual(walletReceiveAddress(open.wallet, 'mainnet', 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.strictEqual(vault.accounts['mainnet:0'].verified, undefined, 'the stored cache is not marked');

    // A swapped xpub, even one stored as verified, never yields an address.
    const other = deriveAccount(importSeed(FIXTURE_SEED, 'TREZOR'), { network: 'mainnet' });
    const swapped = JSON.parse(JSON.stringify(vault));
    Object.assign(swapped.accounts['mainnet:0'], { verified: true });
    Object.assign(swapped.accounts['mainnet:0'].wallet, { verified: true, segwit: { path: other.wallet.segwit.path, xpub: other.wallet.segwit.xpub } });
    assert.throws(() => walletReceiveAddress(currentVaultAccount(swapped).wallet, 'mainnet', 0), unverified);
    assert.throws(() => currentVaultAccount(swapped, MASTER), (err) => err.code === 'FABRIC_ACCOUNT_VAULT_MISMATCH');
  });
});
