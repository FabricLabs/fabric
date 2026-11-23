'use strict';

const assert = require('assert');
const Contract = require('../types/contract');
const Key = require('../types/key');
const { FIXTURE_XPRV } = require('../constants');
const { authorityPubkeys, hasAuthority, publishSignerAuthorized } = require('../types/contract');
const { normalizePeerPubkeyHex } = require('../functions/pubkey');
const { normalizeIdentifier, resolveIdentifier, stampIdentifier } = require('../types/contract');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');
const Bond = require('../types/bond');
const { prepareLeafPsbt } = require('../types/policy');

const sample = {
  key: new Key({
    xprv: FIXTURE_XPRV
  })
};

describe('@fabric/core/types/contract', function () {
  describe('Contract', function () {
    it('is available from @fabric/core', function () {
      assert.equal(Contract instanceof Function, true);
    });

    it('can instantiate from sample data', function (done) {
      async function test () {
        const contract = new Contract(sample);
        assert.ok(contract);
        done();
      }

      test();
    });

    it('can start and stop', function (done) {
      async function test () {
        const contract = new Contract(sample);
        contract.start();
        contract.stop();
        assert.ok(contract);
        done();
      }

      test();
    });

    it('can publish a contract', function (done) {
      const timeout = setTimeout(() => {
        done(new Error('Timeout waiting for contract publish'));
      }, 5000);

      async function test () {
        const contract = new Contract({
          ...sample,
          key: new Key({
            xprv: FIXTURE_XPRV
          })
        });

        contract.on('error', (err) => {
          clearTimeout(timeout);
          done(err);
        });

        contract.on('message', (msg) => {
          switch (msg['@type']) {
            default:
            case 'CONTRACT_PUBLISH':
              clearTimeout(timeout);
              assert.ok(contract);
              assert.ok(msg);
              done();
              break;
          }
        });

        try {
          await contract.deploy();
        } catch (err) {
          clearTimeout(timeout);
          done(err);
        }
      }

      test();
    });

    it('emits committed changes even when the diff is too large for one message', function () {
      const contract = new Contract(sample);
      const seen = { changes: null, messages: 0, warnings: [] };
      contract.on('changes', (changes) => { seen.changes = changes; });
      contract.on('message', () => { seen.messages++; });
      contract.on('warning', (w) => { seen.warnings.push(w); });
      contract._state.content.blob = 'x'.repeat(64 * 1024);
      contract.commit();
      assert.ok(seen.changes && seen.changes.length, 'listeners got the changes');
      assert.strictEqual(seen.messages, 0);
      assert.strictEqual(seen.warnings.length, 1);
      assert.match(seen.warnings[0], /commit message not built/);
    });
  });
});

describe('Contract publish authority', function () {
  it('authorityPubkeys walks nested members and spendPolicy', function () {
    const owner = new Key();
    const co = new Key();
    const set = authorityPubkeys({
      members: { signers: [owner.pubkey] },
      spendPolicy: { validators: [co.pubkey] }
    });
    assert.ok(hasAuthority(set, owner.pubkey));
    assert.ok(hasAuthority(set, co.pubkey));
  });

  it('authorityPubkeys includes proposedPolicy.validators', function () {
    const v = new Key();
    const set = authorityPubkeys({
      proposedPolicy: { validators: [v.pubkey] }
    });
    assert.ok(hasAuthority(set, v.pubkey));
  });

  it('publishSignerAuthorized allows empty authority set (open genesis)', function () {
    assert.strictEqual(publishSignerAuthorized({ name: 'X' }, 'aa'.repeat(32)), true);
    assert.strictEqual(publishSignerAuthorized({ name: 'X' }, null), true);
  });

  it('publishSignerAuthorized rejects non-party signer', function () {
    const owner = new Key();
    const attacker = new Key();
    const def = { validators: [owner.pubkey] };
    assert.strictEqual(publishSignerAuthorized(def, owner.pubkey), true);
    assert.strictEqual(publishSignerAuthorized(def, attacker.pubkey), false);
  });

  it('publishSignerAuthorized fail-closes when authorities exist but signer is missing', function () {
    const owner = new Key();
    const def = { validators: [owner.pubkey] };
    assert.strictEqual(publishSignerAuthorized(def, null), false);
    assert.strictEqual(publishSignerAuthorized(def, ''), false);
  });

  it('normalizePeerPubkeyHex strips compressed prefix', function () {
    const k = new Key();
    const compressed = k.pubkey;
    assert.strictEqual(normalizePeerPubkeyHex(compressed).length, 64);
  });
});

