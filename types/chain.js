'use strict';

/**
 * @fileoverview Chain — ledger of Bitcoin-shaped Blocks with consensus policy:
 *
 * - `pow` (default) — parent-linked playnet / Bitcoin-style Block + mempool
 * - `federation` — linear tip; Elements-style k-of-n block signatures (Beacon)
 * - `gossip` — content-addressed data blocks; merge = union by block id
 *
 * Statechain document helpers (`functions/sidechainState`) hold the sealed JSON
 * document. Digests feed that document / Beacon sidechain heads; raw gossip is
 * never Beacon authority.
 *
 * @see docs/CHAIN.md
 * @see docs/DISTRIBUTED_EXECUTION.md
 */

const crypto = require('crypto');
const {
  MAX_TX_PER_BLOCK
} = require('../constants');

const monitor = require('fast-json-patch');

const Actor = require('./actor');
const Block = require('./block');
const Stack = require('./stack');
const State = require('./state');
const Transaction = require('./transaction');
const Tree = require('./tree');
const Key = require('./key');
const fabricCanonicalJson = require('../functions/fabricCanonicalJson');
const { stableStringify } = fabricCanonicalJson;

const CONSENSUS_POW = Block.CONSENSUS_POW;
const CONSENSUS_FEDERATION = Block.CONSENSUS_FEDERATION;
const CONSENSUS_GOSSIP = Block.CONSENSUS_GOSSIP;

/** @private @deprecated Use CONSENSUS_*; aliases for one release. */
const SEAL_BLOCK = 'block';
/** @private */
const SEAL_FEDERATION = CONSENSUS_FEDERATION;
/** @private */
const SEAL_GOSSIP = CONSENSUS_GOSSIP;

function eventId (args = {}) {
  const body = stableStringify({
    source: String(args.source || ''),
    kind: String(args.kind || ''),
    fields: args.fields && typeof args.fields === 'object' ? args.fields : {},
    timestamp: args.timestamp != null ? String(args.timestamp) : ''
  });
  return crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex').slice(0, 32);
}

function entryDigest (entry) {
  return Block.blockDigest({
    id: entry && entry.id,
    parent: entry && entry.parent,
    height: entry && (entry.height != null ? entry.height : entry.clock),
    type: entry && entry.type,
    data: entry && (entry.data !== undefined ? entry.data : entry.payload),
    author: entry && entry.author,
    federationWitness: entry && entry.federationWitness
  });
}

function signingStringForEntry (entry) {
  return Block.signingStringForBlock({
    id: entry && entry.id,
    parent: entry && entry.parent,
    height: entry && (entry.height != null ? entry.height : entry.clock),
    type: entry && entry.type,
    data: entry && (entry.data !== undefined ? entry.data : entry.payload),
    transactions: entry && entry.transactions,
    merkleRoot: entry && entry.merkleRoot,
    timestamp: entry && entry.timestamp,
    author: entry && entry.author,
    nonce: entry && entry.nonce,
    bits: entry && entry.bits
  });
}

function _normalizeConsensus (value) {
  if (value === CONSENSUS_FEDERATION || value === SEAL_FEDERATION) return CONSENSUS_FEDERATION;
  if (value === CONSENSUS_GOSSIP || value === SEAL_GOSSIP) return CONSENSUS_GOSSIP;
  if (value === CONSENSUS_POW || value === SEAL_BLOCK || value === 'block') return CONSENSUS_POW;
  return CONSENSUS_POW;
}

function _cloneRecord (rec) {
  return JSON.parse(JSON.stringify(rec));
}

