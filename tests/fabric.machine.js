'use strict';

const assert = require('assert');
const playnet = require('../settings/playnet');
const OPCODES = require('../assets/opcodes');
const Machine = require('../types/machine');

describe('@fabric/core/types/machine', function () {
  describe('Machine', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Machine instanceof Function, true);
    });

    it('provides entropy on first sip', function () {
      const machine = new Machine(false);
      const sip = machine.sip();
      assert.ok(typeof sip === 'string');
      assert.ok(sip.length > 0);
    });

    it('provides entropy on first slurp', function () {
      const machine = new Machine(false);
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.ok(typeof slurp === 'string');
      assert.ok(slurp.length > 0);
    });

    it('provides the predicted entropy on first sip with seed', function () {
      const machine = new Machine({ key: { seed: playnet.key.seed } });
      const sip = machine.sip();
      assert.strictEqual(sip.length, 32);
      // Constructor consumes one 128-bit sip into `entropy`; this is the second sip from
      // Key’s deterministic bit stream (`fabric/key/bitgen/v1` + pubkeyhash-derived seed).
      assert.strictEqual(sip, '88b27944aebe8fad98c5ba8bcdf8189d');
    });

    it('provides the predicted entropy on first slurp with seed', function () {
      const machine = new Machine({ key: { seed: playnet.key.seed } });
      const slurp = machine.slurp();
      assert.ok(slurp);
      assert.strictEqual(slurp.length, 64);
      assert.strictEqual(slurp, '88b27944aebe8fad98c5ba8bcdf8189dadd9e35f2156c1c1024be43573b57ba5');
    });

    it('can compute a value', async function prove () {
      // TODO: use Fabric itself
      const machine = new Machine(false);
      // TODO: use Fabric instead of Machine
      machine.define('OP_TRUE', OPCODES.OP_TRUE);
      // fabric.push('OP_TRUE');
      machine.script.push('OP_TRUE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.ok(machine.stack.length >= 1);
    });

    it('can correctly sum two values', async function prove () {
      const machine = new Machine(false);
      machine.define('PUSH_2', function () { return 2; });
      machine.define('PUSH_3', function () { return 3; });
      machine.define('SUM_TWO', function () {
        const b = machine.stack.pop();
        const a = machine.stack.pop();
        return a + b;
      });
      machine.script.push('PUSH_2', 'PUSH_3', 'SUM_TWO');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.strictEqual(machine.stack[machine.stack.length - 1], 5);
    });

    it('can correctly sum three values', async function prove () {
      const machine = new Machine(false);
      machine.define('PUSH_1', function () { return 1; });
      machine.define('PUSH_2', function () { return 2; });
      machine.define('PUSH_3', function () { return 3; });
      machine.define('SUM_THREE', function () {
        const c = machine.stack.pop();
        const b = machine.stack.pop();
        const a = machine.stack.pop();
        return a + b + c;
      });
      machine.script.push('PUSH_1', 'PUSH_2', 'PUSH_3', 'SUM_THREE');
      await machine.start();
      await machine.compute();
      await machine.stop();
      assert.strictEqual(machine.stack[machine.stack.length - 1], 6);
    });

    it('compileOpcodeContract accepts newline-delimited opcode bodies', function () {
      const machine = new Machine(false);
      const lines = machine.compileOpcodeContract('OP_DUP\nOP_HASH160\nP2P_FLUSH_CHAIN');
      assert.deepStrictEqual(lines, ['OP_DUP', 'OP_HASH160', 'P2P_FLUSH_CHAIN']);
    });

    it('compileOpcodeContract rejects unknown opcode symbols', function () {
      const machine = new Machine(false);
      assert.throws(() => machine.compileOpcodeContract('OP_TRUE\nOP_NOT_REAL'), /Unknown opcodes/);
    });
  });
});

const {
  normalizeOpcodeAllowList,
  opcodesFromGenesis,
  assertStepsAllowed
} = require('../functions/opcodeAllowList');

describe('opcodeAllowList', function () {
  it('normalizes and dedupes', function () {
    assert.deepStrictEqual(
      normalizeOpcodeAllowList([' OP_TRUE ', 'OP_TRUE', '', 'OP_ADD']),
      ['OP_TRUE', 'OP_ADD']
    );
  });

  it('opcodesFromGenesis prefers primitives.opcodes', function () {
    assert.deepStrictEqual(
      opcodesFromGenesis({
        primitives: { opcodes: ['OP_A'] },
        opcodes: ['OP_B']
      }),
      ['OP_A']
    );
    assert.deepStrictEqual(opcodesFromGenesis({ opcodes: ['OP_B'] }), ['OP_B']);
    assert.deepStrictEqual(opcodesFromGenesis({}), []);
  });

  it('assertStepsAllowed fails closed', function () {
    assert.strictEqual(assertStepsAllowed(['OP_TRUE'], ['OP_TRUE']).ok, true);
    const bad = assertStepsAllowed(['OP_TRUE'], ['OP_TRUE', 'OP_EVIL']);
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.unknown, ['OP_EVIL']);
  });
});