describe('Contract identifier (contractId rename prep)', function () {
  it('resolve prefers contractIdentifier over legacy contractId', function () {
    assert.strictEqual(resolveIdentifier({
      contractId: 'legacy',
      contractIdentifier: 'canonical'
    }), 'canonical');
    assert.strictEqual(resolveIdentifier({ contractId: 'only-legacy' }), 'only-legacy');
    assert.strictEqual(resolveIdentifier({}), null);
    assert.strictEqual(resolveIdentifier(null), null);
  });

  it('stamp writes both fields without dropping either', function () {
    const row = { contractId: 'old' };
    stampIdentifier(row, 'aa'.repeat(32));
    assert.strictEqual(row.contractIdentifier, 'aa'.repeat(32));
    assert.strictEqual(row.contractId, 'aa'.repeat(32));
  });

  it('normalize rejects empty strings', function () {
    assert.strictEqual(normalizeIdentifier('  '), null);
    assert.strictEqual(normalizeIdentifier('x'), 'x');
  });
});

const { Resolutions } = Contract;

function keypair () {
  const priv = crypto.randomBytes(32);
  return {
    priv,
    pub: Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex'),
    xOnly: Buffer.from(schnorr.getPublicKey(priv)).toString('hex')
  };
}

function fundingFor (address, sats = 50_000n) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.regtest), sats);
  return tx.toHex();
}

