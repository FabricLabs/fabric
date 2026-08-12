'use strict';

/**
 * ARC tip → P2TR spend resolution and tip-bound withdrawal bodies.
 *
 * @module functions/contractSpend
 * @see docs/ARC.md
 */

const crypto = require('crypto');
const Key = require('../types/key');
const {
  buildContractTaproot,
  synthesizeDefaultLadder,
  prepareVaultWithdrawalPsbt,
  prepareDecayMigrationPsbt
} = require('./contractTaproot');
const { pubkeyXOnly, pubkeyCompressed } = require('./groupChatSeal');
const { CONTRACT_BODY_TYPES } = require('./applicationNamespaces');
const {
  programMetaFromTip,
  requiresProgramBind,
  validateProgramRunBinding,
  bindProgramRunToTip
} = require('./contractProgramBind');

const WITHDRAWAL_REQUEST = CONTRACT_BODY_TYPES.ContractWithdrawalRequest;
const WITHDRAWAL_WITNESS = CONTRACT_BODY_TYPES.ContractWithdrawalWitness;

function _canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(_canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${_canonicalStringify(value[k])}`).join(',')}}`;
}

function sha256hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/**
 * Lift pubkeys to compressed hex for Taproot policy builders.
 * Prefer genesis compressed forms when tip members are the same x-only set
 * (avoids 02/03 parity drift breaking address unity with Hub vault).
 * @param {Iterable<*>} tipList
 * @param {Iterable<*>} [genesisList]
 * @returns {string[]}
 */
function toCompressedPubkeys (list, genesisList = null) {
  const tip = [];
  const seen = new Set();
  for (const raw of list || []) {
    let c = null;
    try {
      c = pubkeyCompressed(raw);
    } catch (_) {
      const x = pubkeyXOnly(raw);
      if (x) c = `02${x}`;
    }
    if (!c || seen.has(c)) continue;
    seen.add(c);
    tip.push(c);
  }
  tip.sort((a, b) => Buffer.from(a, 'hex').compare(Buffer.from(b, 'hex')));

  if (!genesisList) return tip;
  const genesis = [];
  const gSeen = new Set();
  for (const raw of genesisList || []) {
    let c = null;
    try {
      c = pubkeyCompressed(raw);
    } catch (_) {
      const x = pubkeyXOnly(raw);
      if (x) c = `02${x}`;
    }
    if (!c || gSeen.has(c)) continue;
    gSeen.add(c);
    genesis.push(c);
  }
  genesis.sort((a, b) => Buffer.from(a, 'hex').compare(Buffer.from(b, 'hex')));

  const tipX = tip.map((c) => pubkeyXOnly(c)).filter(Boolean).sort();
  const genX = genesis.map((c) => pubkeyXOnly(c)).filter(Boolean).sort();
  if (tipX.length && tipX.length === genX.length && tipX.every((x, i) => x === genX[i])) {
    return genesis;
  }
  return tip;
}

/**
 * Normalize a CONTRACT_PUBLISH definition (or Hub-stored genesis) into ARC fields.
 * Accepts legacy shapes: `messageTypes`, `proposedPolicy.validators`, etc.
 *
 * @param {object} definition
 * @returns {object}
 */
