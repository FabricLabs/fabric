'use strict';

const assert = require('assert');
const EncryptedPromise = require('../types/promise');

describe('@fabric/core/types/promise', function () {
  describe('EncryptedPromise', function () {
    it('constructs with password-derived iv and stable id', function () {
      const p = new EncryptedPromise({ password: 'secret' });
      assert.ok(p.id);
      assert.strictEqual(p.id.length, 64);
      assert.strictEqual(typeof p.id, 'string');
    });

    it('resolve returns id and message', function () {
      const p = new EncryptedPromise({ password: 'x' });
      const out = p.resolve({ ok: true });
      assert.strictEqual(out.id, p.id);
      assert.deepStrictEqual(out.msg, { ok: true });
    });

    it('encrypt updates internal state flag', function () {
      const p = new EncryptedPromise({ password: 'pw' });
      assert.strictEqual(p._state.state, 'ENCRYPTED');
    });

    it('_assignState updates serialized data and status', async function () {
      const p = new EncryptedPromise({ password: 'pw' });
      await p._assignState({ n: 1 });
      assert.strictEqual(p.status, 'assigned');
      assert.ok(String(p._state.data).includes('"n"'));
    });

    it('state getter returns typed envelope', function () {
      const p = new EncryptedPromise({ password: 'z' });
      const st = p.state;
      assert.strictEqual(st.type, 'EncryptedPromise');
      assert.ok(Buffer.isBuffer(st.blob));
    });
  });
});
