'use strict';

const assert = require('assert');
const Actor = require('../types/actor');
const Identity = require('../types/identity');
const Key = require('../types/key');
const Service = require('../types/service');
const Message = require('../types/message');
const { P2P_CONTRACT_PUBLISH } = require('../constants');

describe('Wave 1 core audit honesty', function () {
  it('Actor.sign requires a Key and points callers at Message.signWithKey', function () {
    const a = new Actor({ hello: true });
    assert.throws(() => a.sign(), /Message\.signWithKey|Key\.sign/);
  });

  it('Identity._verifyKeyIsChild matches fabricKey under master', function () {
    const id = new Identity();
    assert.strictEqual(id._verifyKeyIsChild(id.fabricKey, id.master), true);
    assert.strictEqual(id._verifyKeyIsChild(new Key(), id.master), false);
    assert.strictEqual(id._verifyKeyIsChild(null, id.master), false);
  });

  it('Service._applyChanges rejects sensitive paths', async function () {
    const service = new Service({ networking: false });
    await service.start();
    const denied = await service._applyChanges([
      { op: 'add', path: '/mnemonic', value: 'abandon abandon' }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(service._state.content.mnemonic, undefined);
    await service.stop();
  });

  it('Service._applyChanges rejects sensitive from pointers on copy/move', async function () {
    const service = new Service({ networking: false });
    await service.start();
    service._state.content.mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const denied = await service._applyChanges([
      { op: 'copy', from: '/mnemonic', path: '/public' }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /sensitive from/);
    assert.strictEqual(service._state.content.public, undefined);
    await service.stop();
  });

  it('Service.requirePatchCapability blocks without patchCapability', async function () {
    const service = new Service({
      networking: false,
      requirePatchCapability: true
    });
    await service.start();
    const denied = await service._applyChanges([
      { op: 'add', path: '/ok', value: 1 }
    ]);
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /requirePatchCapability/);
    await service.stop();
  });

  it('registers CONTRACT_* body schemas while still accepting JSON', function () {
    assert.ok(Message.getBodySchema('CONTRACT_PUBLISH'));
    assert.ok(Message.getBodySchema('CONTRACT_MESSAGE'));
    assert.ok(Message.getBodySchema(P2P_CONTRACT_PUBLISH));
    const json = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: 'aa'.repeat(32),
      payload: { hi: 1 }
    })]);
    const parsed = Message.tryParseMessageBody(json);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.encoding, 'json');
  });
});
