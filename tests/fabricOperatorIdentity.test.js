'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  exclusiveOperatorKeySettings,
  resolveFabricOperatorKeySettings
} = require('../functions/fabricOperatorIdentity');
const { keySettingsFromEnv, classifyFabricIdentityEnvValue } = require('../functions/fabricKeyMaterial');

const PHRASE_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('@fabric/core/functions/fabricOperatorIdentity', function () {
  it('exclusiveOperatorKeySettings prefers xprv over mnemonic (Key is mnemonic-first)', function () {
    const fromMnemonic = new Key({ mnemonic: PHRASE_A });
    const fromXprv = new Key({ mnemonic: PHRASE_B });
    const mixed = { mnemonic: PHRASE_A, xprv: fromXprv.xprv };
    const naive = new Key(mixed);
    assert.strictEqual(naive.pubkey, fromMnemonic.pubkey, 'Key constructor still prefers mnemonic');
    const exclusive = exclusiveOperatorKeySettings(mixed);
    assert.strictEqual(exclusive.xprv, fromXprv.xprv);
    assert.strictEqual(exclusive.mnemonic, undefined);
    const resolved = new Key(exclusive);
    assert.strictEqual(resolved.pubkey, fromXprv.pubkey);
  });

  it('classifyFabricIdentityEnvValue accepts xprv, xpub, and compressed pubkey', function () {
    const k = new Key({ mnemonic: PHRASE_A });
    assert.strictEqual(classifyFabricIdentityEnvValue(k.xprv).kind, 'xprv');
    assert.strictEqual(classifyFabricIdentityEnvValue(k.xpub).kind, 'xpub');
    assert.strictEqual(classifyFabricIdentityEnvValue(k.pubkey).kind, 'pubkey');
  });

  it('keySettingsFromEnv treats public FABRIC_XPRV as watch-only', function () {
    const k = new Key({ mnemonic: PHRASE_A });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: k.xpub }), { xpub: k.xpub });
    assert.deepStrictEqual(keySettingsFromEnv({ FABRIC_XPRV: k.pubkey }), { public: String(k.pubkey).toLowerCase() });
  });

  it('resolveFabricOperatorKeySettings uses FABRIC_XPRV before mnemonic env', function () {
    const k = new Key({ mnemonic: PHRASE_B });
    const resolved = resolveFabricOperatorKeySettings({
      FABRIC_XPRV: k.xprv,
      FABRIC_MNEMONIC: PHRASE_A
    }, { allowWalletFallback: false });
    assert.strictEqual(resolved.source, 'FABRIC_XPRV');
    assert.strictEqual(resolved.key.xprv, k.xprv);
    assert.strictEqual(resolved.key.mnemonic, undefined);
  });
});
