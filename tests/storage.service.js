'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const { secp256k1, schnorr } = require('@noble/curves/secp256k1.js');

const Storage = require('../services/storage');
const { CliDocumentExchange } = require('../functions/cliDocumentExchange');
const Challenge = require('../types/challenge');
const Document = require('../types/document');
const Peer = require('../types/peer');
const Message = require('../types/message');
const { HTLC_MINIMUM_SATS } = require('../constants');

function keypair () {
  const priv = crypto.randomBytes(32);
  return {
    priv,
    pub: Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex'),
    xOnly: Buffer.from(schnorr.getPublicKey(priv)).toString('hex')
  };
}

function fundingFor (address, sats = 50000n) {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(crypto.randomBytes(32), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.regtest), sats);
  return tx.toHex();
}

describe('services/storage', function () {
  this.timeout(20000);

  const publisher = keypair();
  const provider = keypair();
  const doc = Document.seal(crypto.randomBytes(6000), { chunkBytes: 2048 });
  const hashes = doc.record().blobs.map((b) => b.blobHashHex);

  it('publishes a challenge-tree root, not the sale-tree root', function () {
    const contract = Storage.publish({
      blobHashes: hashes,
      documentId: 'doc-1',
      amountSats: 10000,
      publisherPubkey: publisher.pub
    });
    assert.strictEqual(contract.type, 'StorageContract');
    assert.strictEqual(contract.tree, 'blob-hash');
    assert.strictEqual(contract.merkleRootHex, Challenge.createBlobMerkleTree(hashes).rootHex);
    assert.notStrictEqual(contract.merkleRootHex, doc.merkleRootHex);
    assert.throws(
      () => Storage.publish({ blobHashes: hashes, merkleRootHex: doc.merkleRootHex }),
      /challenge tree/
    );
  });

  it('refuses a mainnet bounty and deposit', function () {
    assert.throws(() => Storage.buildBounty({
      network: 'mainnet',
      publisherPubkey: publisher.pub,
      providerPubkeys: [provider.pub],
      seed: crypto.randomBytes(32),
      epochs: [{ epoch: 1, amountSats: 20000 }],
      refundAfter: 800
    }), /mainnet|Bond/);
    assert.throws(() => Storage.buildDeposit({
      network: 'mainnet',
      providerPubkey: provider.pub,
      publisherPubkey: publisher.pub,
      withdrawAfter: 2000
    }), /mainnet|Bond/);
  });

  it('a publisher challenge and a timely answer', function () {
    const storage = new Storage({ network: 'regtest' });
    const contract = storage.register(Storage.publish({ blobHashes: hashes, documentId: 'd' }), 'c1');
    storage.commit({
      merkleRootHex: contract.merkleRootHex,
      blobTotal: contract.blobTotal,
      fromEpoch: 0,
      untilEpoch: 100,
      publisherPubkey: publisher.xOnly,
      providerPrivateKey: provider.priv
    });
    const challenge = storage.challenge({
      contractId: 'c1',
      epoch: 5,
      providerPubkey: provider.xOnly,
      publisherPrivateKey: publisher.priv
    });
    assert.strictEqual(challenge.epoch, 5);
    assert.strictEqual(challenge.merkleRootHex, contract.merkleRootHex);
    const response = new Challenge().respond(challenge, {
      blobHashes: hashes,
      bytes: doc.bytesFor(challenge.blobIndex),
      epoch: 6,
      providerPrivateKey: provider.priv
    });
    const verdict = storage.respond(response, { bytes: doc.bytesFor(challenge.blobIndex) });
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.fraud, null);
  });

  it('a late answer becomes a non-response penalty only when the chain view is present', function () {
    const storage = new Storage({ network: 'regtest' });
    const contract = storage.register(Storage.publish({ blobHashes: hashes }), 'c1');
    const deposit = Storage.buildDeposit({
      network: 'regtest',
      providerPubkey: provider.pub,
      publisherPubkey: publisher.pub,
      withdrawAfter: 2000,
      amountSats: 30000,
      merkleRootHex: contract.merkleRootHex
    });
    const fundedTxHex = fundingFor(deposit.address);
    const fundedTxid = bitcoin.Transaction.fromHex(fundedTxHex).getId();
    const commitment = storage.commit({
      merkleRootHex: contract.merkleRootHex,
      blobTotal: contract.blobTotal,
      fromEpoch: 0,
      untilEpoch: 100,
      publisherPubkey: publisher.xOnly,
      providerPrivateKey: provider.priv,
      depositAddress: deposit.address,
      depositTxid: fundedTxid
    });
    const challenge = storage.challenge({
      contractId: 'c1',
      epoch: 10,
      providerPubkey: provider.xOnly,
      publisherPrivateKey: publisher.priv,
      deposit: { txid: fundedTxid, vout: 0 }
    });
    const late = new Challenge().respond(challenge, {
      blobHashes: hashes,
      epoch: 40,
      allowLate: true,
      providerPrivateKey: provider.priv
    });
    const anchor = Challenge.receipt({ challenge, epoch: 10, privateKey: provider.priv });
    const dest = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(publisher.pub, 'hex'),
      network: bitcoin.networks.regtest
    }).address;

    assert.throws(
      () => storage.penalizeLateResponse({
        challenge, response: late, commitment, anchor, deposit, fundedTxHex, destinationAddress: dest
      }),
      /chain view required/
    );
    assert.deepStrictEqual(storage.sweep({ epoch: 40, tipHeight: 1000 }), {
      ok: false,
      failClosed: true,
      late: 0,
      error: 'chain view required: outpointUnspent, txConfirmed, headerKnown'
    });

    const armed = new Storage({
      network: 'regtest',
      outpointUnspent: () => true,
      txConfirmed: () => true,
      headerKnown: () => true
    });
    const penalty = armed.penalizeLateResponse({
      challenge,
      response: late,
      commitment,
      anchor,
      deposit,
      fundedTxHex,
      destinationAddress: dest,
      feeSats: 500
    });
    assert.strictEqual(penalty.proof.kind, 'non-response');
    assert.strictEqual(penalty.penalty.leafId, 'penalty');
    assert.strictEqual(penalty.penalty.offender, provider.xOnly);
    assert.strictEqual(armed.sweep({ epoch: 40, tipHeight: 1000 }).ok, true);
  });

  it('a peer sells one chunk with no Hub process', function () {
    const seller = new Peer({ listen: false, sealPricedDocuments: true });
    const plain = crypto.randomBytes(100);
    const sealed = Document.seal(plain, { chunkBytes: 2048 });
    const pub = seller.publishSealedDocument(sealed, { rateSats: HTLC_MINIMUM_SATS });
    assert.strictEqual(pub.ok, true, pub.error);
    const written = [];
    seller.connections.buyer = { _writeFabric: (buf) => written.push(buf) };
    assert.ok(seller._sendP2pFileSendToPeer(pub.documentId, 'buyer', {
      revealKey: false,
      settlementId: 's'
    }));
    const sends = written.map((buf) => Message.fromBuffer(buf)).filter((m) => m.type === 'P2P_FILE_SEND');
    assert.ok(sends.length >= 1);
    const parsed = Message.tryParseLegacyBody(sends[0]);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.value.sealed, true);
    assert.ok(parsed.value.body);
  });

  it('document-exchange CLI commit and sweep verbs call the storage service', async function () {
    const ex = new CliDocumentExchange({});
    const missing = ex.storageCommit(['commit']);
    assert.strictEqual(missing.ok, false);
    const committed = ex.storageCommit(['commit', 'c1', hashes[0]]);
    assert.strictEqual(committed.ok, true);
    assert.strictEqual(committed.contract.tree, 'blob-hash');
    const sweep = ex.storageSweep(['sweep', '1', '10']);
    assert.strictEqual(sweep.ok, false);
    assert.match(sweep.error, /chain view required/);

    const calls = [];
    const wired = new CliDocumentExchange({
      getBitcoin () {
        return {
          _makeRPCRequest (method, params) {
            calls.push([method, params]);
            if (method === 'gettxout') return { value: 1 };
            if (method === 'getrawtransaction') return { confirmations: 2 };
            if (method === 'getblockheader') return { confirmations: 2 };
            return null;
          }
        };
      }
    });
    const storage = wired.storage();
    assert.strictEqual(await storage._outpointUnspent('aa'.repeat(32), 0), true);
    assert.strictEqual(calls[0][0], 'gettxout');
    assert.strictEqual(wired.storageSweep(['sweep']).ok, true);
    const CLI = require('../types/cli');
    const recalled = CLI.redactHistoryInput('/challenge c1 aa SECRET 4').split(/\s+/);
    assert.strictEqual(recalled[3], '***');
    assert.strictEqual(CLI.redactHistoryInput('/respond HASH SECRET 4 ff').split(/\s+/)[2], '***');
  });

  it('a rejected response does not close the challenge', function () {
    const storage = new Storage({
      network: 'regtest',
      outpointUnspent: () => true,
      txConfirmed: () => true,
      headerKnown: () => true
    });
    const contract = storage.register(Storage.publish({ blobHashes: hashes }), 'c1');
    const challenge = storage.challenge({
      contractId: 'c1',
      epoch: 10,
      providerPubkey: provider.xOnly,
      publisherPrivateKey: publisher.priv
    });
    const late = new Challenge().respond(challenge, {
      blobHashes: hashes,
      epoch: 40,
      allowLate: true,
      providerPrivateKey: provider.priv
    });
    const verdict = storage.respond(late, { epoch: 40 });
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(storage.sweep({ epoch: 40, tipHeight: 1000 }).late, 1);
    const honest = new Challenge().respond(challenge, {
      blobHashes: hashes,
      bytes: doc.bytesFor(challenge.blobIndex),
      epoch: 11,
      providerPrivateKey: provider.priv
    });
    assert.strictEqual(storage.respond(honest, { bytes: doc.bytesFor(challenge.blobIndex) }).ok, true);
    void contract;
  });
});
