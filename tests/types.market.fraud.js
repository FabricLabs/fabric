'use strict';

// Adversarial regressions for market fraud proofs, bonds, and the offer book:
// each case is an attack a counterparty (or a third party) could mount.

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const Bond = require('../types/bond');
const Challenge = require('../types/challenge');
const Witness = require('../types/witness');
const Document = require('../types/document');
const Tree = require('../types/tree');
const Contract = require('../types/contract');
const DocumentBook = require('../types/documentBook');
const Message = require('../types/message');
const Key = require('../types/key');
const { signerFromPriv32 } = require('../types/htlc');
const { documentMerkleRootHex } = require('../functions/documentBlobManifest');
const { createBlobMerkleTree } = require('../types/challenge');
const { buildInclusion, merkleRootFromTxids, headerMeetsTarget } = require('../functions/bitcoinTxInclusion');

const { FraudProof } = Witness;
const KINDS = Witness.FRAUD_PROOF_KINDS;
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

function p2wpkh (pub) {
  return bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: bitcoin.networks.regtest }).address;
}

function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function signedFrame (obj, priv) {
  return Message.fromVector(['P2P_FILE_SEND', JSON.stringify(obj)]).signWithKey(new Key({ private: priv.toString('hex') })).toBuffer().toString('hex');
}

/** Header over `txids`, mined at regtest difficulty. */
function headerFor (txids) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(2, 0);
  Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
  header.writeUInt32LE(0x207fffff, 72);
  while (!headerMeetsTarget(header.toString('hex'))) header.writeUInt32LE(header.readUInt32LE(76) + 1, 76);
  return header.toString('hex');
}

/** A seller-signed wrong-bytes proof against `seller`. */
function wrongBytesProof (seller, documentId = 'd') {
  const preimage = crypto.randomBytes(32);
  const paymentHashHex = sha256Hex(preimage);
  const rootHex = crypto.randomBytes(32).toString('hex');
  const offer = Witness.signArtifact({ type: 'DocumentOffer', documentId, merkleRootHex: rootHex, blobIndex: 0, blobHashHex: 'aa'.repeat(32), paymentHashHex }, seller.priv);
  const garbage = crypto.randomBytes(8);
  const frameHex = signedFrame({ name: documentId, body: garbage.toString('base64'), blobIndex: 0, blobTotal: 1, blobHashHex: sha256Hex(garbage), merkleRootHex: rootHex, paymentHashHex }, seller.priv);
  return new FraudProof({ kind: KINDS.WRONG_BYTES, artifacts: { offer, claim: { preimageHex: preimage.toString('hex') }, delivery: { frameHex } } });
}

