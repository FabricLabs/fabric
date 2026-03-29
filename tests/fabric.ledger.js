'use strict';

const assert = require('assert');
const Ledger = require('../types/ledger');

/** Stack depth — {@link State#size} is buffer length, not frame count. */
function stackDepth (pages) {
  return pages['@data'].length;
}

describe('@fabric/core/types/ledger', function () {
  it('constructs with 4096-byte memory and stack', function () {
    const ledger = new Ledger([]);
    assert.strictEqual(ledger.memory.length, 4096);
    assert.ok(ledger.pages);
  });

  it('start appends genesis when empty and sets status', async function () {
    const ledger = new Ledger([]);
    await ledger.start();
    assert.strictEqual(ledger.status, 'started');
    assert.ok(stackDepth(ledger.pages) >= 1);
  });

  it('append pushes items and updates serialized data', async function () {
    const ledger = new Ledger([]);
    await ledger.start();
    const before = stackDepth(ledger.pages);
    await ledger.append({ name: 'page-b', n: 1 });
    assert.strictEqual(stackDepth(ledger.pages), before + 1);
    assert.ok(ledger.commit());
  });

  it('consume stores ink and returns same ink on subsequent calls', async function () {
    const ledger = new Ledger([]);
    await ledger.start();
    const ink = Buffer.from('ink');
    assert.strictEqual(ledger.consume(ink), ink);
    assert.strictEqual(ledger.consume(Buffer.from('other')), ink);
  });

  it('render returns XML-ish fragment with id', async function () {
    const ledger = new Ledger([]);
    await ledger.start();
    const xml = ledger.render();
    assert.ok(xml.includes('<Ledger'));
    assert.ok(xml.includes('id='));
  });
});