function normalizeArcGenesis (definition = {}) {
  const def = definition && typeof definition === 'object' ? definition : {};
  const membersBag = def.members && typeof def.members === 'object' ? def.members : {};
  const proposed = def.proposedPolicy && typeof def.proposedPolicy === 'object'
    ? def.proposedPolicy
    : {};
  const spendIn = def.spendPolicy && typeof def.spendPolicy === 'object' ? def.spendPolicy : {};

  const signers = toCompressedPubkeys(
    membersBag.signers
      || def.signers
      || spendIn.validators
      || proposed.validators
      || def.validators
      || []
  );
  const readersRaw = membersBag.readers || def.readers || [];
  const readers = readersRaw.includes('*')
    ? ['*']
    : toCompressedPubkeys(readersRaw);

  const threshold = Number(
    membersBag.threshold != null ? membersBag.threshold
      : (def.threshold != null ? def.threshold
        : (proposed.threshold != null ? proposed.threshold
          : (spendIn.threshold != null ? spendIn.threshold : 1)))
  ) || 1;

  const messageTypes = (def.primitives && Array.isArray(def.primitives.messageTypes))
    ? def.primitives.messageTypes.map(String)
    : (Array.isArray(def.messageTypes) ? def.messageTypes.map(String) : []);
  const opcodes = (def.primitives && Array.isArray(def.primitives.opcodes))
    ? def.primitives.opcodes.map(String)
    : [];

  const publisher = spendIn.publisher
    || def.publisher
    || def.creator
    || (signers[0] || null);

  const networkRaw = spendIn.network || def.network || null;
  const network = networkRaw ? String(networkRaw).trim().toLowerCase() : null;
  // csvBlocks is canonical; depositMaturityBlocks is a deposit-UX alias only.
  const csvBlocks = spendIn.csvBlocks != null
    ? Number(spendIn.csvBlocks)
    : (def.csvBlocks != null
      ? Number(def.csvBlocks)
      : (spendIn.depositMaturityBlocks != null
        ? Number(spendIn.depositMaturityBlocks)
        : (def.depositMaturityBlocks != null ? Number(def.depositMaturityBlocks) : undefined)));

  const softModeRaw = spendIn.softMode || def.softMode || proposed.softMode || null;
  const softMode = softModeRaw
    ? (String(softModeRaw).toLowerCase() === 'reduced' ? 'reduced' : 'publisher')
    : undefined;
  const softThreshold = spendIn.softThreshold != null
    ? Number(spendIn.softThreshold)
    : (def.softThreshold != null ? Number(def.softThreshold) : undefined);

  const spendPolicy = Object.assign({}, spendIn, {
    publisher: publisher ? String(publisher).toLowerCase() : null,
    validators: (spendIn.validators && spendIn.validators.length)
      ? toCompressedPubkeys(spendIn.validators)
      : signers.slice(),
    threshold: Math.min(
      Math.max(1, Number(spendIn.threshold != null ? spendIn.threshold : threshold) || 1),
      Math.max(1, (spendIn.validators && spendIn.validators.length)
        ? toCompressedPubkeys(spendIn.validators).length
        : signers.length || 1)
    )
  });
  if (network) spendPolicy.network = network;
  else delete spendPolicy.network;
  if (csvBlocks != null && Number.isFinite(csvBlocks)) spendPolicy.csvBlocks = csvBlocks;
  delete spendPolicy.depositMaturityBlocks;
  if (softMode) spendPolicy.softMode = softMode;
  if (softThreshold != null && Number.isFinite(softThreshold)) {
    spendPolicy.softThreshold = softThreshold;
  }

  let bitcoinAnchor = null;
  const anchor = def.bitcoinAnchor || def.bitcoin || null;
  if (anchor && (anchor.blockHash || anchor.hash)) {
    bitcoinAnchor = {
      blockHash: String(anchor.blockHash || anchor.hash).trim().toLowerCase(),
      height: anchor.height != null ? Number(anchor.height) : undefined
    };
  } else if (def.bitcoinBlockHash) {
    bitcoinAnchor = {
      blockHash: String(def.bitcoinBlockHash).trim().toLowerCase(),
      height: def.bitcoinHeight != null ? Number(def.bitcoinHeight) : undefined
    };
  }

  const interfaces = Array.isArray(def.interfaces)
    ? def.interfaces.map(String)
    : (def['@type'] || def.name ? ['arc.core'] : []);

  const parentContract = def.parentContract || def.parentContractId || null;

  return {
    name: def.name != null ? String(def.name) : null,
    version: def.version != null ? def.version : null,
    interfaces,
    primitives: {
      messageTypes,
      opcodes
    },
    members: {
      signers,
      readers: readers.length ? readers : signers.slice(),
      threshold: Math.min(Math.max(1, threshold), Math.max(1, signers.length || 1))
    },
    spendPolicy,
    sidechainPolicy: def.sidechainPolicy && typeof def.sidechainPolicy === 'object'
      ? def.sidechainPolicy
      : null,
    bitcoinAnchor,
    /** Preserve product fields (groupId, parentContract, …) for Hub. */
    extension: {
      groupId: def.groupId || null,
      parentContract: parentContract ? String(parentContract) : null,
      parentContractId: parentContract ? String(parentContract) : null,
      creator: def.creator || null,
      proposedPolicy: proposed.validators ? proposed : null,
      meta: def.meta || null
    }
  };
}

