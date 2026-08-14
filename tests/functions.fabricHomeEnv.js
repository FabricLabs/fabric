'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseDotEnvText,
  loadDotEnvFile,
  loadFabricHomeEnv,
  readHubAdminToken,
  upsertFabricHomeEnv,
  HOME_ENV_KEYS
} = require('../functions/fabricHomeEnv');

describe('@fabric/core/functions/fabricHomeEnv', function () {
  it('parses KEY=VALUE lines and ignores comments', function () {
    const parsed = parseDotEnvText([
      '# comment',
      'FABRIC_XPRV=xprv1example',
      "FABRIC_SEED='aabbcc'",
      'NOT A LINE',
      'FABRIC_MNEMONIC="one two three"'
    ].join('\n'));
    assert.strictEqual(parsed.FABRIC_XPRV, 'xprv1example');
    assert.strictEqual(parsed.FABRIC_SEED, 'aabbcc');
    assert.strictEqual(parsed.FABRIC_MNEMONIC, 'one two three');
  });

  it('fills missing env keys from ~/.fabric/env without overriding process env', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-home-env-'));
    try {
      upsertFabricHomeEnv({
        FABRIC_XPRV: 'xprv-from-file',
        FABRIC_SEED: 'aa'.repeat(32)
      }, { store: dir });
      const env = { FABRIC_XPRV: 'xprv-already-set' };
      const n = loadFabricHomeEnv(env, { store: dir });
      assert.ok(n >= 1);
      assert.strictEqual(env.FABRIC_XPRV, 'xprv-already-set');
      assert.strictEqual(env.FABRIC_SEED, 'aa'.repeat(32));
      assert.ok(HOME_ENV_KEYS.has('FABRIC_XPRV'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readHubAdminToken prefers env over a token file', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-admin-token-'));
    try {
      const file = path.join(dir, 'hub-admin-token');
      fs.writeFileSync(file, 'file-token\n', { encoding: 'utf8', mode: 0o600 });
      const fromEnv = readHubAdminToken({ FABRIC_HUB_ADMIN_TOKEN: 'env-token' }, { store: dir });
      assert.strictEqual(fromEnv.token, 'env-token');
      assert.strictEqual(fromEnv.source, 'env');
      const fromFile = readHubAdminToken({}, { tokenPath: file, store: dir });
      assert.strictEqual(fromFile.token, 'file-token');
      assert.strictEqual(fromFile.source, 'adminTokenFile');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadDotEnvFile ignores keys outside the allow list', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-dotenv-allow-'));
    try {
      const file = path.join(dir, 'env');
      fs.writeFileSync(file, 'FABRIC_XPRV=ok\nSECRET_OTHER=nope\n');
      const env = {};
      loadDotEnvFile(file, env, { allowKeys: HOME_ENV_KEYS });
      assert.strictEqual(env.FABRIC_XPRV, 'ok');
      assert.strictEqual(env.SECRET_OTHER, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
