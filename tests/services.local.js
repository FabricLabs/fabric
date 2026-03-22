'use strict';

const assert = require('assert');
const Local = require('../services/local');

describe('services/local', function () {
  it('merges default path into config', function () {
    const s = new Local({});
    assert.strictEqual(s.config.path, './stores/local');
  });

  it('handler maps channel/text into a message event', function (done) {
    const local = new Local({ path: './stores/test-local' });
    local.on('message', (data) => {
      try {
        assert.strictEqual(data.actor, 'u1');
        assert.strictEqual(data.target, '#general');
        assert.strictEqual(data.object, 'hi');
        assert.strictEqual(data.origin.type, 'Link');
        assert.strictEqual(data.origin.name, 'Internal');
        done();
      } catch (e) {
        done(e);
      }
    });

    local.handler({
      user: 'u1',
      channel: '#general',
      text: 'hi'
    });
  });

  it('start delegates to Service.start', async function () {
    const local = new Local({});
    const out = await local.start();
    assert.strictEqual(out, local);
  });
});
