'use strict';

// Generics
const crypto = require('crypto');

// Dependencies
// const Template = require('@babel/template');
// const Generate = require('@babel/generator');
// const t = require('@babel/types');
const bitcoin = require('bitcoinjs-lib');
const parser = require('dotparser');
const monitor = require('fast-json-patch');

// Fabric Types
const Actor = require('./actor');
const Key = require('./key');
const Message = require('./message');
const Policy = require('./policy');
const Program = require('./program');
const Service = require('./service');
const Token = require('./token');

// Fabric Functions
const { LOG_TYPES, CONTRACT_BODY_TYPES, OUTER, isKnownContractBodyType } = require('../functions/applicationNamespaces');
const { HEADER_SIZE, MAX_MESSAGE_SIZE } = require('../constants');
const { fabricCanonicalJson } = require('../functions/fabricCanonicalJson');
const { pubkeyXOnly, pubkeyCompressed, normalizePeerPubkeyHex } = require('./key');
const { sortPubkeysBip67 } = require('../functions/bip67');
const SIGNING_TAGS = require('./key').TAGS;

// @private
function sha256hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/**
 * @private
 * @param {string|object|Buffer} txInput raw hex, Transaction, or decoded RPC-like tx
 * @returns {Object} `{ ok: true, tx, txid }` or `{ ok: false, code, error }`
 */
function parseBitcoinTransaction (txInput) {
  if (txInput == null) {
    return { ok: false, code: 'MISSING_TX', error: 'transaction required' };
  }
  try {
    if (typeof txInput === 'string') {
      const hex = txInput.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 20) {
        return { ok: false, code: 'INVALID_TX', error: 'transaction hex invalid' };
      }
      const tx = bitcoin.Transaction.fromHex(hex);
      return { ok: true, tx, txid: tx.getId() };
    }
    if (txInput && typeof txInput.toHex === 'function' && typeof txInput.getId === 'function') {
      return { ok: true, tx: txInput, txid: txInput.getId() };
    }
    if (txInput && typeof txInput === 'object' && txInput.hex) {
      const tx = bitcoin.Transaction.fromHex(String(txInput.hex).trim());
      return { ok: true, tx, txid: tx.getId() };
    }
    return { ok: false, code: 'INVALID_TX', error: 'unsupported transaction shape' };
  } catch (e) {
    return {
      ok: false,
      code: 'INVALID_TX',
      error: e && e.message ? e.message : 'failed to parse transaction'
    };
  }
}

/**
 * @private
 * @param {string} address
 * @param {string} [networkName]
 * @returns {Object} `{ ok: true, script, network }` or `{ ok: false, code, error }`
 */
function outputScriptForAddress (address, networkName) {
  const addr = String(address || '').trim();
  if (!addr) {
    return { ok: false, code: 'INVALID_ADDRESS', error: 'address required' };
  }
  try {
    const network = Policy.networkForFabricName(networkName || 'regtest');
    const script = Buffer.from(bitcoin.address.toOutputScript(addr, network));
    return { ok: true, script, network };
  } catch (e) {
    return {
      ok: false,
      code: 'INVALID_ADDRESS',
      error: e && e.message ? e.message : 'invalid address for network'
    };
  }
}

/**
 * Service-backed agreement template: DOT graphs, a derived circuit structure, deploy/genesis/publish flows,
 * and JSON-Patch–observed commits. Specialized by {@link Bond}, {@link Federation}, and {@link Distribution}.
 * Message fold, delivery receipts, and the relay queue live on {@link Contract.Journal}.
 * @class Contract
 * @extends Service
 */