describe('Market fraud proofs — adversarial regressions', function () {
  this.timeout(30000);

  const publisher = keypair();
  const provider = keypair();
  const stranger = keypair();
  const challenger = new Challenge({ deadlineEpochs: 2 });
  let doc;
  let hashes;
  let root;
  let total;
  let dest;

  const commitFor = (opts = {}) => Challenge.commit(Object.assign({
    merkleRootHex: root, blobTotal: total, fromEpoch: 0, untilEpoch: 100,
    providerPrivateKey: provider.priv, publisherPubkey: publisher.xOnly
  }, opts));

  before(() => {
    doc = Document.seal(crypto.randomBytes(9000), { chunkBytes: 2048, documentId: 'adversary' });
    hashes = doc.record().blobs.map((b) => b.blobHashHex);
    root = createBlobMerkleTree(hashes).rootHex;
    total = hashes.length;
    dest = p2wpkh(publisher.pub);
    assert.strictEqual(total, 5, 'odd leaf count exercises self-paired nodes');
  });

  describe('blob paths (wrong-leaf / response integrity)', function () {
    it('accepts only paths whose labels, depth, and leaf count match the committed tree', () => {
      const tree = createBlobMerkleTree(hashes);
      for (let i = 0; i < total; i++) {
        const proof = Tree.serializeProof(tree.getProof(hashes[i], i));
        assert.ok(Witness.verifyBlobPath({ merkleRootHex: root, leafHex: hashes[i], index: i, leafCount: total, proof }), `leaf ${i}`);
        if (i !== 4) assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: hashes[i], index: (i + 1) % total, leafCount: total, proof }), 'index drives every left/right choice');
        const flipped = proof.map((s, k) => (k === 0 ? Object.assign({}, s, { position: s.position === 'left' ? 'right' : 'left' }) : s));
        assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: hashes[i], index: i, leafCount: total, proof: flipped }), 'labels must agree with the index');
        assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: hashes[i], index: i, leafCount: total, proof: proof.concat([{ position: 'right', data: root }]) }), 'extra steps');
        assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: hashes[i], index: i, leafCount: total, proof: { proof, leafCount: total + 3 } }), 'proof leafCount differs');
      }
    });

    it('an inner node cannot pass as a leaf once the leaf count is pinned', () => {
      const tree = createBlobMerkleTree(hashes);
      const parent = (l, r) => {
        const rev = (h) => Buffer.from(h, 'hex').reverse();
        const once = crypto.createHash('sha256').update(Buffer.concat([rev(l), rev(r)])).digest();
        return Buffer.from(crypto.createHash('sha256').update(once).digest()).reverse().toString('hex');
      };
      const n01 = parent(hashes[0], hashes[1]);
      const n23 = parent(hashes[2], hashes[3]);
      const n44 = parent(hashes[4], hashes[4]);
      assert.strictEqual(parent(parent(n01, n23), parent(n44, n44)), root, 'helper matches the blob tree');
      const tail = Tree.serializeProof(tree.getProof(hashes[0], 0)).slice(1);
      // The same path is a valid 3-leaf proof of n01 — so the count must be the committed one.
      assert.ok(Witness.verifyBlobPath({ merkleRootHex: root, leafHex: n01, index: 0, leafCount: 3, proof: tail }));
      assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: n01, index: 0, leafCount: total, proof: tail }));
      assert.ok(!Witness.verifyBlobPath({ merkleRootHex: root, leafHex: n01, index: 0, leafCount: total, proof: { proof: tail, leafCount: 3 } }));
    });

    it('a forged pin (no Merkle proof) never convicts an honest provider', () => {
      const challenge = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 20, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
      const index = challenge.blobIndex;
      const other = (index + 1) % total;
      const body = Object.assign({}, challenge, { blobHashHex: hashes[other], pinProof: null });
      delete body.pubkey;
      delete body.signature;
      const forged = Witness.signArtifact(body, publisher.priv);
      assert.throws(() => challenger.respond(forged, { blobHashes: hashes, epoch: 20, providerPrivateKey: provider.priv }), /pins another blob hash/);
      const tree = createBlobMerkleTree(hashes);
      const honest = Witness.signArtifact({
        type: Challenge.TYPES.RESPONSE, version: 1, challengeHash: Witness.artifactHash(forged), merkleRootHex: root,
        blobIndex: index, blobHashHex: hashes[index], proof: { proof: Tree.serializeProof(tree.getProof(hashes[index], index)), leafCount: total },
        possessionHex: null, epoch: 20
      }, provider.priv);
      const commitment = commitFor();
      assert.match(new FraudProof({ kind: KINDS.WRONG_LEAF, artifacts: { challenge: forged, commitment, response: honest } }).verify().reason, /no wrong-leaf fraud/);
      // A "pin proof" for the other leaf at its own index does not prove the pin.
      const fakePin = { proof: Tree.serializeProof(tree.getProof(hashes[other], other)), leafCount: total };
      assert.match(new FraudProof({ kind: KINDS.WRONG_LEAF, artifacts: { challenge: forged, commitment, response: honest, pinProof: fakePin } }).verify().reason, /no wrong-leaf fraud/);
    });

    it('a wrong-leaf proof must bind to the provider\'s commitment (root, count, publisher, nonce-derived index)', () => {
      const challenge = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 20, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
      const tree = createBlobMerkleTree(hashes);
      const w = (challenge.blobIndex + 1) % total;
      const cheat = Witness.signArtifact({
        type: Challenge.TYPES.RESPONSE, version: 1, challengeHash: Witness.artifactHash(challenge), merkleRootHex: root,
        blobIndex: w, blobHashHex: hashes[w], proof: { proof: Tree.serializeProof(tree.getProof(hashes[w], w)), leafCount: total }, possessionHex: null, epoch: 20
      }, provider.priv);
      const verdict = (commitment) => new FraudProof({ kind: KINDS.WRONG_LEAF, artifacts: { challenge, commitment, response: cheat } }).verify();
      assert.strictEqual(verdict(commitFor()).ok, true);
      assert.match(verdict(undefined).reason, /AvailabilityCommitment required/);
      assert.match(verdict(commitFor({ blobTotal: total + 1 })).reason, /blobTotal differs/);
      assert.match(verdict(commitFor({ publisherPubkey: stranger.xOnly })).reason, /committed publisher/);
      assert.match(verdict(commitFor({ merkleRootHex: 'ab'.repeat(32) })).reason, /does not cover/);
      // A publisher that picks the index itself (instead of the nonce) proves nothing.
      const body = Object.assign({}, challenge, { blobIndex: w });
      delete body.pubkey;
      delete body.signature;
      const picked = Witness.signArtifact(body, publisher.priv);
      assert.match(new FraudProof({ kind: KINDS.WRONG_LEAF, artifacts: { challenge: picked, commitment: commitFor(), response: cheat } }).verify().reason, /nonce-derived/);
      assert.throws(() => challenger.respond(picked, { blobHashes: hashes, epoch: 20, providerPrivateKey: provider.priv }), /nonce-derived/);
    });
  });

  describe('penalty PSBT shape', function () {
    let deposit;
    let funded;
    let fundedTxid;
    let expect;

    before(() => {
      deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 50000 });
      funded = fundingFor(deposit.address);
      fundedTxid = bitcoin.Transaction.fromHex(funded).getId();
      expect = { deposit: { txid: fundedTxid, vout: 0 }, deadlineHeight: 1000, depositAddress: deposit.address, destinationAddress: dest };
    });

    const mutate = (fn, feeSats = 500) => {
      const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats });
      const psbt = bitcoin.Psbt.fromBase64(penalty.psbtBase64, { network: bitcoin.networks.regtest });
      if (fn) fn(psbt);
      return psbt;
    };

    it('refuses extra inputs, final sequences, timestamp locktimes, foreign outputs, and fat fees', () => {
      assert.strictEqual(Witness.checkPenaltyPsbt(mutate(), expect).ok, true);
      assert.strictEqual(Witness.checkPenaltyPsbt(mutate(), Object.assign({}, expect, { destinationAddress: undefined })).enforceable, false, 'no destination → not enforceable');
      const out = bitcoin.Transaction.fromHex(funded).outs[0];
      assert.match(Witness.checkPenaltyPsbt(mutate((p) => p.addInput({ hash: crypto.randomBytes(32), index: 0, witnessUtxo: { script: out.script, value: 1000n } })), expect).reason, /exactly one input/);
      assert.match(Witness.checkPenaltyPsbt(mutate((p) => p.setInputSequence(0, 0xffffffff)), expect).reason, /final/);
      assert.match(Witness.checkPenaltyPsbt(mutate((p) => p.setLocktime(1700000000)), Object.assign({}, expect, { deadlineHeight: 1700000000 })).reason, /block height/);
      assert.match(Witness.checkPenaltyPsbt(mutate((p) => p.setLocktime(999)), expect).reason, /not the deadline/);
      assert.match(Witness.checkPenaltyPsbt(mutate((p) => p.addOutput({ address: p2wpkh(provider.pub), value: 100n })), expect).reason, /other than/);
      assert.match(Witness.checkPenaltyPsbt(mutate(null, 25000), expect).reason, /exceeds the cap/);
      assert.strictEqual(Witness.checkPenaltyPsbt(mutate(null, 25000), Object.assign({}, expect, { maxFeeSats: 30000 })).ok, true);
      assert.match(Witness.checkPenaltyPsbt(mutate(), Object.assign({}, expect, { deposit: { txid: 'ab'.repeat(32), vout: 0 } })).reason, /challenged deposit outpoint/);
      // The provider's own signer refuses the same shapes before signing.
      const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 25000 });
      assert.throws(() => Bond.signPenaltyAsProvider(deposit, penalty, provider.priv), /exceeds the cap/);
      assert.throws(() => Bond.prepareDepositPenalty(deposit, { fundedTxHex: funded, deadlineHeight: 500000000, destinationAddress: dest }), /block height/);
    });

    it('a deposit\'s withdraw height must clear every round deadline by the margin', () => {
      const short = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 1100, amountSats: 50000 });
      const shortFunded = fundingFor(short.address);
      const preSig = Bond.signPenaltyAsProvider(short, Bond.prepareDepositPenalty(short, { fundedTxHex: shortFunded, deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 }), provider.priv);
      assert.throws(() => new Bond({ network: 'regtest' }).recordRound(0, { deposit: short, penaltyPreSig: preSig, penaltyAddress: dest }), /withdrawAfter 1100/);
      assert.strictEqual(new Bond({ network: 'regtest' }).recordRound(0, { deposit: short, penaltyPreSig: preSig, penaltyAddress: dest, withdrawMarginBlocks: 50 }).resolvable, true);
      const csv = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: { type: 'csv', blocks: 10 }, amountSats: 50000 });
      const csvPreSig = Bond.signPenaltyAsProvider(csv, Bond.prepareDepositPenalty(csv, { fundedTxHex: fundingFor(csv.address), deadlineHeight: 1000, destinationAddress: dest, feeSats: 500 }), provider.priv);
      assert.throws(() => new Bond({ network: 'regtest' }).recordRound(0, { deposit: csv, penaltyPreSig: csvPreSig, penaltyAddress: dest }), /absolute block height/);
      assert.throws(() => challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 1, deadlineHeight: 500000000, deposit: { txid: 'ab'.repeat(32), vout: 0 }, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv }), /block height/);
      const challenge = challenger.issue({ merkleRootHex: root, blobHashes: hashes, epoch: 1, deadlineHeight: 1000, deposit: { txid: 'ab'.repeat(32), vout: 0 }, providerPubkey: provider.xOnly, publisherPrivateKey: publisher.priv });
      assert.strictEqual(challenger.validate(challenge, null, { tipHeight: 1003 }).fraud, null, 'six blocks by default');
      assert.strictEqual(challenger.validate(challenge, null, { tipHeight: 1003, minConfirmations: 3 }).fraud, KINDS.NON_RESPONSE);
    });
  });

  describe('bad-key (sealed blobs)', function () {
    it('convicts a seller whose payment preimage does not decrypt the delivered ciphertext', () => {
      const sealed = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048, documentId: 'bk' });
      const blob = sealed.blob(0);
      const ct = sealed.bytesFor(0);
      const key = sealed.keyFor(0);
      assert.strictEqual(sha256Hex(Buffer.from(key, 'hex')), sealed.paymentHashFor(0));
      const proofWith = (preimageHex, extraOffer = {}) => {
        const paymentHashHex = sha256Hex(Buffer.from(preimageHex, 'hex'));
        const offer = Witness.signArtifact(Object.assign({ type: 'DocumentOffer', documentId: 'bk', merkleRootHex: sealed.merkleRootHex, blobIndex: 0, blobHashHex: blob.blobHashHex, paymentHashHex, sealed: true, iv: blob.iv }, extraOffer), provider.priv);
        const frameHex = signedFrame({ name: 'bk', body: ct.toString('base64'), blobIndex: 0, blobTotal: sealed.blobTotal, blobHashHex: blob.blobHashHex, merkleRootHex: sealed.merkleRootHex, paymentHashHex, sealed: true }, provider.priv);
        return new FraudProof({ kind: KINDS.BAD_KEY, artifacts: { offer, claim: { preimageHex }, delivery: { frameHex } } });
      };
      assert.match(proofWith(key).verify().reason, /no bad-key fraud/);
      const bad = proofWith(crypto.randomBytes(32).toString('hex')).verify();
      assert.strictEqual(bad.ok, true);
      assert.strictEqual(bad.offender, provider.xOnly);
      assert.strictEqual(bad.evidence, 'aes-gcm');
      assert.match(proofWith(crypto.randomBytes(32).toString('hex'), { sealed: false }).verify().reason, /sealed offer/);
      assert.match(proofWith(crypto.randomBytes(32).toString('hex'), { iv: 'AAAA' }).verify().reason, /12-byte IV/);
      // Wrong bytes are wrong-bytes, not bad-key.
      const wb = proofWith(key, { blobHashHex: 'cd'.repeat(32) }).verify();
      assert.match(wb.reason, /that is wrong-bytes/);
    });
  });

  describe('stale-commitment', function () {
    const channelKey = keypair();
    const n = secp256k1.Point.CURVE().n;
    const pointOf = (secret) => secp256k1.Point.BASE.multiply(BigInt(`0x${secret}`) % n).toHex(true);

    function staleTx () {
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(crypto.randomBytes(32), 0);
      tx.addOutput(bitcoin.address.toOutputScript(dest, bitcoin.networks.regtest), 40000n);
      return tx;
    }

    function revokeFor (tx, opts = {}) {
      const secret = opts.secret || crypto.randomBytes(32).toString('hex');
      return Witness.signArtifact(Object.assign({
        type: 'ChannelRevoke', channelId: 'ch-1', number: 3, commitmentTxid: tx.getId(),
        perCommitmentSecret: secret, perCommitmentPoint: pointOf(secret)
      }, opts.override || {}), opts.priv || channelKey.priv);
    }

    it('needs the secret to open the committed point, the right channel, and confirmed broadcast', () => {
      const tx = staleTx();
      const proof = (revoke, claim = {}, inclusion) => new FraudProof({ kind: KINDS.STALE_COMMITMENT, artifacts: { revoke, staleTxHex: tx.toHex(), inclusion }, claim });
      const revoke = revokeFor(tx);
      assert.strictEqual(proof(revoke).verify({ txConfirmations: () => 6 }).offender, channelKey.xOnly);
      assert.match(proof(revoke).verify({ txConfirmations: () => 5 }).reason, /5 of 6/);
      assert.match(proof(revoke).verify().reason, /broadcast evidence/);
      assert.match(proof(revokeFor(tx, { override: { perCommitmentPoint: pointOf(crypto.randomBytes(32).toString('hex')) } })).verify({ txConfirmations: () => 6 }).reason, /does not open/);
      assert.match(proof(revokeFor(tx, { override: { channelId: '' } })).verify({ txConfirmations: () => 6 }).reason, /no channelId/);
      assert.match(proof(revoke, { channelId: 'ch-2' }).verify({ txConfirmations: () => 6 }).reason, /another channel/);
      assert.match(proof(revoke).verify({ txConfirmations: () => 6, channelId: 'ch-2' }).reason, /another channel/);
      assert.deepStrictEqual(proof(revoke).evidenceIds(), [`stale-tx:${tx.getId()}`]);

      // Inclusion artifacts count only from a known, deep-enough block with a pinned tx count.
      const txids = [crypto.randomBytes(32).toString('hex'), tx.getId(), crypto.randomBytes(32).toString('hex')];
      const headerHex = headerFor(txids);
      const inclusion = buildInclusion({ blockHeaderHex: headerHex, txids, txid: tx.getId() });
      const chain = (over = {}) => Object.assign({ headerKnown: () => true, confirmations: () => 6, txCount: () => 3 }, over);
      assert.strictEqual(proof(revoke, {}, inclusion).verify(chain()).ok, true);
      assert.match(proof(revoke, {}, inclusion).verify(chain({ confirmations: () => 2 })).reason, /2 of 6/);
      assert.match(proof(revoke, {}, inclusion).verify(chain({ confirmations: undefined })).reason, /ctx.confirmations/);
      assert.match(proof(revoke, {}, inclusion).verify(chain({ headerKnown: () => false })).reason, /header chain/);
      assert.match(proof(revoke, {}, inclusion).verify(chain({ txCount: () => 9 })).reason, /txCount|depth/);
      assert.match(proof(revoke, {}, Object.assign({}, inclusion, { txCount: undefined })).verify(chain({ txCount: undefined })).reason, /txCount required/);
    });
  });

  describe('Contract.Resolutions signature hygiene', function () {
    let deposit;
    let base64;

    before(() => {
      deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: publisher.pub, withdrawAfter: 2000, amountSats: 30000 });
      base64 = Bond.prepareDepositPenalty(deposit, { fundedTxHex: fundingFor(deposit.address, 30000n), deadlineHeight: 1200, destinationAddress: dest, feeSats: 500 }).psbtBase64;
    });

    it('refuses forged signatures embedded in an exit PSBT and drops them on import', () => {
      const psbt = bitcoin.Psbt.fromBase64(base64, { network: bitcoin.networks.regtest });
      psbt.signInput(0, signerFromPriv32(provider.priv));
      const r = new Resolutions({ network: 'regtest' });
      r.addExit('genesis', { id: 'p', kind: 'penalty', psbtBase64: psbt.toBase64(), required: [publisher.pub, provider.pub] });
      assert.ok(r.getExit('genesis', 'p').signers.have[provider.xOnly], 'a valid embedded signature is harvested');

      const forged = bitcoin.Psbt.fromBase64(psbt.toBase64(), { network: bitcoin.networks.regtest });
      const sig = Buffer.from(forged.data.inputs[0].tapScriptSig[0].signature);
      sig[0] ^= 1;
      forged.data.inputs[0].tapScriptSig[0].signature = sig;
      assert.throws(() => new Resolutions({ network: 'regtest' }).addExit('genesis', { id: 'p', kind: 'penalty', psbtBase64: forged.toBase64(), required: [publisher.pub, provider.pub] }), /does not verify/);

      const clean = new Resolutions({ network: 'regtest' });
      clean.addExit('genesis', { id: 'p', kind: 'penalty', psbtBase64: base64, required: [publisher.pub, provider.pub] });
      clean.signExit('genesis', 'p', provider.priv);
      clean.signExit('genesis', 'p', publisher.priv);
      assert.ok(clean.resolvable('genesis'));
      const good = clean.getExit('genesis', 'p').signers.have[provider.xOnly];
      const bad = good.slice(0, -2) + (good.endsWith('00') ? '01' : '00');
      const snap = JSON.parse(JSON.stringify(clean.export()).split(good).join(bad));
      const back = new Resolutions({ network: 'regtest' }).import(snap);
      assert.ok(!back.getExit('genesis', 'p').signers.have[provider.xOnly], 'forged signature dropped');
      assert.ok(!back.resolvable('genesis'), 'resolvable reflects verified signatures only');
    });
  });

  describe('DocumentBook hardening', function () {
    it('caps providers (LRU over unpenalized) and offers', () => {
      const book = new DocumentBook({ maxProviders: 3, maxOffers: 2 });
      book.recordDelivery('a', { ok: true });
      book.recordDelivery('b', { ok: true });
      book.recordDelivery('c', { ok: true });
      book.recordPenalty('a', { kind: 'wrong-leaf' });
      book._providers.get('a').updatedAt = 0;
      book._providers.get('b').updatedAt = 1;
      book.recordDelivery('d', { ok: true });
      assert.ok(book.providerStats('a'), 'penalized providers are never evicted');
      assert.strictEqual(book.providerStats('b'), null, 'least recently updated unpenalized provider evicted');
      const full = new DocumentBook({ maxProviders: 1 });
      full.recordPenalty('x', { kind: 'wrong-leaf' });
      assert.strictEqual(full.recordDelivery('y', { ok: true }), null, 'no room without dropping a penalty');
      for (const id of ['d1', 'd2', 'd3']) book.ingestInventoryResponse({ origin: 'a', items: [{ documentId: id, blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      assert.deepStrictEqual(book.listOffers().map((o) => o.documentId), ['d2', 'd3']);
    });

    it('scores inventory-only sellers below neutral; key penalties stick across seller ids and forgetSeller', () => {
      const seller = keypair();
      const book = new DocumentBook();
      book.ingestInventoryResponse({ origin: 'fresh', latencyMs: 5, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      assert.strictEqual(book.scoreFor('fresh'), DocumentBook.SCORE_INVENTORY_ONLY);
      assert.ok(DocumentBook.SCORE_INVENTORY_ONLY < 500);
      book.ingestInventoryResponse({ origin: 'seller-a', latencyMs: 5, signerPubkeyHex: seller.pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      const proof = wrongBytesProof(seller);
      assert.deepStrictEqual(book.ingestFraudProof(proof.toBody()).penalized, ['seller-a']);
      assert.strictEqual(book.scoreFor('seller-a'), 0);
      book.forgetSeller('seller-a');
      book.ingestInventoryResponse({ origin: 'seller-a2', latencyMs: 5, signerPubkeyHex: seller.xOnly, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      assert.strictEqual(book.scoreFor('seller-a2'), 0, 'a new seller id under the penalized key inherits the penalty');
      assert.strictEqual(book.providerStats('seller-a2').penalties, 1);
      // Re-wrapping the same evidence (new claim fields, re-serialized) is a duplicate.
      const rewrapped = proof.toBody();
      rewrapped.claim = { note: 'again' };
      assert.strictEqual(book.ingestFraudProof(rewrapped).duplicate, true);
      assert.strictEqual(book.keyPenalties(seller.pub), 1);
    });

    it('a verdict that names no offender (non-reputational) penalizes nobody', () => {
      class Unattributed extends FraudProof {
        verify () { return { ok: true, offender: provider.xOnly, reputational: false, reason: 'timelock only' }; }
      }
      const book = new DocumentBook();
      book.ingestInventoryResponse({ origin: 'p', latencyMs: 5, signerPubkeyHex: provider.pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      const res = book.ingestFraudProof(new Unattributed({ kind: KINDS.NON_RESPONSE, artifacts: {} }));
      assert.strictEqual(res.ok, false);
      assert.deepStrictEqual(res.penalized, []);
      assert.strictEqual(book.keyPenalties(provider.pub), 0);
    });

    it('rejects items whose inline blob leaves do not build merkleRootHex', () => {
      const H = (c) => String(c).repeat(32);
      const blobs = [
        { index: 0, total: 2, blobHashHex: H('c0'), rateSats: 5, contentHash: H('d0') },
        { index: 1, total: 2, blobHashHex: H('c1'), rateSats: 5, contentHash: H('d1') }
      ];
      const book = new DocumentBook();
      assert.strictEqual(book.ingestInventoryResponse({ origin: 'liar', items: [{ id: 'doc', merkleRootHex: H('ee'), blobs }] }).length, 0);
      const good = book.ingestInventoryResponse({ origin: 'honest', items: [{ id: 'doc', merkleRootHex: documentMerkleRootHex(blobs.map((b) => ({ blobHashHex: b.blobHashHex, paymentHashHex: b.contentHash }))), blobs }] });
      assert.deepStrictEqual(good.map((r) => r.rootVerified), [true, true]);
      // A real sealed document: swapping one blob's payment hash breaks the root.
      const real = Document.seal(crypto.randomBytes(5000), { chunkBytes: 2048 });
      const item = real.inventoryItem({ rateSats: 1000, documentId: 'sealed' });
      assert.strictEqual(book.ingestInventoryResponse({ origin: 'sealed', items: [item] }).length, real.blobTotal);
      const swapped = JSON.parse(JSON.stringify(item));
      swapped.blobs[0].contentHash = swapped.blobs[0].contentHashHex = H('ab');
      assert.strictEqual(book.ingestInventoryResponse({ origin: 'sealed-liar', items: [swapped] }).length, 0);
      // The leaf check is swappable.
      const calls = [];
      const hooked = new DocumentBook({ verifyOfferLeaves: (opts) => { calls.push(opts); return false; } });
      assert.strictEqual(hooked.ingestInventoryResponse({ origin: 'x', items: [{ id: 'doc', merkleRootHex: H('ee'), blobs }] }).length, 0);
      assert.strictEqual(calls[0].blobTotal, 2);
      assert.strictEqual(calls[0].merkleRootHex, H('ee'));
    });

    it('telemetry: canonical hash, idempotent max-merge, penalties never reduced, foreign records refused', () => {
      const seller = keypair();
      const a = new DocumentBook({ nodeId: 'me' });
      a.recordDelivery('x', { ok: true, bytes: 10 });
      a.recordPenalty('x', { kind: 'wrong-leaf' });
      a.ingestInventoryResponse({ origin: 's', latencyMs: 5, signerPubkeyHex: seller.pub, items: [{ documentId: 'd', blobHashHex: 'aa'.repeat(32), rateSats: 1 }] });
      const proof = wrongBytesProof(seller);
      a.ingestFraudProof(proof.toBody());
      const rec = JSON.parse(JSON.stringify(a.exportTelemetry()));

      const b = new DocumentBook({ nodeId: 'me' });
      for (let i = 0; i < 5; i++) b.recordPenalty('x', { kind: 'wrong-bytes' });
      assert.strictEqual(b.importTelemetry(rec), 2);
      assert.strictEqual(b.importTelemetry(rec), 2);
      assert.strictEqual(b.providerStats('x').deliveries, 1, 're-import does not add');
      assert.strictEqual(b._providers.get('x').penalties, 5, 'an older record never lowers penalties');
      assert.strictEqual(b.keyPenalties(seller.pub), 1);
      assert.strictEqual(b.ingestFraudProof(proof.toBody()).duplicate, true, 'evidence ids survive export/import');

      const tampered = JSON.parse(JSON.stringify(rec));
      tampered.providers[0].deliveries = 1e6;
      assert.strictEqual(new DocumentBook({ nodeId: 'me' }).importTelemetry(tampered), 0);
      const negative = JSON.parse(JSON.stringify(rec));
      delete negative.hash;
      assert.strictEqual(new DocumentBook().importTelemetry(negative), 0, 'unhashed records are refused');
      assert.strictEqual(new DocumentBook({ nodeId: 'them' }).importTelemetry(rec), 0);
      assert.strictEqual(new DocumentBook({ nodeId: 'them' }).importTelemetry(rec, { allowForeign: true }), 2);
    });
  });
});