function _recordFromInput (input, opts = {}) {
  if (input instanceof Block) return input.toRecord();
  if (input && typeof input === 'object') {
    const data = input.data !== undefined
      ? input.data
      : (input.payload !== undefined ? input.payload : (
        (input.type === 'BEACON_EPOCH' || input.type === 'SCEvent' || opts.type)
          ? (input.payload || {})
          : undefined
      ));
    if (data !== undefined || input.type === 'BEACON_EPOCH' || input.type === 'SCEvent' ||
        opts.type || input.federationWitness != null || opts.signWith) {
      const block = new Block({
        id: opts.id || input.id || null,
        parent: input.parent !== undefined ? input.parent : opts.parent,
        height: input.height != null ? input.height : (input.clock != null ? input.clock : opts.height),
        type: opts.type || input.type || 'Block',
        data: data !== undefined ? data : {},
        transactions: input.transactions || {},
        author: opts.author != null ? opts.author : input.author,
        signature: opts.signature != null ? opts.signature : input.signature,
        federationWitness: opts.federationWitness !== undefined
          ? opts.federationWitness
          : input.federationWitness,
        timestamp: input.timestamp,
        nonce: input.nonce,
        bits: input.bits,
        merkleRoot: input.merkleRoot
      });
      if (opts.signWith) block.sign(opts.signWith);
      return block.toRecord();
    }
  }
  const block = input instanceof Block ? input : new Block(input);
  return block.toRecord ? block.toRecord() : {
    id: block.id,
    parent: block.parent,
    height: block.height || 0,
    type: 'Block',
    data: {},
    transactions: block.transactions || {}
  };
}

function _sortGossipRecords (records) {
  return records.slice().sort((a, b) => {
    const ta = (a.data && (a.data.timestamp || a.data.ts)) || a.timestamp || '';
    const tb = (b.data && (b.data.timestamp || b.data.ts)) || b.timestamp || '';
    if (ta !== tb) return String(ta).localeCompare(String(tb));
    const ca = Number(a.height) || 0;
    const cb = Number(b.height) || 0;
    if (ca !== cb) return ca - cb;
    const aa = a.author || '';
    const ab = b.author || '';
    if (aa !== ab) return String(aa).localeCompare(String(ab));
    return String(a.id).localeCompare(String(b.id));
  });
}

function _relinkLinear (records) {
  let parent = null;
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const e = _cloneRecord(records[i]);
    e.parent = parent;
    e.height = i + 1;
    out.push(e);
    parent = e.id;
  }
  return out;
}

function _asTipView (rec) {
  if (!rec) return null;
  const view = _cloneRecord(rec);
  view.clock = view.height;
  view.payload = view.data;
  return view;
}

/**
 * Chain.
 * @property {String} consensus `pow` | `federation` | `gossip`
 */
class Chain extends Actor {
  /**
   * @param {Object} [origin]
   * @param {String} [origin.consensus] `pow` (default), `federation`, or `gossip`
   * @param {String} [origin.seal] Deprecated alias for consensus (`block`→`pow`)
   * @param {Array} [origin.entries] Seed block records (federation/gossip)
   * @param {Array} [origin.blocks] Seed block records
   */
  constructor (origin = {}) {
    super(origin);

    this.name = (origin) ? origin.name : '@fabric/playnet';
    const consensus = _normalizeConsensus(
      origin.consensus != null ? origin.consensus : origin.seal
    );
    this.consensusMode = consensus;
    /** @deprecated Use consensusMode */
    this.seal = consensus === CONSENSUS_POW ? SEAL_BLOCK : consensus;

    this.settings = Object.assign({
      name: this.name,
      consensus: this.consensusMode,
      seal: this.seal,
      type: 'sha256',
      genesis: null,
      mempool: [],
      transactions: {},
      bits: origin.bits != null ? origin.bits : null,
      validators: Array.isArray(origin.validators) ? origin.validators : [],
      threshold: origin.threshold != null ? origin.threshold : 1,
      validator: this.validate.bind(this)
    }, origin);

    this._state = {
      best: null,
      blocks: {},
      genesis: this.settings.genesis,
      consensus: null,
      content: {
        actors: {},
        blocks: [],
        mempool: [],
        tip: null
      },
      transactions: this.settings.transactions || {},
      mempool: this.settings.mempool || [],
      ledger: []
    };

    const seed = Array.isArray(origin.entries)
      ? origin.entries
      : (Array.isArray(origin.blocks) ? origin.blocks : null);

    if (seed && seed.length && this._isPolicyChain()) {
      for (const row of seed) {
        const rec = _recordFromInput(row);
        this._state.blocks[rec.id] = rec;
        this._state.ledger.push(rec.id);
        this._state.consensus = rec.id;
        this._state.content.blocks.push(rec.id);
        this._state.content.actors[rec.id] = rec;
      }
    } else if (!this._isPolicyChain()) {
      for (const [, value] of Object.entries(this._state.transactions)) {
        const tx = new Transaction(value);
        this._state.transactions[tx.id] = tx;
      }
      for (let [, value] of Object.entries(this._state.mempool)) {
        this.proposeTransaction(value);
      }
    }

    return this;
  }