class Contract extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'TemplateContract',
      balances: {},
      circuit: {},
      constraints: {},
      graphs: {},
      state: {
        name: 'TemplateContract',
        status: 'PAUSED',
        actors: [],
        balances: {},
        constraints: {},
        signatures: []
      },
      witnesses: []
    }, settings);

    // compatibility
    // this['@data'] = settings;

    // tweaked pubkey
    this.key = new Key(this.settings.key);
    this.messages = {};

    this._inner = null;
    this._state = {
      status: 'PAUSED',
      chain: [], // list of block hashes
      events: [], // list of state changes
      value: this.settings.state,
      content: this.settings.state
    };

    this.observer = monitor.observe(this._state.content);

    /**
     * Pre-signed, timelocked exits per off-chain state (see {@link Resolutions}).
     * A state may only be treated as live once `resolutions.resolvable(stateId)`.
     * @type {Resolutions}
     */
    this.resolutions = new Resolutions({
      network: this.settings.network || 'regtest',
      contractId: this.settings.contractId || null
    });

    return this;
  }

  /**
   * Gate an off-chain state transition on its resolution set: every exit the
   * state depends on must hold all required signatures, otherwise a counterparty
   * that stops responding would leave funds unrecoverable.
   * @param {string} stateId
   * @returns {Contract}
   * @throws {Error} when exits are still missing signatures
   */
  advance (stateId) {
    const missing = this.resolutions.missing(stateId);
    if (missing.length) {
      const first = missing[0];
      throw new Error(`advance(${stateId}): not resolvable — ${first.exitId || first.stateId} missing ${first.missing.join(', ')}`);
    }
    this._state.content.resolvedState = String(stateId);
    return this;
  }

  static fromDot (input) {
    const graphs = parser(input);
    const circuit = Contract.fromGraph(graphs);
    const contract = new Contract({
      graphs: graphs,
      circuit: circuit
    });

    // monkey
    contract.graphs = graphs;

    return contract;
  };

  static fromJavaScript (js) {
    if (typeof js !== 'string') {
      throw new TypeError('JavaScript source must be a string.');
    }

    const source = js.trim();
    const ast = {
      '@type': 'AST',
      '@language': 'JavaScript',
      source
    };

    return new Contract({
      ast,
      state: {
        name: 'TemplateContract',
        status: 'PAUSED',
        actors: [],
        balances: {},
        constraints: {},
        signatures: [],
        source
      }
    });
  }

  static fromGraph (graphs) {
    const circuit = {
      stack: [],
      nodes: [],
      edges: [],
      unhandled: []
    };

    for (let i = 0; i < graphs.length; i++) {
      const graph = graphs[i];
      const node = {
        name: graph.id
      };

      circuit.nodes.push(node);

      if (!graph.children.length) continue;
      for (let j = 0; j < graph.children.length; j++) {
        const child = graph.children[j];
        switch (child.type) {
          default:
            circuit.unhandled.push({
              type: child.type,
              child
            });
            break;
          case 'edge_stmt': {
            const list = Array.isArray(child.edge_list) ? child.edge_list : [];
            for (let k = 0; k < list.length - 1; k++) {
              const from = list[k];
              const to = list[k + 1];
              if (!from || !to) continue;
              if (!from.id || !to.id) continue;
              circuit.edges.push({
                from: from.id,
                to: to.id
              });
            }
            break;
          }
          case 'node_stmt':
            circuit.nodes.push({
              name: child.node_id.id
            });
            break;
        }
      }
    }

    return circuit;
  }

  /**
   * Trimmed contract identifier, or `null` when empty.
   * @param {*} value
   * @returns {string|null}
   */
  static normalizeIdentifier (value) {
    if (value == null) return null;
    const s = String(value).trim();
    return s ? s : null;
  }

  /**
   * Read `contractIdentifier` or legacy `contractId` from an object.
   * Prefer writing `contractIdentifier`; the dual read lasts until Hub,
   * `@fabric/http`, and apps finish the rename (OUTSTANDING Blocker).
   * @param {object|null|undefined} obj
   * @returns {string|null}
   */
  static resolveIdentifier (obj) {
    if (!obj || typeof obj !== 'object') return null;
    return Contract.normalizeIdentifier(obj.contractIdentifier) ||
      Contract.normalizeIdentifier(obj.contractId);
  }

  /**
   * Stamp `contractIdentifier` and `contractId` with the same value so old and
   * new readers converge. Deletes neither key.
   * @param {object} obj
   * @param {string} identifier
   * @returns {object} the same object
   */
  static stampIdentifier (obj, identifier) {
    if (!obj || typeof obj !== 'object') return obj;
    const id = Contract.normalizeIdentifier(identifier);
    if (!id) return obj;
    obj.contractIdentifier = id;
    obj.contractId = id;
    return obj;
  }

  /**
   * Pubkeys declared as patch authorities on a CONTRACT_PUBLISH body
   * (validators, parties, owners, authorities, members, spend / proposed policy).
   * @param {object} object
   * @returns {Set<string>}
   */
  static authorityPubkeys (object) {
    const set = new Set();
    const add = (hex) => {
      const h = normalizePeerPubkeyHex(hex);
      if (/^[0-9a-f]{64}$/.test(h) || /^[0-9a-f]{66}$/.test(h)) set.add(h);
    };
    const addList = (list) => {
      if (!Array.isArray(list)) return;
      for (const entry of list) {
        if (typeof entry === 'string') add(entry);
        else if (entry && typeof entry === 'object') {
          add(entry.pubkey || entry.publicKey || entry.id);
        }
      }
    };
    const def = object && typeof object === 'object' ? object : {};
    addList(def.validators);
    addList(def.parties);
    addList(def.owners);
    addList(def.authorities);
    if (Array.isArray(def.members)) {
      addList(def.members);
    } else if (def.members && typeof def.members === 'object') {
      addList(def.members.signers);
      addList(def.members.validators);
      addList(def.members.parties);
      addList(def.members.owners);
      addList(def.members.authorities);
    }
    if (def.spendPolicy && typeof def.spendPolicy === 'object') {
      addList(def.spendPolicy.validators);
      addList(def.spendPolicy.parties);
    }
    if (def.proposedPolicy && typeof def.proposedPolicy === 'object') {
      addList(def.proposedPolicy.validators);
      addList(def.proposedPolicy.parties);
      addList(def.proposedPolicy.signers);
    }
    return set;
  }

  /**
   * Whether `pubkeyHex` is in an authority set (x-only ↔ compressed tolerant).
   * @param {Set<string>} authorities
   * @param {string} pubkeyHex
   * @returns {boolean}
   */
  static hasAuthority (authorities, pubkeyHex) {
    const h = normalizePeerPubkeyHex(pubkeyHex);
    if (!h || !authorities || !authorities.size) return false;
    if (authorities.has(h)) return true;
    if (h.length === 64) {
      for (const entry of authorities) {
        if (typeof entry === 'string' && entry.length === 66 && entry.slice(2) === h) return true;
      }
    } else if (h.length === 66) {
      const xOnly = h.slice(2);
      if (authorities.has(xOnly)) return true;
    }
    return false;
  }

  /**
   * Whether a wire signer may publish this definition.
   *
   * Empty authority set → any signer (open genesis / observe-only publish).
   * Non-empty authority set → the AMP wire signer **must** be present and listed
   * (fail closed: unsigned frames must not register).
   *
   * @param {object} object CONTRACT_PUBLISH body
   * @param {string|null} [signerPubkeyHex]
   * @returns {boolean}
   */
  static publishSignerAuthorized (object, signerPubkeyHex = null) {
    const authorities = Contract.authorityPubkeys(object);
    if (!authorities.size) return true;
    const pub = normalizePeerPubkeyHex(signerPubkeyHex);
    if (!pub) return false;
    return Contract.hasAuthority(authorities, pub);
  }

  /**
   * Issue a contract-scoped Token capability (read-only member or signer).
   * @param {Object} opts
   * @param {object|Key} opts.issuerKey Fabric Key (or settings) of issuer
   * @param {string} opts.subject Subject compressed pubkey
   * @param {string} opts.contractId Contract / namespace id
   * @param {string} [opts.capability=Contract.OP_CONTRACT_READ]
   * @param {number} [opts.expiresInSeconds]
   * @returns {string} Token.toSignedString()
   */
  static issueCapability (opts = {}) {
    const capability = opts.capability || Contract.OP_CONTRACT_READ;
    if (capability !== Contract.OP_CONTRACT_READ && capability !== Contract.OP_CONTRACT_SIGN) {
      throw new Error(`unsupported contract capability: ${capability}`);
    }
    const contractId = String(opts.contractId || '').trim().toLowerCase();
    if (!contractId) throw new Error('contractId required');
    const subject = String(opts.subject || '').trim().toLowerCase();
    if (!subject) throw new Error('subject required');
    const issuer = opts.issuerKey && typeof opts.issuerKey.sign === 'function'
      ? opts.issuerKey
      : new Key(opts.issuerKey || {});
    const token = new Token({
      capability,
      issuer,
      subject,
      ctx: { contractId }
    });
    return token.toSignedString({
      expiresInSeconds: opts.expiresInSeconds,
      ctx: { contractId }
    });
  }

  /**
   * Verify a contract-scoped Token capability.
   * @param {string} tokenString
   * @param {Object} expect
   * @param {string} expect.contractId
   * @param {string} [expect.expectedCap]
   * @param {string} [expect.subject]
   * @param {Key|object} [expect.issuerKey] Verify Schnorr against this key (auth path)
   * @param {boolean} [expect.allowUnverified] Opt-in parse-only (no sig check); result has verified:false
   * @returns {Object|null} token payload (`cap`, `iss`, `sub`, `iat`, `exp`, `ctx`) plus `verified`
   */
  static verifyCapability (tokenString, expect = {}) {
    const contractId = String(expect.contractId || '').trim().toLowerCase();
    if (!contractId) return null;
    let payload = null;
    let verified = false;
    if (expect.issuerKey) {
      const key = expect.issuerKey && typeof expect.issuerKey.verify === 'function'
        ? expect.issuerKey
        : new Key(expect.issuerKey);
      payload = Token.verifySigned(tokenString, key);
      verified = !!payload;
    } else if (expect.allowUnverified === true) {
      // Parse-only: not authorization. Callers must not treat this as a verified grant.
      if (!tokenString || typeof tokenString !== 'string') return null;
      const parts = tokenString.split('.');
      if (parts.length !== 2) return null;
      try {
        const { tryParseWireJson } = require('../functions/wireJson');
        const payloadStr = Token.base64UrlDecode(parts[0]);
        const pr = tryParseWireJson(payloadStr);
        if (!pr.ok) return null;
        payload = pr.value;
        if (!payload || payload.exp == null || Date.now() / 1000 > payload.exp) return null;
        verified = false;
      } catch (_) {
        return null;
      }
    } else {
      return null;
    }
    if (!payload) return null;
    const ctxId = payload.ctx && payload.ctx.contractId
      ? String(payload.ctx.contractId).trim().toLowerCase()
      : '';
    if (ctxId !== contractId) return null;
    if (expect.expectedCap && payload.cap !== expect.expectedCap) return null;
    if (expect.subject) {
      const sub = String(payload.sub || '').trim().toLowerCase();
      if (sub !== String(expect.subject).trim().toLowerCase()) return null;
    }
    return Object.assign({}, payload, { verified });
  }

  /**
   * @param {string} role `signer` or `sign`; anything else is a reader
   * @returns {string} {@link Contract.OP_CONTRACT_SIGN} or {@link Contract.OP_CONTRACT_READ}
   */
  static roleToCapability (role) {
    const r = String(role || '').toLowerCase();
    if (r === 'signer' || r === 'sign') return Contract.OP_CONTRACT_SIGN;
    return Contract.OP_CONTRACT_READ;
  }

  /**
   * @param {string} cap
   * @returns {string|null} `signer`, `reader`, or `null`
   */
  static capabilityToRole (cap) {
    if (cap === Contract.OP_CONTRACT_SIGN) return 'signer';
    if (cap === Contract.OP_CONTRACT_READ) return 'reader';
    return null;
  }

  /**
   * Observe whether `tx` pays `address` at least `amountSats` (when set).
   * Does not broadcast or mutate chain state.
   *
   * @param {Object} opts
   * @param {string|object} opts.tx transaction hex or Transaction
   * @param {string} opts.address contract spend address
   * @param {string} [opts.network='regtest']
   * @param {number} [opts.amountSats] minimum matched sats (optional)
   * @returns {object}
   */
  static observePayment (opts = {}) {
    const parsed = parseBitcoinTransaction(opts.tx);
    if (!parsed.ok) return parsed;

    const netName = opts.network || opts.networkName || 'regtest';
    const dest = outputScriptForAddress(opts.address, netName);
    if (!dest.ok) return dest;

    const wantMin = opts.amountSats != null ? Math.round(Number(opts.amountSats)) : null;
    if (wantMin != null && (!Number.isFinite(wantMin) || wantMin <= 0)) {
      return { ok: false, code: 'INVALID_AMOUNT', error: 'amountSats must be a positive integer when set' };
    }

    const matches = [];
    let matchedSats = 0;
    for (let i = 0; i < parsed.tx.outs.length; i++) {
      const out = parsed.tx.outs[i];
      const sc = Buffer.isBuffer(out.script) ? out.script : Buffer.from(out.script);
      if (!sc.equals(dest.script)) continue;
      const sats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
      if (!Number.isFinite(sats) || sats <= 0) continue;
      matches.push({ vout: i, amountSats: sats });
      matchedSats += sats;
    }

    if (!matches.length) {
      return {
        ok: false,
        code: 'NO_MATCH',
        error: 'transaction does not pay the contract address',
        txid: parsed.txid,
        address: String(opts.address).trim(),
        network: netName,
        matchedSats: 0,
        vouts: []
      };
    }

    if (wantMin != null && matchedSats < wantMin) {
      return {
        ok: false,
        code: 'UNDERPAID',
        error: `matched ${matchedSats} sats but required at least ${wantMin}`,
        txid: parsed.txid,
        address: String(opts.address).trim(),
        network: netName,
        matchedSats,
        amountSatsRequired: wantMin,
        vouts: matches
      };
    }

    return {
      ok: true,
      code: 'PAID',
      txid: parsed.txid,
      address: String(opts.address).trim(),
      network: netName,
      matchedSats,
      amountSatsRequired: wantMin,
      vouts: matches
    };
  }

  /**
   * Fold a successful observation into tip content balances (immutable clone).
   * @param {object} tip
   * @param {object} observation from {@link Contract.observePayment}
   * @returns {object} tip
   */
  static applyPaymentObservation (tip = {}, observation = {}) {
    if (!observation || observation.ok !== true) {
      throw new Error('Contract.applyPaymentObservation: observation must be successful');
    }
    const prev = tip && typeof tip === 'object' ? tip : {};
    const content = Object.assign({}, prev.content && typeof prev.content === 'object' ? prev.content : {});
    const payments = Array.isArray(content.payments) ? content.payments.slice() : [];
    const txid = String(observation.txid || '').toLowerCase();
    const addr = observation.address;
    if (txid && payments.some((p) => p
      && String(p.txid || '').toLowerCase() === txid
      && String(p.address || '') === String(addr || ''))) {
      // Idempotent: already folded this (txid, address) pair.
      return Object.assign({}, prev, { content: Object.assign({}, content, { payments }) });
    }
    const balances = Object.assign({}, content.balances && typeof content.balances === 'object' ? content.balances : {});
    const prevSats = Number(balances[addr] && balances[addr].sats) || 0;
    balances[addr] = {
      sats: prevSats + Number(observation.matchedSats || 0),
      lastTxid: observation.txid,
      lastObservedAt: new Date().toISOString()
    };
    content.balances = balances;
    payments.push({
      txid: observation.txid,
      address: addr,
      amountSats: observation.matchedSats,
      vouts: observation.vouts
    });
    content.payments = payments;
    return Object.assign({}, prev, { content });
  }

  /**
   * Lift pubkeys to BIP67-sorted compressed hex for Taproot policy builders.
   * Prefers the genesis compressed forms when the tip holds the same x-only set
   * (02/03 parity drift would otherwise move the address off the Hub vault).
   * @param {Iterable<*>} list
   * @param {Iterable<*>} [genesisList]
   * @returns {string[]}
   */
  static toCompressedPubkeys (list, genesisList = null) {
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
    const sortedTip = sortPubkeysBip67(tip).map((b) => b.toString('hex'));

    if (!genesisList) return sortedTip;
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
    const sortedGenesis = sortPubkeysBip67(genesis).map((b) => b.toString('hex'));

    const tipX = sortedTip.map((c) => pubkeyXOnly(c)).filter(Boolean).sort();
    const genX = sortedGenesis.map((c) => pubkeyXOnly(c)).filter(Boolean).sort();
    if (tipX.length && tipX.length === genX.length && tipX.every((x, i) => x === genX[i])) {
      return sortedGenesis;
    }
    return sortedTip;
  }

  /**
   * Normalize a CONTRACT_PUBLISH definition (or Hub-stored genesis) into ARC fields.
   * Accepts legacy shapes: `messageTypes`, `proposedPolicy.validators`, etc.
   *
   * @param {object} definition
   * @returns {object}
   */
  static normalizeGenesis (definition = {}) {
    const def = definition && typeof definition === 'object' ? definition : {};
    const membersBag = def.members && typeof def.members === 'object' ? def.members : {};
    const proposed = def.proposedPolicy && typeof def.proposedPolicy === 'object'
      ? def.proposedPolicy
      : {};
    const spendIn = def.spendPolicy && typeof def.spendPolicy === 'object' ? def.spendPolicy : {};

    const signers = Contract.toCompressedPubkeys(
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
      : Contract.toCompressedPubkeys(readersRaw);

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
        ? Contract.toCompressedPubkeys(spendIn.validators)
        : signers.slice(),
      threshold: Math.min(
        Math.max(1, Number(spendIn.threshold != null ? spendIn.threshold : threshold) || 1),
        Math.max(1, (spendIn.validators && spendIn.validators.length)
          ? Contract.toCompressedPubkeys(spendIn.validators).length
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
      // Product fields (groupId, parentContract, …) kept for Hub.
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
   * {@link Contract.resolveSpend} then keeps genesis validators.
   * @param {object} tip
   * @returns {Array}
   */
  static tipSpendKeys (tip = {}) {
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
   * Canonical authority spendPolicy bag shared by Beacon ARC, vault, and {@link Contract.resolveSpend}.
   * @param {object} [opts]
   * @returns {object}
   */
  static canonicalSpendPolicy (opts = {}) {
    const validators = Contract.toCompressedPubkeys(opts.validators || opts.signers || []);
    if (!validators.length) {
      throw new Error('canonicalSpendPolicy: validators required');
    }
    const threshold = Math.max(
      1,
      Math.min(Number(opts.threshold) || 1, validators.length)
    );
    let publisher = null;
    if (opts.publisher) {
      const p = Contract.toCompressedPubkeys([opts.publisher]);
      publisher = p[0] || null;
    }
    if (!publisher) publisher = validators[0];
    const csvBlocks = Math.max(1, Number(opts.csvBlocks) || Policy.DEFAULT_CSV_BLOCKS);
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
    if (opts.internalKeyMode) {
      const mode = String(opts.internalKeyMode).trim().toLowerCase();
      if (mode === 'musig2' || mode === 'auto') {
        out.internalKeyMode = 'musig2';
      } else if (mode === 'nums') {
        out.internalKeyMode = 'nums';
      } else {
        throw new Error(
          'canonicalSpendPolicy: internalKeyMode must be "musig2", "auto", or "nums"'
        );
      }
    }
    return out;
  }

  /**
   * Nested tip anchor used by Hub tracked accept / summarize.
   * @param {Object} [opts]
   * @param {string} [opts.blockHash]
   * @param {number} [opts.height]
   * @param {string} [opts.bitcoinBlockHash] alias of `blockHash`
   * @param {number} [opts.bitcoinHeight] alias of `height`
   * @returns {Object|null} `{ blockHash, height }`
   */
  static nestBitcoinAnchor (opts = {}) {
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
   * @param {Object} opts
   * @param {Object} [opts.genesis] CONTRACT_PUBLISH definition or {@link Contract.normalizeGenesis} output
   * @param {Object} [opts.tip] `{ content, stateDigest, bitcoinBlockHash, … }` (`content.signers` or `content.members`)
   * @param {Object} [opts.overrides] network / spendPolicy overrides
   * @returns {object}
   */
  static resolveSpend (opts = {}) {
    const genesis = opts.genesis && opts.genesis.members && opts.genesis.spendPolicy
      ? opts.genesis
      : Contract.normalizeGenesis(opts.genesis || {});
    const tip = opts.tip && typeof opts.tip === 'object' ? opts.tip : {};
    const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {};

    const tipMembers = Contract.tipSpendKeys(tip);
    const genesisKeys = genesis.spendPolicy.validators.length
      ? genesis.spendPolicy.validators.slice()
      : genesis.members.signers.slice();
    const validators = tipMembers.length
      ? Contract.toCompressedPubkeys(tipMembers, genesisKeys)
      : Contract.toCompressedPubkeys(genesisKeys);

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
      : Policy.DEFAULT_CSV_BLOCKS;

    const built = policyInput.tiers && policyInput.tiers.length
      ? Policy.compile(policyInput)
      : Policy.compile(Policy.synthesizeDefaultLadder({
        validators,
        threshold,
        network,
        publisher: policyInput.publisher,
        csvBlocks,
        softMode: policyInput.softMode,
        softThreshold: policyInput.softThreshold,
        hashlock: policyInput.hashlock || null,
        extraLeaves: policyInput.extraLeaves || null,
        internalKeyMode: policyInput.internalKeyMode
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
    const bitcoinAnchor = Contract.nestBitcoinAnchor({
      blockHash: bitcoinBlockHash,
      height: bitcoinHeight
    });

    const resolvedCsv = soft && soft.after && soft.after.blocks != null
      ? Number(soft.after.blocks)
      : csvBlocks;

    return {
      contractId: tip.contractId || opts.contractId || null,
      address: built.address,
      // Alias used by vault / tracked summaries.
      spendAddress: built.address,
      network: built.network,
      policy: built.policy,
      leaves: built.leaves,
      internalPubkeyHex: built.internalPubkeyHex || null,
      validators,
      threshold,
      csvBlocks: resolvedCsv,
      // Deposit UX alias of csvBlocks (same ladder delay).
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
        // Effective mode (one-validator musig2 still builds NUMS).
        internalKeyMode: built.internalPubkeyHex === Policy.TAPROOT_INTERNAL_NUMS.toString('hex')
          ? 'nums'
          : 'musig2',
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
  static withdrawalRequestCommitmentFields (object = {}) {
    const amountRaw = object.amountSats != null ? Number(object.amountSats) : NaN;
    return {
      contractId: String(object.contractId || '').trim().toLowerCase(),
      stateDigest: String(object.stateDigest || '').trim().toLowerCase(),
      bitcoinBlockHash: String(object.bitcoinBlockHash || '').trim().toLowerCase(),
      destinationAddress: String(object.destinationAddress || object.destination || '').trim(),
      amountSats: Number.isFinite(amountRaw) ? Math.max(0, Math.round(amountRaw)) : 0,
      feeSats: Math.max(0, Number(object.feeSats) || 0),
      action: object.action === 'migrate' ? 'migrate' : 'spend',
      // Hash what the wire carries: JSON drops undefined properties.
      after: object.after ? JSON.parse(JSON.stringify(object.after)) : null,
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
  static computeWithdrawalRequestId (object) {
    return sha256hex(fabricCanonicalJson(Contract.withdrawalRequestCommitmentFields(object)));
  }

  /**
   * @param {object} object ContractWithdrawalRequest body
   * @param {object} tip Current tip (must include stateDigest + bitcoinBlockHash)
   * @param {Object} [opts]
   * @param {Object} [opts.genesis] Optional ARC genesis for policy checks
   * @returns {{ok: boolean, error: (string|undefined)}}
   */
  static validateWithdrawalRequest (object, tip, opts = {}) {
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

    const amountRaw = object.amountSats != null ? Number(object.amountSats) : NaN;
    if (!Number.isFinite(amountRaw) || !Number.isInteger(amountRaw) || amountRaw < 546) {
      return { ok: false, error: 'amountSats required (integer >= 546)' };
    }

    const genesis = opts.genesis
      || (opts.meta && opts.meta.genesis)
      || tip.genesis
      || null;
    const programCheck = Program.validateBinding({
      object,
      tip,
      genesis: genesis || {}
    });
    if (!programCheck.ok) return programCheck;

    // requestId MUST bind destination/amount/fee/vault (witness signs only requestId).
    const gotId = String(object.requestId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(gotId)) {
      return { ok: false, error: 'requestId required (64-hex)' };
    }
    const expectedId = Contract.computeWithdrawalRequestId(object);
    if (gotId !== expectedId) {
      return { ok: false, error: 'requestId does not match withdrawal commitment' };
    }

    return { ok: true };
  }

  /**
   * Build a tip-bound ContractWithdrawalRequest object.
   * When the tip seals `content.program`, its digests are copied onto the request
   * (Machine/Program run binding — does not alter the P2TR address).
   * @param {object} opts
   * @returns {object}
   */
  static buildWithdrawalRequest (opts = {}) {
    const tip = opts.tip || {};
    const contractId = String(opts.contractId || tip.contractId || '').trim().toLowerCase();
    if (!contractId) throw new Error('contractId required');
    if (!tip.stateDigest) throw new Error('tip.stateDigest required');
    if (!tip.bitcoinBlockHash) throw new Error('tip.bitcoinBlockHash required');

    const destinationAddress = String(opts.destinationAddress || opts.destination || '').trim();
    if (!destinationAddress) throw new Error('destinationAddress required');

    const tipProgram = Program.runFromTip(tip);
    const programHash = opts.programHash
      ? String(opts.programHash).trim().toLowerCase()
      : (tipProgram && tipProgram.programHash);
    const runCommitmentHex = opts.runCommitmentHex
      ? String(opts.runCommitmentHex).trim().toLowerCase()
      : (tipProgram && tipProgram.runCommitmentHex);

    const amountRaw = opts.amountSats != null ? Number(opts.amountSats) : NaN;
    if (!Number.isFinite(amountRaw) || !Number.isInteger(amountRaw) || amountRaw < 546) {
      throw new Error('amountSats required (integer >= 546)');
    }

    const object = {
      type: Contract.WITHDRAWAL_REQUEST,
      v: 1,
      contractId,
      stateDigest: String(tip.stateDigest).toLowerCase(),
      bitcoinBlockHash: String(tip.bitcoinBlockHash).toLowerCase(),
      clock: tip.clock != null ? Number(tip.clock) : 0,
      destinationAddress,
      amountSats: Math.round(amountRaw),
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

    object.requestId = Contract.computeWithdrawalRequestId(object);
    const check = Contract.validateWithdrawalRequest(object, tip, { genesis: opts.genesis });
    if (!check.ok) throw new Error(check.error);
    return object;
  }

  /**
   * Canonical UTF-8 message for BIP340 withdrawal co-sign attestations.
   * @param {object} fields
   * @returns {string}
   */
  static withdrawalWitnessSigningMessage (fields = {}) {
    const requestId = String(fields.requestId || '').trim().toLowerCase();
    const stateDigest = String(fields.stateDigest || '').trim().toLowerCase();
    const bitcoinBlockHash = String(fields.bitcoinBlockHash || '').trim().toLowerCase();
    return `fabric:contract-withdrawal-witness:1:${requestId}:${stateDigest}:${bitcoinBlockHash}`;
  }

  /**
   * Verify BIP340 witness signature over {@link Contract.withdrawalWitnessSigningMessage}.
   * @param {object} witness
   * @returns {{ok: boolean, error: (string|undefined)}}
   */
  static verifyWithdrawalWitnessSignature (witness = {}) {
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
      const msg = Contract.withdrawalWitnessSigningMessage({
        requestId,
        stateDigest: witness.stateDigest,
        bitcoinBlockHash: witness.bitcoinBlockHash
      });
      if (!key.verifySchnorr(msg, Buffer.from(sigHex, 'hex'), SIGNING_TAGS.CONTRACT_WITHDRAWAL_WITNESS)) {
        return { ok: false, error: 'invalid witness signature' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || 'witness verify failed' };
    }
  }

  /**
   * Build a ContractWithdrawalWitness, signing with `opts.signerKey` when no signature is given.
   * @param {object} opts
   * @returns {object}
   */
  static buildWithdrawalWitness (opts = {}) {
    const request = opts.request || opts.withdrawalRequest || {};
    const requestId = String(opts.requestId || request.requestId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(requestId)) throw new Error('requestId required');
    const signer = String(opts.signer || '').trim().toLowerCase();
    if (!signer) throw new Error('signer required');
    let signature = String(opts.signature || '').trim().toLowerCase();
    const stateDigest = String(opts.stateDigest || request.stateDigest || '').toLowerCase() || undefined;
    const bitcoinBlockHash = String(opts.bitcoinBlockHash || request.bitcoinBlockHash || '').toLowerCase() || undefined;
    if (!signature && opts.signerKey && typeof opts.signerKey.signSchnorr === 'function') {
      const msg = Contract.withdrawalWitnessSigningMessage({ requestId, stateDigest, bitcoinBlockHash });
      signature = Buffer.from(opts.signerKey.signSchnorr(msg, SIGNING_TAGS.CONTRACT_WITHDRAWAL_WITNESS)).toString('hex');
    }
    if (!signature) throw new Error('signature required');
    return {
      type: Contract.WITHDRAWAL_WITNESS,
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
  static prepareWithdrawalFromRequest (opts = {}) {
    const request = opts.request;
    if (!opts.tip || typeof opts.tip !== 'object') {
      throw new Error('prepareWithdrawalFromRequest: explicit tip required (do not derive tip from request)');
    }
    const tip = opts.tip;
    const check = Contract.validateWithdrawalRequest(request, tip, { genesis: opts.genesis });
    if (!check.ok) throw new Error(check.error);

    const spend = opts.spend || Contract.resolveSpend({
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
      amountSats: request.amountSats,
      feeSats: request.feeSats,
      tierId: request.tierId,
      leafId: opts.leafId || request.tierId,
      networkName: spend.network || opts.networkName,
      ctx: opts.ctx || {}
    };

    let prep;
    if (request.action === 'migrate') {
      prep = Policy.prepareDecayMigrationPsbt(common);
    } else {
      prep = Policy.prepareVaultWithdrawalPsbt(common);
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

  /**
   * Count distinct validator BIP340 witnesses for a withdrawal request.
   * @param {object} request
   * @param {object[]} witnesses
   * @param {string[]} validatorPubkeys
   * @returns {number}
   */
  static countValidWithdrawalWitnesses (request, witnesses, validatorPubkeys) {
    if (!request || typeof request !== 'object') return 0;
    if (!Array.isArray(witnesses) || !witnesses.length) return 0;
    const validators = new Set(
      (Array.isArray(validatorPubkeys) ? validatorPubkeys : [])
        .map((p) => pubkeyXOnly(p) || String(p || '').toLowerCase())
        .filter((p) => /^[0-9a-f]{64}$/.test(p))
    );
    if (!validators.size) return 0;
    const requestId = String(request.requestId || '').trim().toLowerCase();
    const seen = new Set();
    let valid = 0;
    for (const w of witnesses) {
      if (!w || typeof w !== 'object') continue;
      if (String(w.requestId || '').trim().toLowerCase() !== requestId) continue;
      const signer = pubkeyXOnly(w.signer) || String(w.signer || '').toLowerCase();
      if (!validators.has(signer) || seen.has(signer)) continue;
      const check = Contract.verifyWithdrawalWitnessSignature(Object.assign({}, w, {
        stateDigest: w.stateDigest || request.stateDigest,
        bitcoinBlockHash: w.bitcoinBlockHash || request.bitcoinBlockHash
      }));
      if (!check.ok) continue;
      seen.add(signer);
      valid += 1;
    }
    return valid;
  }

  /**
   * @param {object} request
   * @param {object[]} witnesses
   * @param {string[]} validatorPubkeys
   * @param {number} threshold
   * @returns {{ok: boolean, count: number, error: (string|undefined)}}
   */
  static meetWithdrawalWitnessThreshold (request, witnesses, validatorPubkeys, threshold) {
    const thr = Math.max(1, Number(threshold) || 1);
    const count = Contract.countValidWithdrawalWitnesses(request, witnesses, validatorPubkeys);
    if (count < thr) {
      return {
        ok: false,
        count,
        error: `need ${thr} withdrawal witnesses, have ${count}`
      };
    }
    return { ok: true, count };
  }

  get contract () {
    const contract = `
      $A = ${this._state.content.signers[0]};
      likely@$A
    `;
    return contract.trim();
  }

  /**
   * Deploys the contract.
   * @returns {String} Message ID.
   */
  deploy () {
    // Attest to local time
    const now = (new Date()).toISOString();
    const input = {
      clock: 0,
      validators: []
    };

    // First message (genesis). A stored record, not sent: `P2P_BASE_MESSAGE` is
    // what the unregistered `CONTRACT_GENESIS` name always resolved to.
    const PACKET_CONTRACT_GENESIS = Message.fromVector(['P2P_BASE_MESSAGE', JSON.stringify({
      type: 'CONTRACT_GENESIS',
      object: {
        input: input
      }
    })]).signWithKey(this.key).toBuffer();

    // Get hash of message
    const hash = crypto.createHash('sha256').update(PACKET_CONTRACT_GENESIS).digest('hex');

    // Store locally
    this.messages[hash] = PACKET_CONTRACT_GENESIS.toString('hex');

    // Contract template
    const template = {
      author: this.key.pubkey,
      bond: null, // BTC transaction which is spent
      checksum: '',
      created: now,
      genesis: hash,
      history: [ hash ], // most recent first
      messages: Object.assign({}, this.messages),
      name: this.settings.name,
      signature: '',
      state: input,
      version: 1
    };

    // Track our contract by Actor ID
    this.actor = new Actor(template);
    this.emit('log', `Deploying Contract [0x${this.actor.id}] (${PACKET_CONTRACT_GENESIS.byteLength} bytes): ${this.messages[hash]}`);

    // Network publish message: the body is the definition itself, so peers
    // derive the same namespace id (`Actor(template).id`).
    const PACKET_CONTRACT_PUBLISH = Message.fromLegacyBody('CONTRACT_PUBLISH', template).signWithKey(this.key);

    const signed = PACKET_CONTRACT_PUBLISH.signWithKey(this.key);
    const pubhash = crypto.createHash('sha256').update(signed.toBuffer()).digest('hex');

    this.messages[pubhash] = PACKET_CONTRACT_PUBLISH.toString('hex');
    this.emit('message', signed);

    return this;
  }

  toDot () {
  }

  parse (input) {
    return this.parseDot(input);
  }

  parseDot (input) {
    const contract = Contract.fromDot(input);
    this.settings.graphs = contract.settings.graphs;
    this.settings.circuit = contract.settings.circuit;
    this.graphs = contract.graphs;
    return this;
  }

  /**
   * Start the Contract.
   * @returns {Contract} State "STARTED" iteration of the Contract.
   */
  start () {
    this.state.status = 'STARTING';
    this.state.status = 'STARTED';
    this.commit();
    return this;
  }

  abort () {
    // broadcast L1 transaction
  }

  commit () {
    const now = new Date();
    const changes = monitor.generate(this.observer);

    if (changes.length) {
      // The monitor has already consumed these changes: listeners get them
      // even when the diff is too large for one message.
      this.emit('changes', changes);
      try {
        const message = Message.fromLegacyBody('CONTRACT_MESSAGE', {
          contract: this.id,
          type: LOG_TYPES.ContractMessage,
          ops: changes
        });
        this.emit('message', message);
      } catch (err) {
        this.emit('warning', `[CONTRACT] commit message not built: ${err && err.message ? err.message : err}`);
      }
    }

    let stateDigest = null;
    try {
      stateDigest = this.contentDigest(0);
    } catch (err) {
      this.emit('warning', `[CONTRACT] state digest not built: ${err && err.message ? err.message : err}`);
    }
    this.emit('commit', {
      created: now.toISOString(),
      stateDigest: stateDigest
    });

    return this;
  }

  execute () {
    return this.run();
  }

  run () {
    this.signWith(this.settings.identity);
    this.state.status = 'COMPLETED';
    this.commit();
    this.emit('contract', this.toGenericMessage());
    return this;
  }

  signWith (identity) {
    const baseline = this.toGenericMessage();
    const json = JSON.stringify(baseline); // native JSON.stringify
    const buffer = Buffer.from(json, 'utf8');

    const signer = new Key(identity);
    const signature = signer.sign(buffer);

    return { signature };
  }

  _handleActivity (activity) {
    return new Promise((resolve, reject) => {
      try {
        if (activity == null || typeof activity !== 'object') {
          return reject(new TypeError('activity must be a non-null object'));
        }
        const actor = new Actor(activity);
        return resolve({
          id: actor.id,
          type: 'Activity',
          object: actor.toGenericMessage()
        });
      } catch (exception) {
        return reject(exception);
      }
    });
  }

  /**
   * Observe an on-chain transaction for payments to this contract's spend address.
   * On success (and when `apply` is not false), folds matched sats into tip balances.
   *
   * @param {string|object} txInput raw tx hex or bitcoin.Transaction
   * @param {object} [opts]
   * @param {string} [opts.network]
   * @param {string} [opts.address] override spend address
   * @param {number} [opts.amountSats] minimum matched sats
   * @param {boolean} [opts.apply=true] fold into `_state.content` on success
   * @returns {object} observation from {@link Contract.observePayment}
   */
  _handleBitcoinTransaction (txInput, opts = {}) {
    const network = opts.network || this.settings.network;
    if (!network) {
      return {
        ok: false,
        code: 'NETWORK_REQUIRED',
        error: 'Bitcoin network required (set settings.network or opts.network; do not default to regtest)'
      };
    }
    let address = opts.address || null;
    if (!address) {
      try {
        address = this.toAddress(network);
      } catch (e) {
        return {
          ok: false,
          code: 'NO_ADDRESS',
          error: e && e.message ? e.message : 'contract spend address unavailable'
        };
      }
    }
    const observation = Contract.observePayment({
      tx: txInput,
      address,
      network,
      amountSats: opts.amountSats
    });
    if (observation.ok && opts.apply !== false) {
      const tip = {
        content: (this._state && this._state.content) || this.settings.state || {}
      };
      const next = Contract.applyPaymentObservation(tip, observation);
      if (!this._state) this._state = { content: {} };
      // Merge into the observed content object in place — replacing
      // `this._state.content` would detach `this.observer` from monitor.
      if (!this._state.content || typeof this._state.content !== 'object') {
        this._state.content = {};
      }
      const target = this._state.content;
      const incoming = next.content && typeof next.content === 'object' ? next.content : {};
      for (const key of Object.keys(target)) {
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) delete target[key];
      }
      Object.assign(target, incoming);
      if (this.settings) {
        this.settings.state = target;
      }
      observation.applied = true;
      observation.balances = target.balances;
    } else if (observation.ok) {
      observation.applied = false;
    }
    return observation;
  }

  _toUnsignedTransaction () {
    return {
      script: this.contract
    };
  }

  /**
   * Shared spend-policy inputs for {@link Contract#toTaprootContract}.
   * Subclasses (e.g. Federation) may override to supply validators from state.
   * @private
   * @param {object} [overrides]
   * @returns {object}
   */
  _taprootPolicyInputs (overrides = {}) {
    const validators = overrides.validators
      || (this.settings.proposedPolicy && this.settings.proposedPolicy.validators)
      || (this.settings.consensus && this.settings.consensus.validators)
      || this.settings.validators
      || [];
    const threshold = overrides.threshold != null
      ? overrides.threshold
      : ((this.settings.proposedPolicy && this.settings.proposedPolicy.threshold)
        || this.settings.threshold
        || 1);
    const publisher = overrides.publisher
      || this.settings.publisher
      || this.settings.creator
      || (validators[0] || null);
    const network = overrides.network
      || this.settings.network
      || null;
    if (!network) {
      throw new Error(
        'Contract Bitcoin network required (set settings.network or pass overrides.network; do not default to regtest)'
      );
    }
    const csvBlocks = overrides.csvBlocks != null
      ? overrides.csvBlocks
      : (this.settings.csvBlocks != null ? this.settings.csvBlocks : Policy.DEFAULT_CSV_BLOCKS);
    return { validators, threshold, publisher, network, csvBlocks };
  }

  /**
   * Build deterministic P2TR spend tree from settings.spendLadder or synthesized
   * validators / publisher policy.
   * @param {object} [overrides]
   * @returns {object} {@link Policy.compile}
   */
  toTaprootContract (overrides = {}) {
    const ladder = overrides.spendLadder || this.settings.spendLadder || null;
    if (ladder) {
      const network = overrides.network || this.settings.network || ladder.network;
      if (!network) {
        throw new Error(
          'Contract Bitcoin network required (set settings.network, ladder.network, or overrides.network)'
        );
      }
      return Policy.compile({ ...ladder, ...overrides, network });
    }
    const inputs = this._taprootPolicyInputs(overrides);
    // Do not re-spread overrides after inputs — falsy override fields must not
    // undo resolved validators / threshold / csvBlocks / network.
    return Policy.compile(Policy.synthesizeDefaultLadder(inputs));
  }

  /**
   * Bech32m P2TR address for this contract's spend policy.
   * @param {string} [network]
   * @returns {string}
   */
  toAddress (network) {
    const built = this.toTaprootContract(network ? { network } : {});
    return built.address;
  }

  /**
   * Resolve tip + genesis spend policy to the public P2TR surface (ARC).
   * @param {object} [opts]
   * @param {object} [opts.tip]
   * @param {object} [opts.genesis] defaults to this.settings
   * @param {object} [opts.overrides]
   * @returns {object} {@link Contract.resolveSpend}
   */
  resolveSpend (opts = {}) {
    return Contract.resolveSpend({
      genesis: opts.genesis || this.settings,
      tip: opts.tip || {
        contractId: this.id || null,
        content: (this._state && this._state.content) || this.settings.state || {},
        stateDigest: opts.stateDigest || null,
        bitcoinBlockHash: opts.bitcoinBlockHash
          || (this.settings.bitcoinAnchor && this.settings.bitcoinAnchor.blockHash)
          || null,
        bitcoinHeight: opts.bitcoinHeight != null
          ? opts.bitcoinHeight
          : ((this.settings.bitcoinAnchor && this.settings.bitcoinAnchor.height) || null),
        clock: (this._state && this._state.content && this._state.content.clock) || 0
      },
      contractId: opts.contractId || this.id || null,
      overrides: opts.overrides
    });
  }
}

const Resolutions = (function () {
/**
 * @fileoverview State tree of pre-signed, timelocked exits for a Fabric
 * contract whose state advances off-chain (payment channels, provider
 * deposits, …). A state is **resolvable** when every exit it depends on
 * carries all required signatures, so either party can close it on L1 without
 * the counterparty's cooperation. Contracts refuse to treat a state as live
 * until it is resolvable — "lack of response" then always has an on-chain
 * answer (BOLT 2's funding_signed-before-broadcast, generalised).
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');

const Actor = require('./actor');
const Tree = require('./tree');
const Witness = require('./witness');
const ecc = require('./ecc');
const Htlc = require('./htlc');
const { networkForFabricName } = require('./policy');

const HEX64 = /^[0-9a-f]{64}$/;
const HEX66 = /^[0-9a-f]{66}$/;

/** Exit kinds. */
const EXIT_KINDS = Object.freeze({
  TIMEOUT: 'timeout',
  PENALTY: 'penalty',
  REFUND: 'refund',
  COMMITMENT: 'commitment',
  CHECKIN: 'checkin'
});

/** `CONTRACT_MESSAGE` body carrying one exit signature. */
const EXIT_SIGNATURE_TYPE = 'ContractExitSignature';

/**
 * Normalise a compressed (66) or x-only (64) hex pubkey to x-only lowercase.
 * @private
 * @param {string} pubkey
 * @returns {string}
 */
function xOnly (pubkey) {
  const s = String(pubkey || '').trim().toLowerCase();
  if (HEX66.test(s)) return s.slice(2);
  if (HEX64.test(s)) return s;
  throw new Error(`Resolutions: pubkey must be 32/33-byte hex, got ${s.length / 2} bytes`);
}

/**
 * Tapleaf hash of input 0's first `tapLeafScript` entry.
 * @private
 * @param {Object} psbt bitcoinjs Psbt
 * @returns {Buffer}
 */
function leafHashOf (psbt) {
  const input = psbt.data.inputs[0];
  const leaf = input && input.tapLeafScript && input.tapLeafScript[0];
  if (!leaf) throw new Error('Resolutions: exit PSBT input 0 carries no tapLeafScript');
  return bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
}

/**
 * State tree of pre-signed exits. Pure data plus Schnorr verification; no I/O.
 * @class Resolutions
 * @extends Actor
 */
class Resolutions extends Actor {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] Fabric network name
   * @param {Object} [settings.states] import snapshot (`export()` output)
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({ network: 'regtest' }, settings);
    /** @type {Map<string, { parent: string|null, exits: Map<string, Object> }>} */
    this._states = new Map();
    if (settings.states) this.import({ states: settings.states });
    return this;
  }

  static get KINDS () { return EXIT_KINDS; }
  static get EXIT_SIGNATURE_TYPE () { return EXIT_SIGNATURE_TYPE; }

  /** @returns {string[]} known state ids (insertion order). */
  get stateIds () { return Array.from(this._states.keys()); }

  /**
   * Declare a state node (idempotent).
   * @param {string} stateId
   * @param {string|null} [parent] parent state id (tree edge)
   * @returns {Resolutions}
   */
  declare (stateId, parent = null) {
    const id = String(stateId);
    if (!this._states.has(id)) this._states.set(id, { parent: parent != null ? String(parent) : null, exits: new Map() });
    return this;
  }

  /**
   * Register an exit a state depends on. Signatures already present on the
   * PSBT are harvested into `signers.have`.
   * @param {string} stateId
   * @param {Object} exit
   * @param {string} exit.id unique within the state
   * @param {string} exit.kind one of {@link Resolutions.KINDS}
   * @param {string} exit.psbtBase64 unsigned (or partially signed) tapscript spend, input 0
   * @param {string[]} exit.required pubkeys (compressed or x-only hex) whose signatures make it broadcastable
   * @param {Object} [exit.locktime] `{ height }` (nLockTime / CLTV) and/or `{ csv }` (relative)
   * @param {Object} [exit.spends] `{ txid, vout }` the exit consumes
   * @param {Object} [exit.meta] free-form (never secrets)
   * @returns {Object} stored exit record
   */
  addExit (stateId, exit = {}) {
    const id = String(stateId);
    this.declare(id);
    if (!exit || !exit.id) throw new Error('addExit: exit.id required');
    if (!Object.values(EXIT_KINDS).includes(exit.kind)) throw new Error(`addExit: unknown exit kind ${exit.kind}`);
    if (!exit.psbtBase64) throw new Error('addExit: psbtBase64 required');
    const required = Array.from(new Set((exit.required || []).map(xOnly)));
    if (!required.length) throw new Error('addExit: at least one required signer');
    const psbt = this._psbt(exit.psbtBase64);
    const tx = psbt.__CACHE.__TX;
    const input = tx.ins[0];
    const record = {
      id: String(exit.id),
      kind: exit.kind,
      psbtBase64: psbt.toBase64(),
      txid: tx.getId(),
      locktime: Object.assign({}, exit.locktime || {}, tx.locktime > 0 && !(exit.locktime && exit.locktime.height) ? { height: tx.locktime } : {}),
      spends: exit.spends || (input ? { txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index } : null),
      signers: { required, have: {} },
      meta: exit.meta || {}
    };
    // A harvested signature counts only if it is over this spend through the
    // exit's one leaf, by that key.
    const leaves = psbt.data.inputs[0].tapLeafScript || [];
    for (const s of (psbt.data.inputs[0].tapScriptSig || [])) {
      const pk = Buffer.from(s.pubkey).toString('hex');
      if (!required.includes(pk)) continue;
      if (leaves.length !== 1 || !Buffer.from(s.leafHash).equals(leafHashOf(psbt))) throw new Error(`addExit: signature by ${pk} is not on the exit's leaf`);
      const signatureHex = Buffer.from(s.signature).toString('hex');
      const check = this._verifySignature(record, pk, signatureHex);
      if (!check.ok) throw new Error(`addExit: signature by ${pk} does not verify (${check.reason})`);
      record.signers.have[pk] = signatureHex;
    }
    this._states.get(id).exits.set(record.id, record);
    return record;
  }

  /**
   * @param {string} stateId
   * @param {string} exitId
   * @returns {Object|null}
   */
  getExit (stateId, exitId) {
    const node = this._states.get(String(stateId));
    return node ? node.exits.get(String(exitId)) || null : null;
  }

  /**
   * Sign an exit with a 32-byte private key and record the signature.
   * @param {string} stateId
   * @param {string} exitId
   * @param {Buffer|string} priv32
   * @returns {Object} `ContractExitSignature` artifact (JSON-safe) for the counterparty
   */
  signExit (stateId, exitId, priv32) {
    const exit = this._exitOrThrow(stateId, exitId);
    const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex');
    if (priv.length !== 32) throw new Error('signExit: 32-byte private key required');
    const pubkey = Witness.xOnlyPubkeyHex(priv);
    if (!exit.signers.required.includes(pubkey)) throw new Error('signExit: key is not a required signer of this exit');
    const psbt = this._psbt(exit.psbtBase64);
    psbt.signInput(0, Htlc.signerFromPriv32(priv));
    const sig = (psbt.data.inputs[0].tapScriptSig || []).find((s) => Buffer.from(s.pubkey).toString('hex') === pubkey);
    if (!sig) throw new Error('signExit: signer produced no tapscript signature');
    const signatureHex = Buffer.from(sig.signature).toString('hex');
    exit.signers.have[pubkey] = signatureHex;
    return Witness.signArtifact({
      type: EXIT_SIGNATURE_TYPE,
      version: 1,
      contractId: this.settings.contractId || null,
      stateId: String(stateId),
      exitId: String(exitId),
      txid: exit.txid,
      signerPubkey: pubkey,
      exitSignature: signatureHex
    }, priv);
  }

  /**
   * Accept a counterparty's `ContractExitSignature` artifact after verifying
   * both the artifact signature and the tapscript signature it carries.
   * @param {Object} artifact output of {@link Resolutions#signExit}
   * @returns {{ ok: boolean, reason: (string|undefined), stateId: (string|undefined), exitId: (string|undefined) }}
   */
  ingest (artifact) {
    if (!artifact || artifact.type !== EXIT_SIGNATURE_TYPE) return { ok: false, reason: 'not a ContractExitSignature' };
    if (!Witness.verifyArtifact(artifact)) return { ok: false, reason: 'artifact signature invalid' };
    if (String(artifact.signerPubkey).toLowerCase() !== String(artifact.pubkey).toLowerCase()) return { ok: false, reason: 'artifact signer differs from exit signer' };
    if (this.settings.contractId && artifact.contractId && String(artifact.contractId) !== String(this.settings.contractId)) {
      return { ok: false, reason: 'artifact names another contract' };
    }
    const exit = this.getExit(artifact.stateId, artifact.exitId);
    if (!exit) return { ok: false, reason: 'unknown exit' };
    if (exit.txid !== String(artifact.txid || '').toLowerCase()) return { ok: false, reason: 'signature is on a different transaction' };
    const pubkey = String(artifact.signerPubkey).toLowerCase();
    if (!exit.signers.required.includes(pubkey)) return { ok: false, reason: 'signer is not required by this exit' };
    const check = this._verifySignature(exit, pubkey, String(artifact.exitSignature || ''));
    if (!check.ok) return check;
    exit.signers.have[pubkey] = String(artifact.exitSignature).toLowerCase();
    return { ok: true, stateId: String(artifact.stateId), exitId: String(artifact.exitId) };
  }

  /**
   * Re-verify every held signature on an exit against its PSBT.
   * @param {string} stateId
   * @param {string} exitId
   * @returns {{ ok: boolean, reason: (string|undefined), missing: Array<string> }}
   */
  verifyExit (stateId, exitId) {
    const exit = this._exitOrThrow(stateId, exitId);
    for (const [pubkey, sig] of Object.entries(exit.signers.have)) {
      const check = this._verifySignature(exit, pubkey, sig);
      if (!check.ok) return Object.assign(check, { missing: this.missingSigners(exit) });
    }
    const missing = this.missingSigners(exit);
    return missing.length ? { ok: false, reason: `missing ${missing.length} signature(s)`, missing } : { ok: true, missing };
  }

  /**
   * @param {Object} exit
   * @returns {string[]} required x-only pubkeys without a held signature
   */
  missingSigners (exit) {
    return exit.signers.required.filter((pk) => !exit.signers.have[pk]);
  }

  /**
   * A state is resolvable when it (and every ancestor it inherits exits from)
   * holds all required signatures on all exits.
   * @param {string} stateId
   * @returns {boolean}
   */
  resolvable (stateId) {
    return this.missing(stateId).length === 0;
  }

  /**
   * What still has to be exchanged before `stateId` is live.
   * @param {string} stateId
   * @returns {Array<{ stateId: string, exitId: string, kind: string, missing: string[] }>}
   */
  missing (stateId) {
    const out = [];
    let id = String(stateId);
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      seen.add(id);
      const node = this._states.get(id);
      if (!node) { out.push({ stateId: id, exitId: null, kind: null, missing: ['state not declared'] }); break; }
      for (const exit of node.exits.values()) {
        const missing = this.missingSigners(exit);
        if (missing.length) out.push({ stateId: id, exitId: exit.id, kind: exit.kind, missing });
      }
      id = node.parent;
    }
    return out;
  }

  /**
   * Exits that become broadcastable at or after `height` (absolute locks only).
   * @param {number} height
   * @param {string} [stateId] restrict to one state
   * @returns {Object[]}
   */
  exitsAfter (height, stateId = null) {
    const h = Number(height);
    const out = [];
    for (const [id, node] of this._states) {
      if (stateId != null && id !== String(stateId)) continue;
      for (const exit of node.exits.values()) {
        const lock = exit.locktime && exit.locktime.height != null ? Number(exit.locktime.height) : 0;
        if (lock <= h) out.push(Object.assign({ stateId: id }, exit));
      }
    }
    return out;
  }

  /**
   * Fully-signed exit as a broadcastable transaction.
   * @param {string} stateId
   * @param {string} exitId
   * @returns {{ txHex: string, txid: string }}
   */
  finalizeExit (stateId, exitId) {
    const exit = this._exitOrThrow(stateId, exitId);
    const missing = this.missingSigners(exit);
    if (missing.length) throw new Error(`finalizeExit: missing ${missing.length} signature(s)`);
    const psbt = this._withSignatures(exit, exit.signers.have);
    const { finalizeSpendPsbt } = require('./policy');
    return finalizeSpendPsbt({ psbt });
  }

  /**
   * Bitcoin-style Merkle tree over `SHA256(stateId|exitId|txid)` for audit.
   * @returns {Tree}
   */
  toTree () {
    const leaves = [];
    for (const [id, node] of this._states) {
      for (const exit of node.exits.values()) {
        leaves.push(crypto.createHash('sha256').update(`${id}|${exit.id}|${exit.txid}`).digest('hex'));
      }
    }
    return new Tree({ leaves, sortLeaves: true });
  }

  /** @returns {string} hex Merkle root (empty tree → 64 zeros). */
  get rootHex () {
    const tree = this.toTree();
    return tree.settings.leaves.length ? tree.rootHex : '0'.repeat(64);
  }

  /** @returns {Object} JSON-safe snapshot (no private material). */
  export () {
    const states = {};
    for (const [id, node] of this._states) {
      states[id] = { parent: node.parent, exits: Array.from(node.exits.values()).map((e) => JSON.parse(JSON.stringify(e))) };
    }
    return { type: 'ContractResolutions', version: 1, network: this.settings.network, states };
  }

  /**
   * Load a snapshot. Every held signature is re-verified against its PSBT;
   * ones that do not verify are dropped (the exit then reports them missing).
   * @param {Object} snapshot output of {@link Resolutions#export}
   * @returns {Resolutions}
   */
  import (snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.states) return this;
    for (const [id, node] of Object.entries(snapshot.states)) {
      this.declare(id, node.parent);
      for (const exit of node.exits || []) {
        const record = this.addExit(id, Object.assign({}, exit, { required: exit.signers ? exit.signers.required : exit.required }));
        const have = (exit.signers && exit.signers.have) || {};
        for (const [pubkey, signatureHex] of Object.entries(have)) {
          const pk = String(pubkey).toLowerCase();
          if (!record.signers.required.includes(pk) || record.signers.have[pk]) continue;
          if (this._verifySignature(record, pk, String(signatureHex || '')).ok) record.signers.have[pk] = String(signatureHex).toLowerCase();
        }
      }
    }
    return this;
  }

  // -- private ---------------------------------------------------------------

  /** @private */
  _psbt (base64) {
    return bitcoin.Psbt.fromBase64(String(base64), { network: networkForFabricName(this.settings.network) });
  }

  /** @private */
  _exitOrThrow (stateId, exitId) {
    const exit = this.getExit(stateId, exitId);
    if (!exit) throw new Error(`Resolutions: unknown exit ${stateId}/${exitId}`);
    return exit;
  }

  /** @private */
  _withSignatures (exit, have) {
    const psbt = this._psbt(exit.psbtBase64);
    const leafHash = leafHashOf(psbt);
    const input = psbt.data.inputs[0];
    // Replace, never keep, an embedded signature for the same key: what is
    // checked (and finalized) is exactly the signature held for it.
    if (input.tapScriptSig) {
      const kept = input.tapScriptSig.filter((s) => !have[Buffer.from(s.pubkey).toString('hex')]);
      if (kept.length) input.tapScriptSig = kept;
      else delete input.tapScriptSig;
    }
    const add = [];
    for (const [pubkey, sig] of Object.entries(have)) {
      add.push({ pubkey: Buffer.from(pubkey, 'hex'), leafHash, signature: Buffer.from(sig, 'hex') });
    }
    if (add.length) psbt.updateInput(0, { tapScriptSig: add });
    return psbt;
  }

  /** @private */
  _verifySignature (exit, pubkey, signatureHex) {
    if (!/^[0-9a-f]{128}$/i.test(signatureHex) && !/^[0-9a-f]{130}$/i.test(signatureHex)) return { ok: false, reason: 'exit signature is not a Schnorr signature' };
    try {
      const psbt = this._withSignatures(exit, { [pubkey]: signatureHex.toLowerCase() });
      const ok = psbt.validateSignaturesOfInput(0, (pk, msghash, sig) => ecc.verifySchnorr(msghash, pk, sig), Buffer.from(pubkey, 'hex'));
      return ok ? { ok: true } : { ok: false, reason: 'invalid tapscript signature' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
}
  return Resolutions;
})();
Contract.Resolutions = Resolutions;

// Contract body types for tip-bound withdrawals.
Contract.WITHDRAWAL_REQUEST = CONTRACT_BODY_TYPES.ContractWithdrawalRequest;
Contract.WITHDRAWAL_WITNESS = CONTRACT_BODY_TYPES.ContractWithdrawalWitness;
Contract.WITHDRAWAL_WITNESS_TAG = SIGNING_TAGS.CONTRACT_WITHDRAWAL_WITNESS;

// Token capabilities for contract members (see Contract.issueCapability).
Contract.OP_CONTRACT_READ = 'OP_CONTRACT_READ';
Contract.OP_CONTRACT_SIGN = 'OP_CONTRACT_SIGN';

// Export before the journal loads sidechain and governance code. Those modules
// reach Federation, which extends this class. Journal is attached afterward.
module.exports = Contract;

// Resolved at the call. An eager destructure stays undefined when
// sidechainState is the module that loaded Contract.
function sidechainStateApi () {
  return require('../functions/sidechainState');
}
const {
  GOVERNANCE_ACTIONS,
  proposalIdOf,
  verifyProposalVote,
  applyGroupChangeAction,
  foldProposals
} = require('../functions/groupChangeGovernance');

const RECEIPT_TAG = SIGNING_TAGS.MESSAGE_RECEIPT;

let commitExports;

function receiptSigningMessage (messageId) {
  return `fabric:message-receipt:1:${String(messageId || '').trim().toLowerCase()}`;
}

/**
 * @param {Iterable<*>} readers
 * @returns {string[]}
 */
function normalizeReaders (readers) {
  const set = new Set();
  for (const r of readers || []) {
    const x = pubkeyXOnly(r);
    if (x) set.add(x);
  }
  return Array.from(set).sort();
}

/**
 * @param {object} opts
 * @param {string} opts.id Message id (usually wire hash)
 * @param {string} opts.contractId
 * @param {string} [opts.wireHash]
 * @param {string} [opts.contentHash]
 * @param {Iterable<*>} opts.readers
 * @returns {object}
 */
function createPending (opts = {}) {
  const id = String(opts.id || opts.wireHash || '').trim().toLowerCase();
  if (!id) throw new Error('createPending: id required');
  const contractId = String(opts.contractId || '').trim().toLowerCase();
  if (!contractId) throw new Error('createPending: contractId required');
  const readers = normalizeReaders(opts.readers);
  if (!readers.length) throw new Error('createPending: at least one reader required');
  const peers = {};
  for (const r of readers) peers[r] = {};
  return {
    id,
    contractId,
    wireHash: opts.wireHash != null ? String(opts.wireHash).toLowerCase() : id,
    contentHash: opts.contentHash != null ? String(opts.contentHash).toLowerCase() : null,
    createdAt: opts.createdAt || new Date().toISOString(),
    readers: readers.slice(),
    peers
  };
}

function _peerSlot (record, pubkey) {
  const x = pubkeyXOnly(pubkey);
  if (!x) throw new Error('invalid reader pubkey');
  // Records loaded without a peers map (legacy / partial) — init from readers
  // before slot access, matching phaseFlags' `record.peers` guard.
  if (!record.peers || typeof record.peers !== 'object') {
    record.peers = Object.create(null);
    for (const r of record.readers || []) {
      const rx = pubkeyXOnly(r);
      if (rx) record.peers[rx] = {};
    }
  }
  if (!record.peers[x] && Array.isArray(record.readers) && record.readers.includes(x)) {
    record.peers[x] = {};
  }
  if (!record.peers[x]) {
    throw new Error('pubkey not in reader set');
  }
  return { x, slot: record.peers[x] };
}

/**
 * Phase 1: mark received for a reader.
 * @param {object} record
 * @param {*} pubkey
 * @param {string} [at]
 * @returns {object}
 */
function markReceived (record, pubkey, at) {
  const { slot } = _peerSlot(record, pubkey);
  if (!slot.receivedAt) slot.receivedAt = at || new Date().toISOString();
  return record;
}

/**
 * Verify BIP340 receipt over the pending message id / wire hash.
 * @param {object} record
 * @param {*} pubkey
 * @param {string} receiptSig 64-byte hex
 * @returns {boolean}
 */
function verifyReceiptSignature (record, pubkey, receiptSig) {
  const x = pubkeyXOnly(pubkey);
  const sigHex = String(receiptSig || '').trim().toLowerCase();
  if (!x || !/^[0-9a-f]{128}$/.test(sigHex)) return false;
  const id = String((record && (record.id || record.wireHash)) || '').toLowerCase();
  if (!id) return false;
  try {
    const key = new Key({ public: `02${x}` });
    return !!key.verifySchnorr(receiptSigningMessage(id), Buffer.from(sigHex, 'hex'), RECEIPT_TAG);
  } catch (_) {
    return false;
  }
}

/**
 * Phase 2: mark receipt for a reader.
 * Requires a BIP340 `receiptSig` over {@link receiptSigningMessage}(record.id).
 * @param {object} record
 * @param {*} pubkey
 * @param {string} [at]
 * @param {string} receiptSig
 * @returns {object}
 */
function markReceipt (record, pubkey, at, receiptSig) {
  const { x, slot } = _peerSlot(record, pubkey);
  if (receiptSig == null || receiptSig === '') {
    throw new Error('receiptSig required (BIP340 over message id)');
  }
  if (!verifyReceiptSignature(record, x, receiptSig)) {
    throw new Error('invalid receiptSig');
  }
  if (!slot.receivedAt) slot.receivedAt = at || new Date().toISOString();
  if (!slot.receiptAt) {
    slot.receiptAt = at || new Date().toISOString();
    slot.receiptSig = String(receiptSig).toLowerCase();
  }
  return record;
}

/**
 * @param {object} record
 * @param {*} pubkey
 * @returns {{ received: boolean, receipt: boolean }}
 */
function phaseFlags (record, pubkey) {
  const x = pubkeyXOnly(pubkey);
  const slot = x && record && record.peers ? record.peers[x] : null;
  return {
    received: !!(slot && slot.receivedAt),
    receipt: !!(slot && slot.receiptAt)
  };
}

/**
 * True when every reader has completed both phases.
 * @param {object} record
 * @returns {boolean}
 */
function allPhasesComplete (record) {
  const readers = (record && record.readers) || [];
  if (!readers.length) return false;
  return readers.every((r) => {
    const f = phaseFlags(record, r);
    return f.received && f.receipt;
  });
}

/**
 * Aggregate UI flags: lit only when all readers completed that phase.
 * @param {object} record
 * @returns {{ received: boolean, receipt: boolean }}
 */
function aggregatePhaseFlags (record) {
  const readers = (record && record.readers) || [];
  if (!readers.length) return { received: false, receipt: false };
  return {
    received: readers.every((r) => phaseFlags(record, r).received),
    receipt: readers.every((r) => phaseFlags(record, r).receipt)
  };
}

/**
 * Records still awaiting full 2PC (for local relay queues).
 * @param {object[]} records
 * @returns {object[]}
 */
function pendingForRelay (records) {
  return (Array.isArray(records) ? records : []).filter((r) => !allPhasesComplete(r));
}

commitExports = {
  RECEIPT_TAG,
  normalizeReaders,
  receiptSigningMessage,
  createPending,
  markReceived,
  markReceipt,
  verifyReceiptSignature,
  phaseFlags,
  allPhasesComplete,
  aggregatePhaseFlags,
  pendingForRelay
};

const COLLECTION = 'contractmessages';
const ORIGINS = Object.freeze(['mesh', 'queue', 'paste', 'local']);
/** Compactable journal rows (mutations are never dropped). */
const COMPACTABLE_TYPES = Object.freeze(['GroupChat', 'MessageReceived', 'MessageReceipt']);
const ABSOLUTE_MAX_JOURNAL_ENTRIES = 20000;
const DEFAULT_MAX_JOURNAL_ENTRIES = ABSOLUTE_MAX_JOURNAL_ENTRIES;

/**
 * Body types that require current signer / federation validator (or verified
 * OP_CONTRACT_SIGN). Includes governance / invite / journal-request frames so
 * outsiders cannot advance tip clock / stateDigest with AMP-signed spam.
 */
const SIGNER_MUTATION_TYPES = Object.freeze([
  'GroupChange',
  'GroupChangeProposal',
  'GroupChangeVote',
  'FederationContractInvite',
  'FederationContractInviteResponse',
  'GroupJournalRequest',
  'ContractCapabilityGrant',
  'ContractWithdrawalRequest',
  'ContractWithdrawalWitness',
  'GroupJournalBatch',
  'GroupStateJournal'
]);

/**
 * Delivery 2PC ACKs — stored + relayed as CONTRACT_MESSAGE like any other type, but
 * excluded from tip clock / stateDigest (sidecar via contractMessageCommit).
 *
 * They are also excluded from the **synchronization filter**: ACKs never
 * themselves open a new pending 2PC row (no ack-of-ack).
 */
const DELIVERY_ACK_TYPES = Object.freeze([
  CONTRACT_BODY_TYPES.MessageReceived,
  CONTRACT_BODY_TYPES.MessageReceipt
]);

/**
 * Control-plane types excluded from delivery sync by default (still tip-stored
 * when allowed by primitives). Apps override via genesis
 * `primitives.deliverySync`.
 */
const DEFAULT_SYNC_EXCLUDE = Object.freeze([
  CONTRACT_BODY_TYPES.MessageReceived,
  CONTRACT_BODY_TYPES.MessageReceipt,
  CONTRACT_BODY_TYPES.GroupJournalRequest || 'GroupJournalRequest'
]);

function isDeliveryAckType (type) {
  return DELIVERY_ACK_TYPES.includes(String(type || ''));
}

function isCompactableType (type) {
  return COMPACTABLE_TYPES.includes(String(type || ''));
}

function clampJournalEntries (value, fallback = DEFAULT_MAX_JOURNAL_ENTRIES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), ABSOLUTE_MAX_JOURNAL_ENTRIES);
}

/**
 * Drop lowest-hash compactable rows until length ≤ max. Mutation / governance
 * rows are never evicted (fold must still reconstruct the roster).
 * @param {object[]} entries
 * @param {number} maxEntries
 * @returns {object[]}
 */
function compactJournalEntries (entries, maxEntries) {
  const list = Array.isArray(entries) ? entries : [];
  const max = clampJournalEntries(maxEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  if (list.length <= max) return list;
  const pinned = [];
  const compactable = [];
  for (const row of list) {
    if (isCompactableType(row && row.type)) compactable.push(row);
    else pinned.push(row);
  }
  const overflow = pinned.length + compactable.length - max;
  if (overflow <= 0) return list;
  compactable.sort((a, b) => {
    const ha = String(a && a.hash || '');
    const hb = String(b && b.hash || '');
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
  });
  const keptCompact = compactable.slice(overflow);
  return pinned.concat(keptCompact);
}

function resolveMaxJournalEntries (doc, meta = {}) {
  const fromGenesis = doc && doc.genesis && doc.genesis.primitives
    && doc.genesis.primitives.maxJournalEntries;
  if (fromGenesis != null) {
    return clampJournalEntries(fromGenesis, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  if (doc && doc.maxJournalEntries != null) {
    return clampJournalEntries(doc.maxJournalEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  // Local bootstrap only: never overrides a contract-wide cap.
  if (meta.maxJournalEntries != null) {
    return clampJournalEntries(meta.maxJournalEntries, DEFAULT_MAX_JOURNAL_ENTRIES);
  }
  return DEFAULT_MAX_JOURNAL_ENTRIES;
}

function _commit () {
  return commitExports;
}

/**
 * Resolve genesis/meta delivery-sync policy.
 * @param {object} doc
 * @param {object} [meta]
 * @returns {{ mode: string, types: string[] }}
 */
function resolveDeliverySyncPolicy (doc = {}, meta = {}) {
  const fromGenesis = doc.genesis && doc.genesis.primitives && doc.genesis.primitives.deliverySync;
  const fromMeta = meta.primitives && meta.primitives.deliverySync;
  const raw = (fromGenesis && typeof fromGenesis === 'object')
    ? fromGenesis
    : ((fromMeta && typeof fromMeta === 'object') ? fromMeta : null);
  if (!raw) return { mode: 'all', types: [] };
  const mode = String(raw.mode || 'all').toLowerCase();
  const types = Array.isArray(raw.types)
    ? raw.types.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  return { mode, types };
}

/**
 * Synchronization filter: which accumulated CONTRACT_MESSAGE body types open a
 * per-reader MessageReceived / MessageReceipt 2PC row.
 *
 * Hard rule: delivery ACK types never open a new pending row.
 * Default: all other types except {@link DEFAULT_SYNC_EXCLUDE}.
 * Override: genesis `primitives.deliverySync` =
 *   `{ mode: 'all'|'none'|'include'|'exclude', types?: string[] }`.
 *
 * @param {string} type
 * @param {object} [doc]
 * @param {object} [meta]
 * @returns {boolean}
 */
function isSyncTrackedType (type, doc = {}, meta = {}) {
  const t = String(type || '').trim();
  if (!t || isDeliveryAckType(t)) return false;
  const policy = resolveDeliverySyncPolicy(doc, meta);
  if (policy.mode === 'none') return false;
  if (policy.mode === 'include') return policy.types.includes(t);
  if (policy.mode === 'exclude') {
    // Explicit denylist on top of the hard ACK exclusion above.
    return !policy.types.includes(t);
  }
  // mode === 'all' (default): track content types; skip default control-plane excludes
  return !DEFAULT_SYNC_EXCLUDE.includes(t);
}

/**
 * Parse `fabric:<hex>` or raw hex into a Buffer.
 * @param {string|Buffer} input
 * @returns {Buffer}
 */
function bufferFromPaste (input) {
  if (Buffer.isBuffer(input)) return input;
  let s = String(input || '').trim();
  if (/^fabric:/i.test(s)) s = s.slice(s.indexOf(':') + 1);
  s = s.replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error('invalid fabric message hex');
  }
  return Buffer.from(s, 'hex');
}

function messageHashHex (msg) {
  const h = msg && msg.raw && msg.raw.hash;
  if (Buffer.isBuffer(h)) return h.toString('hex');
  return String(h || '').toLowerCase();
}

function authorXOnlyHex (msg) {
  const a = msg && msg.raw && msg.raw.author;
  if (Buffer.isBuffer(a)) return a.toString('hex');
  return String(a || '').toLowerCase();
}

/**
 * Verify BIP340 Fabric/Message signature using the frame’s author field.
 * @param {Message} msg
 * @returns {boolean}
 */
function verifyMessageSignature (msg) {
  const xOnly = authorXOnlyHex(msg);
  if (!/^[0-9a-f]{64}$/.test(xOnly)) return false;
  try {
    const signer = new Key({ public: `02${xOnly}` });
    return !!msg.verifyWithKey(signer);
  } catch (_) {
    return false;
  }
}

/**
 * Parse a CONTRACT_MESSAGE body (typed fields or transitional JSON).
 * @param {Message} msg
 * @returns {{ contract: string, type: string, object: object }|null}
 */
function parseContractMessageBody (msg) {
  if (!msg || (msg.type !== OUTER.CONTRACT_MESSAGE && msg.type !== 'P2P_CONTRACT_MESSAGE')) {
    return null;
  }
  const result = Message.tryParseLegacyBody(msg);
  if (!result.ok) return null;
  const parsed = result.value;
  if (!parsed || typeof parsed !== 'object') return null;
  const contract = String(parsed.contract || '').trim().toLowerCase();
  const type = String(parsed.type || '').trim();
  const object = parsed.object && typeof parsed.object === 'object' ? parsed.object : parsed;
  if (!contract || !type) return null;
  return { contract, type, object };
}

/**
 * @param {Iterable<*>} list
 * @returns {string[]}
 */
function normalizePubkeyList (list) {
  const out = [];
  const seen = new Set();
  let publicRead = false;
  for (const m of list || []) {
    if (m === '*' || String(m == null ? '' : m).trim() === '*') {
      publicRead = true;
      continue;
    }
    const x = pubkeyXOnly(m);
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  // Preserve ARC public-reader wildcard (docs/CONTRACTS.md, beacon / blinded genesis).
  if (publicRead) out.push('*');
  return out.sort();
}

/**
 * @param {string[]} readers
 * @param {string} authorXOnly
 * @returns {boolean}
 */
function authorAllowedByReaders (readers, authorXOnly) {
  if (!Array.isArray(readers) || !readers.length) return false;
  if (readers.includes('*')) return true;
  return readers.includes(authorXOnly);
}

/**
 * Normalize genesis / meta into a persisted ARC policy bag.
 * @param {object} raw
 * @returns {object}
 */
function normalizeGenesis (raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const members = src.members && typeof src.members === 'object' ? src.members : {};
  const proposed = src.proposedPolicy && typeof src.proposedPolicy === 'object'
    ? src.proposedPolicy
    : {};
  const spendPolicy = src.spendPolicy && typeof src.spendPolicy === 'object'
    ? src.spendPolicy
    : {};
  const signers = normalizePubkeyList(
    src.signers
    || members.signers
    || src.validators
    || src.parties
    || spendPolicy.validators
    || proposed.validators
    || []
  );
  const readers = normalizePubkeyList(src.readers || members.readers || []);
  let primitives = null;
  if (src.primitives && typeof src.primitives === 'object') {
    primitives = {};
    if (Array.isArray(src.primitives.messageTypes)) {
      primitives.messageTypes = src.primitives.messageTypes.map((t) => String(t || '').trim()).filter(Boolean);
    }
    if (Array.isArray(src.primitives.opcodes)) {
      primitives.opcodes = src.primitives.opcodes.map((t) => String(t || '').trim()).filter(Boolean);
    }
    if (src.primitives.deliverySync && typeof src.primitives.deliverySync === 'object') {
      const ds = src.primitives.deliverySync;
      primitives.deliverySync = {
        mode: String(ds.mode || 'all').toLowerCase(),
        types: Array.isArray(ds.types)
          ? ds.types.map((t) => String(t || '').trim()).filter(Boolean)
          : []
      };
    }
    if (src.primitives.maxJournalEntries != null) {
      primitives.maxJournalEntries = clampJournalEntries(
        src.primitives.maxJournalEntries,
        DEFAULT_MAX_JOURNAL_ENTRIES
      );
    }
  }
  // Hub / Federation application genesis may declare messageTypes at the top level.
  if (Array.isArray(src.messageTypes)) {
    if (!primitives) primitives = {};
    if (!Array.isArray(primitives.messageTypes)) {
      primitives.messageTypes = src.messageTypes.map((t) => String(t || '').trim()).filter(Boolean);
    }
  }
  let bitcoinAnchor = null;
  if (src.bitcoinAnchor && src.bitcoinAnchor.blockHash) {
    bitcoinAnchor = {
      blockHash: String(src.bitcoinAnchor.blockHash).trim().toLowerCase(),
      height: src.bitcoinAnchor.height != null ? Number(src.bitcoinAnchor.height) : undefined
    };
  }
  const thresholdRaw = src.threshold != null
    ? src.threshold
    : (members.threshold != null
      ? members.threshold
      : (proposed.threshold != null
        ? proposed.threshold
        : spendPolicy.threshold));
  const threshold = thresholdRaw != null ? Number(thresholdRaw) : undefined;
  return {
    signers,
    readers,
    primitives,
    bitcoinAnchor,
    threshold: Number.isFinite(threshold) ? threshold : undefined
  };
}

/**
 * Merge genesis from ingest meta into doc (first write wins).
 * @param {object} doc
 * @param {object} meta
 * @returns {object} doc
 */
function applyGenesisMeta (doc, meta = {}) {
  if (doc.genesis && typeof doc.genesis === 'object') return doc;
  let raw = null;
  if (meta.genesis && typeof meta.genesis === 'object') raw = meta.genesis;
  else if (Array.isArray(meta.signers) && meta.signers.length) {
    raw = {
      signers: meta.signers,
      readers: meta.readers,
      primitives: meta.primitives,
      bitcoinAnchor: meta.bitcoinAnchor,
      threshold: meta.threshold
    };
  } else if (meta.primitives || meta.bitcoinAnchor) {
    raw = {
      signers: meta.signers || [],
      readers: meta.readers || [],
      primitives: meta.primitives,
      bitcoinAnchor: meta.bitcoinAnchor,
      threshold: meta.threshold
    };
  }
  if (raw) doc.genesis = normalizeGenesis(raw);
  return doc;
}

function loadDoc (store, contractId) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('contractMessageAccumulate requires a Store (get/put)');
  }
  const id = sidechainStateApi().normalizeContractId(contractId);
  const existing = store.get(COLLECTION, id);
  if (existing && typeof existing === 'object') {
    return {
      id,
      version: Number(existing.version) || 1,
      clock: Number(existing.clock) || 0,
      content: existing.content && typeof existing.content === 'object' ? existing.content : {},
      entries: Array.isArray(existing.entries) ? existing.entries.slice() : [],
      genesis: existing.genesis && typeof existing.genesis === 'object' ? existing.genesis : null,
      maxJournalEntries: existing.maxJournalEntries != null
        ? Number(existing.maxJournalEntries)
        : null,
      bitcoinBlockHash: existing.bitcoinBlockHash
        ? String(existing.bitcoinBlockHash).toLowerCase()
        : null,
      bitcoinHeight: existing.bitcoinHeight != null ? Number(existing.bitcoinHeight) : null
    };
  }
  return {
    id,
    version: 1,
    clock: 0,
    content: {},
    entries: [],
    genesis: null,
    maxJournalEntries: null,
    bitcoinBlockHash: null,
    bitcoinHeight: null
  };
}

function persistDoc (store, doc) {
  const row = {
    id: doc.id,
    version: doc.version,
    clock: doc.clock,
    content: doc.content,
    entries: doc.entries
  };
  if (doc.genesis) row.genesis = doc.genesis;
  if (doc.maxJournalEntries != null) row.maxJournalEntries = doc.maxJournalEntries;
  if (doc.bitcoinBlockHash) row.bitcoinBlockHash = doc.bitcoinBlockHash;
  if (doc.bitcoinHeight != null) row.bitcoinHeight = doc.bitcoinHeight;
  store.put(COLLECTION, doc.id, row);
  return doc;
}

/**
 * Tip roster when non-empty; otherwise genesis signers (bootstrap).
 * Prefer explicit `content.signers` (even when empty — do not widen to
 * participant `members`). Legacy tips without a `signers` field still use
 * `members` as the authority roster.
 * @param {object} doc
 * @returns {string[]}
 */
function currentSignerSet (doc) {
  if (doc.content && Object.prototype.hasOwnProperty.call(doc.content, 'signers')
    && Array.isArray(doc.content.signers)) {
    const tipSigners = normalizePubkeyList(doc.content.signers);
    if (tipSigners.length) return tipSigners;
    if (doc.genesis && Array.isArray(doc.genesis.signers)) {
      return normalizePubkeyList(doc.genesis.signers);
    }
    return [];
  }
  const tipMembers = normalizePubkeyList(
    (doc.content && Array.isArray(doc.content.members)) ? doc.content.members : []
  );
  if (tipMembers.length) return tipMembers;
  if (doc.genesis && Array.isArray(doc.genesis.signers)) {
    return normalizePubkeyList(doc.genesis.signers);
  }
  return [];
}

/**
 * @param {object} doc
 * @param {string} type
 * @param {object} [meta]
 * @returns {boolean}
 */
function messageTypeAllowed (doc, type, meta = {}) {
  const fromGenesis = doc.genesis && doc.genesis.primitives && Array.isArray(doc.genesis.primitives.messageTypes)
    ? doc.genesis.primitives.messageTypes
    : null;
  const fromMeta = meta.primitives && Array.isArray(meta.primitives.messageTypes)
    ? meta.primitives.messageTypes.map(String)
    : null;
  const allowed = fromGenesis || fromMeta;
  // Explicit empty allowlist is deny-all (presence of the array is the policy signal).
  if (allowed) return allowed.includes(type);
  return isKnownContractBodyType(type);
}

/**
 * Verified OP_CONTRACT_SIGN Token for author (issuer must be a current signer).
 * @param {object} doc
 * @param {string} authorXOnly
 * @param {string} [tokenString]
 * @returns {boolean}
 */
/**
 * @param {object} doc
 * @param {string} authorXOnly
 * @param {string} [tokenString]
 * @param {string} expectedCap
 * @returns {boolean}
 */
function authorHasCapabilityToken (doc, authorXOnly, tokenString, expectedCap) {
  if (!tokenString || typeof tokenString !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(authorXOnly)) return false;
  const issuers = currentSignerSet(doc);
  if (!issuers.length) return false;
  for (const iss of issuers) {
    const candidates = [];
    try {
      candidates.push(pubkeyCompressed(iss));
    } catch (_) { /* fall through */ }
    // Try both SEC parity prefixes — Key.public may be even or odd Y.
    candidates.push(`02${iss}`, `03${iss}`);
    const seen = new Set();
    for (const compressed of candidates) {
      const c = String(compressed || '').toLowerCase();
      if (!/^(02|03)[0-9a-f]{64}$/.test(c) || seen.has(c)) continue;
      seen.add(c);
      try {
        const payload = Contract.verifyCapability(tokenString, {
          contractId: doc.id,
          expectedCap,
          issuerKey: { public: c }
        });
        if (!payload || payload.verified !== true) continue;
        if (pubkeyXOnly(payload.sub) === authorXOnly) return true;
      } catch (_) {
        /* try next candidate */
      }
    }
  }
  return false;
}

function authorHasSignToken (doc, authorXOnly, tokenString) {
  return authorHasCapabilityToken(doc, authorXOnly, tokenString, Contract.OP_CONTRACT_SIGN);
}

function authorHasReadToken (doc, authorXOnly, tokenString) {
  return authorHasCapabilityToken(doc, authorXOnly, tokenString, Contract.OP_CONTRACT_READ)
    || authorHasSignToken(doc, authorXOnly, tokenString);
}

/**
 * @param {object} doc
 * @param {string} type
 * @param {string} authorXOnly
 * @param {object} [meta]
 * @param {object} [bodyObject]
 * @returns {{ ok: boolean, error?: string }}
 */
function authorizeIngest (doc, type, authorXOnly, meta = {}, bodyObject = null) {
  if (!messageTypeAllowed(doc, type, meta)) {
    return { ok: false, error: 'message type not allowed by contract primitives' };
  }

  if (isDeliveryAckType(type)) {
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    if (!readers.length) {
      return {
        ok: false,
        error: 'delivery ack requires genesis readers/signers or tip members (fail closed)'
      };
    }
    if (!authorAllowedByReaders(readers, authorXOnly)) {
      return { ok: false, error: 'author not in contract reader set' };
    }
    const target = String(
      (bodyObject && (bodyObject.messageId || bodyObject.wireHash || bodyObject.hash)) || ''
    ).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(target)) {
      return { ok: false, error: 'delivery ack requires messageId (wire hash)' };
    }
    return { ok: true };
  }

  // GroupChat: reader ∪ signer (or verified OP_CONTRACT_READ / OP_CONTRACT_SIGN).
  if (type === 'GroupChat') {
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    const signers = currentSignerSet(doc);
    const allowed = new Set(readers.concat(signers));
    if (!allowed.size) {
      return {
        ok: false,
        error: 'GroupChat requires genesis readers/signers or tip members (fail closed)'
      };
    }
    const token = meta.capabilityToken || meta.token;
    if (!authorAllowedByReaders(readers, authorXOnly)
      && !signers.includes(authorXOnly)
      && !authorHasReadToken(doc, authorXOnly, token)) {
      return { ok: false, error: 'author not in contract reader/signer set' };
    }
    return { ok: true };
  }

  const needsSigner = SIGNER_MUTATION_TYPES.includes(type);
  if (!needsSigner) {
    // Remaining types (custom genesis `primitives.messageTypes`, etc.): still require
    // author ∈ reader ∪ signer (or verified capability). Do not fail open.
    if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
      return { ok: false, error: 'invalid author' };
    }
    const readers = readerSetForDelivery(doc, meta);
    const signers = currentSignerSet(doc);
    const allowed = new Set(readers.concat(signers));
    if (!allowed.size) {
      return {
        ok: false,
        error: 'contract message requires genesis readers/signers or tip members (fail closed)'
      };
    }
    const token = meta.capabilityToken || meta.token;
    if (!authorAllowedByReaders(readers, authorXOnly)
      && !signers.includes(authorXOnly)
      && !authorHasReadToken(doc, authorXOnly, token)
      && !authorHasSignToken(doc, authorXOnly, token)) {
      return { ok: false, error: 'author not in contract reader/signer set' };
    }
    return { ok: true };
  }

  if (!/^[0-9a-f]{64}$/.test(authorXOnly)) {
    return { ok: false, error: 'invalid author' };
  }

  const signers = currentSignerSet(doc);
  if (!signers.length) {
    return {
      ok: false,
      error: 'signer mutation requires genesis.signers or tip members (fail closed)'
    };
  }

  const isSigner = signers.includes(authorXOnly)
    || authorHasSignToken(doc, authorXOnly, meta.capabilityToken || meta.token);
  if (!isSigner) {
    return { ok: false, error: 'author not authorized for signer mutation' };
  }

  if (type === 'ContractWithdrawalRequest' && bodyObject) {
    const tip = tipFromDoc(doc);
    const check = Contract.validateWithdrawalRequest(bodyObject, tip, {
      genesis: doc.genesis || meta.genesis || null
    });
    if (!check.ok) return { ok: false, error: check.error };
  }

  if (type === 'ContractWithdrawalWitness' && bodyObject) {
    const tip = tipFromDoc(doc);
    const requestId = String(bodyObject.requestId || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(requestId)) {
      return { ok: false, error: 'witness requestId required' };
    }
    const pending = ((tip.content && tip.content.withdrawals) || [])
      .find((w) => w && String(w.requestId || '').toLowerCase() === requestId);
    if (!pending) {
      return { ok: false, error: 'witness requestId not found in tip withdrawals' };
    }
    const reqDigest = String(bodyObject.stateDigest || '').toLowerCase();
    const reqHash = String(bodyObject.bitcoinBlockHash || '').toLowerCase();
    // Bind to the withdrawal request's tip fields (not the post-request tip digest).
    if (pending.stateDigest) {
      if (!/^[0-9a-f]{64}$/.test(reqDigest)) {
        return { ok: false, error: 'witness stateDigest required' };
      }
      if (reqDigest !== String(pending.stateDigest).toLowerCase()) {
        return { ok: false, error: 'witness stateDigest does not match request' };
      }
    }
    if (pending.bitcoinBlockHash) {
      if (!/^[0-9a-f]{64}$/.test(reqHash)) {
        return { ok: false, error: 'witness bitcoinBlockHash required' };
      }
      if (reqHash !== String(pending.bitcoinBlockHash).toLowerCase()) {
        return { ok: false, error: 'witness bitcoinBlockHash does not match request' };
      }
    }
    const claimed = pubkeyXOnly(bodyObject.signer) || String(bodyObject.signer || '').toLowerCase();
    if (claimed && claimed !== authorXOnly) {
      return { ok: false, error: 'witness signer must match AMP author' };
    }
    const verified = Contract.verifyWithdrawalWitnessSignature({
      ...bodyObject,
      signer: authorXOnly
    });
    if (!verified.ok) {
      return { ok: false, error: verified.error || 'invalid witness signature' };
    }
  }

  if (type === 'GroupChangeProposal' && bodyObject) {
    const action = String(bodyObject.action || '');
    if (!GOVERNANCE_ACTIONS.includes(action)) {
      return { ok: false, error: 'unsupported proposal action' };
    }
    if (!proposalIdOf(bodyObject)) {
      return { ok: false, error: 'proposal id required' };
    }
  }

  if (type === 'GroupChangeVote' && bodyObject) {
    const voter = pubkeyXOnly(bodyObject.voter) || String(bodyObject.voter || '').toLowerCase();
    if (voter !== authorXOnly) {
      return { ok: false, error: 'vote voter must match AMP author' };
    }
    const sig = String(bodyObject.signature || '').trim().toLowerCase();
    if (sig.startsWith('local:')) {
      return { ok: false, error: 'local vote signatures are not valid on the wire' };
    }
    if (!/^[0-9a-f]{128}$/.test(sig)) {
      return { ok: false, error: 'vote signature required (64-byte BIP340 hex)' };
    }
    const pid = String(bodyObject.proposalId || '').trim();
    if (!pid) return { ok: false, error: 'vote proposalId required' };
    const prior = (doc.entries || []).find((row) => {
      return row && row.type === 'GroupChangeProposal' && proposalIdOf(row.object) === pid;
    });
    if (prior && prior.object) {
      if (!verifyProposalVote(prior.object, authorXOnly, sig)) {
        return { ok: false, error: 'invalid vote signature' };
      }
    }
  }

  return { ok: true };
}

/**
 * Deterministic fold: sort by message hash, apply GroupChange then collect chats.
 * @param {object[]} entries
 * @returns {{ version: number, clock: number, content: object }}
 */
function foldContractState (entries = [], genesis = null) {
  const sorted = (Array.isArray(entries) ? entries.slice() : []).sort((a, b) => {
    // Byte-order / plain lexicographic on hex — not ICU localeCompare (tips must
    // converge across Node ICU builds).
    const ha = String(a.hash || '');
    const hb = String(b.hash || '');
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
  });
  const ctx = {
    members: new Set(),
    signers: new Set(),
    readerOnlyAdds: false,
    threshold: genesis && genesis.threshold != null ? Number(genesis.threshold) : null
  };
  const messages = [];
  const withdrawals = Object.create(null);
  for (const row of sorted) {
    const type = String(row.type || '');
    const obj = row.object && typeof row.object === 'object' ? row.object : {};
    if (type === 'GroupChange') {
      applyGroupChangeAction(ctx, obj);
    } else if (type === 'GroupChat') {
      const authorRaw = row.author || obj.author || null;
      const author = pubkeyXOnly(authorRaw) || authorRaw;
      messages.push({
        hash: row.hash,
        author,
        body: obj.body != null ? String(obj.body) : (obj.content != null ? String(obj.content) : ''),
        // Only message-carried ts — never ingest-time acceptedAt (must converge)
        ts: obj.ts != null ? String(obj.ts) : null
      });
    } else if (type === 'ContractWithdrawalRequest' && obj.requestId) {
      const id = String(obj.requestId).toLowerCase();
      withdrawals[id] = {
        requestId: id,
        hash: row.hash,
        author: row.author || null,
        stateDigest: obj.stateDigest || null,
        bitcoinBlockHash: obj.bitcoinBlockHash || null,
        bitcoinHeight: obj.bitcoinHeight != null ? Number(obj.bitcoinHeight) : null,
        destinationAddress: obj.destinationAddress || obj.destination || null,
        feeSats: obj.feeSats != null ? Number(obj.feeSats) : 0,
        action: obj.action === 'migrate' ? 'migrate' : 'spend',
        witnesses: (withdrawals[id] && withdrawals[id].witnesses) || []
      };
    } else if (type === 'ContractWithdrawalWitness' && obj.requestId) {
      const id = String(obj.requestId).toLowerCase();
      if (!withdrawals[id]) {
        withdrawals[id] = {
          requestId: id,
          hash: null,
          author: null,
          stateDigest: obj.stateDigest || null,
          bitcoinBlockHash: obj.bitcoinBlockHash || null,
          witnesses: []
        };
      }
      const sig = String(obj.signature || '').toLowerCase();
      const signer = pubkeyXOnly(obj.signer || row.author) || String(obj.signer || row.author || '').toLowerCase();
      // Fold only witnesses already accepted at ingest (AMP author === signer + BIP340).
      if (signer && sig && signer === String(row.author || '').toLowerCase()
        && !withdrawals[id].witnesses.some((w) => w.signer === signer && w.signature === sig)) {
        withdrawals[id].witnesses.push({
          hash: row.hash,
          signer,
          signature: sig
        });
      }
    }
  }
  const proposals = foldProposals(
    sorted,
    ctx,
    ctx.threshold,
    genesis && Array.isArray(genesis.signers) ? genesis.signers : []
  );
  const memberList = Array.from(ctx.members).sort();
  const signerList = ctx.readerOnlyAdds
    ? Array.from(ctx.signers).sort()
    : (ctx.signers.size ? Array.from(ctx.signers).sort() : memberList.slice());
  const content = {
    members: memberList,
    signers: signerList,
    messages,
    withdrawals: Object.keys(withdrawals).sort().map((k) => withdrawals[k])
  };
  if (proposals.length) content.proposals = proposals;
  if (ctx.threshold != null && Number.isFinite(Number(ctx.threshold))) {
    content.threshold = Math.max(1, Math.floor(Number(ctx.threshold)));
  }
  // Delivery ACKs are persisted in entries but do not advance tip clock / digest.
  const tipEntries = sorted.filter((row) => !isDeliveryAckType(row.type));
  const state = {
    version: 1,
    clock: tipEntries.length,
    content
  };
  return state;
}

/**
 * Reader roster for MessageReceived / MessageReceipt authz + 2PC sidecar.
 * @param {object} doc
 * @param {object} [meta]
 * @returns {string[]}
 */
function readerSetForDelivery (doc, meta = {}) {
  const tipMembers = normalizePubkeyList(
    (doc.content && Array.isArray(doc.content.members)) ? doc.content.members : []
  );
  if (tipMembers.length) return tipMembers;
  if (doc.genesis) {
    const fromGenesis = normalizePubkeyList(
      (doc.genesis.readers && doc.genesis.readers.length)
        ? doc.genesis.readers
        : doc.genesis.signers
    );
    if (fromGenesis.length) return fromGenesis;
  }
  return normalizePubkeyList(meta.readers || meta.signers || []);
}

/**
 * Open a pending 2PC sidecar row for a sync-tracked content frame.
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @param {object} entry
 * @param {object} [meta]
 * @returns {object|null}
 */
function ensureDeliveryPending (store, doc, entry, meta = {}) {
  if (!store || !entry || !isSyncTrackedType(entry.type, doc, meta)) return null;
  const hash = String(entry.hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  let readers = readerSetForDelivery(doc, meta);
  const author = String(entry.author || '').toLowerCase();
  if (author && !readers.includes(author)) readers = readers.concat([author]);
  if (!readers.length && author) readers = [author];
  if (!readers.length) return null;

  let record = store.get('contractmessagecommits', hash);
  if (record) return record;
  record = _commit().createPending({
    id: hash,
    contractId: doc.id,
    wireHash: hash,
    contentHash: entry.object && entry.object.contentHash
      ? String(entry.object.contentHash).toLowerCase()
      : null,
    readers
  });
  record.sourceType = String(entry.type);
  store.put('contractmessagecommits', hash, record);
  return record;
}

/**
 * Fold a stored MessageReceived / MessageReceipt entry into the 2PC sidecar.
 * Does not alter tip content / stateDigest.
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @param {object} entry
 * @param {object} [meta]
 * @returns {object|null}
 */
function applyDeliveryAckEntry (store, doc, entry, meta = {}) {
  if (!store || !entry || !isDeliveryAckType(entry.type)) return null;
  const obj = entry.object && typeof entry.object === 'object' ? entry.object : {};
  const targetHash = String(obj.messageId || obj.wireHash || obj.hash || '').toLowerCase();
  const author = String(entry.author || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(targetHash) || !/^[0-9a-f]{64}$/.test(author)) return null;

  let readers = readerSetForDelivery(doc, meta);
  if (!readers.includes(author)) readers = readers.concat([author]);
  if (!readers.length) readers = [author];

  let record = store.get('contractmessagecommits', targetHash);
  if (!record) {
    record = _commit().createPending({
      id: targetHash,
      contractId: doc.id,
      wireHash: targetHash,
      readers
    });
  }
  try {
    const commit = _commit();
    commit.markReceived(record, author, obj.receivedAt || entry.acceptedAt || undefined);
    if (entry.type === CONTRACT_BODY_TYPES.MessageReceipt ||
        obj.receipt || obj.receiptAt || obj['@type'] === 'MessageReceipt') {
      try {
        commit.markReceipt(
          record,
          author,
          obj.receiptAt || entry.acceptedAt || undefined,
          obj.receiptSig || null
        );
      } catch (receiptErr) {
        // Keep MessageReceived; leave receipt phase unset until a valid BIP340 receiptSig.
        void receiptErr;
      }
    }
    // Retain the AMP frame hex on the sidecar for later relay / audit.
    if (!Array.isArray(record.ackMessages)) record.ackMessages = [];
    if (entry.hex && !record.ackMessages.some((a) => a && a.hash === entry.hash)) {
      record.ackMessages.push({
        hash: entry.hash,
        type: entry.type,
        author,
        hex: entry.hex,
        acceptedAt: entry.acceptedAt || null
      });
    }
    store.put('contractmessagecommits', targetHash, record);
    return record;
  } catch (_) {
    return null;
  }
}

function tipFromDoc (doc) {
  const state = {
    version: doc.version,
    clock: doc.clock,
    content: doc.content
  };
  const tip = {
    contractId: doc.id,
    clock: state.clock,
    stateDigest: sidechainStateApi().stateDigest(state),
    content: state.content
  };
  const blockHash = doc.bitcoinBlockHash
    || (doc.genesis && doc.genesis.bitcoinAnchor && doc.genesis.bitcoinAnchor.blockHash)
    || null;
  if (blockHash) tip.bitcoinBlockHash = blockHash;
  const height = doc.bitcoinHeight != null
    ? doc.bitcoinHeight
    : (doc.genesis && doc.genesis.bitcoinAnchor && doc.genesis.bitcoinAnchor.height);
  if (height != null && Number.isFinite(Number(height))) tip.bitcoinHeight = Number(height);
  return tip;
}

/**
 * Ingest signed Message bytes for a contract namespace.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste Buffer or fabric:/hex paste
 * @param {{
 *   origin?: string,
 *   genesis?: object,
 *   signers?: string[],
 *   readers?: string[],
 *   primitives?: object,
 *   bitcoinAnchor?: object,
 *   bitcoinBlockHash?: string,
 *   bitcoinHeight?: number,
 *   capabilityToken?: string,
 *   token?: string
 * }} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, entry: object|null, tip: object, error?: string }}
 */
function ingestMessageBuffer (store, contractId, bufferOrPaste, meta = {}) {
  const id = sidechainStateApi().normalizeContractId(contractId);
  const origin = ORIGINS.includes(meta.origin) ? meta.origin : 'mesh';
  // Load once so rejected paths still return tipFromDoc without re-reading.
  const doc = loadDoc(store, id);
  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste)
      ? bufferOrPaste
      : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: e.message || 'invalid buffer'
    };
  }

  // Match Peer wire gate: drop oversized frames before parse / verify / JSON.
  if (buffer.length > HEADER_SIZE + MAX_MESSAGE_SIZE) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: `message exceeds MAX_MESSAGE_SIZE (${MAX_MESSAGE_SIZE})`
    };
  }

  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: e.message || 'parse failed'
    };
  }

  if (!verifyMessageSignature(msg)) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'invalid signature'
    };
  }

  const body = parseContractMessageBody(msg);
  if (!body) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'not a CONTRACT_MESSAGE body'
    };
  }
  if (body.contract !== id) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: 'contract id mismatch'
    };
  }

  const hash = messageHashHex(msg);
  applyGenesisMeta(doc, meta);

  if (doc.entries.some((e) => e && e.hash === hash)) {
    // Duplicate AMP frame: tip unchanged — skip re-fold / persist.
    return {
      accepted: false,
      duplicate: true,
      entry: null,
      tip: tipFromDoc(doc)
    };
  }

  const author = authorXOnlyHex(msg);
  const authz = authorizeIngest(doc, body.type, author, meta, body.object);
  if (!authz.ok) {
    return {
      accepted: false,
      duplicate: false,
      entry: null,
      tip: tipFromDoc(doc),
      error: authz.error || 'unauthorized'
    };
  }

  let bitcoinBlockHash = null;
  let bitcoinHeight = null;
  if (meta.bitcoinBlockHash != null && String(meta.bitcoinBlockHash).trim() !== '') {
    const bh = String(meta.bitcoinBlockHash).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(bh)) {
      return {
        accepted: false,
        duplicate: false,
        entry: null,
        tip: tipFromDoc(doc),
        error: 'meta.bitcoinBlockHash must be 64 hex chars'
      };
    }
    bitcoinBlockHash = bh;
    if (meta.bitcoinHeight != null) bitcoinHeight = Number(meta.bitcoinHeight);
  }

  const entry = {
    hash,
    type: body.type,
    author,
    object: body.object,
    hex: buffer.toString('hex'),
    origin,
    acceptedAt: new Date().toISOString()
  };
  doc.entries.push(entry);
  const maxJournal = resolveMaxJournalEntries(doc, meta);
  doc.maxJournalEntries = maxJournal;
  doc.entries = compactJournalEntries(doc.entries, maxJournal);
  const state = foldContractState(doc.entries, doc.genesis);
  doc.version = state.version;
  doc.clock = state.clock;
  doc.content = state.content;

  if (bitcoinBlockHash) {
    doc.bitcoinBlockHash = bitcoinBlockHash;
    if (bitcoinHeight != null) doc.bitcoinHeight = bitcoinHeight;
  } else if (!doc.bitcoinBlockHash && doc.genesis && doc.genesis.bitcoinAnchor) {
    const genesisHash = String(doc.genesis.bitcoinAnchor.blockHash || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(genesisHash)) {
      doc.bitcoinBlockHash = genesisHash;
      if (doc.genesis.bitcoinAnchor.height != null) {
        doc.bitcoinHeight = Number(doc.genesis.bitcoinAnchor.height);
      }
    }
  }

  persistDoc(store, doc);

  if (isDeliveryAckType(entry.type)) {
    applyDeliveryAckEntry(store, doc, entry, meta);
  } else if (isSyncTrackedType(entry.type, doc, meta)) {
    ensureDeliveryPending(store, doc, entry, meta);
  }

  return {
    accepted: true,
    duplicate: false,
    entry,
    tip: tipFromDoc(doc)
  };
}

/**
 * Persist ARC genesis from a signed CONTRACT_PUBLISH so later GroupChange
 * ingest does not need meta.genesis on every call (first write wins).
 * @param {{ get: Function, put: Function }} store
 * @param {Buffer|string} bufferOrPaste
 * @param {object} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, contractId: string|null, genesis: object|null, error?: string }}
 */
function ingestContractPublishBuffer (store, bufferOrPaste, meta = {}) {
  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste) ? bufferOrPaste : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: e.message || 'invalid buffer' };
  }
  if (buffer.length > HEADER_SIZE + MAX_MESSAGE_SIZE) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'message exceeds MAX_MESSAGE_SIZE' };
  }
  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: e.message || 'parse failed' };
  }
  if (msg.type !== OUTER.CONTRACT_PUBLISH && msg.type !== 'P2P_CONTRACT_PUBLISH') {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'not a CONTRACT_PUBLISH' };
  }
  if (!verifyMessageSignature(msg)) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid signature' };
  }
  // Prefer tryParseMessageBody so Message.fromFields('CONTRACT_PUBLISH', …)
  // (length-prefixed `definition` string) is accepted alongside transitional
  // UTF-8 JSON bodies from Message.fromVector.
  let definition;
  const parsed = Message.tryParseMessageBody(msg);
  if (parsed.ok && parsed.encoding === 'fields') {
    const fieldDef = parsed.value && parsed.value.definition;
    try {
      definition = typeof fieldDef === 'string' ? JSON.parse(fieldDef) : fieldDef;
    } catch (_) {
      return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid publish body' };
    }
  } else if (parsed.ok && parsed.encoding === 'json') {
    definition = parsed.value;
  } else {
    let raw = msg.body != null ? msg.body : (msg.raw && msg.raw.data);
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    try {
      definition = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid publish body' };
    }
  }
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { accepted: false, duplicate: false, contractId: null, genesis: null, error: 'invalid publish body' };
  }
  const contractId = new Actor(definition).id;
  const genesis = normalizeGenesis(definition);
  const author = authorXOnlyHex(msg);
  if (!/^[0-9a-f]{64}$/.test(String(author || ''))) {
    return { accepted: false, duplicate: false, contractId, genesis: null, error: 'invalid publish author' };
  }
  if (genesis.signers.length && !genesis.signers.includes(author)) {
    return {
      accepted: false,
      duplicate: false,
      contractId,
      genesis: null,
      error: 'publish signer not in genesis authorities'
    };
  }
  const doc = loadDoc(store, contractId);
  if (doc.genesis && typeof doc.genesis === 'object') {
    return { accepted: false, duplicate: true, contractId, genesis: doc.genesis };
  }
  applyGenesisMeta(doc, { ...meta, genesis: definition });
  if (!doc.genesis) doc.genesis = genesis;
  persistDoc(store, doc);
  return { accepted: true, duplicate: false, contractId, genesis: doc.genesis };
}

