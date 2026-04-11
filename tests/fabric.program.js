'use strict';

const assert = require('assert');
const Program = require('../types/program');

describe('@fabric/core/types/program', function () {
  it('constructs with circuit and script', function () {
    const p = new Program();
    assert.ok(p.circuit);
    assert.ok(p.script);
    assert.deepStrictEqual(p.settings.instructions, []);
  });

  it('step runs without throwing', function () {
    const p = new Program();
    assert.doesNotThrow(() => p.step());
  });

  it('start resolves', async function () {
    const p = new Program();
    await p.start();
  });
});
