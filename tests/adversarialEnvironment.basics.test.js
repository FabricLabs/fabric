'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 * Not a substitute for tests/protocol-v1 adversarial Peer coverage.
 */

const assert = require('assert');
const Key = require('../types/key');
const {
  composeGarblerPublish,
  finalizeBlindedExecution
} = require('../functions/blindedExecutionCircuit');

describe('adversarialEnvironment.basics (@fabric/core)', function () {
  it('refuses a single-party blinded-execution publish (needs evaluator)', function () {
    const garbler = new Key();
    assert.throws(() => composeGarblerPublish({
      network: 'regtest',
      garbler: garbler.pubkey,
      parties: [],
      state: { v: 1 },
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    }), /at least one evaluator/);
  });

  it('refuses finalize without an accept under adversarial coordination', function () {
    const a = new Key();
    const b = new Key();
    const session = composeGarblerPublish({
      network: 'regtest',
      garbler: a.pubkey,
      parties: [b.pubkey],
      state: {},
      program: { language: 'fabric-opcodes', steps: ['OP_TRUE'] }
    });
    assert.throws(() => finalizeBlindedExecution({ session }), /at least one accept/);
  });
});