/**
 * In-memory Store shim for tests / ephemeral peers.
 * @returns {{ get: Function, put: Function, _data: object }}
 */
function createMemoryStore () {
  const data = Object.create(null);
  return {
    _data: data,
    get (collection, id) {
      const bag = data[collection];
      return bag && bag[id] != null ? bag[id] : null;
    },
    put (collection, id, value) {
      if (!data[collection]) data[collection] = Object.create(null);
      data[collection][id] = value;
      return value;
    }
  };
}


const QUEUE_COLLECTION = 'contractmessagequeue';
const DEFAULT_MAX_ENTRIES = 512;
const ABSOLUTE_MAX_ENTRIES = 10000;

function clampMaxEntries (value, fallback = DEFAULT_MAX_ENTRIES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), ABSOLUTE_MAX_ENTRIES);
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @returns {object}
 */
function loadQueueDoc (store, contractId) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('contractMessageQueue requires a Store (get/put)');
  }
  const id = sidechainStateApi().normalizeContractId(contractId);
  const existing = store.get(QUEUE_COLLECTION, id);
  if (existing && typeof existing === 'object') {
    return {
      id,
      maxEntries: clampMaxEntries(existing.maxEntries, DEFAULT_MAX_ENTRIES),
      entries: Array.isArray(existing.entries) ? existing.entries.slice() : []
    };
  }
  return { id, maxEntries: DEFAULT_MAX_ENTRIES, entries: [] };
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {object} doc
 * @returns {object}
 */