/**
 * Tip keys used for spend authority. Prefer explicit signers over a general
 * `members` roster (Groups fold applicants into members). An explicit empty
 * `signers: []` (reader-only GroupChange fold) must NOT widen to members —
 * `resolveSpend` then keeps genesis validators.
 * @param {object} tip
 * @returns {*[]}
 */
function tipSpendKeys (tip = {}) {
  const content = tip && tip.content && typeof tip.content === 'object' ? tip.content : null;
  if (content && Object.prototype.hasOwnProperty.call(content, 'signers')
    && Array.isArray(content.signers)) {
    return content.signers;
  }
  if (Object.prototype.hasOwnProperty.call(tip || {}, 'signers') && Array.isArray(tip.signers)) {
    return tip.signers;
  }
  if (content && Array.isArray(content.members) && content.members.length) {
    return content.members;
  }
  if (Array.isArray(tip.members) && tip.members.length) return tip.members;
  if (content && Array.isArray(content.validators) && content.validators.length) {
    return content.validators;
  }
  return [];
}

/**
 * Canonical authority spendPolicy bag shared by Beacon ARC, vault, and resolveSpend.
 * @param {object} [opts]
 * @returns {object}
 */
function canonicalSpendPolicy (opts = {}) {
  const validators = toCompressedPubkeys(opts.validators || opts.signers || []);
  if (!validators.length) {
    throw new Error('canonicalSpendPolicy: validators required');
  }
  const threshold = Math.max(
    1,
    Math.min(Number(opts.threshold) || 1, validators.length)
  );
  let publisher = null;
  if (opts.publisher) {
    const p = toCompressedPubkeys([opts.publisher]);
    publisher = p[0] || null;
  }
  if (!publisher) publisher = validators[0];
  const csvBlocks = Math.max(1, Number(opts.csvBlocks) || require('./contractTaproot').DEFAULT_CSV_BLOCKS);
  const softMode = String(opts.softMode || 'publisher').toLowerCase() === 'reduced'
    ? 'reduced'
    : 'publisher';
  const out = {
    publisher,
    validators: validators.slice(),
    threshold,
    csvBlocks,
    softMode
  };
  if (opts.network) out.network = String(opts.network).trim().toLowerCase();
  if (opts.softThreshold != null && Number.isFinite(Number(opts.softThreshold))) {
    out.softThreshold = Number(opts.softThreshold);
  }
  return out;
}

/**
 * Nested tip overlay used by Hub tracked accept / summarize.
 * @param {{ blockHash?: string|null, height?: number|null, bitcoinBlockHash?: string|null, bitcoinHeight?: number|null }} [opts]
 * @returns {{ blockHash: string, height?: number }|null}
 */
function nestBitcoinAnchor (opts = {}) {
  const blockHash = opts.blockHash || opts.bitcoinBlockHash || null;
  if (!blockHash) return null;
  const height = opts.height != null
    ? Number(opts.height)
    : (opts.bitcoinHeight != null ? Number(opts.bitcoinHeight) : undefined);
  const out = { blockHash: String(blockHash).trim().toLowerCase() };
  if (height != null && Number.isFinite(height)) out.height = height;
  return out;
}

/**
 * Resolve current tip (+ genesis) to the public P2TR spend surface.
 *
 * @param {object} opts
 * @param {object} [opts.genesis] CONTRACT_PUBLISH definition or normalized ARC
 * @param {object} [opts.tip] `{ content.signers|members, stateDigest, bitcoinBlockHash, … }`
 * @param {object} [opts.overrides] network / spendPolicy overrides
 * @returns {object}
 */
