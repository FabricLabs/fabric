'use strict';

/**
 * Helpers for ARC / Federation mesh + L1 withdrawal E2E.
 * @private
 */

const bitcoin = require('bitcoinjs-lib');
const { Psbt } = bitcoin;
const ecc = require('../../types/ecc');
const Actor = require('../../types/actor');
const Key = require('../../types/key');
const Message = require('../../types/message');
const {
  CONTRACT_BODY_TYPES
} = require('../../functions/applicationNamespaces');
const {
  pubkeyXOnly
} = require('../../functions/groupChatSeal');
const {
  finalizeSpendPsbt
} = require('../../functions/contractTaproot');
const {
  createCollection,
  ingest
} = require('../../functions/fabricMessageCollection');

bitcoin.initEccLib(ecc);

const ARC_MESSAGE_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.GroupChat,
  CONTRACT_BODY_TYPES.GroupChange,
  CONTRACT_BODY_TYPES.GroupChangeProposal,
  CONTRACT_BODY_TYPES.GroupChangeVote,
  CONTRACT_BODY_TYPES.FederationContractInvite,
  CONTRACT_BODY_TYPES.FederationContractInviteResponse,
  CONTRACT_BODY_TYPES.ContractCapabilityGrant,
  CONTRACT_BODY_TYPES.ContractWithdrawalRequest,
  CONTRACT_BODY_TYPES.ContractWithdrawalWitness,
  CONTRACT_BODY_TYPES.GroupJournalRequest,
  CONTRACT_BODY_TYPES.GroupJournalBatch,
  CONTRACT_BODY_TYPES.GroupStateJournal
]);

function e2eRegtestEnabled () {
  const v = process.env.FABRIC_E2E_REGTEST;
  return v === '1' || v === 'true';
}

function privateKey32 (key) {
  const raw = key && key.private;
  if (Buffer.isBuffer(raw) && raw.length === 32) return raw;
  if (raw instanceof Uint8Array && raw.length === 32) return Buffer.from(raw);
  if (typeof raw === 'string' && /^[0-9a-f]+$/i.test(raw) && raw.length === 64) {
    return Buffer.from(raw, 'hex');
  }
  throw new Error('privateKey32: expected 32-byte key.private');
}

function schnorrSignerFromKey (key) {
  const priv = privateKey32(key);
  const publicKey = Buffer.from(ecc.pointFromScalar(priv, true));
  return {
    publicKey,
    sign (hash) { return Buffer.from(ecc.sign(hash, priv)); },
    signSchnorr (hash) { return Buffer.from(ecc.signSchnorr(hash, priv)); }
  };
}

function signSpendPsbt (psbtBase64, keys) {
  const psbt = Psbt.fromBase64(String(psbtBase64 || '').trim());
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    psbt.signInput(0, schnorrSignerFromKey(key));
  }
  return finalizeSpendPsbt({ psbt });
}

function syntheticFundedTxHex (outputScript, valueSats = 100000) {
  const fund = new bitcoin.Transaction();
  fund.version = 2;
  fund.addInput(Buffer.alloc(32), 0);
  const script = Buffer.isBuffer(outputScript)
    ? outputScript
    : Buffer.from(outputScript);
  const value = typeof valueSats === 'bigint' ? valueSats : BigInt(valueSats);
  fund.addOutput(script, value);
  return fund.toHex();
}

function p2wpkhAddress (pubkeyHex, networkName = 'regtest') {
  const network = networkName === 'regtest'
    ? bitcoin.networks.regtest
    : bitcoin.networks.bitcoin;
  const pk = Buffer.from(String(pubkeyHex).trim().replace(/^0x/i, ''), 'hex');
  return bitcoin.payments.p2wpkh({ pubkey: pk, network }).address;
}

function compressedPubkey (key) {
  return String(key.pubkey || '').toLowerCase();
}

function arcDefinition (opts = {}) {
  const signers = (opts.signers || []).map((s) => {
    if (s && s.pubkey) return compressedPubkey(s);
    return String(s).toLowerCase();
  });
  const publisher = opts.publisher
    ? (opts.publisher.pubkey ? compressedPubkey(opts.publisher) : String(opts.publisher).toLowerCase())
    : signers[0];
  const threshold = opts.threshold != null ? Number(opts.threshold) : Math.max(1, signers.length);
  const csvBlocks = opts.csvBlocks != null ? Number(opts.csvBlocks) : 144;
  const network = opts.network || 'regtest';
  const def = {
    '@type': 'FabricContract',
    name: opts.name || 'arc-e2e',
    interfaces: Array.isArray(opts.interfaces) ? opts.interfaces : ['arc.core'],
    primitives: {
      messageTypes: (opts.messageTypes || ARC_MESSAGE_TYPES).slice(),
      opcodes: Array.isArray(opts.opcodes) ? opts.opcodes.slice() : []
    },
    members: {
      signers: signers.slice(),
      readers: opts.readers || ['*'],
      threshold
    },
    spendPolicy: Object.assign({
      network,
      publisher,
      validators: signers.slice(),
      threshold,
      csvBlocks,
      softMode: opts.softMode || 'publisher'
    }, opts.internalKeyMode ? { internalKeyMode: opts.internalKeyMode } : {}),
    bitcoinAnchor: opts.bitcoinAnchor || {
      blockHash: opts.blockHash || 'ab'.repeat(32),
      height: opts.height != null ? Number(opts.height) : 1
    }
  };
  if (opts.parentContract || opts.parentContractId) {
    def.parentContract = String(opts.parentContract || opts.parentContractId);
    def.parentContractId = def.parentContract;
  }
  if (opts.hashlock) def.spendPolicy.hashlock = opts.hashlock;
  if (opts.extraLeaves) def.spendPolicy.extraLeaves = opts.extraLeaves;
  if (opts.requireProgramRun) def.spendPolicy.requireProgramRun = true;
  return def;
}

function contractIdOf (definition) {
  return new Actor(definition).id;
}

function signPublish (key, definition) {
  return Message.fromVector(['CONTRACT_PUBLISH', JSON.stringify(definition)]).signWithKey(key);
}

function signContractMessage (key, contractId, type, object) {
  return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
    contract: contractId,
    type,
    object
  })]).signWithKey(key);
}

function attachCollector (peer) {
  const collection = createCollection();
  const orig = peer._handleFabricMessage.bind(peer);
  peer._handleFabricMessage = function (buffer, origin, socket) {
    ingest(collection, buffer, {
      origin: origin && origin.name ? String(origin.name) : 'peer'
    });
    return orig(buffer, origin, socket);
  };
  return collection;
}

function appHashes (collection) {
  return (collection.messages || [])
    .filter((row) => row.type === 'CONTRACT_PUBLISH' || row.type === 'CONTRACT_MESSAGE')
    .map((row) => row.hash)
    .sort();
}

function keysNamed (count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(new Key());
  return out;
}

module.exports = {
  ARC_MESSAGE_TYPES,
  e2eRegtestEnabled,
  privateKey32,
  schnorrSignerFromKey,
  signSpendPsbt,
  syntheticFundedTxHex,
  p2wpkhAddress,
  compressedPubkey,
  pubkeyXOnly,
  arcDefinition,
  contractIdOf,
  signPublish,
  signContractMessage,
  attachCollector,
  appHashes,
  keysNamed
};