function persistQueueDoc (store, doc) {
  store.put(QUEUE_COLLECTION, doc.id, {
    id: doc.id,
    maxEntries: doc.maxEntries,
    entries: doc.entries
  });
  return doc;
}

/**
 * Trim oldest entries when over max. Prefer dropping already-delivered rows.
 * @param {object} doc
 * @returns {object}
 */
function trimQueueDoc (doc) {
  const max = clampMaxEntries(doc.maxEntries, DEFAULT_MAX_ENTRIES);
  doc.maxEntries = max;
  while (doc.entries.length > max) {
    let dropIdx = doc.entries.findIndex((e) => {
      const d = e && e.deliveredTo;
      return d && typeof d === 'object' && Object.keys(d).length > 0;
    });
    if (dropIdx < 0) dropIdx = 0;
    doc.entries.splice(dropIdx, 1);
  }
  return doc;
}

/**
 * Enqueue opaque signed Message bytes for a contract namespace.
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste
 * @param {{ origin?: string, maxEntries?: number, type?: string, author?: string }} [meta]
 * @returns {{ accepted: boolean, duplicate: boolean, entry: object|null, error?: string }}
 */
function enqueueMessageBuffer (store, contractId, bufferOrPaste, meta = {}) {
  let id;
  try {
    id = sidechainStateApi().normalizeContractId(contractId);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'invalid contractId' };
  }

  let buffer;
  try {
    buffer = Buffer.isBuffer(bufferOrPaste)
      ? bufferOrPaste
      : bufferFromPaste(bufferOrPaste);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'invalid buffer' };
  }

  let msg;
  try {
    msg = Message.fromBuffer(buffer);
  } catch (e) {
    return { accepted: false, duplicate: false, entry: null, error: e.message || 'parse failed' };
  }

  if (!verifyMessageSignature(msg)) {
    return { accepted: false, duplicate: false, entry: null, error: 'invalid signature' };
  }

  const hash = messageHashHex(msg);
  if (!hash) {
    return { accepted: false, duplicate: false, entry: null, error: 'missing message hash' };
  }

  const body = parseContractMessageBody(msg);
  if (!body || !body.contract) {
    return { accepted: false, duplicate: false, entry: null, error: 'not a CONTRACT_MESSAGE body' };
  }
  if (body.contract !== id) {
    return { accepted: false, duplicate: false, entry: null, error: 'contract id mismatch' };
  }

  const doc = loadQueueDoc(store, id);
  if (meta.maxEntries != null) {
    doc.maxEntries = clampMaxEntries(meta.maxEntries, doc.maxEntries);
  }
  if (doc.entries.some((e) => e && e.hash === hash)) {
    return { accepted: false, duplicate: true, entry: null };
  }

  const entry = {
    hash,
    hex: buffer.toString('hex'),
    type: (body && body.type) || (meta.type != null ? String(meta.type) : null),
    author: authorXOnlyHex(msg) || (meta.author != null ? String(meta.author) : null),
    origin: meta.origin != null ? String(meta.origin) : 'mesh',
    enqueuedAt: meta.enqueuedAt || new Date().toISOString(),
    deliveredTo: {}
  };
  doc.entries.push(entry);
  trimQueueDoc(doc);
  persistQueueDoc(store, doc);
  return { accepted: true, duplicate: false, entry };
}