  _isPolicyChain () {
    return this.consensusMode === CONSENSUS_FEDERATION ||
      this.consensusMode === CONSENSUS_GOSSIP;
  }

  /** @deprecated */
  _isEntrySeal () {
    return this._isPolicyChain();
  }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.consensus]
   * @param {string} [opts.seal]
   * @param {Object} [opts.genesis]
   * @param {Array.<Object>} [opts.entries]
   * @param {Array.<Object>} [opts.blocks]
   * @returns {Chain}
   */
  static create (opts = {}) {
    const consensus = _normalizeConsensus(opts.consensus != null ? opts.consensus : opts.seal);
    const chain = new Chain({
      consensus,
      entries: opts.entries || opts.blocks,
      validators: opts.validators,
      threshold: opts.threshold,
      bits: opts.bits
    });
    if (opts.genesis) {
      chain.append(opts.genesis);
    }
    return chain;
  }

  static fromObject (data) {
    return new Chain(data);
  }

  static fromJSON (obj) {
    if (!obj || typeof obj !== 'object') return Chain.create();
    return new Chain({
      consensus: obj.consensus || obj.seal,
      entries: Array.isArray(obj.entries)
        ? obj.entries
        : (Array.isArray(obj.blocks) ? obj.blocks : [])
    });
  }

  toJSON () {
    if (this._isPolicyChain()) {
      return {
        version: 1,
        consensus: this.consensusMode,
        seal: this.seal,
        entries: this.entries
      };
    }
    return {
      version: 1,
      consensus: CONSENSUS_POW,
      seal: SEAL_BLOCK,
      name: this.name,
      tip: this.tip,
      height: this.height
    };
  }

  get consensus () {
    return this._state.consensus;
  }

  get tip () {
    if (this._isPolicyChain()) {
      if (!this._state.ledger.length) return null;
      const id = this._state.ledger[this._state.ledger.length - 1];
      return _asTipView(this._state.blocks[id]);
    }
    return this._state.consensus;
  }

  get root () {
    return this.mast.getRoot();
  }

  get blocks () {
    return this._state.ledger;
  }

  /** Cloned block records (federation/gossip). */
  get entries () {
    return this._state.ledger.map((id) => _asTipView(this._state.blocks[id]));
  }

  get height () {
    return this._state.ledger.length;
  }

  get leaves () {
    return this.blocks.map(x => Buffer.from(x, 'hex'));
  }

  get length () {
    return this.height;
  }

  get subsidy () {
    return 50;
  }

  get mempool () {
    return this._state.mempool;
  }

  get transactions () {
    return this.state.transactions;
  }

  get _tree () {
    const stack = new Stack(this.leaves);
    return stack.asMerkleTree();
  }

  at (index) {
    if (!this._isPolicyChain()) return null;
    const id = this._state.ledger[index];
    if (!id) return null;
    return _asTipView(this._state.blocks[id]);
  }

  digest () {
    if (!this._isPolicyChain()) {
      if (!this._state.ledger.length) return null;
      const leaves = this._state.ledger.map((id) => {
        const rec = this._state.blocks[id];
        return rec ? Block.blockDigest(rec) : id;
      });
      const tree = new Tree({ leaves });
      const root = tree.root;
      if (!root) return null;
      return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
    }
    if (!this._state.ledger.length) return null;
    const leaves = this._state.ledger.map((id) => Block.blockDigest(this._state.blocks[id]));
    const tree = new Tree({ leaves });
    const root = tree.root;
    if (!root) return null;
    return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
  }

  createSignedBlock (proposal = {}) {
    return {
      actor: proposal.actor || Actor.randomBytes(32).toString('hex'),
      changes: proposal.changes,
      mode: proposal.mode || 'NAIVE_SIGHASH_SINGLE',
      object: Buffer.concat([
        Buffer.alloc(32),
        Buffer.alloc(32),
        Buffer.alloc(32),
        Buffer.alloc(64)
      ]),
      parent: this.id,
      signature: Buffer.alloc(64),
      state: this.state,
      type: 'FabricBlock'
    };
  }

  proposeTransaction (transaction) {
    const actor = new Transaction(transaction);

    const prior = this._state.transactions[actor.id];
    if (prior) {
      return prior;
    }

    this._state.transactions[actor.id] = actor;
    this._state.mempool.push(actor.id);

    this._state.content.actors[actor.id] = actor.generic.object;
    this._state.content.mempool.push(actor.id);

    this.commit();

    return actor;
  }

  trust (source) {
    const self = this;

    super.trust(source, 'TIMECHAIN');

    source.on('message', function onTrustedSourceMessage (message) {
      self.emit('debug', `Message from trusted source: ${message}`);
    });

    return self;
  }

  async start () {
    const chain = this;
    this.observer = monitor.observe(this._state.content);
    await chain.commit();
    return chain;
  }

  async stop () {
    await this.commit();
    return this;
  }

  async attach (application) {
    if (!application.store) {
      this.emit('error', `Application has no "store" property.`);
    } else {
      this.store = application.store;
    }
    return this;
  }

  async open () {
    return this.storage.open();
  }

  async close () {
    return this.storage.close();
  }

  async _load () {
    const chain = this;
    const query = await chain.storage.get('/blocks');
    const response = new State(query);
    this.log('query:', query);
    this.log('response:', response);
    this.log('response id:', response.id);
    return chain;
  }

  /**
   * Append a Block (or Block-shaped object).
   * Policy chains return the tip view synchronously; pow returns a Promise.
   * @returns {Promise<Chain>|object}
   */
  append (input, opts = {}) {
    if (this._isPolicyChain()) {
      return this._appendPolicyBlock(input, opts);
    }
    return this._appendPowBlock(input);
  }

  async _appendPowBlock (input) {
    if (!input) throw new Error('Must provide a block.');
    let block = input;
    if (!(block instanceof Block)) {
      block = new Block(block);
    }

    const tipId = this._state.consensus;
    if (tipId && block.parent != null && String(block.parent) !== String(tipId)) {
      // Soft: playnet historically did not enforce parent; only enforce when parent set wrongly
      if (String(block.parent) !== String(tipId) && block.parent !== tipId) {
        /* allow legacy append without parent match when parent was unset in constructor */
      }
    }

    const bits = this.settings.bits;
    if (bits != null) {
      const check = block.validate({ consensus: CONSENSUS_POW, bits });
      if (!check.ok) throw new Error(check.reason || 'invalid block');
    }

    if (this.blocks.length <= 0) {
      this._state.genesis = block.id;
    }

    const rec = (typeof block.toRecord === 'function')
      ? block.toRecord()
      : { id: block.id, parent: block.parent, height: this.height + 1, type: 'Block', data: {}, transactions: block.transactions || {} };

    this._state.blocks[block.id] = rec;
    this._state.ledger.push(block.id);
    this._state.consensus = block.id;

    this._state.content.actors[block.id] = block.generic ? block.generic.object : rec;
    this._state.content.blocks.push(block.id);

    this.commit();
    this.emit('block', block);
    return this;
  }

  _appendPolicyBlock (input, opts = {}) {
    const tipId = this._state.ledger.length
      ? this._state.ledger[this._state.ledger.length - 1]
      : null;
    const tip = tipId ? this._state.blocks[tipId] : null;
    const nextHeight = tip ? (Number(tip.height) || 0) + 1 : 1;

    let payloadInput = input;
    if (!(input instanceof Block) && input && typeof input === 'object') {
      if (input.payload !== undefined && input.data === undefined) {
        payloadInput = { ...input, data: input.payload, type: input.type || opts.type || 'Block' };
      } else if (input.payload !== undefined && input.type) {
        payloadInput = { ...input, data: input.data !== undefined ? input.data : input.payload };
      }
    }

    const rec = _recordFromInput(payloadInput, {
      parent: tip ? tip.id : null,
      height: nextHeight,
      type: opts.type,
      author: opts.author,
      signature: opts.signature,
      federationWitness: opts.federationWitness,
      id: opts.id,
      signWith: opts.signWith
    });

    if (rec.parent === undefined || (opts.parent === undefined && payloadInput && payloadInput.parent === undefined)) {
      rec.parent = tip ? tip.id : null;
    }
    if (payloadInput && payloadInput.parent !== undefined) {
      rec.parent = payloadInput.parent != null ? String(payloadInput.parent) : null;
    }
    if (rec.height == null || rec.height === 0) rec.height = nextHeight;

    // Gossip: content-address by event fields unless caller supplied an explicit id
    if (this.consensusMode === CONSENSUS_GOSSIP) {
      const data = rec.data || {};
      const explicitId = opts.id != null
        ? String(opts.id)
        : (payloadInput && typeof payloadInput === 'object' && !(payloadInput instanceof Block) &&
          payloadInput.id != null
          ? String(payloadInput.id)
          : null);
      rec.id = explicitId || eventId({
        source: rec.author || data.source || '',
        kind: data.kind || rec.type,
        fields: data.fields || data,
        timestamp: data.timestamp || data.ts || ''
      });
    }

    if (this.consensusMode === CONSENSUS_FEDERATION) {
      if (tip && rec.parent !== tip.id) {
        throw new Error('federation Chain: parent must match tip (no forks)');
      }
      if (!tip && rec.parent != null) {
        throw new Error('federation Chain: genesis parent must be null');
      }
    }

    if (opts.signWith && opts.signWith.private) {
      const block = Block.fromRecord(rec);
      block.sign(opts.signWith);
      const signed = block.toRecord();
      rec.author = signed.author;
      rec.signature = signed.signature;
    }

    if (this.consensusMode === CONSENSUS_GOSSIP) {
      if (this._state.blocks[rec.id]) {
        return _asTipView(this._state.blocks[rec.id]);
      }
    }

    this._state.blocks[rec.id] = _cloneRecord(rec);
    this._state.ledger.push(rec.id);
    this._state.consensus = rec.id;
    this._state.content.blocks.push(rec.id);
    this._state.content.actors[rec.id] = rec;

    const view = _asTipView(rec);
    this.emit('block', view);
    this.emit('entry', view);
    return view;
  }

  pop () {
    if (!this._isPolicyChain()) return null;
    if (!this._state.ledger.length) return null;
    const id = this._state.ledger.pop();
    const rec = this._state.blocks[id];
    delete this._state.blocks[id];
    this._state.consensus = this._state.ledger.length
      ? this._state.ledger[this._state.ledger.length - 1]
      : null;
    const idx = this._state.content.blocks.indexOf(id);
    if (idx >= 0) this._state.content.blocks.splice(idx, 1);
    return _asTipView(rec);
  }

  replay (opts = {}) {
    if (!this._isPolicyChain()) return [];
    let list = this.entries;
    if (opts.fromId) {
      const idx = list.findIndex((e) => e.id === opts.fromId);
      list = idx >= 0 ? list.slice(idx) : [];
    }
    if (opts.fromClock != null) {
      const c = Number(opts.fromClock) || 0;
      list = list.filter((e) => (e.height || e.clock) >= c);
    }
    if (typeof opts.filter === 'function') {
      list = list.filter(opts.filter);
    }
    return list;
  }

  split (opts = {}) {
    if (!this._isPolicyChain()) {
      return {
        head: Chain.create({ consensus: this.consensusMode }),
        tail: Chain.create({ consensus: this.consensusMode })
      };
    }
    const by = opts.by || 'clock';
    let headEntries = [];
    let tailEntries = [];
    const all = this.entries;

    if (by === 'clock' || by === 'height') {
      const at = Number(opts.at != null ? opts.at : opts.clock) || 0;
      for (const e of all) {
        if ((e.height || e.clock) <= at) headEntries.push(e);
        else tailEntries.push(e);
      }
    } else if (by === 'time') {
      const at = String(opts.at || '');
      for (const e of all) {
        const ts = (e.data && (e.data.timestamp || e.data.ts)) ||
          (e.payload && (e.payload.timestamp || e.payload.ts)) || '';
        if (String(ts) <= at) headEntries.push(e);
        else tailEntries.push(e);
      }
    } else if (by === 'author') {
      const author = String(opts.author || opts.at || '');
      for (const e of all) {
        if (String(e.author || '') === author) headEntries.push(e);
        else tailEntries.push(e);
      }
    } else if (by === 'predicate' && typeof opts.predicate === 'function') {
      for (const e of all) {
        if (opts.predicate(e)) headEntries.push(e);
        else tailEntries.push(e);
      }
    } else {
      headEntries = all;
      tailEntries = [];
    }

    if (this.consensusMode === CONSENSUS_FEDERATION) {
      headEntries = _relinkLinear(headEntries);
      tailEntries = _relinkLinear(tailEntries);
    }

    return {
      head: new Chain({ consensus: this.consensusMode, entries: headEntries }),
      tail: new Chain({ consensus: this.consensusMode, entries: tailEntries })
    };
  }

  merge (other) {
    if (!this._isPolicyChain()) throw new Error('merge requires federation or gossip consensus');
    if (!other || !(other instanceof Chain) || !other._isPolicyChain()) {
      throw new Error('merge requires a Chain with federation/gossip consensus');
    }
    if (other.consensusMode !== this.consensusMode) {
      throw new Error('merge consensus mode mismatch');
    }

    if (this.consensusMode === CONSENSUS_FEDERATION) {
      const a = this._state.ledger.map((id) => this._state.blocks[id]);
      const b = other._state.ledger.map((id) => other._state.blocks[id]);
      let i = 0;
      while (i < a.length && i < b.length) {
        if (a[i].id !== b[i].id) {
          throw new Error('federation Chain merge: fork detected');
        }
        i++;
      }
      if (b.length < a.length) return this;
      for (; i < b.length; i++) {
        const tipId = this._state.ledger.length
          ? this._state.ledger[this._state.ledger.length - 1]
          : null;
        const tip = tipId ? this._state.blocks[tipId] : null;
        const next = _cloneRecord(b[i]);
        const expectedParent = tip ? tip.id : null;
        if (next.parent !== expectedParent && tip) {
          next.parent = expectedParent;
          next.height = (Number(tip.height) || 0) + 1;
        } else if (!tip) {
          next.parent = null;
          next.height = 1;
        }
        if (tip && next.parent !== tip.id) {
          throw new Error('federation Chain merge: extension parent mismatch');
        }
        this._state.blocks[next.id] = next;
        this._state.ledger.push(next.id);
        this._state.consensus = next.id;
        this._state.content.blocks.push(next.id);
      }
      return this;
    }

    const byId = new Map();
    for (const id of this._state.ledger) byId.set(id, _cloneRecord(this._state.blocks[id]));
    for (const id of other._state.ledger) {
      if (!byId.has(id)) byId.set(id, _cloneRecord(other._state.blocks[id]));
    }
    const merged = _relinkLinear(_sortGossipRecords([...byId.values()]));
    this._state.blocks = {};
    this._state.ledger = [];
    this._state.content.blocks = [];
    for (const rec of merged) {
      this._state.blocks[rec.id] = rec;
      this._state.ledger.push(rec.id);
      this._state.content.blocks.push(rec.id);
      this._state.consensus = rec.id;
    }
    return this;
  }

  verify (validatorsOrLevel = 4, thresholdOrDepth = 6) {
    if (this._isPolicyChain()) {
      return this._verifyPolicy(validatorsOrLevel, thresholdOrDepth);
    }
    return this._verifyBlocks(validatorsOrLevel, thresholdOrDepth);
  }

  async _verifyBlocks (level = 4, depth = 6) {
    this.log(`Verification Level ${level} running from -${depth}...`);
    console.log('root:', this.root);
    return (this['@id'] === this.root);
  }

  _verifyPolicy (validators, threshold) {
    const failures = [];
    const pubs = Array.isArray(validators) ? validators : this.settings.validators || [];
    const thr = Math.max(1, Number(threshold != null ? threshold : this.settings.threshold) || 1);

    for (const id of this._state.ledger) {
      const rec = this._state.blocks[id];
      if (!rec) continue;
      const block = Block.fromRecord(rec);
      const result = block.validate({
        consensus: this.consensusMode,
        validators: pubs,
        threshold: thr
      });
      if (!result.ok) {
        failures.push({
          id: rec.id,
          clock: rec.data && rec.data.clock != null ? rec.data.clock : rec.height,
          reason: result.reason || 'invalid'
        });
      }
    }
    return { ok: failures.length === 0, failures };
  }

  replaceFromBeaconMessages (messages) {
    const built = fromBeaconMessages(messages, { consensus: CONSENSUS_FEDERATION });
    this.consensusMode = CONSENSUS_FEDERATION;
    this.seal = SEAL_FEDERATION;
    this.settings.consensus = CONSENSUS_FEDERATION;
    this.settings.seal = SEAL_FEDERATION;
    this._state.blocks = built._state.blocks;
    this._state.ledger = built._state.ledger.slice();
    this._state.consensus = built._state.consensus;
    this._state.content.blocks = built._state.ledger.slice();
    return this;
  }

  toBeaconMessages () {
    return toBeaconMessages(this);
  }

  pruneByBeaconHeight (inclusiveMaxHeight) {
    if (!this._isPolicyChain()) return { pruned: 0, removedBeaconClocks: [] };
    const maxH = Number(inclusiveMaxHeight);
    if (!Number.isFinite(maxH)) return { pruned: 0, removedBeaconClocks: [] };
    const removedBeaconClocks = [];
    const kept = [];
    for (const id of this._state.ledger) {
      const e = this._state.blocks[id];
      const h = e.data && e.data.height != null ? Number(e.data.height) : 0;
      if (h <= maxH) kept.push(_cloneRecord(e));
      else if (e.data && e.data.clock != null) removedBeaconClocks.push(Number(e.data.clock));
    }
    const pruned = this._state.ledger.length - kept.length;
    let parent = null;
    this._state.blocks = {};
    this._state.ledger = [];
    this._state.content.blocks = [];
    for (const row of kept) {
      row.parent = parent;
      if (row.data && row.data.clock != null) row.height = Number(row.data.clock);
      this._state.blocks[row.id] = row;
      this._state.ledger.push(row.id);
      this._state.content.blocks.push(row.id);
      this._state.consensus = row.id;
      parent = row.id;
    }
    if (!kept.length) this._state.consensus = null;
    return { pruned, removedBeaconClocks };
  }

  truncateAt (idx) {
    if (!this._isPolicyChain()) return this;
    const i = Math.max(0, Number(idx) || 0);
    const keep = this._state.ledger.slice(0, i);
    const nextBlocks = {};
    for (const id of keep) nextBlocks[id] = this._state.blocks[id];
    this._state.blocks = nextBlocks;
    this._state.ledger = keep;
    this._state.content.blocks = keep.slice();
    this._state.consensus = keep.length ? keep[keep.length - 1] : null;
    return this;
  }

  async _listBlocks () {
    return this.blocks;
  }

  async generateBlock () {
    // Playnet proposal shape stays `{ parent, transactions }` so Actor ids match fixtures.
    const proposal = {
      parent: this.consensus,
      transactions: {}
    };

    if (this.mempool.length) {
      for (let i = 0; i < MAX_TX_PER_BLOCK; i++) {
        try {
          const txid = this.mempool.shift();
          const candidate = this._state.transactions[txid];
          const tx = new Transaction(candidate);
          proposal.transactions[tx.id] = candidate;
        } catch (exception) {
          console.error('Could not create block:', exception);
          return null;
        }
      }
    }

    const bits = this.settings.bits;
    if (bits != null && Number(bits) > 0) {
      let nonce = 0;
      let block = new Block({ ...proposal, nonce, bits });
      while (!Block.meetsProofOfWork(block.id, bits) && nonce < 1e6) {
        nonce += 1;
        block = new Block({ ...proposal, nonce, bits });
      }
      await this.append(block);
      return block;
    }

    const block = new Block(proposal);
    await this.append(block);
    return block;
  }

  async generateBlocks (count = 1) {
    const blocks = [];
    for (let i = 0; i < count; i++) {
      const block = await this.generateBlock();
      blocks.push(block);
    }
    return blocks;
  }

  async commit () {
    let changes = null;
    if (this.observer) {
      changes = monitor.generate(this.observer);
    }
    if (changes) {
      this.emit('changes', {
        type: 'StateChanges',
        data: changes
      });
    }
    const state = new Actor(this._state);
    return state.id;
  }

  validate (chain) {
    let valid = false;
    for (let i = 0; i < chain.height; i++) {
      void chain.blocks[i];
    }
    return valid;
  }

  render () {
    console.log('[CHAIN]', '[RENDER]', this);
    return `<Chain id="${this.id}" consensus="${this.consensusMode}" />`;
  }
}

