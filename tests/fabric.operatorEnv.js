'use strict';

const assert = require('assert');
const fs = require('fs');

const Key = require('../types/key');
const Token = require('../types/token');
const Wallet = require('../types/wallet');
const Environment = require('../types/environment');
const bip39 = require('../functions/bip39');
const { FIXTURE_SEED } = require('../constants');
const {
  classifyFabricKeyMaterial,
  keySettingsFromEnv,
  parseRawSeedHex
} = require('../functions/fabricKeyMaterial');
const {
  loadFabricHomeEnv,
  mintHubAdminToken,
  writeHubAdminToken,
  readHubAdminToken,
  upsertFabricHomeEnv
} = require('../functions/fabricHomeEnv');
const { loadIdentityFromWalletFile } = require('../functions/fabricWalletIdentity');
const { withIsolatedHome } = require('./helpers/isolatedHome');

describe('@fabric/core operator env (seed hex + home admin token)', function () {
  it('classifies xprv, raw seed hex, and mnemonic', function () {
    const key = new Key({ mnemonic: FIXTURE_SEED });
    const hex = bip39.mnemonicToSeedSync(FIXTURE_SEED).toString('hex');
    assert.strictEqual(classifyFabricKeyMaterial(key.xprv).kind, 'xprv');
    assert.strictEqual(classifyFabricKeyMaterial(hex).kind, 'seedHex');
    assert.strictEqual(classifyFabricKeyMaterial(FIXTURE_SEED).kind, 'mnemonic');
    assert.ok(parseRawSeedHex(hex));
    assert.strictEqual(parseRawSeedHex(FIXTURE_SEED), null);
  });

  it('keySettingsFromEnv prefers XPRV then SEED hex then MNEMONIC', function () {
    const key = new Key({ mnemonic: FIXTURE_SEED });
    const hex = bip39.mnemonicToSeedSync(FIXTURE_SEED).toString('hex');
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: key.xprv, FABRIC_SEED: hex }), { xprv: key.xprv });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_SEED: hex }), { seed: hex });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_MNEMONIC: FIXTURE_SEED }), { mnemonic: FIXTURE_SEED });
    assert.strictEqual(keySettingsFromEnv({}), null);
  });

  it('loads identity from a plaintext wallet.json when env is empty', function () {
    const iso = withIsolatedHome('fabric-wallet-id-');
    try {
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'production';
      const environment = new Environment({
        home: iso.home,
        path: iso.walletPath,
        store: iso.store
      });
      environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { encrypt: false });
      const loaded = loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath
      });
      assert.ok(loaded);
      assert.ok(loaded.xprv);
      const expected = new Key({ mnemonic: FIXTURE_SEED });
      assert.strictEqual(loaded.xprv, expected.xprv);
    } finally {
      iso.restore();
    }
  });

  it('loads identity from a sealed wallet.json with FABRIC_PASSWORD', function () {
    const iso = withIsolatedHome('fabric-wallet-seal-');
    try {
      iso.clearIdentityEnv();
      process.env.NODE_ENV = 'production';
      const password = 'correct-horse-battery';
      const environment = new Environment({
        home: iso.home,
        path: iso.walletPath,
        store: iso.store
      });
      environment.setWallet(new Wallet({ key: { seed: FIXTURE_SEED } }), true, { password, encrypt: true });
      assert.strictEqual(loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath
      }), null);
      const loaded = loadIdentityFromWalletFile({
        home: iso.home,
        store: iso.store,
        walletPath: iso.walletPath,
        password
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.xprv, new Key({ mnemonic: FIXTURE_SEED }).xprv);
    } finally {
      iso.restore();
    }
  });

  it('mints a Hub admin token and reads it from ~/.fabric/hub-admin-token', function () {
    const iso = withIsolatedHome('fabric-home-token-');
    try {
      iso.clearIdentityEnv();
      const key = new Key({ mnemonic: FIXTURE_SEED });
      const token = mintHubAdminToken(key);
      assert.ok(Token.verifySigned(token, key));
      const tokenPath = writeHubAdminToken(token, { home: iso.home, store: iso.store });
      const envPath = upsertFabricHomeEnv({
        FABRIC_HUB_ADMIN_TOKEN_FILE: tokenPath
      }, { home: iso.home, store: iso.store });
      assert.ok(fs.existsSync(envPath));
      const env = {};
      loadFabricHomeEnv(env, { home: iso.home, store: iso.store });
      const got = readHubAdminToken(env, { home: iso.home, store: iso.store });
      assert.strictEqual(got.token, token);
      assert.ok(got.source === 'adminTokenFile' || got.source === 'home');
    } finally {
      iso.restore();
    }
  });
});