function resolveSpend (opts = {}) {
  const genesis = opts.genesis && opts.genesis.members && opts.genesis.spendPolicy
    ? opts.genesis
    : normalizeArcGenesis(opts.genesis || {});
  const tip = opts.tip && typeof opts.tip === 'object' ? opts.tip : {};
  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {};

  const tipMembers = tipSpendKeys(tip);
  const genesisKeys = genesis.spendPolicy.validators.length
    ? genesis.spendPolicy.validators.slice()
    : genesis.members.signers.slice();
  const validators = tipMembers.length
    ? toCompressedPubkeys(tipMembers, genesisKeys)
    : toCompressedPubkeys(genesisKeys);

  if (!validators.length) {
    throw new Error('resolveSpend: no validators (tip members or genesis signers required)');
  }

  const tipThreshold = tip.content && tip.content.threshold != null
    ? Number(tip.content.threshold)
    : (tip.threshold != null ? Number(tip.threshold) : null);
  const threshold = Math.min(
    Math.max(1, tipThreshold != null && Number.isFinite(tipThreshold)
      ? tipThreshold
      : genesis.members.threshold || genesis.spendPolicy.threshold || 1),
    validators.length
  );

  const network = overrides.network
    || (overrides.spendPolicy && overrides.spendPolicy.network)
    || genesis.spendPolicy.network
    || null;
  if (!network) {
    throw new Error(
      'resolveSpend: bitcoin network required (pass overrides.network; do not default to regtest)'
    );
  }

  const softMode = (overrides.spendPolicy && overrides.spendPolicy.softMode)
    || genesis.spendPolicy.softMode
    || 'publisher';
  const policyInput = Object.assign({}, genesis.spendPolicy, overrides.spendPolicy || {}, {
    network,
    validators,
    threshold,
    publisher: (overrides.spendPolicy && overrides.spendPolicy.publisher)
      || genesis.spendPolicy.publisher
      || validators[0],
    softMode
  });

  const csvBlocks = policyInput.csvBlocks != null
    ? Number(policyInput.csvBlocks)
    : require('./contractTaproot').DEFAULT_CSV_BLOCKS;

  const built = policyInput.tiers && policyInput.tiers.length
    ? buildContractTaproot(policyInput)
    : buildContractTaproot(synthesizeDefaultLadder({
      validators,
      threshold,
      network,
      publisher: policyInput.publisher,
      csvBlocks,
      softMode: policyInput.softMode,
      softThreshold: policyInput.softThreshold,
      hashlock: policyInput.hashlock || null,
      extraLeaves: policyInput.extraLeaves || null
    }));

  const soft = built.policy && built.policy.tiers
    ? built.policy.tiers.find((t) => t.id === 't1-soft' || t.id === 't1-publisher')
    : null;

  const bitcoinBlockHash = tip.bitcoinBlockHash
    || (tip.bitcoinAnchor && tip.bitcoinAnchor.blockHash)
    || (genesis.bitcoinAnchor && genesis.bitcoinAnchor.blockHash)
    || null;
  const bitcoinHeight = tip.bitcoinHeight != null
    ? Number(tip.bitcoinHeight)
    : (tip.bitcoinAnchor && tip.bitcoinAnchor.height != null
      ? Number(tip.bitcoinAnchor.height)
      : (genesis.bitcoinAnchor && genesis.bitcoinAnchor.height != null
        ? Number(genesis.bitcoinAnchor.height)
        : null));
  const bitcoinAnchor = nestBitcoinAnchor({
    blockHash: bitcoinBlockHash,
    height: bitcoinHeight
  });

  const resolvedCsv = soft && soft.after && soft.after.blocks != null
    ? Number(soft.after.blocks)
    : csvBlocks;

  return {
    contractId: tip.contractId || opts.contractId || null,
    address: built.address,
    /** Alias used by vault / tracked summaries. */
    spendAddress: built.address,
    network: built.network,
    policy: built.policy,
    leaves: built.leaves,
    internalPubkeyHex: built.internalPubkeyHex || null,
    validators,
    threshold,
    csvBlocks: resolvedCsv,
    /** Deposit UX alias of csvBlocks (same ladder delay). */
    depositMaturityBlocks: resolvedCsv,
    softMode: String(policyInput.softMode || 'publisher'),
    softTier: soft || null,
    scheme: 'taproot-authority-ladder-v1',
    spendPolicy: {
      publisher: policyInput.publisher,
      validators: validators.slice(),
      threshold,
      csvBlocks: resolvedCsv,
      softMode: String(policyInput.softMode || 'publisher'),
      network: built.network,
      hashlock: built.policy && built.policy.hashlock
        ? built.policy.hashlock
        : (policyInput.hashlock || null),
      extraLeaves: built.policy && built.policy.extraLeaves
        ? built.policy.extraLeaves
        : (policyInput.extraLeaves || null)
    },
    stateDigest: tip.stateDigest || null,
    clock: tip.clock != null ? Number(tip.clock) : null,
    bitcoinAnchor,
    bitcoinBlockHash,
    bitcoinHeight: Number.isFinite(bitcoinHeight) ? bitcoinHeight : null,
    genesis: {
      name: genesis.name,
      members: genesis.members,
      primitives: genesis.primitives,
      spendPolicy: {
        publisher: genesis.spendPolicy.publisher,
        validators: genesis.spendPolicy.validators,
        threshold: genesis.spendPolicy.threshold,
        csvBlocks: genesis.spendPolicy.csvBlocks,
        softMode: genesis.spendPolicy.softMode || null
      },
      bitcoinAnchor: genesis.bitcoinAnchor
    }
  };
}

