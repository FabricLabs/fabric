'use strict';

/**
 * Blinded-execution circuit composition / commitment scaffold.
 *
 * Matches Fabric's Yao-oriented methodology at the **composition** layer:
 * garbler publishes initial state + rules, peers coordinate via
 * ContractProposal accept/reject, then a content-addressed circuit
 * commitment binds the simplest useful L1 surface (hashlock Taproot).
 *
 * This is **not** Yao gate garbling / OT. Real GC remains a future backend
 * behind the same digests.
 *
 * @module functions/blindedExecutionCircuit
 * @see docs/PROGRAM.md
 * @see docs/CONTRACT_PROPOSAL.md
 */

const crypto = require('crypto');

const Actor = require('../types/actor');
const Key = require('../types/key');
const Program = require('../types/program');
const fabricCanonicalJson = require('./fabricCanonicalJson');
const { jsonSafe } = fabricCanonicalJson;
const {
  verifyContractProposalPayload
} = require('./contractProposal');
const {
  synthesizeDefaultLadder,
  composeTaprootTree,
  toAddress,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt,
  DEFAULT_CSV_BLOCKS
} = require('./contractTaproot');

const SESSION_VERSION = 1;
const HASHLOCK_LEAF_ID = 'blinded-execution-hashlock';

/**
 * Canonical UTF-8 message for BIP340 accept/reject attestations.
 * @param {object} fields
 * @returns {string}
 */
function decisionSigningMessage (fields = {}) {
  const sessionId = String(fields.sessionId || '').trim().toLowerCase();
  const proposalMerkleRoot = String(fields.proposalMerkleRoot || '').trim().toLowerCase();
  const decision = String(fields.decision || '').trim().toLowerCase();
  return `fabric:blinded-execution-decision:1:${sessionId}:${proposalMerkleRoot}:${decision}`;
}

/**
 * @param {string|Buffer} hexOrBuf
 * @returns {string} lowercase 64-hex
 */