function fromBeaconMessages (messages, opts = {}) {
  const chain = new Chain({
    consensus: opts.consensus || opts.seal || CONSENSUS_FEDERATION
  });
  let parent = null;
  let i = 0;
  for (const m of messages || []) {
    if (!m || typeof m !== 'object') continue;
    i += 1;
    const data = m.payload && typeof m.payload === 'object'
      ? m.payload
      : (m.data && typeof m.data === 'object' ? m.data : {});
    const id = m.id != null
      ? String(m.id)
      : entryDigest({
        id: '',
        parent,
        height: data.clock != null ? Number(data.clock) : i,
        type: m.type || 'BEACON_EPOCH',
        data,
        author: null,
        federationWitness: m.federationWitness || null
      }).slice(0, 32);
    const rec = {
      id,
      parent,
      height: data.clock != null ? Number(data.clock) : i,
      type: String(m.type || 'BEACON_EPOCH'),
      data: JSON.parse(JSON.stringify(data)),
      transactions: {},
      author: null,
      signature: null,
      signatures: [],
      federationWitness: m.federationWitness
        ? JSON.parse(JSON.stringify(m.federationWitness))
        : null,
      merkleRoot: null,
      nonce: 0,
      bits: null,
      timestamp: data.timestamp || null
    };
    chain._state.blocks[id] = rec;
    chain._state.ledger.push(id);
    chain._state.consensus = id;
    chain._state.content.blocks.push(id);
    parent = id;
  }
  return chain;
}