/**
 * Canonical fields hashed into ContractWithdrawalRequest.requestId.
 * Witness BIP340 covers requestId; this preimage binds destination/fee/vault.
 * @param {object} object
 * @returns {object}
 */
function withdrawalRequestCommitmentFields (object = {}) {
  return {
    contractId: String(object.contractId || '').trim().toLowerCase(),
    stateDigest: String(object.stateDigest || '').trim().toLowerCase(),
    bitcoinBlockHash: String(object.bitcoinBlockHash || '').trim().toLowerCase(),
    destinationAddress: String(object.destinationAddress || object.destination || '').trim(),
    feeSats: Math.max(0, Number(object.feeSats) || 0),
    action: object.action === 'migrate' ? 'migrate' : 'spend',
    after: object.after || null,
    tierId: object.tierId ? String(object.tierId) : null,
    vaultAddress: object.vaultAddress ? String(object.vaultAddress) : null,
    clock: object.clock != null ? Number(object.clock) : 0,
    programHash: object.programHash
      ? String(object.programHash).trim().toLowerCase()
      : null,
    runCommitmentHex: object.runCommitmentHex
      ? String(object.runCommitmentHex).trim().toLowerCase()
      : null
  };
}

/**
 * @param {object} object
 * @returns {string} 64-hex sha256 of canonical commitment JSON
 */
function computeWithdrawalRequestId (object) {
  return sha256hex(_canonicalStringify(withdrawalRequestCommitmentFields(object)));
}

/**
 * @param {object} object ContractWithdrawalRequest body
 * @param {object} tip Current tip (must include stateDigest + bitcoinBlockHash)
 * @param {Object} [opts]
 * @param {Object} [opts.genesis] Optional ARC genesis for policy checks
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function validateWithdrawalRequest (object, tip, opts = {}) {
  if (!object || typeof object !== 'object') {
    return { ok: false, error: 'withdrawal request required' };
  }
  if (!tip || typeof tip !== 'object') {
    return { ok: false, error: 'tip required' };
  }
  const digest = String(object.stateDigest || '').trim().toLowerCase();
  const tipDigest = String(tip.stateDigest || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return { ok: false, error: 'stateDigest required (64-hex)' };
  }
  if (!tipDigest || digest !== tipDigest) {
    return { ok: false, error: 'stateDigest does not match tip (stale or forged)' };
  }
  const blockHash = String(object.bitcoinBlockHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(blockHash)) {
    return { ok: false, error: 'bitcoinBlockHash required (64-hex)' };
  }
  const tipHash = tip.bitcoinBlockHash
    ? String(tip.bitcoinBlockHash).trim().toLowerCase()
    : null;
  if (!tipHash) {
    return { ok: false, error: 'tip.bitcoinBlockHash required' };
  }
  if (tipHash !== blockHash) {
    return { ok: false, error: 'bitcoinBlockHash does not match tip' };
  }
  const dest = String(object.destinationAddress || object.destination || '').trim();
  if (!dest) return { ok: false, error: 'destinationAddress required' };

  const genesis = opts.genesis
    || (opts.meta && opts.meta.genesis)
    || tip.genesis
    || null;
  const programCheck = validateProgramRunBinding({
    object,
    tip,
    genesis: genesis || {}
  });
  if (!programCheck.ok) return programCheck;

  // requestId MUST bind destination/fee/vault (witness signs only requestId).
  const gotId = String(object.requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(gotId)) {
    return { ok: false, error: 'requestId required (64-hex)' };
  }
  const expectedId = computeWithdrawalRequestId(object);
  if (gotId !== expectedId) {
    return { ok: false, error: 'requestId does not match withdrawal commitment' };
  }

  return { ok: true };
}

/**
 * Build a tip-bound ContractWithdrawalRequest object.
 * When tip seals `content.program`, digests are copied onto the request
 * (Machine/Program run binding — does not alter P2TR address).
 * @param {object} opts
 * @returns {object}
 */