function sha256Hex (hexOrBuf) {
  const buf = Buffer.isBuffer(hexOrBuf)
    ? hexOrBuf
    : Buffer.from(String(hexOrBuf), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * @param {*} value
 * @returns {string} 64-hex digest of canonical JSON
 */
function digestCanonical (value) {
  return sha256Hex(Buffer.from(fabricCanonicalJson(jsonSafe(value)), 'utf8'));
}

/**
 * @param {unknown} list
 * @returns {string[]} sorted unique compressed pubkey hex
 */
function normalizeParties (list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const s = String(raw || '').trim().toLowerCase().replace(/^0x/i, '');
    if (!/^(02|03)[0-9a-f]{64}$/.test(s)) {
      throw new Error('blindedExecutionCircuit: party pubkey must be 33-byte compressed hex');
    }
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort();
  return out;
}

/**
 * @param {Program|object} programOrOpts
 * @returns {Program}
 */
function resolveProgram (programOrOpts) {
  if (programOrOpts instanceof Program) {
    if (!programOrOpts.steps.length && programOrOpts.settings && programOrOpts.settings.source) {
      programOrOpts.compile();
    }
    return programOrOpts;
  }
  const prog = Program.from(programOrOpts || { language: 'fabric-opcodes', steps: ['OP_TRUE'] });
  prog.compile();
  return prog;
}

/**
 * Initial circuit commitment over program, state, and coordinator set.
 * @param {{ programHash: string, stateDigest: string, parties: string[], name: string, garbler: string|null }} parts
 * @returns {string}
 */
function computeBaseCircuitCommitment (parts) {
  return digestCanonical({
    version: SESSION_VERSION,
    kind: 'BlindedExecutionCircuit',
    name: parts.name,
    programHash: parts.programHash,
    stateDigest: parts.stateDigest,
    parties: parts.parties.slice(),
    garbler: parts.garbler || null
  });
}

/**
 * @param {object[]} decisions
 * @returns {string|null}
 */
function computeCoordinationRoot (decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return null;
  const digests = decisions.map((d) => digestCanonical({
    decision: d.decision,
    actorPubkey: d.actorPubkey,
    proposalMerkleRoot: d.proposalMerkleRoot,
    at: d.at
  })).sort();
  return digestCanonical({ version: SESSION_VERSION, decisions: digests });
}

/**
 * Garbler composes the initial CONTRACT_PUBLISH-shaped definition and session.
 *
 * Requires at least one coordinator/evaluator in `parties` so the circuit has
 * ≥2 peer roles (garbler + evaluator).
 *
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {object} [opts.state] known initial state
 * @param {Program|object} [opts.program]
 * @param {string[]} opts.parties evaluator / coordinator compressed pubkeys
 * @param {string} [opts.garbler] garbler compressed pubkey
 * @param {string} opts.network bitcoin network name
 * @param {number} [opts.csvBlocks]
 * @param {number} [opts.threshold]
 * @returns {object} session
 */
function composeGarblerPublish (opts = {}) {
  const parties = normalizeParties(opts.parties);
  if (parties.length < 1) {
    throw new Error('composeGarblerPublish: at least one evaluator/coordinator party is required');
  }

  let garbler = opts.garbler != null
    ? String(opts.garbler).trim().toLowerCase().replace(/^0x/i, '')
    : null;
  if (garbler) {
    if (!/^(02|03)[0-9a-f]{64}$/.test(garbler)) {
      throw new Error('composeGarblerPublish: garbler must be 33-byte compressed hex');
    }
  } else {
    garbler = parties[0];
  }

  const network = opts.network || opts.networkName;
  if (!network) throw new Error('composeGarblerPublish: network required');

  const name = opts.name != null ? String(opts.name) : 'blinded-execution';
  const state = opts.state != null && typeof opts.state === 'object' ? jsonSafe(opts.state) : {};
  const prog = resolveProgram(opts.program);
  const programHash = prog.programHash;
  const stateDigest = digestCanonical(state);
  const circuitCommitment = computeBaseCircuitCommitment({
    name,
    programHash,
    stateDigest,
    parties,
    garbler
  });

  const signers = Array.from(new Set([garbler].concat(parties))).sort();
  const threshold = Math.max(1, Math.min(Number(opts.threshold) || 1, signers.length));
  const csvBlocks = Math.max(1, Number(opts.csvBlocks) || DEFAULT_CSV_BLOCKS);

  const definition = {
    '@type': 'FabricContract',
    name,
    interfaces: ['arc.core', 'fabric.blinded-execution'],
    primitives: {
      messageTypes: ['ContractProposal', 'CONTRACT_MESSAGE'],
      opcodes: prog.steps.slice()
    },
    members: {
      signers,
      readers: ['*'],
      threshold
    },
    state,
    spendPolicy: {
      network: String(network),
      publisher: garbler,
      validators: signers,
      threshold,
      csvBlocks
    },
    blindedExecution: {
      version: SESSION_VERSION,
      programHash,
      stateDigest,
      circuitCommitment,
      parties: parties.slice(),
      garbler
    }
  };

  const circuitId = new Actor({
    type: 'FabricContract',
    object: definition
  }).id;

  return {
    version: SESSION_VERSION,
    definition,
    circuitId,
    programHash,
    stateDigest,
    parties: parties.slice(),
    garbler,
    roles: {
      garbler,
      evaluators: parties.slice()
    },
    decisions: [],
    coordinationRoot: null,
    circuitCommitment,
    hashlockCommitmentHex: null,
    hashlockPreimageHex: null,
    runCommitmentHex: null,
    finalized: false,
    network: String(network),
    program: {
      language: prog.language,
      steps: prog.steps.slice(),
      programId: prog.programId
    }
  };
}

/**
 * Pubkeys allowed to record accept/reject on a session (garbler ∪ evaluators).
 * @param {object} session
 * @returns {Set<string>}
 */
function sessionRolePubkeys (session) {
  const allowed = new Set();
  const add = (raw) => {
    const s = String(raw || '').trim().toLowerCase().replace(/^0x/i, '');
    if (/^(02|03)[0-9a-f]{64}$/.test(s)) allowed.add(s);
  };
  add(session.garbler);
  for (const p of session.parties || []) add(p);
  if (session.roles && typeof session.roles === 'object') {
    add(session.roles.garbler);
    for (const e of session.roles.evaluators || []) add(e);
  }
  return allowed;
}

/**
 * Verify a ContractProposal and record accept/reject against the session.
 *
 * @param {object} opts
 * @param {object} opts.session
 * @param {object} opts.proposalPayload from buildContractProposalPayload
 * @param {'accept'|'reject'} opts.decision
 * @param {string} opts.actorPubkey compressed hex (must be session garbler or evaluator)
 * @param {string} opts.signature BIP340 hex over {@link decisionSigningMessage}
 * @returns {object} updated session (shallow clone)
 */
function recordProposalDecision (opts = {}) {
  const session = opts.session;
  if (!session || typeof session !== 'object') {
    throw new Error('recordProposalDecision: session required');
  }
  if (session.finalized) {
    throw new Error('recordProposalDecision: session already finalized');
  }

  const decision = String(opts.decision || '').trim().toLowerCase();
  if (decision !== 'accept' && decision !== 'reject') {
    throw new Error('recordProposalDecision: decision must be accept or reject');
  }

  const actorPubkey = String(opts.actorPubkey || '').trim().toLowerCase().replace(/^0x/i, '');
  if (!/^(02|03)[0-9a-f]{64}$/.test(actorPubkey)) {
    throw new Error('recordProposalDecision: actorPubkey must be 33-byte compressed hex');
  }
  if (!sessionRolePubkeys(session).has(actorPubkey)) {
    throw new Error('recordProposalDecision: actorPubkey is not a session party');
  }

  const proposalPayload = opts.proposalPayload;
  const verified = verifyContractProposalPayload(proposalPayload);
  if (!verified.ok) {
    throw new Error(`recordProposalDecision: invalid proposal (${verified.error || 'verify failed'})`);
  }

  const proposalMerkleRoot = proposalPayload.chain && proposalPayload.chain.merkleRoot
    ? String(proposalPayload.chain.merkleRoot).toLowerCase()
    : null;
  if (!proposalMerkleRoot || !/^[0-9a-f]{64}$/.test(proposalMerkleRoot)) {
    throw new Error('recordProposalDecision: proposal merkleRoot missing');
  }

  if (proposalPayload.contractId != null && session.circuitId &&
      String(proposalPayload.contractId) !== String(session.circuitId)) {
    throw new Error('recordProposalDecision: proposal contractId does not match session');
  }

  const sessionId = String(session.circuitId || session.id || '').trim().toLowerCase();
  if (!sessionId) {
    throw new Error('recordProposalDecision: session id required');
  }
  const sigHex = String(opts.signature || '').trim().toLowerCase().replace(/^0x/i, '');
  if (!/^[0-9a-f]{128}$/.test(sigHex)) {
    throw new Error('recordProposalDecision: signature required (64-byte BIP340 hex)');
  }
  const msg = decisionSigningMessage({
    sessionId,
    proposalMerkleRoot,
    decision
  });
  const verifyKey = new Key({ public: actorPubkey });
  if (!verifyKey.verifySchnorr(msg, Buffer.from(sigHex, 'hex'))) {
    throw new Error('recordProposalDecision: invalid decision signature');
  }

  const prior = Array.isArray(session.decisions) ? session.decisions : [];
  const existing = prior.find((d) =>
    d &&
    String(d.actorPubkey || '').toLowerCase() === actorPubkey &&
    String(d.proposalMerkleRoot || '').toLowerCase() === proposalMerkleRoot &&
    String(d.decision || '').toLowerCase() === decision
  );
  // Same actor/proposal/decision is idempotent — signature does not bind `at`,
  // so replaying with a new timestamp must not grow decisions or change the root.
  if (existing) {
    if (String(existing.signature || '').toLowerCase() !== sigHex) {
      throw new Error('recordProposalDecision: conflicting signature for existing decision');
    }
    return Object.assign({}, session, {
      decisions: prior.slice(),
      coordinationRoot: session.coordinationRoot || computeCoordinationRoot(prior)
    });
  }

  const entry = {
    decision,
    actorPubkey,
    proposalMerkleRoot,
    signature: sigHex,
    at: opts.at != null ? Number(opts.at) : Date.now()
  };

  const decisions = prior.concat([entry]);
  const coordinationRoot = computeCoordinationRoot(decisions);

  return Object.assign({}, session, {
    decisions,
    coordinationRoot
  });
}

/**
 * Require ≥1 evaluator accept; fold coordination (+ optional run) into final digests.
 *
 * Hashlock binds `SHA256(preimage)` where preimage is the 32-byte finalized
 * circuit commitment. Because that digest is public, the L1 leaf MUST also
 * require a Schnorr sig from an authorized key (`preimage+sig`) — see
 * {@link bindBlindedExecutionToHashlock}.
 *
 * @param {object} opts
 * @param {object} opts.session
 * @param {string} [opts.runCommitmentHex]
 * @returns {object} finalized session
 */
function finalizeBlindedExecution (opts = {}) {
  const session = opts.session;
  if (!session || typeof session !== 'object') {
    throw new Error('finalizeBlindedExecution: session required');
  }
  if (session.finalized) {
    throw new Error('finalizeBlindedExecution: session already finalized');
  }

  const evaluators = new Set(
    normalizeParties(session.parties || (session.roles && session.roles.evaluators) || [])
  );
  const accepts = (session.decisions || []).filter((d) => d.decision === 'accept');
  const evaluatorAccept = accepts.some((d) => evaluators.has(String(d.actorPubkey || '').toLowerCase()));
  if (!evaluatorAccept) {
    throw new Error('finalizeBlindedExecution: at least one evaluator accept is required');
  }

  let runCommitmentHex = opts.runCommitmentHex != null
    ? String(opts.runCommitmentHex).trim().toLowerCase().replace(/^0x/i, '')
    : (session.runCommitmentHex || null);
  if (runCommitmentHex != null && !/^[0-9a-f]{64}$/.test(runCommitmentHex)) {
    throw new Error('finalizeBlindedExecution: runCommitmentHex must be 64-hex');
  }

  const coordinationRoot = session.coordinationRoot || computeCoordinationRoot(session.decisions);
  const circuitCommitment = digestCanonical({
    version: SESSION_VERSION,
    kind: 'BlindedExecutionFinal',
    baseCircuitCommitment: session.circuitCommitment,
    coordinationRoot,
    runCommitmentHex: runCommitmentHex || null
  });

  const hashlockPreimage = Buffer.from(circuitCommitment, 'hex');
  const hashlockCommitmentHex = crypto.createHash('sha256').update(hashlockPreimage).digest('hex');

  return Object.assign({}, session, {
    coordinationRoot,
    circuitCommitment,
    runCommitmentHex: runCommitmentHex || null,
    hashlockPreimageHex: hashlockPreimage.toString('hex'),
    hashlockCommitmentHex,
    finalized: true
  });
}

/**
 * Bind a finalized session to the hashlock Taproot contract (simplest useful L1 surface).
 *
 * @param {object} opts
 * @param {object} opts.session finalized session
 * @param {string[]} [opts.validators] defaults to session signers
 * @param {string} [opts.publisher]
 * @param {string} [opts.network]
 * @param {number} [opts.threshold]
 * @param {number} [opts.csvBlocks]
 * @returns {object}
 */
function bindBlindedExecutionToHashlock (opts = {}) {
  const session = opts.session;
  if (!session || typeof session !== 'object') {
    throw new Error('bindBlindedExecutionToHashlock: session required');
  }
  if (!session.finalized || !session.hashlockCommitmentHex) {
    throw new Error('bindBlindedExecutionToHashlock: session must be finalized');
  }

  const network = opts.network || opts.networkName || session.network;
  if (!network) throw new Error('bindBlindedExecutionToHashlock: network required');

  const publisher = opts.publisher
    ? String(opts.publisher).trim().toLowerCase()
    : session.garbler;
  const validators = Array.isArray(opts.validators) && opts.validators.length
    ? opts.validators
    : (session.definition && session.definition.members && session.definition.members.signers) ||
      [session.garbler].concat(session.parties || []);
  const threshold = Math.max(1, Number(opts.threshold) || 1);
  const csvBlocks = Math.max(1, Number(opts.csvBlocks) || DEFAULT_CSV_BLOCKS);

  // Public circuit commitment must not be a pure-preimage leaf (any observer
  // could recompute and sweep). Bind hashlock+pubkey so spend needs Schnorr.
  const hashlock = {
    commitmentHex: session.hashlockCommitmentHex,
    id: HASHLOCK_LEAF_ID,
    pubkeyHex: publisher
  };

  const policy = synthesizeDefaultLadder({
    validators,
    threshold,
    publisher,
    network,
    csvBlocks,
    hashlock
  });

  const tree = composeTaprootTree({
    network,
    policy,
    hashlock
  });

  const ladderOnly = synthesizeDefaultLadder({
    validators,
    threshold,
    publisher,
    network,
    csvBlocks
  });

  return {
    session,
    policy,
    tree,
    address: tree.address,
    ladderOnlyAddress: toAddress(ladderOnly),
    hashlockCommitmentHex: session.hashlockCommitmentHex,
    hashlockPreimageHex: session.hashlockPreimageHex,
    circuitCommitment: session.circuitCommitment,
    /**
     * @param {object} withdrawOpts
     * @param {string} withdrawOpts.fundedTxHex
     * @param {string} withdrawOpts.destinationAddress
     * @param {number} [withdrawOpts.feeSats]
     * @param {string} [withdrawOpts.vaultAddress]
     */
    prepareWithdrawal (withdrawOpts = {}) {
      return prepareHashlockWithdrawalPsbt({
        policy,
        fundedTxHex: withdrawOpts.fundedTxHex,
        vaultAddress: withdrawOpts.vaultAddress || tree.address,
        destinationAddress: withdrawOpts.destinationAddress,
        feeSats: withdrawOpts.feeSats,
        preimage32: Buffer.from(session.hashlockPreimageHex, 'hex'),
        leafId: HASHLOCK_LEAF_ID
      });
    },
    /**
     * @param {object} finOpts
     * @param {string} finOpts.psbtBase64 signed PSBT (tapScriptSig for publisher)
     * @param {string} [finOpts.witnessShape='preimage+sig']
     */
    finalizeWithdrawal (finOpts = {}) {
      return finalizeHashlockPsbt({
        psbtBase64: finOpts.psbtBase64,
        preimage32: Buffer.from(session.hashlockPreimageHex, 'hex'),
        witnessShape: finOpts.witnessShape || 'preimage+sig'
      });
    }
  };
}

module.exports = {
  SESSION_VERSION,
  HASHLOCK_LEAF_ID,
  sha256Hex,
  digestCanonical,
  normalizeParties,
  sessionRolePubkeys,
  computeBaseCircuitCommitment,
  computeCoordinationRoot,
  decisionSigningMessage,
  composeGarblerPublish,
  recordProposalDecision,
  finalizeBlindedExecution,
  bindBlindedExecutionToHashlock
};