/**
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {{ limit?: number, includeDelivered?: boolean, peerKey?: string, recipient?: string, ref?: string, slot?: string }} [opts]
 *   `recipient`, `ref`, and `slot` match the CONTRACT_MESSAGE index fields.
 *   The JSON payload is not parsed.
 * @returns {object[]}
 */
function listQueuedMessages (store, contractId, opts = {}) {
  const doc = loadQueueDoc(store, contractId);
  const peerKey = opts.peerKey != null ? String(opts.peerKey).toLowerCase() : null;
  let rows = doc.entries.slice();
  if (peerKey && opts.includeDelivered !== true) {
    rows = rows.filter((e) => !(e.deliveredTo && e.deliveredTo[peerKey]));
  }
  if (opts.recipient || opts.ref || opts.slot) {
    rows = rows.filter((entry) => {
      if (!entry || !entry.hex) return false;
      try {
        return Message.contractMessageMatches(Message.fromBuffer(Buffer.from(entry.hex, 'hex')), opts);
      } catch (_) {
        return false;
      }
    });
  }
  const limit = Number(opts.limit);
  if (limit > 0 && rows.length > limit) rows = rows.slice(-limit);
  return rows;
}

/**
 * Frames still awaiting delivery to `peerKey` (or all undelivered if omitted).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {string} [peerKey]
 * @returns {object[]}
 */