const Program = require('../types/program');
const {
  runExecutionProgram,
  executionProgramFromHub
} = require('../functions/executionProgramRunner');

describe('executionProgramRunner / Machine fabric-execution', function () {
  it('runs Push/Dup/Pop/ADD on Machine stack', function () {
    const r = runExecutionProgram({
      version: 1,
      steps: [
        { op: 'Push', value: 2 },
        { op: 'PUSH', value: 3 },
        { op: 'ADD' },
        { op: 'Dup' }
      ]
    });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.stack[0], 5);
    assert.strictEqual(r.stack[1], 5);
    assert.ok(r.programHash);
    assert.ok(r.runCommitmentHex);
    assert.ok(r.program);
  });

  it('content-addresses via Program.programHash', function () {
    const program = { version: 1, steps: [{ op: 'Push', value: 1 }] };
    const a = executionProgramFromHub(program).programHash;
    const b = executionProgramFromHub(program).programHash;
    assert.strictEqual(a, b);
    assert.strictEqual(runExecutionProgram(program).programHash, a);
  });

  it('Machine.runProgram delegates fabric-execution', async function () {
    const machine = new Machine({ deterministic: true });
    const out = await machine.runProgram({
      language: 'fabric-execution',
      source: {
        version: 1,
        steps: [{ op: 'Push', value: { hi: true } }]
      }
    });
    assert.strictEqual(out.ok, true, out.error);
    assert.deepStrictEqual(out.tip, { hi: true });
    assert.ok(out.runCommitmentHex);
  });

  it('rejects Ping FabricOpcode when resolver marks it', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricType: 'Ping' }]
    }, {
      resolveFabricEntry () {
        throw new Error('Ping is a transport keepalive, not an Execution program opcode');
      }
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Ping/);
  });

  it('enforces Machine / genesis opcode allow-list on FabricOpcode steps', function () {
    const program = {
      version: 1,
      steps: [{ op: 'FabricOpcode', fabricType: 'ChatMessage' }]
    };
    const denied = runExecutionProgram(program, {
      allowedOpcodes: ['P2P_CHAT_MESSAGE'],
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(denied.ok, false);
    assert.match(denied.error, /allow-list/i);

    const allowed = runExecutionProgram(program, {
      allowedOpcodes: ['ChatMessage'],
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(allowed.ok, true, allowed.error);

    const fromGenesis = runExecutionProgram(program, {
      genesis: { primitives: { opcodes: ['OtherOnly'] } },
      resolveFabricEntry () {
        return { name: 'ChatMessage', opcodeDec: 0x67 };
      }
    });
    assert.strictEqual(fromGenesis.ok, false);
    assert.match(fromGenesis.error, /allow-list/i);
  });

  it('Program.compile fabric-execution requires steps', function () {
    const bad = Program.from({ language: 'fabric-execution', source: {} }).compile();
    assert.strictEqual(bad.ok, false);
  });
});
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const Key = require('../types/key');
const Contract = require('../types/contract');
const {
  observePaymentToAddress,
  applyPaymentObservationToTip
} = require('../functions/contractPaymentObserve');
const {
  buildExecutionRunOutput,
  computeExecutionRunCommitmentHex,
  computeFabricProgramRunFromExecution
} = require('../functions/executionRunBridge');

describe('executionRunBridge / FabricProgramRun forward digest', function () {
  it('keeps legacy ExecutionRun digest stable', function () {
    const result = {
      ok: true,
      stepsExecuted: 2,
      trace: [{ pc: 0, op: 'Push' }],
      stack: [1]
    };
    const a = computeExecutionRunCommitmentHex('cid-1', result);
    const b = computeExecutionRunCommitmentHex('cid-1', result);
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 64);
  });

  it('buildExecutionRunOutput prefers FabricProgramRun when programHash set', function () {
    const programHash = crypto.createHash('sha256').update('prog').digest('hex');
    const result = { ok: true, stepsExecuted: 1, trace: [], stack: ['x'] };
    const out = buildExecutionRunOutput({
      contractId: 'cid-forward',
      programHash,
      result
    });
    assert.strictEqual(out.programHash, programHash);
    assert.ok(out.executionRunCommitmentHex);
    assert.ok(out.fabricProgramRunCommitmentHex);
    assert.notStrictEqual(out.executionRunCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.runCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.fabricProgramRun.kind, 'FabricProgramRun');
    assert.strictEqual(out.fabricProgramRun.runCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(
      computeFabricProgramRunFromExecution({ programHash, contractId: 'cid-forward', result }),
      out.fabricProgramRunCommitmentHex
    );
  });

  it('falls back to ExecutionRun digest without programHash', function () {
    const result = { ok: false, error: 'boom', trace: [], stack: [] };
    const out = buildExecutionRunOutput({ contractId: 'cid-legacy', result });
    assert.strictEqual(out.programHash, null);
    assert.strictEqual(out.runCommitmentHex, out.executionRunCommitmentHex);
    assert.strictEqual(out.fabricProgramRun, null);
  });
});

describe('contractPaymentObserve / Contract L1 payment', function () {
  const keys = [];
  before(function () {
    for (let i = 0; i < 3; i++) keys.push(new Key());
  });

  function fundTx (outputScript, valueSats) {
    const fund = new bitcoin.Transaction();
    fund.version = 2;
    fund.addInput(Buffer.alloc(32), 0);
    fund.addOutput(outputScript, BigInt(valueSats));
    return fund;
  }

  it('observes successful payment to contract address', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey, keys[1].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const address = contract.toAddress('regtest');
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 50000);
    const obs = observePaymentToAddress({
      tx: tx.toHex(),
      address,
      network: 'regtest',
      amountSats: 40000
    });
    assert.strictEqual(obs.ok, true);
    assert.strictEqual(obs.code, 'PAID');
    assert.strictEqual(obs.matchedSats, 50000);
    assert.ok(obs.txid);
  });

  it('fails when tx does not pay contract address', function () {
    const other = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keys[2].pubkey, 'hex'),
      network: bitcoin.networks.regtest
    });
    const tx = fundTx(other.output, 10000);
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const obs = observePaymentToAddress({
      tx: tx.toHex(),
      address: contract.toAddress('regtest'),
      network: 'regtest'
    });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'NO_MATCH');
  });

  it('fails UNDERPAID when matched sats below amountSats', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey
    });
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 1000);
    const obs = observePaymentToAddress({
      tx,
      address: contract.toAddress('regtest'),
      network: 'regtest',
      amountSats: 5000
    });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'UNDERPAID');
    assert.strictEqual(obs.matchedSats, 1000);
  });

  it('fails on missing / invalid tx', function () {
    assert.strictEqual(observePaymentToAddress({ address: 'bcrt1qxx' }).code, 'MISSING_TX');
    assert.strictEqual(
      observePaymentToAddress({ tx: 'zz', address: 'bcrt1qxx' }).code,
      'INVALID_TX'
    );
  });

  it('Contract#_handleBitcoinTransaction applies balances on success', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey,
      state: { balances: {}, payments: [] }
    });
    const built = contract.toTaprootContract({ network: 'regtest' });
    const tx = fundTx(built.output, 25000);
    const obs = contract._handleBitcoinTransaction(tx.toHex(), {
      network: 'regtest',
      amountSats: 10000
    });
    assert.strictEqual(obs.ok, true);
    assert.strictEqual(obs.applied, true);
    const addr = contract.toAddress('regtest');
    assert.strictEqual(contract._state.content.balances[addr].sats, 25000);
    assert.strictEqual(contract._state.content.payments.length, 1);
  });

  it('Contract#_handleBitcoinTransaction does not apply on failure', function () {
    const contract = new Contract({
      network: 'regtest',
      validators: [keys[0].pubkey],
      threshold: 1,
      publisher: keys[0].pubkey,
      state: { balances: {}, payments: [] }
    });
    const other = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(keys[1].pubkey, 'hex'),
      network: bitcoin.networks.regtest
    });
    const tx = fundTx(other.output, 9000);
    const obs = contract._handleBitcoinTransaction(tx.toHex(), { network: 'regtest' });
    assert.strictEqual(obs.ok, false);
    assert.strictEqual(obs.code, 'NO_MATCH');
    assert.deepStrictEqual(contract._state.content.payments || [], []);
  });

  it('applyPaymentObservationToTip rejects failed observations', function () {
    assert.throws(
      () => applyPaymentObservationToTip({}, { ok: false, code: 'NO_MATCH' }),
      /successful/
    );
  });
});