describe('Contract.Resolutions — pre-signed exits per off-chain state', function () {
  this.timeout(20000);

  const publisher = keypair();
  const provider = keypair();
  const stranger = keypair();
  const dest = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(publisher.pub, 'hex'), network: bitcoin.networks.regtest }).address;

  let deposit;
  let funded;
  let penaltyPsbt;

  before(() => {
    deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 900, amountSats: 30000 });
    funded = fundingFor(deposit.address, 30000n);
    const leaf = deposit._leaves.find((l) => l.id === 'penalty') || deposit._leaves[0];
    penaltyPsbt = prepareLeafPsbt({
      networkName: 'regtest',
      fundedTxHex: funded,
      vaultAddress: deposit.address,
      leafScript: leaf.script,
      leaves: deposit._leaves,
      internalPubkeyHex: deposit.internalPubkeyHex,
      destinationAddress: dest,
      feeSats: 500,
      after: { type: 'cltv', height: 1200 }
    });
  });

  it('a contract refuses to advance into a state whose exits are unsigned', () => {
    const contract = new Contract({ network: 'regtest' });
    assert.ok(contract.resolutions instanceof Resolutions);
    const exit = contract.resolutions.addExit('genesis', {
      id: 'penalty-0',
      kind: Resolutions.KINDS.PENALTY,
      psbtBase64: penaltyPsbt.psbtBase64 || penaltyPsbt.psbt.toBase64(),
      required: [publisher.pub, provider.xOnly],
      locktime: { height: 1200 }
    });
    assert.strictEqual(exit.locktime.height, 1200);
    assert.strictEqual(exit.spends.txid, bitcoin.Transaction.fromHex(funded).getId());
    assert.strictEqual(exit.signers.required.length, 2);
    assert.deepStrictEqual(contract.resolutions.missing('genesis').map((m) => m.exitId), ['penalty-0']);
    assert.throws(() => contract.advance('genesis'), /not resolvable/);
    assert.throws(() => contract.advance('nope'), /state not declared/);
  });

  it('exit signatures are exchanged as ContractExitSignature artifacts and verified', () => {
    const base64 = penaltyPsbt.psbtBase64 || penaltyPsbt.psbt.toBase64();
    const a = new Resolutions({ network: 'regtest', contractId: 'c1' });
    const b = new Resolutions({ network: 'regtest', contractId: 'c1' });
    for (const r of [a, b]) {
      r.addExit('genesis', { id: 'penalty-0', kind: 'penalty', psbtBase64: base64, required: [publisher.pub, provider.pub] });
    }
    // Provider signs on its side; publisher ingests the artifact.
    const fromProvider = a.signExit('genesis', 'penalty-0', provider.priv);
    assert.strictEqual(fromProvider.type, Resolutions.EXIT_SIGNATURE_TYPE);
    assert.strictEqual(fromProvider.signerPubkey, provider.xOnly);
    assert.ok(!b.resolvable('genesis'));
    assert.deepStrictEqual(b.ingest(fromProvider), { ok: true, stateId: 'genesis', exitId: 'penalty-0' });
    assert.ok(!b.resolvable('genesis'), 'publisher signature still missing');
    assert.deepStrictEqual(b.missing('genesis')[0].missing, [publisher.xOnly]);

    // Publisher signs; now both sides are resolvable and the exit finalizes.
    const fromPublisher = b.signExit('genesis', 'penalty-0', publisher.priv);
    assert.strictEqual(a.ingest(fromPublisher).ok, true);
    assert.ok(a.resolvable('genesis'));
    assert.ok(b.resolvable('genesis'));
    assert.deepStrictEqual(a.verifyExit('genesis', 'penalty-0'), { ok: true, missing: [] });
    const fin = a.finalizeExit('genesis', 'penalty-0');
    const tx = bitcoin.Transaction.fromHex(fin.txHex);
    assert.strictEqual(tx.locktime, 1200, 'timelocked exit keeps nLockTime');
    assert.strictEqual(tx.ins[0].witness.length, 4, '2 sigs + script + control block');

    // Strangers, tampered signatures, and foreign contracts are rejected.
    const c = new Resolutions({ network: 'regtest', contractId: 'c2' });
    c.addExit('genesis', { id: 'penalty-0', kind: 'penalty', psbtBase64: base64, required: [publisher.pub, provider.pub] });
    assert.match(c.ingest(fromProvider).reason, /another contract/);
    assert.throws(() => a.signExit('genesis', 'penalty-0', stranger.priv), /not a required signer/);
    const tampered = Object.assign({}, fromProvider, { exitSignature: fromProvider.exitSignature.replace(/^../, fromProvider.exitSignature.startsWith('00') ? 'ff' : '00') });
    assert.match(b.ingest(tampered).reason, /artifact signature invalid/);
    const resigned = Object.assign({}, fromProvider, { exitSignature: fromPublisher.exitSignature });
    assert.match(b.ingest(resigned).reason, /artifact signature invalid/);
    assert.match(b.ingest(Object.assign({}, fromProvider, { exitId: 'ghost' })).reason, /artifact signature invalid|unknown exit/);
  });

  it('child states inherit missing exits; export/import and tree root are stable', () => {
    const base64 = penaltyPsbt.psbtBase64 || penaltyPsbt.psbt.toBase64();
    const r = new Resolutions({ network: 'regtest' });
    r.addExit('genesis', { id: 'penalty-0', kind: 'penalty', psbtBase64: base64, required: [publisher.pub, provider.pub] });
    r.declare('1', 'genesis');
    r.addExit('1', { id: 'timeout-h1', kind: 'timeout', psbtBase64: base64, required: [provider.pub] });
    assert.strictEqual(r.missing('1').length, 2, 'own exit plus inherited genesis exit');
    r.signExit('1', 'timeout-h1', provider.priv);
    assert.strictEqual(r.missing('1').length, 1);
    r.signExit('genesis', 'penalty-0', provider.priv);
    r.signExit('genesis', 'penalty-0', publisher.priv);
    assert.ok(r.resolvable('1'));
    assert.strictEqual(r.getExit('1', 'timeout-h1').locktime.height, 1200, 'nLockTime harvested from the PSBT');
    assert.strictEqual(r.exitsAfter(1199).length, 0, 'nothing broadcastable before the lock');
    assert.strictEqual(r.exitsAfter(1200).length, 2);

    const snap = JSON.parse(JSON.stringify(r.export()));
    assert.strictEqual(snap.type, 'ContractResolutions');
    const back = new Resolutions({ network: 'regtest' }).import(snap);
    assert.ok(back.resolvable('1'));
    assert.strictEqual(back.rootHex, r.rootHex);
    assert.notStrictEqual(back.rootHex, '0'.repeat(64));
    assert.deepStrictEqual(back.verifyExit('genesis', 'penalty-0'), { ok: true, missing: [] });
  });
});