function pendingForDelivery (store, contractId, peerKey) {
  return listQueuedMessages(store, contractId, {
    peerKey: peerKey || undefined,
    includeDelivered: peerKey ? false : true
  }).filter((e) => {
    if (!peerKey) {
      const d = e.deliveredTo;
      return !d || typeof d !== 'object' || Object.keys(d).length === 0;
    }
    return !(e.deliveredTo && e.deliveredTo[String(peerKey).toLowerCase()]);
  });
}

/**
 * Mark a queued frame delivered to a peer (sidecar only).
 * @param {{ get: Function, put: Function }} store
 * @param {string} contractId
 * @param {string} hash
 * @param {string} peerKey
 * @param {string} [at]
 * @returns {{ ok: boolean, entry: object|null }}
 */
function markDelivered (store, contractId, hash, peerKey, at) {
  const id = sidechainStateApi().normalizeContractId(contractId);
  const h = String(hash || '').trim().toLowerCase();
  const peer = String(peerKey || '').trim().toLowerCase();
  if (!h || !peer) return { ok: false, entry: null };
  const doc = loadQueueDoc(store, id);
  const entry = doc.entries.find((e) => e && e.hash === h);
  if (!entry) return { ok: false, entry: null };
  if (!entry.deliveredTo || typeof entry.deliveredTo !== 'object') entry.deliveredTo = {};
  if (!entry.deliveredTo[peer]) {
    entry.deliveredTo[peer] = at || new Date().toISOString();
    persistQueueDoc(store, doc);
  }
  return { ok: true, entry };
}

