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
const Resolutions = require('./resolutions');
const Service = require('./service');
const Token = require('./token');

// Fabric Functions
const { LOG_TYPES, CONTRACT_BODY_TYPES } = require('../functions/applicationNamespaces');
const { fabricCanonicalJson } = require('../functions/fabricCanonicalJson');
const { pubkeyXOnly, pubkeyCompressed, normalizePeerPubkeyHex } = require('../functions/pubkey');
const { sortPubkeysBip67 } = require('../functions/bip67');

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
   * @param {string} role `signer` | `sign` | anything else (reader)
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
   * @param {Object} [opts.tip] `{ content.signers|members, stateDigest, bitcoinBlockHash, … }`
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
      if (!key.verifySchnorr(msg, Buffer.from(sigHex, 'hex'))) {
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
      signature = Buffer.from(opts.signerKey.signSchnorr(msg)).toString('hex');
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

    // First message (genesis)
    const PACKET_CONTRACT_GENESIS = Message.fromVector(['CONTRACT_GENESIS', JSON.stringify({
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

    this.emit('commit', {
      created: now.toISOString(),
      state: this.state
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

Contract.Resolutions = Resolutions;

// Contract body types for tip-bound withdrawals.
Contract.WITHDRAWAL_REQUEST = CONTRACT_BODY_TYPES.ContractWithdrawalRequest;
Contract.WITHDRAWAL_WITNESS = CONTRACT_BODY_TYPES.ContractWithdrawalWitness;

// Token capabilities for contract members (see Contract.issueCapability).
Contract.OP_CONTRACT_READ = 'OP_CONTRACT_READ';
Contract.OP_CONTRACT_SIGN = 'OP_CONTRACT_SIGN';

module.exports = Contract;
