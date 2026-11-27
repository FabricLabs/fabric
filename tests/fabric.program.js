'use strict';

const assert = require('assert');
const Program = require('../types/program');
const Machine = require('../types/machine');

describe('@fabric/core/types/program', function () {
  it('constructs with circuit and script', function () {
    const p = new Program();
    assert.ok(p.circuit);
    assert.ok(p.script);
    assert.deepStrictEqual(p.settings.instructions, []);
  });

  it('Program.from fabric-opcodes compiles steps from source lines', function () {
    const p = Program.from({
      language: 'fabric-opcodes',
      source: 'OP_TRUE\nOP_ADD'
    });
    const r = p.compile();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(p.steps, ['OP_TRUE', 'OP_ADD']);
    assert.ok(p.programHash.length === 64);
  });

  it('bitcoin-script toRedeemScript returns hex', function () {
    const bitcoin = require('bitcoinjs-lib');
    const p = Program.from({
      language: 'bitcoin-script',
      source: [bitcoin.opcodes.OP_TRUE]
    });
    const r = p.toRedeemScript();
    assert.strictEqual(r.ok, true);
    assert.ok(r.scriptHex && r.scriptHex.length >= 2);
  });

  it('solidity compile is unsupported stub', function () {
    const p = Program.from({ language: 'solidity', source: 'contract C {}' });
    const r = p.compile();
    assert.strictEqual(r.ok, false);
    assert.ok(/not implemented/.test(r.error));
  });

  it('runCommitmentHex is stable for same result', function () {
    const p = Program.from({ language: 'fabric-opcodes', steps: ['1'] });
    p.compile();
    const a = p.runCommitmentHex({ tip: 1 });
    const b = p.runCommitmentHex({ tip: 1 });
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 64);
  });

  it('Machine.runProgram executes fabric-opcodes', async function () {
    const m = new Machine({ script: [] });
    m.define('OP_TRUE', () => true);
    const prog = Program.from({ language: 'fabric-opcodes', steps: ['OP_TRUE'] });
    const out = await m.runProgram(prog);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.tip, true);
    assert.ok(out.runCommitmentHex);
  });

  it('Machine.parseManifest validates programHash', function () {
    const m = new Machine();
    const prog = Program.from({ language: 'fabric-opcodes', steps: ['1'] });
    prog.compile();
    const ok = m.parseManifest({
      version: 1,
      programId: prog.programId,
      programHash: prog.programHash
    }, prog);
    assert.strictEqual(ok.ok, true);
    const bad = m.parseManifest({
      version: 1,
      programId: 'x',
      programHash: '00'.repeat(32)
    }, prog);
    assert.strictEqual(bad.ok, false);
  });

  it('step and start remain callable', async function () {
    const p = new Program();
    assert.doesNotThrow(() => p.step());
    await p.start();
  });
});