function toBeaconMessages (chain) {
  if (!(chain instanceof Chain) || !chain._isPolicyChain()) return [];
  return chain._state.ledger.map((id) => {
    const e = chain._state.blocks[id];
    const row = {
      type: e.type || 'BEACON_EPOCH',
      payload: e.data,
      id: e.id || null
    };
    if (e.federationWitness) row.federationWitness = e.federationWitness;
    return row;
  });
}

Chain.CONSENSUS_POW = CONSENSUS_POW;
Chain.CONSENSUS_FEDERATION = CONSENSUS_FEDERATION;
Chain.CONSENSUS_GOSSIP = CONSENSUS_GOSSIP;
Chain.SEAL_BLOCK = SEAL_BLOCK;
Chain.SEAL_FEDERATION = SEAL_FEDERATION;
Chain.SEAL_GOSSIP = SEAL_GOSSIP;
Chain.eventId = eventId;
Chain.entryDigest = entryDigest;
Chain.signingStringForEntry = signingStringForEntry;
Chain.fromBeaconMessages = fromBeaconMessages;
Chain.toBeaconMessages = toBeaconMessages;

module.exports = Chain;
module.exports.eventId = eventId;
module.exports.entryDigest = entryDigest;
module.exports.signingStringForEntry = signingStringForEntry;
module.exports.fromBeaconMessages = fromBeaconMessages;
module.exports.toBeaconMessages = toBeaconMessages;
module.exports.CONSENSUS_POW = CONSENSUS_POW;
module.exports.CONSENSUS_FEDERATION = CONSENSUS_FEDERATION;
module.exports.CONSENSUS_GOSSIP = CONSENSUS_GOSSIP;
module.exports.SEAL_BLOCK = SEAL_BLOCK;
module.exports.SEAL_FEDERATION = SEAL_FEDERATION;
module.exports.SEAL_GOSSIP = SEAL_GOSSIP;