function buildWithdrawalRequest (opts = {}) {
  const tip = opts.tip || {};
  const contractId = String(opts.contractId || tip.contractId || '').trim().toLowerCase();
  if (!contractId) throw new Error('contractId required');
  if (!tip.stateDigest) throw new Error('tip.stateDigest required');
  if (!tip.bitcoinBlockHash) throw new Error('tip.bitcoinBlockHash required');

  const destinationAddress = String(opts.destinationAddress || opts.destination || '').trim();
  if (!destinationAddress) throw new Error('destinationAddress required');

  const tipProgram = programMetaFromTip(tip);
  const programHash = opts.programHash
    ? String(opts.programHash).trim().toLowerCase()
    : (tipProgram && tipProgram.programHash);
  const runCommitmentHex = opts.runCommitmentHex
    ? String(opts.runCommitmentHex).trim().toLowerCase()
    : (tipProgram && tipProgram.runCommitmentHex);

  const object = {
    type: WITHDRAWAL_REQUEST,
    v: 1,
    contractId,
    stateDigest: String(tip.stateDigest).toLowerCase(),
    bitcoinBlockHash: String(tip.bitcoinBlockHash).toLowerCase(),
    clock: tip.clock != null ? Number(tip.clock) : 0,
    destinationAddress,
    feeSats: Math.max(0, Number(opts.feeSats) || 0),
    action: opts.action === 'migrate' ? 'migrate' : 'spend',
    createdAt: opts.createdAt || new Date().toISOString()
  };
  if (tip.bitcoinHeight != null && Number.isFinite(Number(tip.bitcoinHeight))) {
    object.bitcoinHeight = Number(tip.bitcoinHeight);
  }
  if (opts.after) object.after = opts.after;
  if (opts.tierId) object.tierId = String(opts.tierId);
  if (opts.vaultAddress) object.vaultAddress = String(opts.vaultAddress);
  if (programHash) object.programHash = programHash;
  if (runCommitmentHex) object.runCommitmentHex = runCommitmentHex;
  if (opts.programId || (tipProgram && tipProgram.programId)) {
    object.programId = String(opts.programId || tipProgram.programId);
  }

  object.requestId = computeWithdrawalRequestId(object);
  const check = validateWithdrawalRequest(object, tip, { genesis: opts.genesis });
  if (!check.ok) throw new Error(check.error);
  return object;
}

/**
 * Canonical UTF-8 message for BIP340 withdrawal co-sign attestations.
 * @param {object} fields
 * @returns {string}
 */
function withdrawalWitnessSigningMessage (fields = {}) {
  const requestId = String(fields.requestId || '').trim().toLowerCase();
  const stateDigest = String(fields.stateDigest || '').trim().toLowerCase();
  const bitcoinBlockHash = String(fields.bitcoinBlockHash || '').trim().toLowerCase();
  return `fabric:contract-withdrawal-witness:1:${requestId}:${stateDigest}:${bitcoinBlockHash}`;
}

/**
 * Verify BIP340 witness signature over {@link withdrawalWitnessSigningMessage}.
 * @param {object} witness
 * @returns {{ ok: boolean, error?: string }}
 */