/**
 * Opaque hex list suitable for accumulate ingest (`origin: 'queue'`).
 * @param {object[]} entries
 * @returns {string[]}
 */
function entryHexList (entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => e && e.hex)
    .filter((h) => typeof h === 'string' && /^[0-9a-f]+$/i.test(h));
}

/**
 * SHA-256 of buffer when Message parse is unavailable (diagnostics only).
 * Prefer {@link messageHashHex} on a parsed Message for queue identity.
 * @param {Buffer} buffer
 * @returns {string}
 */
function fallbackContentHash (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}


const accumulateExports = {
  COLLECTION,
  ORIGINS,
  SIGNER_MUTATION_TYPES,
  DELIVERY_ACK_TYPES,
  DEFAULT_SYNC_EXCLUDE,
  isDeliveryAckType,
  resolveDeliverySyncPolicy,
  isSyncTrackedType,
  normalizeGenesis,
  normalizePubkeyList,
  authorAllowedByReaders,
  bufferFromPaste,
  verifyMessageSignature,
  parseContractMessageBody,
  loadDoc,
  persistDoc,
  applyGenesisMeta,
  currentSignerSet,
  readerSetForDelivery,
  messageTypeAllowed,
  authorHasSignToken,
  authorizeIngest,
  foldContractState,
  tipFromDoc,
  ensureDeliveryPending,
  applyDeliveryAckEntry,
  ingestMessageBuffer,
  ingestContractPublishBuffer,
  compactJournalEntries,
  clampJournalEntries,
  resolveMaxJournalEntries,
  ABSOLUTE_MAX_JOURNAL_ENTRIES,
  COMPACTABLE_TYPES,
  createMemoryStore,
  messageHashHex,
  authorXOnlyHex
};

const queueExports = {
  COLLECTION: QUEUE_COLLECTION,
  DEFAULT_MAX_ENTRIES,
  ABSOLUTE_MAX_ENTRIES,
  clampMaxEntries,
  loadQueueDoc,
  persistQueueDoc,
  trimQueueDoc,
  enqueueMessageBuffer,
  listQueuedMessages,
  pendingForDelivery,
  markDelivered,
  entryHexList,
  fallbackContentHash,
  createMemoryStore
};

/**
 * Contract-message journal: fold signed frames, track delivery receipts,
 * and hold a relay queue of opaque bytes.
 */
class ContractJournal {
  /**
   * @param {{ get: Function, put: Function }} [store]
   */
  constructor (store = null) {
    this.store = store;
  }
}

ContractJournal.accumulate = accumulateExports;
ContractJournal.commit = commitExports;
ContractJournal.queue = queueExports;
ContractJournal.QUEUE_COLLECTION = QUEUE_COLLECTION;

for (const bag of [accumulateExports, commitExports, queueExports]) {
  for (const name of Object.keys(bag)) {
    if (ContractJournal[name] == null) ContractJournal[name] = bag[name];
  }
}

Contract.Journal = ContractJournal;