function verifyWithdrawalWitnessSignature (witness = {}) {
  const requestId = String(witness.requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(requestId)) {
    return { ok: false, error: 'witness requestId required' };
  }
  const sigHex = String(witness.signature || '').trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(sigHex)) {
    return { ok: false, error: 'witness signature required (64-byte BIP340 hex)' };
  }
  const signerX = pubkeyXOnly(witness.signer) || String(witness.signer || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signerX)) {
    return { ok: false, error: 'witness signer required' };
  }
  try {
    const key = new Key({ public: `02${signerX}` });
    const msg = withdrawalWitnessSigningMessage({
      requestId,
      stateDigest: witness.stateDigest,
      bitcoinBlockHash: witness.bitcoinBlockHash
    });
    if (!key.verifySchnorr(msg, Buffer.from(sigHex, 'hex'))) {
      return { ok: false, error: 'invalid witness signature' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'witness verify failed' };
  }
}

/**
 * @param {object} opts
 * @returns {object}
 */
function buildWithdrawalWitness (opts = {}) {
  const request = opts.request || opts.withdrawalRequest || {};
  const requestId = String(opts.requestId || request.requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(requestId)) throw new Error('requestId required');
  const signer = String(opts.signer || '').trim().toLowerCase();
  if (!signer) throw new Error('signer required');
  let signature = String(opts.signature || '').trim().toLowerCase();
  const stateDigest = String(opts.stateDigest || request.stateDigest || '').toLowerCase() || undefined;
  const bitcoinBlockHash = String(opts.bitcoinBlockHash || request.bitcoinBlockHash || '').toLowerCase() || undefined;
  if (!signature && opts.signerKey && typeof opts.signerKey.signSchnorr === 'function') {
    const msg = withdrawalWitnessSigningMessage({ requestId, stateDigest, bitcoinBlockHash });
    signature = Buffer.from(opts.signerKey.signSchnorr(msg)).toString('hex');
  }
  if (!signature) throw new Error('signature required');
  return {
    type: WITHDRAWAL_WITNESS,
    v: 1,
    contractId: String(opts.contractId || request.contractId || '').trim().toLowerCase() || undefined,
    requestId,
    stateDigest,
    bitcoinBlockHash,
    signer,
    signature,
    createdAt: opts.createdAt || new Date().toISOString()
  };
}

/**
 * Prepare an L1 PSBT from a validated withdrawal request + spend policy.
 * @param {object} opts
 * @returns {object}
 */
function prepareWithdrawalFromRequest (opts = {}) {
  const request = opts.request;
  if (!opts.tip || typeof opts.tip !== 'object') {
    throw new Error('prepareWithdrawalFromRequest: explicit tip required (do not derive tip from request)');
  }
  const tip = opts.tip;
  const check = validateWithdrawalRequest(request, tip, { genesis: opts.genesis });
  if (!check.ok) throw new Error(check.error);

  const spend = opts.spend || resolveSpend({
    genesis: opts.genesis,
    tip,
    contractId: request.contractId,
    overrides: opts.overrides
  });

  const common = {
    policy: spend.policy,
    fundedTxHex: opts.fundedTxHex,
    vaultAddress: request.vaultAddress || spend.address,
    destinationAddress: request.destinationAddress,
    feeSats: request.feeSats,
    tierId: request.tierId,
    ctx: opts.ctx || {}
  };

  let prep;
  if (request.action === 'migrate') {
    prep = prepareDecayMigrationPsbt(common);
  } else {
    prep = prepareVaultWithdrawalPsbt(common);
  }

  return Object.assign({}, prep, {
    requestId: request.requestId,
    stateDigest: request.stateDigest,
    bitcoinBlockHash: request.bitcoinBlockHash,
    bitcoinHeight: request.bitcoinHeight != null ? request.bitcoinHeight : null,
    spendAddress: spend.address,
    network: spend.network
  });
}

module.exports = {
  WITHDRAWAL_REQUEST,
  WITHDRAWAL_WITNESS,
  normalizeArcGenesis,
  tipSpendKeys,
  canonicalSpendPolicy,
  nestBitcoinAnchor,
  resolveSpend,
  validateWithdrawalRequest,
  computeWithdrawalRequestId,
  withdrawalRequestCommitmentFields,
  buildWithdrawalRequest,
  buildWithdrawalWitness,
  withdrawalWitnessSigningMessage,
  verifyWithdrawalWitnessSignature,
  prepareWithdrawalFromRequest,
  toCompressedPubkeys,
  programMetaFromTip,
  requiresProgramBind,
  bindProgramRunToTip,
  validateProgramRunBinding
};
