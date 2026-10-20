'use strict';

// Constants
const {
  MAX_CHANNEL_VALUE
} = require('../constants');

// Dependencies
const crypto = require('crypto');
const BN = require('bn.js');
const bitcoin = require('bitcoinjs-lib');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { witnessStackToScriptWitness } = require('bitcoinjs-lib/src/psbt/psbtutils');

// Types
const Entity = require('./entity');
const State = require('./state');
const Secret = require('./secret');
const Witness = require('./witness');
const Resolutions = require('./resolutions');

// Functions
const { taprootPsbtInputFields, signerFromPriv32 } = require('../functions/inventoryHtlc');
const { buildInclusion } = require('../functions/bitcoinTxInclusion');
const ecc = require('./ecc');
const EventEmitter = require('events');

const {
  networkForFabricName,
  buildSpendLeaf,
  buildHashlockLeaf,
  buildScriptLeaf,
  composeTaprootTree,
  buildControlBlockForLeaf,
  prepareLeafPsbt,
  finalizeSpendPsbt,
  finalizeHashlockPsbt
} = require('../functions/contractTaproot');

// Locals
const HEX64 = /^[0-9a-f]{64}$/;
const COMPRESSED = /^(02|03)[0-9a-f]{64}$/;
const MAINNET_NAMES = new Set(['mainnet', 'main', 'bitcoin', 'livenet']);
const DUST = 546;
const SEQUENCE_NONFINAL = (2 ** 32) - 2; // 0xfffffffe: enables nLockTime, opts out of RBF signalling
const ECPoint = secp256k1.Point || secp256k1.ProjectivePoint;
const CURVE_N = (ECPoint.Fn && ECPoint.Fn.ORDER) || (secp256k1.CURVE && secp256k1.CURVE.n);

/**
 * CONTRACT_MESSAGE body types for the Fabric payment channel flow. These ride
 * the existing `CONTRACT_MESSAGE` opcode as signed artifacts
 * ({@link Witness.signArtifact}); **no channel opcode is introduced** — a
 * dedicated opcode is a separate, later protocol decision.
 */
const CHANNEL_BODY_TYPES = Object.freeze({
  Open: 'ChannelOpen',
  Commitment: 'ChannelCommitment',
  Revoke: 'ChannelRevoke',
  HtlcFulfill: 'ChannelHtlcFulfill',
  HtlcFail: 'ChannelHtlcFail',
  Close: 'ChannelClose'
});

/**
 * Channel defaults (Lightning-derived, scaled for a per-chunk market).
 * Policy fields are negotiated at `ChannelOpen` — the stricter value wins.
 */
const CHANNEL_DEFAULTS = Object.freeze({
  toSelfDelay: 144,
  anchorSats: 330,
  minCommitFeeSats: 200,
  maxCommitFeeSats: 50000,
  maxAcceptedHtlcs: 30,
  htlcMinimumSats: 1,
  maxDustExposureSats: 5000,
  minCltvDelta: 6,
  closeMarginBlocks: 144,
  staleTipMs: 60 * 60 * 1000,
  minFundingConfirmations: Object.freeze({ regtest: 1, signet: 1, default: 3 })
});

/**
 * Normalise and validate a 33-byte compressed pubkey hex.
 * @param {string} label error prefix
 * @param {string} hex
 * @returns {string} lowercase hex
 * @private
 */
function compressedOrThrow (label, hex) {
  const s = String(hex || '').trim().toLowerCase();
  if (!COMPRESSED.test(s)) throw new Error(`${label} must be a 33-byte compressed pubkey (hex)`);
  return s;
}

/**
 * x-only (32-byte) form of a compressed pubkey.
 * @param {string} compressedHex
 * @returns {string}
 * @private
 */
function xOnlyOf (compressedHex) {
  return compressedHex.slice(2);
}

/**
 * Throw for any mainnet network name (RC posture: regtest / signet / testnet only).
 * @param {string} network
 * @private
 */
function refuseMainnet (network) {
  if (MAINNET_NAMES.has(String(network || '').toLowerCase())) {
    throw new Error('Channel: mainnet refused (regtest/signet/testnet only)');
  }
}

/**
 * Normalise an HTLC expiry into `{ type: 'cltv', height }`.
 * @param {number|Object|null} raw block height or `{ type, height }`
 * @returns {Object|null}
 * @private
 */
function heightLock (raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && raw.type === 'cltv') return { type: 'cltv', height: Number(raw.height != null ? raw.height : raw.value) };
  const h = Math.floor(Number(raw));
  if (!Number.isFinite(h) || h <= 0) throw new Error('Channel: block height lock required');
  return { type: 'cltv', height: h };
}

/**
 * @param {Buffer|string} buf
 * @returns {string} SHA256 hex
 * @private
 */
function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// (legacy Consensus type removed)
// const Layer = require('./layer');

/**
 * @classdesc <strong>Payment / capacity channel</strong> between peers: balances (<code>incoming</code> /
 * <code>outgoing</code>), counterparty handle, optional asset caps (<code>MAX_CHANNEL_VALUE</code>). Extends
 * {@link State} → {@link Actor}. Wording below is product-oriented;
 * wire safety still depends on the Lightning/Bitcoin services you attach, not this object alone.
 * @class Channel
 * @extends State
 */
class Channel extends State {
  /**
   * Creates a channel between two peers (bidirectional by default; <code>settings.mode</code>, <code>settings.asset</code>, …).
   * @param {Object} [settings] Configuration for the channel.
   */
  constructor (settings) {
    super(settings);

    // assign internal settings
    this.settings = Object.assign({
      asset: null,
      maximum: MAX_CHANNEL_VALUE, // 1 BTC in satoshis
      provider: 'bcoin',
      mode: 'bidirectional'
    }, settings);

    // this.key = new Key();
    this.secret = new Secret();
    // this.provider = new Consensus({ provider: this.settings.provider });

    this._state = {
      counterparty: this.settings.counterparty || {},
      value: {
        incoming: 0,
        outgoing: 0
      },
      inputs: []
    };

    Object.defineProperties(this, {
      '@allocation': { enumerable: false },
      '@data': { enumerable: false },
      '@input': { enumerable: false },
      // 'id': { enumerable: false },
      'config': { enumerable: false },
      'key': { enumerable: false },
      'observer': { enumerable: false },
      'provider': { enumerable: false },
      'settings': { enumerable: false },
      // 'size': { enumerable: false },
    });

    this['@id'] = this.id;
    this.status = 'initialized';

    return this;
  }

  set state (value) {
    this._state = value;
  }

  get state () {
    return Object.assign({}, this._state);
  }

  get counterparty () {
    return this._state.counterparty || null;
  }

  get balance () {
    return this._state.value.outgoing;
  }

  set balance (amount) {
    this._state.value.outgoing = amount;
    this.commit();
    return this.balance;
  }

  /**
   * Add an amount to the channel's balance.
   * @param {Number} amount Amount value to add to current outgoing balance.
   */
  add (amount) {
    void new BN(amount + '');
    /* const layer = new Layer({
      parents: [this._parent],
      uint256: value
    }); */

    this._state.value.outgoing += amount;
    this.commit();
    return this.balance;
  }

  commit () {
    super.commit();
    const snapshot = typeof structuredClone === 'function'
      ? structuredClone(this._state)
      : JSON.parse(JSON.stringify(this._state));
    const committed = new Entity(snapshot);
    this.emit('commit', committed);
    return committed;
  }

  /**
   * Fund the channel.
   * @param {Mixed} input Instance of a {@link Transaction}.
   */
  async fund (input) {
    // this._layer = new Layer({ inputs: [input] });
    this._state.inputs.push(input);
    this.commit();
  }

  /**
   * Opens a {@link Channel} with a {@link Peer}.
   * @param {Object} channel Channel settings.
   */
  async open (channel = {}) {
    if (!channel.recipient) return console.error('Channel recipient must be provided.');
    this.status = 'opening';
    this._state.session = {
      counterparty: channel.recipient,
      settings: channel
    };
    this.status = 'opened';
    this.commit();
  }

  async close () {
    this.status = 'closed';
    this.commit();
  }

  async _setDestinationAddress (address) {
    console.log('[FABRIC:CHANNEL]', `Setting destination address to ${address} on counterparty:`, this.counterparty);
    this.counterparty.address = address;
    this.commit();
  }

  async _getSpendableOutput () {
    let mtx = new this.provider.MTX();
    let script = new this.provider.Script();

    let tx = mtx.toTX();
    // TODO: remove short-circuit
    return {
      '@type': "BitcoinTransactionOutput",
      "@data": {
        script: script,
        transaction: tx
      }
    };
  }
}


// ---------------------------------------------------------------------------
// Phase 4: Fabric payment channels — unbroadcast L1 commitments as
// CONTRACT_MESSAGE bodies, off-chain per-chunk settlement, multi-hop HTLC,
// Lightning-style penalty revocation (asymmetric commitments).
// ---------------------------------------------------------------------------

/**
 * @param {string} hex
 * @returns {bigint}
 * @private
 */
function bigintFromHex (hex) {
  return BigInt('0x' + String(hex));
}

/**
 * @param {bigint} n
 * @returns {string} 32-byte zero-padded hex
 * @private
 */
function hexFromBigint (n) {
  return n.toString(16).padStart(64, '0');
}

/**
 * Decode a secp256k1 point from compressed hex (noble v1 / v2 compatible).
 * @param {string} hex
 * @returns {Object} ECPoint
 * @private
 */
function pointFromHex (hex) {
  const buf = Buffer.from(String(hex), 'hex');
  if (typeof ECPoint.fromBytes === 'function') return ECPoint.fromBytes(Uint8Array.from(buf));
  return ECPoint.fromHex(buf.toString('hex'));
}

/**
 * Encode a secp256k1 point as compressed hex.
 * @param {Object} P ECPoint
 * @returns {string}
 * @private
 */
function pointToHex (P) {
  const bytes = typeof P.toBytes === 'function' ? P.toBytes(true) : P.toRawBytes(true);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Reduce 32 bytes to a scalar mod the curve order.
 * @param {Buffer} buf
 * @returns {bigint}
 * @private
 */
function scalarOf (buf) {
  return bigintFromHex(Buffer.from(buf).toString('hex')) % CURVE_N;
}

/**
 * @param {number} n
 * @returns {Buffer} 8-byte big-endian encoding
 * @private
 */
function u64be (n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Number(n) || 0)));
  return b;
}

Channel.DEFAULTS = CHANNEL_DEFAULTS;

/**
 * Per-commitment secret for state `n` (BOLT 3 shape; a plain hash chain over
 * a per-channel seed — shachain compaction is out of scope).
 * @param {Buffer} seed 32 bytes
 * @param {number} n commitment number
 * @returns {string} 32-byte hex
 */
Channel.commitmentSecret = function commitmentSecret (seed, n) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new Error('commitmentSecret: 32-byte seed required');
  return sha256Hex(Buffer.concat([seed, u64be(n), Buffer.from('fabric-channel-commitment')]));
};

/**
 * Per-commitment point `secret * G`.
 * @param {string} secretHex
 * @returns {string} compressed pubkey hex
 */
Channel.commitmentPoint = function commitmentPoint (secretHex) {
  const s = String(secretHex || '').toLowerCase();
  if (!HEX64.test(s)) throw new Error('commitmentPoint: 32-byte secret hex required');
  return pointToHex(ECPoint.BASE.multiply(bigintFromHex(s) % CURVE_N));
};

/**
 * BOLT 3 revocation pubkey: `basepoint * H(basepoint || point) + point * H(point || basepoint)`.
 * The basepoint is the *non-holder's* channel key, the point is the holder's
 * per-commitment point; only the non-holder can derive the private key, and
 * only once the holder reveals that commitment's secret.
 * @param {string} basepointHex compressed
 * @param {string} perCommitmentPointHex compressed
 * @returns {string} compressed pubkey hex
 */
Channel.revocationPubkey = function revocationPubkey (basepointHex, perCommitmentPointHex) {
  const B = pointFromHex(compressedOrThrow('basepoint', basepointHex));
  const P = pointFromHex(compressedOrThrow('perCommitmentPoint', perCommitmentPointHex));
  const bBuf = Buffer.from(basepointHex, 'hex');
  const pBuf = Buffer.from(perCommitmentPointHex, 'hex');
  const h1 = scalarOf(crypto.createHash('sha256').update(Buffer.concat([bBuf, pBuf])).digest());
  const h2 = scalarOf(crypto.createHash('sha256').update(Buffer.concat([pBuf, bBuf])).digest());
  return pointToHex(B.multiply(h1).add(P.multiply(h2)));
};

/**
 * Revocation private key once the holder's per-commitment secret is known.
 * @param {Buffer} basepointSecret32 non-holder's channel private key
 * @param {string} perCommitmentSecretHex holder's revealed secret
 * @returns {Buffer} 32-byte private key for {@link Channel.revocationPubkey}
 */
Channel.revocationPrivkey = function revocationPrivkey (basepointSecret32, perCommitmentSecretHex) {
  const b = scalarOf(basepointSecret32);
  const s = bigintFromHex(String(perCommitmentSecretHex).toLowerCase()) % CURVE_N;
  const bHex = pointToHex(ECPoint.BASE.multiply(b));
  const pHex = Channel.commitmentPoint(perCommitmentSecretHex);
  const bBuf = Buffer.from(bHex, 'hex');
  const pBuf = Buffer.from(pHex, 'hex');
  const h1 = scalarOf(crypto.createHash('sha256').update(Buffer.concat([bBuf, pBuf])).digest());
  const h2 = scalarOf(crypto.createHash('sha256').update(Buffer.concat([pBuf, bBuf])).digest());
  const r = (b * h1 + s * h2) % CURVE_N;
  return Buffer.from(hexFromBigint(r), 'hex');
};

/**
 * Negotiate two channel policies: the stricter value wins on every field.
 * @param {object} [a]
 * @param {object} [b]
 * @param {number} [capacitySats] for the default reserve (1 % of capacity, min dust)
 * @returns {object}
 */
Channel.negotiatePolicy = function negotiatePolicy (a = {}, b = {}, capacitySats = 0) {
  const d = CHANNEL_DEFAULTS;
  const num = (v, dflt) => (v == null || !Number.isFinite(Number(v)) ? dflt : Math.floor(Number(v)));
  const defaultReserve = Math.max(DUST, Math.floor((Number(capacitySats) || 0) / 100));
  const defaultInFlight = Math.max(DUST, Number(capacitySats) || MAX_CHANNEL_VALUE);
  const pick = (field, dflt, mode) => {
    const x = num(a[field], dflt);
    const y = num(b[field], dflt);
    return mode === 'min' ? Math.min(x, y) : Math.max(x, y);
  };
  const policy = {
    maxAcceptedHtlcs: pick('maxAcceptedHtlcs', d.maxAcceptedHtlcs, 'min'),
    maxHtlcValueInFlightSats: pick('maxHtlcValueInFlightSats', defaultInFlight, 'min'),
    htlcMinimumSats: pick('htlcMinimumSats', d.htlcMinimumSats, 'max'),
    maxDustExposureSats: pick('maxDustExposureSats', d.maxDustExposureSats, 'min'),
    channelReserveSats: pick('channelReserveSats', defaultReserve, 'max'),
    minCommitFeeSats: pick('minCommitFeeSats', d.minCommitFeeSats, 'max'),
    maxCommitFeeSats: pick('maxCommitFeeSats', d.maxCommitFeeSats, 'min'),
    minCltvDelta: pick('minCltvDelta', d.minCltvDelta, 'max'),
    closeMarginBlocks: pick('closeMarginBlocks', d.closeMarginBlocks, 'max')
  };
  if (policy.maxAcceptedHtlcs < 1) policy.maxAcceptedHtlcs = 1;
  if (policy.minCommitFeeSats > policy.maxCommitFeeSats) policy.maxCommitFeeSats = policy.minCommitFeeSats;
  return policy;
};

/**
 * Deterministic channel id over the funding address, both keys and the
 * negotiated `toSelfDelay` (so neither party can re-interpret the delay).
 * @param {object} funding
 * @returns {string}
 */
Channel.idFor = function idFor (funding) {
  const keys = [funding.localPubkey, funding.remotePubkey].map((k) => String(k).toLowerCase()).sort();
  return sha256Hex(Buffer.from(`${String(funding.address)}:${keys.join(':')}:${Number(funding.toSelfDelay) || 0}`));
};

/**
 * P2TR funding output: `cooperative` 2-of-2 leaf (every commitment and the
 * cooperative close spend through it) plus a `refund` leaf for the funder
 * after `expireAfter` (block height) so funds never strand.
 * @param {object} opts `{ network, localPubkey, remotePubkey, expireAfter, capacitySats, funder?, toSelfDelay? }`
 * @returns {object} `ChannelFunding` record (`_leaves` carries scripts; drop before gossip)
 */
Channel.buildFunding = function buildFunding (opts = {}) {
  const network = String(opts.network || 'regtest');
  refuseMainnet(network);
  const local = compressedOrThrow('localPubkey', opts.localPubkey);
  const remote = compressedOrThrow('remotePubkey', opts.remotePubkey);
  const expireAfter = heightLock(opts.expireAfter);
  if (!expireAfter) throw new Error('buildFunding: expireAfter height required');
  const funder = opts.funder === 'remote' ? remote : local;
  const toSelfDelay = Math.floor(Number(opts.toSelfDelay != null ? opts.toSelfDelay : CHANNEL_DEFAULTS.toSelfDelay));
  if (!(toSelfDelay >= 1 && toSelfDelay <= 65535)) throw new Error('buildFunding: toSelfDelay must be 1..65535 blocks');
  const leaves = [
    buildSpendLeaf({ id: 'cooperative', keys: [local, remote], threshold: 2 }),
    buildSpendLeaf({ id: 'refund', keys: [funder], threshold: 1, after: expireAfter })
  ];
  const tree = composeTaprootTree({ network, leaves });
  const funding = {
    type: 'ChannelFunding',
    version: 2,
    network,
    localPubkey: local,
    remotePubkey: remote,
    funder,
    expireAfter,
    toSelfDelay,
    capacitySats: opts.capacitySats != null ? Math.floor(Number(opts.capacitySats)) : null,
    address: tree.address,
    leaves: tree.leaves,
    internalPubkeyHex: tree.internalPubkeyHex,
    _leaves: tree.leafScripts
  };
  funding.channelId = Channel.idFor(funding);
  return funding;
};

/**
 * Rebuild a funding record (with leaf scripts) from its public fields.
 * @param {object} record
 * @returns {object}
 */
Channel.fundingFromRecord = function fundingFromRecord (record = {}) {
  const funder = record.funder === record.remotePubkey ? 'remote' : 'local';
  return Channel.buildFunding(Object.assign({}, record, { funder }));
};

/**
 * Holder's balance output on their own commitment: `delayed` leaf (holder key
 * after `toSelfDelay` CSV) and `revocation` leaf (immediate, revocation key).
 * @param {object} opts `{ network, holderPubkey, revocationPubkey, toSelfDelay }`
 * @returns {object}
 */
Channel.buildToLocalOutput = function buildToLocalOutput (opts = {}) {
  const network = String(opts.network || 'regtest');
  refuseMainnet(network);
  const holder = compressedOrThrow('holderPubkey', opts.holderPubkey);
  const revocation = compressedOrThrow('revocationPubkey', opts.revocationPubkey);
  const toSelfDelay = Math.floor(Number(opts.toSelfDelay) || CHANNEL_DEFAULTS.toSelfDelay);
  const leaves = [
    buildSpendLeaf({ id: 'delayed', keys: [holder], threshold: 1, after: { type: 'csv', blocks: toSelfDelay } }),
    buildSpendLeaf({ id: 'revocation', keys: [revocation], threshold: 1 })
  ];
  const tree = composeTaprootTree({ network, leaves });
  return { holderPubkey: holder, revocationPubkey: revocation, toSelfDelay, address: tree.address, internalPubkeyHex: tree.internalPubkeyHex, _leaves: tree.leafScripts };
};

/**
 * Anchor output (CPFP handle) for one party: single-key leaf, no delay.
 * @param {object} opts `{ network, pubkey }`
 * @returns {object}
 */
Channel.buildAnchorOutput = function buildAnchorOutput (opts = {}) {
  const network = String(opts.network || 'regtest');
  const pubkey = compressedOrThrow('pubkey', opts.pubkey);
  const leaves = [buildSpendLeaf({ id: 'anchor', keys: [pubkey], threshold: 1 })];
  const tree = composeTaprootTree({ network, leaves });
  return { pubkey, address: tree.address, internalPubkeyHex: tree.internalPubkeyHex, _leaves: tree.leafScripts };
};

/**
 * Per-HTLC P2TR output on a commitment. Symmetric form (no `revocationPubkey`):
 * `claim` hashlock leaf for the receiver and `timeout` leaf for the sender
 * after `expireAfter`. Holder-aware form adds a `revocation` leaf and a
 * `toSelfDelay` CSV on whichever leaf pays the commitment *holder* (BOLT 3):
 * the holder is punished for a stale broadcast and must wait on their own tx,
 * the counterparty spends immediately.
 * @param {object} opts `{ network, paymentHashHex, receiverPubkey, senderPubkey, expireAfter, holder?: 'receiver'|'sender', toSelfDelay?, revocationPubkey? }`
 * @returns {object}
 */
Channel.buildHtlcOutput = function buildHtlcOutput (opts = {}) {
  const network = String(opts.network || 'regtest');
  refuseMainnet(network);
  const paymentHashHex = String(opts.paymentHashHex || '').toLowerCase();
  if (!HEX64.test(paymentHashHex)) throw new Error('buildHtlcOutput: paymentHashHex must be 32-byte hex');
  const receiver = compressedOrThrow('receiverPubkey', opts.receiverPubkey);
  const sender = compressedOrThrow('senderPubkey', opts.senderPubkey);
  const expireAfter = heightLock(opts.expireAfter);
  if (!expireAfter) throw new Error('buildHtlcOutput: expireAfter height required');
  const leaves = [];
  if (opts.revocationPubkey) {
    const revocation = compressedOrThrow('revocationPubkey', opts.revocationPubkey);
    const holder = opts.holder === 'sender' ? 'sender' : 'receiver';
    const csv = { type: 'csv', blocks: Math.floor(Number(opts.toSelfDelay) || CHANNEL_DEFAULTS.toSelfDelay) };
    if (holder === 'receiver') {
      leaves.push(buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHashHex, pubkeyHex: receiver, after: csv }));
      leaves.push(buildSpendLeaf({ id: 'timeout', keys: [sender], threshold: 1, after: expireAfter }));
    } else {
      leaves.push(buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHashHex, pubkeyHex: receiver }));
      const inner = buildSpendLeaf({ id: 'timeout', keys: [sender], threshold: 1, after: expireAfter }).script;
      leaves.push(buildScriptLeaf({ id: 'timeout', script: inner, after: csv, witnessShape: 'sigs' }));
    }
    leaves.push(buildSpendLeaf({ id: 'revocation', keys: [revocation], threshold: 1 }));
  } else {
    leaves.push(buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHashHex, pubkeyHex: receiver }));
    leaves.push(buildSpendLeaf({ id: 'timeout', keys: [sender], threshold: 1, after: expireAfter }));
  }
  const tree = composeTaprootTree({ network, leaves });
  return {
    paymentHashHex,
    receiverPubkey: receiver,
    senderPubkey: sender,
    expireAfter,
    holder: opts.revocationPubkey ? (opts.holder === 'sender' ? 'sender' : 'receiver') : null,
    toSelfDelay: opts.revocationPubkey ? Math.floor(Number(opts.toSelfDelay) || CHANNEL_DEFAULTS.toSelfDelay) : null,
    address: tree.address,
    internalPubkeyHex: tree.internalPubkeyHex,
    _leaves: tree.leafScripts
  };
};

/**
 * Build the (unsigned) commitment transaction **held by one party** for a
 * channel state (asymmetric, BOLT 3 shape): spends the funding output through
 * the `cooperative` leaf into the holder's delayed/revocable `toLocal`, the
 * counterparty's plain `toRemote`, one output per pending HTLC (holder leaves
 * CSV-delayed and revocable), and two anchor outputs. Deterministic for
 * identical inputs, so both peers derive the same `txid` and only exchange
 * tapscript signatures on *each other's* commitment.
 * @param {object} funding from {@link Channel.buildFunding}
 * @param {object} state `{ number, fundedTxHex, localSats, remoteSats, localAddress, remoteAddress, htlcs:[{ id, amountSats, paymentHashHex, direction:'offered'|'received', expireAfter }], feeSats }` (all from the *local* party's view)
 * @param {object} opts `{ holder: 'local'|'remote', holderPoint }` whose commitment, and that party's per-commitment point
 * @returns {object} `{ psbtBase64, txid, outputs, feeSats, number, holder, revocationPubkey }`
 */
Channel.buildCommitment = function buildCommitment (funding, state = {}, opts = {}) {
  if (!funding || !Array.isArray(funding._leaves)) throw new Error('buildCommitment: funding with leaf scripts required');
  const holder = opts.holder === 'remote' ? 'remote' : 'local';
  const holderPoint = compressedOrThrow('holderPoint', opts.holderPoint);
  const network = networkForFabricName(funding.network);
  const tx = bitcoin.Transaction.fromHex(String(state.fundedTxHex || '').trim());
  const script = bitcoin.address.toOutputScript(funding.address, network);
  const vout = tx.outs.findIndex((o) => Buffer.from(o.script).equals(script));
  if (vout < 0) throw new Error('buildCommitment: funding tx has no output for the channel address');
  const inputSats = Number(tx.outs[vout].value);
  const fee = Math.max(1, Math.floor(Number(state.feeSats || 500)));
  const anchorSats = CHANNEL_DEFAULTS.anchorSats;
  const htlcs = Array.isArray(state.htlcs) ? state.htlcs : [];
  const localSats = Math.floor(Number(state.localSats) || 0);
  const remoteSats = Math.floor(Number(state.remoteSats) || 0);
  if (localSats < 0 || remoteSats < 0) throw new Error('buildCommitment: negative balance');
  const htlcSats = htlcs.reduce((n, h) => n + Math.floor(Number(h.amountSats) || 0), 0);
  if (localSats + remoteSats + htlcSats + fee + 2 * anchorSats !== inputSats) {
    throw new Error(`buildCommitment: balances (${localSats}+${remoteSats}+${htlcSats}) + fee ${fee} + anchors ${2 * anchorSats} must equal funding ${inputSats}`);
  }
  const holderPubkey = holder === 'local' ? funding.localPubkey : funding.remotePubkey;
  const otherPubkey = holder === 'local' ? funding.remotePubkey : funding.localPubkey;
  const holderSats = holder === 'local' ? localSats : remoteSats;
  const otherSats = holder === 'local' ? remoteSats : localSats;
  const otherAddress = String(holder === 'local' ? state.remoteAddress : state.localAddress);
  const revocationPubkey = Channel.revocationPubkey(otherPubkey, holderPoint);
  const toSelfDelay = Number(funding.toSelfDelay) || CHANNEL_DEFAULTS.toSelfDelay;

  const leaf = funding._leaves.find((l) => l.id === 'cooperative');
  const internal = Buffer.from(funding.internalPubkeyHex, 'hex');
  const control = buildControlBlockForLeaf(funding._leaves, leaf.script, internal);
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput(Object.assign({
    hash: tx.getId(),
    index: vout,
    sequence: SEQUENCE_NONFINAL,
    witnessUtxo: { script: Uint8Array.from(script), value: BigInt(inputSats) }
  }, taprootPsbtInputFields({
    tapInternalKey: internal,
    script: leaf.script,
    controlBlock: control,
    leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
  })));
  const outputs = [];
  const toLocal = Channel.buildToLocalOutput({ network: funding.network, holderPubkey, revocationPubkey, toSelfDelay });
  if (holderSats >= DUST) {
    psbt.addOutput({ address: toLocal.address, value: BigInt(holderSats) });
    outputs.push({ kind: 'toLocal', owner: holderPubkey, amountSats: holderSats, address: toLocal.address, vout: psbt.txOutputs.length - 1, _toLocal: toLocal });
  }
  if (otherSats >= DUST) {
    psbt.addOutput({ address: otherAddress, value: BigInt(otherSats) });
    outputs.push({ kind: 'toRemote', owner: otherPubkey, amountSats: otherSats, address: otherAddress, vout: psbt.txOutputs.length - 1 });
  }
  const sorted = htlcs.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let trimmedSats = 0;
  for (const h of sorted) {
    const amount = Math.floor(Number(h.amountSats) || 0);
    if (amount < 1) throw new Error(`buildCommitment: HTLC ${h.id} amount required`);
    const offered = h.direction !== 'received'; // offered by the local party
    if (amount < DUST) {
      // Trimmed HTLC (Lightning convention): per-chunk micro-payments below
      // dust get no output — their value rides in the fee until settled and
      // is enforced only by the off-chain state both parties sign.
      trimmedSats += amount;
      outputs.push({ kind: 'htlc', id: String(h.id), amountSats: amount, direction: offered ? 'offered' : 'received', paymentHashHex: String(h.paymentHashHex).toLowerCase(), blobHashHex: h.blobHashHex || null, expireAfter: heightLock(h.expireAfter), vout: null, trimmed: true });
      continue;
    }
    const receiverPubkey = offered ? funding.remotePubkey : funding.localPubkey;
    const holderIsReceiver = receiverPubkey === holderPubkey;
    const out = Channel.buildHtlcOutput({
      network: funding.network,
      paymentHashHex: h.paymentHashHex,
      receiverPubkey,
      senderPubkey: offered ? funding.localPubkey : funding.remotePubkey,
      expireAfter: h.expireAfter,
      holder: holderIsReceiver ? 'receiver' : 'sender',
      toSelfDelay,
      revocationPubkey
    });
    psbt.addOutput({ address: out.address, value: BigInt(amount) });
    outputs.push({
      kind: 'htlc',
      id: String(h.id),
      amountSats: amount,
      direction: offered ? 'offered' : 'received',
      paymentHashHex: out.paymentHashHex,
      blobHashHex: h.blobHashHex || null,
      expireAfter: out.expireAfter,
      address: out.address,
      vout: psbt.txOutputs.length - 1,
      _htlc: out
    });
  }
  for (const pubkey of [holderPubkey, otherPubkey]) {
    const anchor = Channel.buildAnchorOutput({ network: funding.network, pubkey });
    psbt.addOutput({ address: anchor.address, value: BigInt(anchorSats) });
    outputs.push({ kind: 'anchor', owner: pubkey, amountSats: anchorSats, address: anchor.address, vout: psbt.txOutputs.length - 1, _anchor: anchor });
  }
  const unsigned = psbt.__CACHE.__TX;
  return {
    number: Math.floor(Number(state.number) || 0),
    holder,
    holderPoint,
    revocationPubkey,
    psbtBase64: psbt.toBase64(),
    txid: unsigned.getId(),
    fundingTxid: tx.getId(),
    fundingVout: vout,
    inputSats,
    feeSats: fee + trimmedSats,
    trimmedSats,
    anchorSats: 2 * anchorSats,
    localSats,
    remoteSats,
    outputs
  };
};

/**
 * Sign the cooperative input of a commitment / close PSBT.
 * @param {string} psbtBase64
 * @param {Buffer|string} priv32
 * @param {string} network
 * @returns {string} psbt base64 carrying this party's tapscript signature
 */
Channel.signCommitment = function signCommitment (psbtBase64, priv32, network = 'regtest') {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64), { network: networkForFabricName(network) });
  psbt.signInput(0, signerFromPriv32(Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex')));
  return psbt.toBase64();
};

/**
 * Verify a counterparty's tapscript signature on *our* commitment.
 * @param {string} commitmentPsbtBase64 unsigned (ours)
 * @param {string} signedPsbtBase64 counterparty partial
 * @param {string} signerPubkeyHex compressed
 * @param {string} network
 * @returns {{ ok: boolean, reason: (string|undefined) }}
 */
Channel.verifyCommitmentSignature = function verifyCommitmentSignature (commitmentPsbtBase64, signedPsbtBase64, signerPubkeyHex, network = 'regtest') {
  const net = networkForFabricName(network);
  let mine; let theirs;
  try {
    mine = bitcoin.Psbt.fromBase64(String(commitmentPsbtBase64), { network: net });
    theirs = bitcoin.Psbt.fromBase64(String(signedPsbtBase64), { network: net });
  } catch (e) {
    return { ok: false, reason: `psbt: ${e.message}` };
  }
  if (mine.__CACHE.__TX.getId() !== theirs.__CACHE.__TX.getId()) return { ok: false, reason: 'signature is on a different transaction' };
  const xOnly = xOnlyOf(compressedOrThrow('signerPubkey', signerPubkeyHex));
  const sigs = (theirs.data.inputs[0].tapScriptSig || []).filter((s) => Buffer.from(s.pubkey).toString('hex') === xOnly);
  if (!sigs.length) return { ok: false, reason: 'no signature from the counterparty key' };
  try {
    mine.combine(theirs);
    const ok = mine.validateSignaturesOfInput(0, (pubkey, msghash, sig) => ecc.verifySchnorr(msghash, pubkey, sig), Buffer.from(xOnly, 'hex'));
    return ok ? { ok: true } : { ok: false, reason: 'invalid tapscript signature' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
};

/**
 * Merge both parties' partial signatures and extract the broadcastable tx.
 * @param {string} psbtA base64
 * @param {string} psbtB base64
 * @param {string} network
 * @returns {object} `{ txHex, txid }`
 */
Channel.finalizeCommitment = function finalizeCommitment (psbtA, psbtB, network = 'regtest') {
  const net = networkForFabricName(network);
  const a = bitcoin.Psbt.fromBase64(String(psbtA), { network: net });
  if (psbtB) a.combine(bitcoin.Psbt.fromBase64(String(psbtB), { network: net }));
  const sigs = (a.data.inputs[0].tapScriptSig || []).length;
  if (sigs < 2) throw new Error(`finalizeCommitment: need 2 tapscript signatures, have ${sigs}`);
  return finalizeSpendPsbt({ psbt: a });
};

/**
 * Find the on-chain HTLC output row for an id, refusing trimmed (dust) HTLCs.
 * @param {Object} commitment built commitment
 * @param {string} htlcId
 * @param {string} label error prefix
 * @returns {Object} output row
 * @private
 */
function htlcRowOrThrow (commitment, htlcId, label) {
  const row = (commitment.outputs || []).find((o) => o.kind === 'htlc' && o.id === String(htlcId));
  if (row && row.trimmed) throw new Error(`${label}: trimmed HTLC has no on-chain output`);
  if (!row || !row._htlc) throw new Error(`${label}: HTLC not on this commitment (rebuild with buildCommitment)`);
  return row;
}

/**
 * Receiver claims an HTLC output of a broadcast commitment with the preimage.
 * On the receiver's own commitment the claim leaf is CSV-delayed (`sequence`
 * is set accordingly).
 * @param {object} commitment from {@link Channel.buildCommitment}
 * @param {object} opts `{ htlcId, commitmentTxHex, preimageHex, destinationAddress, feeSats, network }`
 * @returns {object} `{ psbtBase64, … }` — sign with receiver key, then {@link Channel.finalizeHtlcClaim}
 */
Channel.prepareHtlcClaim = function prepareHtlcClaim (commitment, opts = {}) {
  const row = htlcRowOrThrow(commitment, opts.htlcId, 'prepareHtlcClaim');
  const preimageHex = String(opts.preimageHex || '').toLowerCase();
  if (sha256Hex(Buffer.from(preimageHex, 'hex')) !== row.paymentHashHex) throw new Error('prepareHtlcClaim: preimage does not match paymentHash');
  const leaf = row._htlc._leaves.find((l) => l.id === 'claim');
  const delayed = row._htlc.holder === 'receiver';
  return Object.assign(prepareLeafPsbt({
    networkName: opts.network || 'regtest',
    fundedTxHex: opts.commitmentTxHex,
    vaultAddress: row.address,
    leafScript: leaf.script,
    leaves: row._htlc._leaves,
    internalPubkeyHex: row._htlc.internalPubkeyHex,
    destinationAddress: opts.destinationAddress,
    feeSats: opts.feeSats,
    after: delayed ? { type: 'csv', blocks: row._htlc.toSelfDelay } : undefined,
    preimage32: Buffer.from(preimageHex, 'hex')
  }), { leafId: 'claim', witnessShape: 'preimage+sig', htlcId: row.id, delayed });
};

/**
 * Sender reclaims an expired HTLC output of a broadcast commitment. On the
 * sender's own commitment the timeout leaf is additionally CSV-delayed.
 * @param {object} commitment
 * @param {object} opts `{ htlcId, commitmentTxHex, destinationAddress, feeSats, network }`
 * @returns {object}
 */
Channel.prepareHtlcTimeout = function prepareHtlcTimeout (commitment, opts = {}) {
  const row = htlcRowOrThrow(commitment, opts.htlcId, 'prepareHtlcTimeout');
  const leaf = row._htlc._leaves.find((l) => l.id === 'timeout');
  const delayed = row._htlc.holder === 'sender';
  return Object.assign(prepareLeafPsbt({
    networkName: opts.network || 'regtest',
    fundedTxHex: opts.commitmentTxHex,
    vaultAddress: row.address,
    leafScript: leaf.script,
    leaves: row._htlc._leaves,
    internalPubkeyHex: row._htlc.internalPubkeyHex,
    destinationAddress: opts.destinationAddress,
    feeSats: opts.feeSats,
    after: row.expireAfter,
    sequence: delayed ? row._htlc.toSelfDelay : undefined
  }), { leafId: 'timeout', witnessShape: 'sigs', htlcId: row.id, delayed });
};

/** @param {string} psbtBase64 signed @param {string} preimageHex @returns {object} */
Channel.finalizeHtlcClaim = function finalizeHtlcClaim (psbtBase64, preimageHex) {
  return finalizeHashlockPsbt({ psbtBase64, preimage32: Buffer.from(String(preimageHex), 'hex'), witnessShape: 'preimage+sig' });
};

/**
 * Justice transaction: sweep every revocable output of a counterparty's
 * **stale** commitment (their `toLocal` plus every HTLC output) through the
 * `revocation` leaves, signed with the revocation key derived from the
 * secret they revealed when revoking that state.
 * @param {object} opts `{ funding, state, holderPoint, perCommitmentSecretHex, staleTxHex, localPrivateKey, destinationAddress, feeSats, network? }` — `state` is the revoked state (local view)
 * @returns {object} `{ txHex, txid, sweptSats, inputs:[{ vout, kind, amountSats }] }`
 */
Channel.prepareJusticeSpend = function prepareJusticeSpend (opts = {}) {
  const funding = Array.isArray(opts.funding && opts.funding._leaves) ? opts.funding : Channel.fundingFromRecord(opts.funding);
  const network = networkForFabricName(funding.network);
  const stale = bitcoin.Transaction.fromHex(String(opts.staleTxHex || '').trim());
  const commitment = Channel.buildCommitment(funding, opts.state, { holder: 'remote', holderPoint: opts.holderPoint });
  if (commitment.txid !== stale.getId()) throw new Error('prepareJusticeSpend: tx is not the revoked commitment');
  const priv = Buffer.isBuffer(opts.localPrivateKey) ? opts.localPrivateKey : Buffer.from(String(opts.localPrivateKey), 'hex');
  const revPriv = Channel.revocationPrivkey(priv, opts.perCommitmentSecretHex);
  const revPub = pointToHex(ECPoint.BASE.multiply(scalarOf(revPriv)));
  if (revPub !== commitment.revocationPubkey) throw new Error('prepareJusticeSpend: secret does not derive the commitment revocation key');
  const signer = signerFromPriv32(revPriv);
  const psbt = new bitcoin.Psbt({ network });
  const inputs = [];
  let swept = 0;
  const add = (row, tree) => {
    const leaf = tree._leaves.find((l) => l.id === 'revocation');
    const internal = Buffer.from(tree.internalPubkeyHex, 'hex');
    const control = buildControlBlockForLeaf(tree._leaves, leaf.script, internal);
    const out = stale.outs[row.vout];
    const expected = bitcoin.address.toOutputScript(row.address, network);
    if (!out || !Buffer.from(out.script).equals(expected)) {
      throw new Error(`prepareJusticeSpend: output ${row.vout} of the stale tx is not the ${row.kind} output`);
    }
    psbt.addInput(Object.assign({
      hash: stale.getId(),
      index: row.vout,
      sequence: SEQUENCE_NONFINAL,
      witnessUtxo: { script: Uint8Array.from(out.script), value: BigInt(out.value) }
    }, taprootPsbtInputFields({ tapInternalKey: internal, script: leaf.script, controlBlock: control, leafVersion: bip341.LEAF_VERSION_TAPSCRIPT })));
    inputs.push({ vout: row.vout, kind: row.kind, id: row.id || null, amountSats: Number(out.value) });
    swept += Number(out.value);
  };
  for (const row of commitment.outputs) {
    if (row.kind === 'toLocal' && row._toLocal) add(row, row._toLocal);
    else if (row.kind === 'htlc' && row._htlc) add(row, row._htlc);
  }
  if (!inputs.length) throw new Error('prepareJusticeSpend: nothing revocable on this commitment');
  const fee = Math.max(1, Math.floor(Number(opts.feeSats) || 500));
  if (swept - fee < DUST) throw new Error('prepareJusticeSpend: swept value below dust after fee');
  psbt.addOutput({ address: String(opts.destinationAddress), value: BigInt(swept - fee) });
  for (let i = 0; i < inputs.length; i++) {
    psbt.signInput(i, signer);
    psbt.finalizeInput(i, (_idx, input) => {
      const leaf = input.tapLeafScript[0];
      const sig = Buffer.from(input.tapScriptSig[0].signature);
      return { finalScriptWitness: witnessStackToScriptWitness([sig, Buffer.from(leaf.script), Buffer.from(leaf.controlBlock)]) };
    });
  }
  const tx = psbt.extractTransaction();
  return { txHex: tx.toHex(), txid: tx.getId(), sweptSats: swept, feeSats: fee, inputs, revocationPubkey: revPub };
};

/**
 * Multi-hop atomic HTLC plan: same payment hash on every hop, amounts grow by
 * each hop's fee toward the source, expiries shrink toward the destination so
 * every intermediary can claim upstream after it is paid downstream.
 * @param {object} opts `{ paymentHashHex, amountSats, finalExpireHeight, hops:[{ feeSats, cltvDelta }] }` hops listed source → destination
 * @returns {object} `{ paymentHashHex, hops:[{ amountSats, expireAfter }] , totalFeeSats }`
 */
Channel.planRoute = function planRoute (opts = {}) {
  const paymentHashHex = String(opts.paymentHashHex || '').toLowerCase();
  if (!HEX64.test(paymentHashHex)) throw new Error('planRoute: paymentHashHex must be 32-byte hex');
  const hops = Array.isArray(opts.hops) ? opts.hops : [];
  if (!hops.length) throw new Error('planRoute: at least one hop');
  const finalAmount = Math.floor(Number(opts.amountSats) || 0);
  if (finalAmount < DUST) throw new Error('planRoute: amountSats below dust');
  const finalHeight = Math.floor(Number(opts.finalExpireHeight) || 0);
  if (finalHeight <= 0) throw new Error('planRoute: finalExpireHeight required');
  // Walk destination → source.
  // `hops[i].feeSats` / `cltvDelta` are what the node at the end of hop i
  // charges to forward onto hop i+1; the last hop pays the final amount.
  const out = new Array(hops.length);
  let amount = finalAmount;
  let height = finalHeight;
  for (let i = hops.length - 1; i >= 0; i--) {
    if (i < hops.length - 1) {
      amount += Math.floor(Number(hops[i].feeSats) || 0);
      height += Math.max(1, Math.floor(Number(hops[i].cltvDelta) || 1));
    }
    out[i] = { amountSats: amount, expireAfter: { type: 'cltv', height } };
  }
  return { paymentHashHex, hops: out, totalFeeSats: amount - finalAmount, sourceAmountSats: out[0].amountSats };
};

/**
 * Check a received multi-hop offer is consistent with the plan the forwarder
 * holds on the downstream hop (atomicity preconditions).
 * @param {object} upstream `{ amountSats, expireAfter }` HTLC received
 * @param {object} downstream `{ amountSats, expireAfter }` HTLC to offer
 * @param {object} policy `{ feeSats, cltvDelta }`
 * @returns {{ ok: boolean, reason: (string|undefined) }}
 */
Channel.checkForward = function checkForward (upstream, downstream, policy = {}) {
  const fee = Math.floor(Number(policy.feeSats) || 0);
  const delta = Math.max(1, Math.floor(Number(policy.cltvDelta) || 1));
  if (upstream.amountSats - downstream.amountSats < fee) return { ok: false, reason: 'fee-short' };
  const up = heightLock(upstream.expireAfter).height;
  const down = heightLock(downstream.expireAfter).height;
  if (up - down < delta) return { ok: false, reason: 'cltv-delta-short' };
  if (upstream.paymentHashHex && downstream.paymentHashHex && String(upstream.paymentHashHex).toLowerCase() !== String(downstream.paymentHashHex).toLowerCase()) {
    return { ok: false, reason: 'payment-hash-mismatch' };
  }
  return { ok: true };
};

Channel.BODY_TYPES = CHANNEL_BODY_TYPES;

/**
 * Harvest HTLC preimages from any transaction spending known HTLC outputs
 * (claim witnesses carry the 32-byte preimage).
 * @param {string|object} txHexOrTx
 * @param {string[]} paymentHashes hex
 * @returns {Array<{ paymentHashHex: string, preimageHex: string, vin: number }>}
 */
Channel.harvestPreimages = function harvestPreimages (txHexOrTx, paymentHashes = []) {
  const tx = typeof txHexOrTx === 'string' ? bitcoin.Transaction.fromHex(String(txHexOrTx).trim()) : txHexOrTx;
  const want = new Set(paymentHashes.map((h) => String(h).toLowerCase()));
  const found = [];
  if (!want.size) return found;
  tx.ins.forEach((input, vin) => {
    for (const item of input.witness || []) {
      const buf = Buffer.from(item);
      if (buf.length !== 32) continue;
      const hash = sha256Hex(buf);
      if (want.has(hash)) found.push({ paymentHashHex: hash, preimageHex: buf.toString('hex'), vin });
    }
  });
  return found;
};

/**
 * Deep-ish copy of an HTLC list with normalised expiries.
 * @param {Object[]} list
 * @returns {Object[]}
 * @private
 */
function cloneHtlcs (list) {
  return (list || []).map((h) => Object.assign({}, h, { expireAfter: heightLock(h.expireAfter) }));
}

/**
 * @param {Object} h HTLC row
 * @returns {number} CLTV expiry height (0 when none)
 * @private
 */
function expireHeight (h) {
  const lock = heightLock(h && h.expireAfter);
  return lock ? Number(lock.height) : 0;
}

/**
 * @classdesc Off-chain state of one Fabric payment channel from the local
 * party's perspective: balances, pending HTLCs (one per chunk), each party's
 * current commitment and the counterparty's signature on **ours**. Updates are
 * exchanged as signed `CONTRACT_MESSAGE` bodies ({@link Channel.BODY_TYPES}):
 *
 * 1. proposer → `ChannelCommitment n` (signature on the *counterparty's*
 *    commitment `n`, next per-commitment point);
 * 2. counterparty → `ChannelCommitment n` reply (signature on the proposer's
 *    commitment `n`, inline `revoke` of its own state `n-1`, next point);
 * 3. proposer → `ChannelRevoke n-1`.
 *
 * A party that broadcasts a revoked commitment loses everything on it
 * ({@link Channel.prepareJusticeSpend}); the latest commitment pays the
 * holder only after `toSelfDelay`. Open is three messages (`ChannelOpen`,
 * reply, ack) because the funder cannot sign the counterparty's commitment
 * before learning its first per-commitment point.
 * @class ChannelSession
 */
class ChannelSession {
  /**
   * @param {object} opts `{ funding, fundedTxHex, localPrivateKey, localSats, remoteSats, localAddress, remoteAddress, feeSats, policy?, tipHeight?, confirmations?, minFundingConfirmations? }`
   */
  constructor (opts = {}) {
    this.funding = Array.isArray(opts.funding && opts.funding._leaves) ? opts.funding : Channel.fundingFromRecord(opts.funding);
    this.channelId = this.funding.channelId;
    this.network = this.funding.network;
    this.fundedTxHex = String(opts.fundedTxHex || '');
    const priv = opts.localPrivateKey;
    this.localPrivateKey = Buffer.isBuffer(priv) ? priv : Buffer.from(String(priv || ''), 'hex');
    if (this.localPrivateKey.length !== 32) throw new Error('ChannelSession: localPrivateKey (32 bytes) required');
    const derived = Buffer.from(signerFromPriv32(this.localPrivateKey).publicKey).toString('hex');
    if (derived !== this.funding.localPubkey) throw new Error('ChannelSession: localPrivateKey does not match funding.localPubkey');
    this.localAddress = String(opts.localAddress || '');
    this.remoteAddress = String(opts.remoteAddress || '');
    this.isFunder = this.funding.funder === this.funding.localPubkey;
    this._seed = crypto.createHash('sha256').update(Buffer.concat([this.localPrivateKey, Buffer.from(this.channelId, 'hex'), Buffer.from('per-commitment-seed')])).digest();
    this._tip = typeof opts.tipHeight === 'function' ? opts.tipHeight : null;
    this._confirmations = typeof opts.confirmations === 'function' ? opts.confirmations : null;
    const netKey = String(this.network).toLowerCase();
    this.minFundingConfirmations = opts.minFundingConfirmations != null
      ? Math.floor(Number(opts.minFundingConfirmations))
      : (CHANNEL_DEFAULTS.minFundingConfirmations[netKey] || CHANNEL_DEFAULTS.minFundingConfirmations.default);
    this.localPolicy = Object.assign({}, opts.policy || {});
    this._state = {
      number: 0,
      localSats: Math.floor(Number(opts.localSats) || 0),
      remoteSats: Math.floor(Number(opts.remoteSats) || 0),
      feeSats: Math.floor(Number(opts.feeSats || 500)),
      policy: Channel.negotiatePolicy(this.localPolicy, {}, this.funding.capacitySats || 0),
      htlcs: [],
      settled: [],
      status: 'opening',
      fundingConfirmed: !this._confirmations,
      remoteSig: null,
      pending: null,
      remotePoints: {},
      remoteCommitments: {},
      revoked: {},
      localRevokedThrough: -1,
      remoteRevokedThrough: -1,
      lastTipHeight: null
    };
    this._localCommitment = null;
    this._preimages = new Map();
    // Pre-signed exits (Contract.Resolutions): every counterparty-signed
    // commitment is a timelocked unilateral exit for that state, so the
    // channel is always resolvable on L1 without further cooperation.
    this.resolutions = new Resolutions({ network: this.network, contractId: this.channelId });
  }

  /**
   * @private record the counterparty-signed commitment for state `n` as that
   * state's unilateral exit in {@link Resolutions}.
   */
  _recordExit (n, signedPsbtBase64) {
    try {
      const id = String(n);
      if (!this.resolutions.stateIds.includes(id)) this.resolutions.declare(id, n > 0 ? String(n - 1) : null);
      this.resolutions.addExit(id, { id: 'commitment', kind: Resolutions.KINDS.COMMITMENT, psbtBase64: signedPsbtBase64, required: [this.funding.remotePubkey], meta: { toSelfDelay: this.funding.toSelfDelay } });
    } catch (_) { /* exits are advisory bookkeeping; the session state stays authoritative */ }
  }

  /** @returns {boolean} the current state has a counterparty-signed unilateral exit */
  get resolvable () {
    return this.resolutions.resolvable(String(this._state.number));
  }

  get state () { return this._state; }
  get number () { return this._state.number; }
  get status () { return this._state.status; }
  get policy () { return this._state.policy; }
  get feeSats () { return this._state.feeSats; }
  get balances () { return { localSats: this._state.localSats, remoteSats: this._state.remoteSats }; }
  /** @returns {object|null} our latest commitment (holder = local) */
  get commitment () { return this._localCommitment; }
  /** @returns {boolean} both signatures held on the current state */
  get fullySigned () { return !!(this._localCommitment && this._state.remoteSig); }
  /** @returns {boolean} an update round is mid-flight (proposal unanswered or revocation outstanding) */
  get busy () {
    const s = this._state;
    return !!s.pending || s.remoteRevokedThrough < s.number - 1 || s.localRevokedThrough < s.number - 1;
  }

  /** @private */
  _localSecret (n) { return Channel.commitmentSecret(this._seed, n); }
  /** @private */
  _localPoint (n) { return Channel.commitmentPoint(this._localSecret(n)); }

  /** @private current chain tip or null when unknown / stale */
  _tipHeight () {
    if (!this._tip) return null;
    const h = this._tip();
    if (h == null || !Number.isFinite(Number(h)) || Number(h) <= 0) return null;
    return Math.floor(Number(h));
  }

  /** @private */
  _stateFor (htlcs, number, balances = {}, feeSats = null) {
    return {
      number,
      fundedTxHex: this.fundedTxHex,
      localSats: balances.localSats != null ? balances.localSats : this._state.localSats,
      remoteSats: balances.remoteSats != null ? balances.remoteSats : this._state.remoteSats,
      localAddress: this.localAddress,
      remoteAddress: this.remoteAddress,
      feeSats: feeSats != null ? feeSats : this._state.feeSats,
      htlcs
    };
  }

  /** @private */
  _buildLocal (htlcs, number, balances, feeSats) {
    return Channel.buildCommitment(this.funding, this._stateFor(htlcs, number, balances, feeSats), { holder: 'local', holderPoint: this._localPoint(number) });
  }

  /** @private */
  _buildRemote (htlcs, number, balances, feeSats) {
    const point = this._state.remotePoints[number];
    if (!point) throw new Error(`missing counterparty per-commitment point for state ${number}`);
    return Channel.buildCommitment(this.funding, this._stateFor(htlcs, number, balances, feeSats), { holder: 'remote', holderPoint: point });
  }

  /** @private sign the counterparty's commitment and remember it for justice */
  _signRemote (htlcs, number, balances, feeSats) {
    const c = this._buildRemote(htlcs, number, balances, feeSats);
    const sig = Channel.signCommitment(c.psbtBase64, this.localPrivateKey, this.network);
    const snapshot = this._stateFor(cloneHtlcs(htlcs), number, balances, feeSats);
    delete snapshot.fundedTxHex;
    this._state.remoteCommitments[number] = { txid: c.txid, pointHex: c.holderPoint, state: snapshot };
    return { commitment: c, sig };
  }

  /** @private publish-ready body (signed artifact). */
  _body (type, extra = {}) {
    return Witness.signArtifact(Object.assign({
      type,
      version: 2,
      channelId: this.channelId,
      number: this._state.number
    }, extra), this.localPrivateKey);
  }

  /** @private record a revealed counterparty secret for state `n` */
  _applyRemoteRevoke (n, revoke) {
    const s = this._state;
    if (!revoke || revoke.type !== CHANNEL_BODY_TYPES.Revoke || !Witness.verifyArtifact(revoke, xOnlyOf(this.funding.remotePubkey))) {
      throw new Error('revoke: signed ChannelRevoke artifact required');
    }
    if (Math.floor(Number(revoke.number)) !== n) throw new Error(`revoke: expected state ${n}, got ${revoke.number}`);
    const secret = String(revoke.perCommitmentSecret || '').toLowerCase();
    if (!HEX64.test(secret)) throw new Error('revoke: perCommitmentSecret must be 32-byte hex');
    const expectedPoint = s.remotePoints[n];
    if (!expectedPoint) throw new Error(`revoke: no per-commitment point known for state ${n}`);
    if (Channel.commitmentPoint(secret) !== expectedPoint) throw new Error('revoke: secret does not match the per-commitment point');
    const rc = s.remoteCommitments[n];
    if (rc) {
      if (revoke.commitmentTxid && String(revoke.commitmentTxid) !== rc.txid) throw new Error('revoke: names a commitment txid we did not sign');
      s.revoked[rc.txid] = { number: n, perCommitmentSecretHex: secret, pointHex: rc.pointHex, state: rc.state, revoke };
      delete s.remoteCommitments[n];
    }
    if (n > s.remoteRevokedThrough) s.remoteRevokedThrough = n;
  }

  /** @private our own revoke payload for state `n` */
  _localRevoke (n) {
    const s = this._state;
    if (n < 0) return null;
    s.localRevokedThrough = Math.max(s.localRevokedThrough, n);
    return Witness.signArtifact({
      type: CHANNEL_BODY_TYPES.Revoke,
      version: 2,
      channelId: this.channelId,
      number: n,
      perCommitmentSecret: this._localSecret(n),
      perCommitmentPoint: this._localPoint(n),
      commitmentTxid: s.localTxids && s.localTxids[n] ? s.localTxids[n] : null
    }, this.localPrivateKey);
  }

  /** @private remember our own commitment txid per state (for ChannelRevoke) */
  _rememberLocal (commitment) {
    const s = this._state;
    if (!s.localTxids) s.localTxids = {};
    s.localTxids[commitment.number] = commitment.txid;
    for (const k of Object.keys(s.localTxids)) if (Number(k) < commitment.number - 2) delete s.localTxids[k];
  }

  /**
   * Initial `ChannelOpen` body (funder): the funding record (public fields),
   * balances, our policy proposal and first two per-commitment points. No
   * commitment signature yet — see the class description.
   * @returns {object}
   */
  open () {
    if (!this.isFunder) throw new Error('open: only the funder opens');
    const s = this._state;
    if (s.pending) throw new Error('open: already opening');
    this._localCommitment = this._buildLocal([], 0);
    this._rememberLocal(this._localCommitment);
    s.pending = 'proposed';
    const funding = Object.assign({}, this.funding);
    delete funding._leaves;
    return this._body(CHANNEL_BODY_TYPES.Open, {
      funding,
      fundedTxHex: this.fundedTxHex,
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      localAddress: this.localAddress,
      remoteAddress: this.remoteAddress,
      feeSats: s.feeSats,
      policy: this.localPolicy,
      perCommitmentPoint: this._localPoint(0),
      nextPerCommitmentPoint: this._localPoint(1)
    });
  }

  /** @private checks on a newly offered HTLC (local or remote proposer). */
  _checkHtlcPolicy (row, htlcs, proposerBalanceAfter, proposer) {
    const p = this._state.policy;
    const label = proposer === 'local' ? 'offerHtlc' : 'receive';
    if (row.amountSats < p.htlcMinimumSats) throw new Error(`${label}: HTLC below htlcMinimumSats ${p.htlcMinimumSats}`);
    if (htlcs.length > p.maxAcceptedHtlcs) throw new Error(`${label}: maxAcceptedHtlcs ${p.maxAcceptedHtlcs} exceeded`);
    if (htlcs.some((h) => h.id !== row.id && h.paymentHashHex === row.paymentHashHex)) throw new Error(`${label}: duplicate paymentHash in flight`);
    const inFlight = htlcs.filter((h) => h.direction === row.direction).reduce((n, h) => n + h.amountSats, 0);
    if (inFlight > p.maxHtlcValueInFlightSats) throw new Error(`${label}: maxHtlcValueInFlightSats ${p.maxHtlcValueInFlightSats} exceeded`);
    const dust = htlcs.filter((h) => h.amountSats < DUST).reduce((n, h) => n + h.amountSats, 0);
    if (dust > p.maxDustExposureSats) throw new Error(`${label}: maxDustExposureSats ${p.maxDustExposureSats} exceeded`);
    if (proposerBalanceAfter < p.channelReserveSats) throw new Error(`${label}: balance would drop below channelReserveSats ${p.channelReserveSats}`);
    const tip = this._tipHeight();
    if (this._tip && tip == null) throw new Error(`${label}: chain tip unknown or stale — refusing new HTLC`);
    const expire = expireHeight(row);
    if (!(expire > 0)) throw new Error(`${label}: HTLC expireAfter height required`);
    if (tip != null && expire < tip + p.minCltvDelta) throw new Error(`${label}: HTLC expires too soon (tip ${tip} + minCltvDelta ${p.minCltvDelta})`);
    const latest = Number(this.funding.expireAfter.height) - Number(this.funding.toSelfDelay) - p.closeMarginBlocks;
    if (expire > latest) throw new Error(`${label}: HTLC expiry ${expire} past channel expiry window (${latest})`);
  }

  /**
   * Offer an HTLC (pay for one chunk): moves `amountSats` from our balance
   * into a pending HTLC and returns the `ChannelCommitment` proposal.
   * @param {object} htlc `{ id?, amountSats, paymentHashHex, blobHashHex?, expireAfter, forwardOf? }`
   * @returns {object}
   */
  offerHtlc (htlc = {}) {
    if (this._state.status !== 'open') throw new Error(`offerHtlc: channel ${this._state.status}`);
    if (this.busy) throw new Error('offerHtlc: channel busy (previous update not yet revoked)');
    const amount = Math.floor(Number(htlc.amountSats) || 0);
    if (amount < 1) throw new Error('offerHtlc: amountSats required');
    if (amount > this._state.localSats) throw new Error('offerHtlc: insufficient local balance');
    const paymentHashHex = String(htlc.paymentHashHex || '').toLowerCase();
    if (!HEX64.test(paymentHashHex)) throw new Error('offerHtlc: paymentHashHex required');
    const id = htlc.id ? String(htlc.id) : sha256Hex(Buffer.from(`${this.channelId}:${this._state.number + 1}:${paymentHashHex}`)).slice(0, 16);
    if (this._state.htlcs.some((h) => h.id === id)) throw new Error('offerHtlc: duplicate HTLC id');
    const row = { id, amountSats: amount, paymentHashHex, blobHashHex: htlc.blobHashHex || null, direction: 'offered', expireAfter: heightLock(htlc.expireAfter), forwardOf: htlc.forwardOf || null };
    const htlcs = this._state.htlcs.concat([row]);
    this._checkHtlcPolicy(row, htlcs, this._state.localSats - amount, 'local');
    return this._propose(htlcs, { localSats: this._state.localSats - amount, remoteSats: this._state.remoteSats }, null, { htlc: Object.assign({}, row) });
  }

  /**
   * Propose a new commitment fee (bounded by the negotiated policy; the
   * funder's balance absorbs the difference).
   * @param {number} feeSats
   * @returns {object} `ChannelCommitment` proposal
   */
  updateFee (feeSats) {
    if (this.busy) throw new Error('updateFee: channel busy');
    const fee = Math.floor(Number(feeSats) || 0);
    const p = this._state.policy;
    if (fee < p.minCommitFeeSats || fee > p.maxCommitFeeSats) throw new Error(`updateFee: fee must be within [${p.minCommitFeeSats}, ${p.maxCommitFeeSats}]`);
    const delta = fee - this._state.feeSats;
    const balances = { localSats: this._state.localSats, remoteSats: this._state.remoteSats };
    if (this.isFunder) balances.localSats -= delta; else balances.remoteSats -= delta;
    if (balances.localSats < 0 || balances.remoteSats < 0) throw new Error('updateFee: funder cannot cover the fee');
    return this._propose(this._state.htlcs.slice(), balances, fee);
  }

  /** @private sign the counterparty's next commitment + build ours; emit the proposal. */
  _propose (htlcs, balances, feeSats = null, extra = {}) {
    const s = this._state;
    const number = s.number + 1;
    const fee = feeSats != null ? feeSats : s.feeSats;
    const remote = this._signRemote(htlcs, number, balances, fee);
    const local = this._buildLocal(htlcs, number, balances, fee);
    s.htlcs = htlcs;
    s.localSats = balances.localSats;
    s.remoteSats = balances.remoteSats;
    s.feeSats = fee;
    s.number = number;
    s.remoteSig = null;
    s.pending = 'proposed';
    this._localCommitment = local;
    this._rememberLocal(local);
    return this._body(CHANNEL_BODY_TYPES.Commitment, Object.assign({
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: fee,
      htlcs: htlcs.map((h) => Object.assign({}, h)),
      commitmentTxid: remote.commitment.txid,
      psbtBase64: remote.sig,
      nextPerCommitmentPoint: this._localPoint(number + 1)
    }, extra));
  }

  /**
   * Validate a counterparty proposal against our previous state: only the
   * transitions the protocol allows (they add HTLCs funded from their own
   * balance; HTLCs leave only through a settlement we can check; fee changes
   * are bounded and paid by the funder) and the resulting balances must match
   * exactly.
   * @private
   */
  _validateTransition (prev, next, ctx = {}) {
    const prevById = new Map(prev.htlcs.map((h) => [h.id, h]));
    const nextById = new Map(next.htlcs.map((h) => [h.id, h]));
    let local = prev.localSats;
    let remote = prev.remoteSats;
    for (const h of next.htlcs) {
      const before = prevById.get(h.id);
      if (!before) {
        if (h.direction !== 'received') throw new Error('receive: counterparty added an HTLC on our behalf');
        remote -= h.amountSats;
        this._checkHtlcPolicy(h, next.htlcs, remote, 'remote');
        continue;
      }
      const same = before.amountSats === h.amountSats && before.paymentHashHex === h.paymentHashHex && before.direction === h.direction && expireHeight(before) === expireHeight(h);
      if (!same) throw new Error(`receive: HTLC ${h.id} was altered`);
    }
    for (const h of prev.htlcs) {
      if (nextById.has(h.id)) continue;
      const settlement = ctx.settlement && ctx.settlement.id === h.id ? ctx.settlement : null;
      if (!settlement) throw new Error(`receive: HTLC ${h.id} removed without a settlement`);
      if (settlement.outcome === 'fulfilled') {
        // Preimage already checked by receiveSettlement; value goes to the receiver.
        if (h.direction === 'offered') remote += h.amountSats; else local += h.amountSats;
      } else {
        // Fail: the receiver may always fail; the sender only once expired.
        // An unknown / stale tip is treated as "not expired" — otherwise a
        // sender could claw back in-flight value before CLTV simply because
        // our chain view is down.
        if (h.direction === 'received') {
          const tip = this._tipHeight();
          if (tip == null) throw new Error('receive: counterparty failed its own HTLC but the chain tip is unknown — cannot confirm expiry');
          if (expireHeight(h) > tip) throw new Error('receive: counterparty failed its own unexpired HTLC');
          remote += h.amountSats;
        } else {
          local += h.amountSats;
        }
      }
    }
    const feeDelta = next.feeSats - prev.feeSats;
    if (feeDelta !== 0) {
      const p = this._state.policy;
      if (next.feeSats < p.minCommitFeeSats || next.feeSats > p.maxCommitFeeSats) throw new Error('receive: fee outside negotiated bounds');
      if (this.isFunder) local -= feeDelta; else remote -= feeDelta;
    }
    if (local !== next.localSats || remote !== next.remoteSats) {
      throw new Error(`receive: balances do not follow from the previous state (expected ${local}/${remote}, got ${next.localSats}/${next.remoteSats})`);
    }
  }

  /**
   * Ingest a counterparty `ChannelOpen` / `ChannelCommitment` / `ChannelClose`
   * / `ChannelRevoke`. Returns the body we must send back (countersignature
   * with inline revoke, `ChannelRevoke`, or `null`).
   * @param {object} body signed artifact from the peer
   * @param {object} [ctx] `{ settlement }` from {@link ChannelSession#receiveSettlement}
   * @returns {object|null}
   */
  receive (body = {}, ctx = {}) {
    if (!Witness.verifyArtifact(body, xOnlyOf(this.funding.remotePubkey))) throw new Error('receive: bad counterparty signature');
    if (body.channelId !== this.channelId) throw new Error('receive: channel id mismatch');
    const s = this._state;
    const number = Math.floor(Number(body.number) || 0);
    switch (body.type) {
      case CHANNEL_BODY_TYPES.Revoke:
        this._applyRemoteRevoke(number, body);
        return null;
      case CHANNEL_BODY_TYPES.Open:
        return this._receiveOpen(body);
      case CHANNEL_BODY_TYPES.Commitment:
      case CHANNEL_BODY_TYPES.Close:
        break;
      default:
        throw new Error(`receive: unexpected type ${body.type}`);
    }
    // Reply / ack to a state we proposed.
    if (s.pending === 'proposed' && number === s.number && this._localCommitment && body.commitmentTxid === this._localCommitment.txid) {
      return this._receiveCountersignature(body);
    }
    if (s.pending) throw new Error('receive: channel busy (our proposal is unanswered)');
    if (number !== s.number + 1) throw new Error(`receive: expected state ${s.number + 1}, got ${number}`);
    if (s.remoteRevokedThrough < s.number - 1) throw new Error(`receive: counterparty has not revoked state ${s.number - 1}`);
    if (body.type === CHANNEL_BODY_TYPES.Close && (body.htlcs || []).length) throw new Error('receive: close with pending HTLCs');
    if (s.status !== 'open' && !(s.status === 'pending' && body.type === CHANNEL_BODY_TYPES.Close)) {
      throw new Error(`receive: channel ${s.status}`);
    }
    const htlcs = cloneHtlcs(body.htlcs).map((h) => Object.assign(h, { direction: h.direction === 'offered' ? 'received' : 'offered' }));
    const next = {
      localSats: Math.floor(Number(body.remoteSats) || 0),
      remoteSats: Math.floor(Number(body.localSats) || 0),
      feeSats: body.feeSats != null ? Math.floor(Number(body.feeSats)) : s.feeSats,
      htlcs
    };
    this._validateTransition({ localSats: s.localSats, remoteSats: s.remoteSats, feeSats: s.feeSats, htlcs: s.htlcs }, next, ctx);
    let local;
    try {
      local = this._buildLocal(htlcs, number, next, next.feeSats);
    } catch (e) {
      throw new Error(`receive: counterparty state invalid (${e.message})`);
    }
    if (body.commitmentTxid !== local.txid) throw new Error('receive: counterparty signed a commitment that does not match the derived state');
    const check = Channel.verifyCommitmentSignature(local.psbtBase64, body.psbtBase64, this.funding.remotePubkey, this.network);
    if (!check.ok) throw new Error(`receive: ${check.reason}`);
    if (!body.nextPerCommitmentPoint) throw new Error('receive: nextPerCommitmentPoint missing');
    const remote = this._signRemote(htlcs, number, next, next.feeSats);
    this._notePoint(number + 1, body.nextPerCommitmentPoint);
    s.htlcs = htlcs;
    s.localSats = next.localSats;
    s.remoteSats = next.remoteSats;
    s.feeSats = next.feeSats;
    s.number = number;
    s.remoteSig = String(body.psbtBase64);
    this._localCommitment = local;
    this._recordExit(number, s.remoteSig);
    this._rememberLocal(local);
    if (body.type === CHANNEL_BODY_TYPES.Close) s.status = 'closing';
    const revoke = this._localRevoke(number - 1);
    return this._body(body.type === CHANNEL_BODY_TYPES.Close ? CHANNEL_BODY_TYPES.Close : CHANNEL_BODY_TYPES.Commitment, {
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: s.feeSats,
      htlcs: htlcs.map((h) => Object.assign({}, h)),
      commitmentTxid: remote.commitment.txid,
      psbtBase64: remote.sig,
      revoke,
      nextPerCommitmentPoint: this._localPoint(number + 1)
    });
  }

  /** @private */
  _notePoint (n, pointHex) {
    const p = compressedOrThrow('perCommitmentPoint', pointHex);
    const s = this._state;
    if (s.remotePoints[n] && s.remotePoints[n] !== p) throw new Error(`receive: counterparty changed its per-commitment point for state ${n}`);
    s.remotePoints[n] = p;
    for (const k of Object.keys(s.remotePoints)) if (Number(k) < s.remoteRevokedThrough) delete s.remotePoints[k];
  }

  /** @private non-funder side of `ChannelOpen` */
  _receiveOpen (body) {
    const s = this._state;
    if (this.isFunder) throw new Error('receive: funder received a ChannelOpen');
    if (s.number !== 0 || s.pending || this._localCommitment) throw new Error('receive: channel already opened');
    if (!body.perCommitmentPoint || !body.nextPerCommitmentPoint) throw new Error('receive: ChannelOpen without per-commitment points');
    this._notePoint(0, body.perCommitmentPoint);
    this._notePoint(1, body.nextPerCommitmentPoint);
    s.policy = Channel.negotiatePolicy(this.localPolicy, body.policy || {}, this.funding.capacitySats || 0);
    s.feeSats = Math.floor(Number(body.feeSats || s.feeSats));
    if (s.feeSats < s.policy.minCommitFeeSats || s.feeSats > s.policy.maxCommitFeeSats) throw new Error('receive: opening fee outside negotiated bounds');
    s.localSats = Math.floor(Number(body.remoteSats) || 0);
    s.remoteSats = Math.floor(Number(body.localSats) || 0);
    if (s.localSats !== 0) throw new Error('receive: non-funder must open with a zero balance');
    const remote = this._signRemote([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
    this._localCommitment = this._buildLocal([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
    this._rememberLocal(this._localCommitment);
    s.pending = 'proposed';
    return this._body(CHANNEL_BODY_TYPES.Commitment, {
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: s.feeSats,
      htlcs: [],
      policy: s.policy,
      commitmentTxid: remote.commitment.txid,
      psbtBase64: remote.sig,
      perCommitmentPoint: this._localPoint(0),
      nextPerCommitmentPoint: this._localPoint(1)
    });
  }

  /** @private the counterparty signed the state we proposed */
  _receiveCountersignature (body) {
    const s = this._state;
    const check = Channel.verifyCommitmentSignature(this._localCommitment.psbtBase64, body.psbtBase64, this.funding.remotePubkey, this.network);
    if (!check.ok) throw new Error(`receive: ${check.reason}`);
    if (s.number === 0 && body.perCommitmentPoint) {
      // Reply to our ChannelOpen: learn their points + negotiated policy, then ack with our signature on their commitment #0.
      const negotiated = Channel.negotiatePolicy(this.localPolicy, body.policy || {}, this.funding.capacitySats || 0);
      const theirs = Channel.negotiatePolicy(body.policy || {}, {}, this.funding.capacitySats || 0);
      for (const k of Object.keys(negotiated)) if (theirs[k] !== negotiated[k]) throw new Error(`receive: counterparty policy ${k} is not the stricter negotiation`);
      s.policy = negotiated;
      this._notePoint(0, body.perCommitmentPoint);
      if (body.nextPerCommitmentPoint) this._notePoint(1, body.nextPerCommitmentPoint);
      s.remoteSig = String(body.psbtBase64);
      this._recordExit(s.number, s.remoteSig);
      const remote = this._signRemote([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
      s.pending = null;
      this._refreshStatus();
      return this._body(CHANNEL_BODY_TYPES.Commitment, { commitmentTxid: remote.commitment.txid, psbtBase64: remote.sig, nextPerCommitmentPoint: this._localPoint(1) });
    }
    s.remoteSig = String(body.psbtBase64);
    this._recordExit(s.number, s.remoteSig);
    if (body.nextPerCommitmentPoint) this._notePoint(s.number + 1, body.nextPerCommitmentPoint);
    s.pending = null;
    if (s.number === 0) {
      // Ack on our reply to ChannelOpen.
      this._refreshStatus();
      return null;
    }
    if (!body.revoke || Number(body.revoke.number) !== s.number - 1) throw new Error(`receive: countersignature must revoke state ${s.number - 1}`);
    this._applyRemoteRevoke(s.number - 1, body.revoke);
    if (body.type === CHANNEL_BODY_TYPES.Close || s.status === 'closing') s.status = 'closing';
    return this._localRevoke(s.number - 1);
  }

  /** @private */
  _refreshStatus () {
    const s = this._state;
    if (s.status === 'closing' || s.status === 'closed') return;
    if (!this.fullySigned) { s.status = 'opening'; return; }
    s.status = s.fundingConfirmed ? 'open' : 'pending';
  }

  /**
   * Settle an HTLC with its preimage: the amount moves to the **receiver's**
   * balance and the proposal carries the preimage. Normally the receiver
   * reveals; the sender may also settle an HTLC it offered once it learned
   * the preimage elsewhere (e.g. the seller's public key reveal) — that only
   * ever pays the counterparty.
   * @param {string} id
   * @param {string} preimageHex
   * @returns {object} `ChannelHtlcFulfill` body (+ the new commitment via `commitment`)
   */
  fulfillHtlc (id, preimageHex) {
    const row = this._state.htlcs.find((h) => h.id === String(id));
    if (!row) throw new Error('fulfillHtlc: unknown HTLC');
    if (this.busy) throw new Error('fulfillHtlc: channel busy');
    const pre = String(preimageHex || '').toLowerCase();
    if (sha256Hex(Buffer.from(pre, 'hex')) !== row.paymentHashHex) throw new Error('fulfillHtlc: preimage does not match');
    this._preimages.set(row.paymentHashHex, pre);
    this._state.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, outcome: 'fulfilled', forwardOf: row.forwardOf || null });
    const rest = this._state.htlcs.filter((h) => h.id !== row.id);
    const balances = { localSats: this._state.localSats, remoteSats: this._state.remoteSats };
    if (row.direction === 'received') balances.localSats += row.amountSats; else balances.remoteSats += row.amountSats;
    const commitment = this._propose(rest, balances);
    return this._body(CHANNEL_BODY_TYPES.HtlcFulfill, { htlcId: row.id, preimageHex: pre, commitment });
  }

  /**
   * Fail an HTLC: the receiver may fail a received HTLC at any time; the
   * sender may fail its own offered HTLC only once expired at the known tip.
   * @param {string} id
   * @param {string} [reason]
   * @returns {object} `ChannelHtlcFail` body
   */
  failHtlc (id, reason = 'failed') {
    const row = this._state.htlcs.find((h) => h.id === String(id));
    if (!row) throw new Error('failHtlc: unknown HTLC');
    if (this.busy) throw new Error('failHtlc: channel busy');
    if (row.direction === 'offered') {
      const tip = this._tipHeight();
      if (tip == null) throw new Error('failHtlc: chain tip unknown — cannot prove the offered HTLC expired');
      if (expireHeight(row) > tip) throw new Error('failHtlc: offered HTLC not yet expired');
    }
    this._state.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, outcome: 'failed', reason, forwardOf: row.forwardOf || null });
    const balances = { localSats: this._state.localSats, remoteSats: this._state.remoteSats };
    if (row.direction === 'offered') balances.localSats += row.amountSats; else balances.remoteSats += row.amountSats;
    const commitment = this._propose(this._state.htlcs.filter((h) => h.id !== row.id), balances);
    return this._body(CHANNEL_BODY_TYPES.HtlcFail, { htlcId: row.id, reason, commitment });
  }

  /**
   * Apply a counterparty `ChannelHtlcFulfill` / `ChannelHtlcFail` body.
   * @param {object} body
   * @returns {object|null} our countersignature body
   */
  receiveSettlement (body = {}) {
    if (!Witness.verifyArtifact(body, xOnlyOf(this.funding.remotePubkey))) throw new Error('receiveSettlement: bad signature');
    const row = this._state.htlcs.find((h) => h.id === String(body.htlcId));
    if (!row) throw new Error('receiveSettlement: unknown HTLC');
    let outcome;
    if (body.type === CHANNEL_BODY_TYPES.HtlcFulfill) {
      const pre = String(body.preimageHex || '').toLowerCase();
      if (sha256Hex(Buffer.from(pre, 'hex')) !== row.paymentHashHex) throw new Error('receiveSettlement: preimage mismatch');
      outcome = 'fulfilled';
      const reply = this.receive(body.commitment, { settlement: { id: row.id, outcome } });
      this._preimages.set(row.paymentHashHex, pre);
      this._state.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, outcome, forwardOf: row.forwardOf || null });
      return reply;
    }
    if (body.type === CHANNEL_BODY_TYPES.HtlcFail) {
      outcome = 'failed';
      const reply = this.receive(body.commitment, { settlement: { id: row.id, outcome } });
      this._state.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, outcome, reason: body.reason || null, forwardOf: row.forwardOf || null });
      return reply;
    }
    throw new Error(`receiveSettlement: unexpected type ${body.type}`);
  }

  /**
   * Dispatch any inbound `Channel*` body to the right handler.
   * @param {object} body
   * @param {object} [ctx]
   * @returns {object|null} reply body
   */
  ingest (body = {}, ctx = {}) {
    if (body.type === CHANNEL_BODY_TYPES.HtlcFulfill || body.type === CHANNEL_BODY_TYPES.HtlcFail) return this.receiveSettlement(body);
    return this.receive(body, ctx);
  }

  /**
   * Chain-time housekeeping: funding confirmation gating, auto-fail of expired
   * received HTLCs, and timeout flags on expired offered HTLCs.
   * @param {number} tipHeight
   * @returns {{ bodies: object[], timeouts: object[], status: string }}
   */
  tick (tipHeight) {
    const s = this._state;
    const tip = Math.floor(Number(tipHeight) || 0);
    if (tip > 0) s.lastTipHeight = tip;
    if (!s.fundingConfirmed && this._confirmations) {
      const n = Number(this._confirmations(this._localCommitment ? this._localCommitment.fundingTxid : bitcoin.Transaction.fromHex(this.fundedTxHex).getId()));
      if (Number.isFinite(n) && n >= this.minFundingConfirmations) s.fundingConfirmed = true;
    }
    this._refreshStatus();
    const bodies = [];
    const timeouts = [];
    if (tip > 0) {
      for (const h of s.htlcs.slice()) {
        if (expireHeight(h) > tip) continue;
        if (h.direction === 'received' && !this.busy && s.status === 'open') {
          try { bodies.push(this.failHtlc(h.id, 'expired')); } catch (_) { /* busy */ }
        } else if (h.direction === 'offered') {
          h.expired = true;
          timeouts.push(Object.assign({}, h));
        }
      }
    }
    return { bodies, timeouts, status: s.status };
  }

  /**
   * Classify an observed on-chain transaction: our/their latest commitment,
   * a **stale** (revoked) counterparty commitment — returning a signed
   * justice transaction and a `FraudProof` — or an HTLC spend whose witness
   * reveals preimages we are owed.
   * @param {string} txHex
   * @param {object} [opts] `{ destinationAddress?, feeSats?, inclusion?: { blockHeaderHex, txids } }` — `inclusion` lets a stale-commitment proof carry an SPV branch binding the broadcast to a block header
   * @returns {object} `{ kind, txid, justice?, fraudProof?, preimages? }`
   */
  observe (txHex, opts = {}) {
    const tx = bitcoin.Transaction.fromHex(String(txHex).trim());
    const txid = tx.getId();
    const s = this._state;
    const fundingTxid = this._localCommitment ? this._localCommitment.fundingTxid : bitcoin.Transaction.fromHex(this.fundedTxHex).getId();
    const spendsFunding = tx.ins.some((i) => Buffer.from(i.hash).reverse().toString('hex') === fundingTxid);
    if (spendsFunding) {
      if (this._localCommitment && txid === this._localCommitment.txid) { s.status = 'closing'; return { kind: 'local-latest', txid }; }
      const current = Object.values(s.remoteCommitments).find((c) => c.txid === txid);
      if (current) { s.status = 'closing'; return { kind: 'remote-latest', txid }; }
      const stale = s.revoked[txid];
      if (stale) {
        s.status = 'closing';
        const justice = opts.destinationAddress
          ? Channel.prepareJusticeSpend({ funding: this.funding, state: Object.assign({ fundedTxHex: this.fundedTxHex }, stale.state), holderPoint: stale.pointHex, perCommitmentSecretHex: stale.perCommitmentSecretHex, staleTxHex: txHex, localPrivateKey: this.localPrivateKey, destinationAddress: opts.destinationAddress, feeSats: opts.feeSats, network: this.network })
          : null;
        let inclusion = null;
        if (opts.inclusion && opts.inclusion.blockHeaderHex && Array.isArray(opts.inclusion.txids)) {
          try { inclusion = buildInclusion({ blockHeaderHex: opts.inclusion.blockHeaderHex, txids: opts.inclusion.txids, txid }); } catch (_) { inclusion = null; }
        }
        const fraudProof = new Witness.FraudProof({
          kind: Witness.FraudProof.KINDS.STALE_COMMITMENT,
          artifacts: Object.assign({ staleTxHex: txHex, revoke: stale.revoke }, inclusion ? { inclusion } : {}),
          claim: { channelId: this.channelId, offenderPubkey: this.funding.remotePubkey, staleNumber: stale.number, latestNumber: s.number, staleTxid: txid }
        }).toBody();
        return { kind: 'stale', txid, number: stale.number, justice, fraudProof, inclusion };
      }
      return { kind: 'unknown-funding-spend', txid };
    }
    const hashes = s.htlcs.map((h) => h.paymentHashHex).concat(s.settled.map((x) => x.paymentHashHex));
    const preimages = Channel.harvestPreimages(tx, hashes);
    for (const p of preimages) this._preimages.set(p.paymentHashHex, p.preimageHex);
    return { kind: preimages.length ? 'htlc-spend' : 'unknown', txid, preimages };
  }

  /** @param {string} paymentHashHex @returns {string|null} preimage learned on this channel */
  preimageFor (paymentHashHex) {
    return this._preimages.get(String(paymentHashHex).toLowerCase()) || null;
  }

  /**
   * Broadcastable latest commitment (ours; requires the counterparty's signature).
   * @returns {object} `{ txHex, txid }`
   */
  finalize () {
    if (!this.fullySigned) throw new Error('finalize: counterparty signature missing on current state');
    const mine = Channel.signCommitment(this._localCommitment.psbtBase64, this.localPrivateKey, this.network);
    return Channel.finalizeCommitment(mine, this._state.remoteSig, this.network);
  }

  /**
   * Cooperative close: no HTLCs pending, latest balances. Returns a
   * `ChannelClose` proposal; the reply countersigns and both finalize.
   * @returns {object}
   */
  close () {
    if (this._state.htlcs.length) throw new Error('close: settle pending HTLCs first');
    if (this.busy) throw new Error('close: channel busy');
    const body = this._propose([], { localSats: this._state.localSats, remoteSats: this._state.remoteSats });
    this._state.status = 'closing';
    const clean = Object.assign({}, body);
    delete clean.pubkey; delete clean.signature; delete clean.type;
    return this._body(CHANNEL_BODY_TYPES.Close, clean);
  }

  /** @returns {object} persistence snapshot (no private key) */
  export () {
    const funding = Object.assign({}, this.funding);
    delete funding._leaves;
    return {
      type: 'ChannelSessionState',
      version: 2,
      channelId: this.channelId,
      funding,
      fundedTxHex: this.fundedTxHex,
      localAddress: this.localAddress,
      remoteAddress: this.remoteAddress,
      localPolicy: this.localPolicy,
      state: JSON.parse(JSON.stringify(this._state)),
      preimages: Object.fromEntries(this._preimages)
    };
  }

  /**
   * @param {object} snapshot from {@link ChannelSession#export}
   * @param {Buffer|string} localPrivateKey
   * @param {object} [deps] `{ tipHeight?, confirmations? }`
   * @returns {ChannelSession}
   */
  static import (snapshot, localPrivateKey, deps = {}) {
    const s = new ChannelSession({
      funding: snapshot.funding,
      fundedTxHex: snapshot.fundedTxHex,
      localPrivateKey,
      localSats: snapshot.state.localSats,
      remoteSats: snapshot.state.remoteSats,
      localAddress: snapshot.localAddress,
      remoteAddress: snapshot.remoteAddress,
      feeSats: snapshot.state.feeSats,
      policy: snapshot.localPolicy,
      tipHeight: deps.tipHeight,
      confirmations: deps.confirmations
    });
    s._state = Object.assign(s._state, JSON.parse(JSON.stringify(snapshot.state)));
    s._state.htlcs = cloneHtlcs(s._state.htlcs);
    if (s._state.status !== 'opening' || s._state.pending) {
      try { s._localCommitment = s._buildLocal(s._state.htlcs, s._state.number); } catch (_) { s._localCommitment = null; }
    }
    // Exits are not exported: rebuild the current state's from its
    // countersignature, rooted here (every earlier state is revoked).
    if (s._localCommitment && s._state.remoteSig) {
      s.resolutions.declare(String(s._state.number), null);
      s._recordExit(s._state.number, s._state.remoteSig);
    }
    for (const [k, v] of Object.entries(snapshot.preimages || {})) s._preimages.set(k, v);
    return s;
  }
}

Channel.Session = ChannelSession;

/**
 * Drive one update round between two in-process sessions (tests / loopback):
 * proposal → reply → revoke.
 * @param {ChannelSession} from proposer
 * @param {ChannelSession} to counterparty
 * @param {object} body proposal from `from`
 * @returns {object[]} every body exchanged
 */
Channel.exchange = function exchange (from, to, body) {
  const trace = [body];
  let reply = to.ingest(body);
  let turn = from;
  let other = to;
  while (reply) {
    trace.push(reply);
    const next = turn.ingest(reply);
    reply = next;
    const t = turn; turn = other; other = t;
  }
  return trace;
};

/**
 * @classdesc Local registry of {@link ChannelSession}s for a host (Hub,
 * GoonCitizen, Passport): looks a channel up by counterparty, routes inbound
 * `Channel*` `CONTRACT_MESSAGE` bodies to the right session, forwards
 * multi-hop HTLCs, ticks sessions on new chain tips, and returns the bodies
 * the host must publish back. Shape expected by the market agent's
 * `attach({ channels })`.
 *
 * **Seller-fulfils (Lightning shape):** when the host supplies
 * `preimageFor(paymentHashHex)` the book fulfils every received HTLC whose
 * preimage the host knows as soon as the round that committed it completes;
 * the payer learns the preimage from the resulting `ChannelHtlcFulfill`.
 *
 * Events: `htlcCommitted` (a received HTLC is irrevocably committed),
 * `htlcFulfilled` (a counterparty revealed a preimage to us), and
 * `htlcSettled` (any HTLC left the channel; `outcome` is `fulfilled` or
 * `failed`). Payloads are `{ channelId, session, htlcId, paymentHashHex,
 * blobHashHex, amountSats, direction, preimageHex?, outcome?, reason? }`.
 * @class ChannelBook
 */
class ChannelBook extends EventEmitter {
  /**
   * @param {object} opts `{ localPrivateKey, network, tipHeight?: function, confirmations?: function(txid), publish?: function(body), preimageFor?: function(paymentHashHex), policy?, staleTipMs?, forwardPolicy?: { feeSats, cltvDelta } }`
   */
  constructor (opts = {}) {
    super();
    const priv = opts.localPrivateKey;
    this.localPrivateKey = Buffer.isBuffer(priv) ? priv : Buffer.from(String(priv || ''), 'hex');
    if (this.localPrivateKey.length !== 32) throw new Error('ChannelBook: localPrivateKey (32 bytes) required');
    this.localPubkey = Buffer.from(signerFromPriv32(this.localPrivateKey).publicKey).toString('hex');
    this.network = String(opts.network || 'regtest');
    refuseMainnet(this.network);
    this._tipFn = typeof opts.tipHeight === 'function' ? opts.tipHeight : null;
    // `confirmations: fn(txid)` (sync) or `true` to gate funding on the
    // host-fed cache (`setConfirmations`); omitted = no funding gating.
    this._confirmationCache = new Map();
    this._confirmations = typeof opts.confirmations === 'function'
      ? opts.confirmations
      : (opts.confirmations === true ? (txid) => this._confirmationCache.get(String(txid)) || 0 : null);
    this._publish = typeof opts.publish === 'function' ? opts.publish : null;
    this._preimageFor = typeof opts.preimageFor === 'function' ? opts.preimageFor : null;
    this.policy = Object.assign({}, opts.policy || {});
    this.forwardPolicy = Object.assign({ feeSats: 1, cltvDelta: CHANNEL_DEFAULTS.minCltvDelta }, opts.forwardPolicy || {});
    this.staleTipMs = Math.floor(Number(opts.staleTipMs != null ? opts.staleTipMs : CHANNEL_DEFAULTS.staleTipMs));
    this._tip = { height: 0, at: 0 };
    this.sessions = new Map(); // channelId → ChannelSession
    this.peers = new Map(); // sellerId / address alias → channelId
    this.forwards = new Map(); // `${downstreamChannelId}:${htlcId}` → { channelId, htlcId }
    this._announced = new Set(); // `${channelId}:${htlcId}` already emitted as htlcCommitted
  }

  /**
   * Record a fresh chain tip (hosts call on every block) and tick sessions.
   * @param {number} height
   * @returns {object[]} bodies published by the tick
   */
  setTip (height) {
    const h = Math.floor(Number(height) || 0);
    if (h > 0) this._tip = { height: h, at: Date.now() };
    return this.tick();
  }

  /**
   * Host-fed confirmation count for a funding txid (see `confirmations: true`).
   * @param {string} txid
   * @param {number} confirmations
   */
  setConfirmations (txid, confirmations) {
    this._confirmationCache.set(String(txid), Math.floor(Number(confirmations) || 0));
  }

  /** @returns {string[]} funding txids of sessions still waiting on confirmations */
  pendingFundingTxids () {
    const out = [];
    for (const s of this.sessions.values()) {
      if (s.state.fundingConfirmed) continue;
      try { out.push(bitcoin.Transaction.fromHex(s.fundedTxHex).getId()); } catch (_) { /* skip */ }
    }
    return [...new Set(out)];
  }

  /**
   * New-block hook for hosts: record the tip, tick sessions, and classify any
   * transactions the host hands over (mempool / block bodies).
   * @param {object} opts `{ height, txHexes?, blockHeaderHex?, txids?, destinationAddress?, feeSats? }` — `blockHeaderHex` + `txids` (block order) let stale-commitment proofs carry an inclusion branch
   * @returns {{ published: object[], observations: object[] }}
   */
  onBlock (opts = {}) {
    const published = this.setTip(opts.height);
    const observations = [];
    const inclusion = opts.blockHeaderHex && Array.isArray(opts.txids) ? { blockHeaderHex: opts.blockHeaderHex, txids: opts.txids } : undefined;
    for (const hex of opts.txHexes || []) observations.push(...this.observe(hex, { destinationAddress: opts.destinationAddress, feeSats: opts.feeSats, inclusion }));
    return { published, observations };
  }

  /** @returns {number|null} tip height, or `null` when unknown / stale (refuses new HTLCs) */
  tipHeight () {
    if (this._tipFn) {
      const h = Number(this._tipFn());
      if (Number.isFinite(h) && h > 0) { this._tip = { height: h, at: Date.now() }; return h; }
    }
    if (!this._tip.height) return this._tipFn ? null : null;
    if (this.staleTipMs > 0 && Date.now() - this._tip.at > this.staleTipMs) return null;
    return this._tip.height;
  }

  /** @returns {boolean} chain view is usable for expiry decisions */
  get tipFresh () { return this.tipHeight() != null; }

  /**
   * @private deps handed to every session. `tipHeight` is **always** wired so
   * a session never mistakes "no chain view" for "no expiry rule": with an
   * unknown tip sessions refuse new HTLCs and refuse sender-side fails.
   */
  _sessionDeps () {
    return {
      tipHeight: () => this.tipHeight(),
      confirmations: this._confirmations || undefined
    };
  }

  /**
   * Host-side preimage lookup (seller-fulfils). Falls back to preimages any
   * session on this book has already learned.
   * @param {string} paymentHashHex
   * @returns {string|null}
   */
  preimageFor (paymentHashHex) {
    const hash = String(paymentHashHex || '').toLowerCase();
    if (this._preimageFor) {
      try {
        const pre = this._preimageFor(hash);
        if (pre && sha256Hex(Buffer.from(String(pre), 'hex')) === hash) return String(pre).toLowerCase();
      } catch (_) { /* host lookup failed */ }
    }
    for (const s of this.sessions.values()) {
      const pre = s.preimageFor(hash);
      if (pre) return pre;
    }
    return null;
  }

  /** @private event payload for an HTLC row */
  _htlcEvent (session, row, extra = {}) {
    return Object.assign({
      channelId: session.channelId,
      session,
      htlcId: row.id,
      paymentHashHex: row.paymentHashHex,
      blobHashHex: row.blobHashHex || null,
      amountSats: row.amountSats,
      direction: row.direction,
      forwardOf: row.forwardOf || null
    }, extra);
  }

  /**
   * @private fulfil every committed received HTLC whose preimage we know
   * (one per call — each fulfil opens a new round).
   */
  _autoFulfil (session) {
    if (session.busy || session.status !== 'open') return null;
    for (const h of session.state.htlcs) {
      if (h.direction !== 'received') continue;
      const pre = this.preimageFor(h.paymentHashHex);
      if (!pre) continue;
      try {
        const body = session.fulfillHtlc(h.id, pre);
        this.publish(body, session);
        return body;
      } catch (_) { /* try the next */ }
    }
    return null;
  }

  /**
   * Register a session under a channel id plus any peer aliases (Fabric id,
   * `pubkey@host:port`, connection name) used by offers.
   * @param {ChannelSession} session
   * @param {string[]} [aliases]
   * @returns {ChannelSession}
   */
  add (session, aliases = []) {
    this.sessions.set(session.channelId, session);
    this.peers.set(session.funding.remotePubkey, session.channelId);
    for (const a of aliases) if (a) this.peers.set(String(a), session.channelId);
    return session;
  }

  /**
   * @param {string} sellerId offer `sellerId` / `sellerAddress`
   * @param {string|null} [pubkeyHex] compressed counterparty key when known
   * @returns {ChannelSession|null}
   */
  sessionFor (sellerId, pubkeyHex = null) {
    const id = (pubkeyHex && this.peers.get(String(pubkeyHex).toLowerCase())) || this.peers.get(String(sellerId || ''));
    return id ? this.sessions.get(id) || null : null;
  }

  /**
   * Publish hook used by the market agent (`channels.publish(body, session)`).
   * @param {object} body
   * @param {ChannelSession} [session]
   */
  publish (body, session = null) {
    if (this._publish && body) this._publish(body, session);
  }

  /**
   * Open a channel toward a counterparty as the funder. The funder's opening
   * balance is `capacity − fee − anchors`.
   * @param {object} opts `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, toSelfDelay?, policy?, aliases? }`
   * @returns {{ session: ChannelSession, body: object }} `ChannelOpen` body to publish
   */
  open (opts = {}) {
    const fee = Math.floor(Number(opts.feeSats || 500));
    const funding = Channel.buildFunding({ network: this.network, localPubkey: this.localPubkey, remotePubkey: opts.remotePubkey, expireAfter: opts.expireAfter, capacitySats: opts.capacitySats, toSelfDelay: opts.toSelfDelay });
    const session = new ChannelSession(Object.assign({
      funding,
      fundedTxHex: opts.fundedTxHex,
      localPrivateKey: this.localPrivateKey,
      localSats: Math.floor(Number(opts.capacitySats)) - fee - 2 * CHANNEL_DEFAULTS.anchorSats,
      remoteSats: 0,
      localAddress: opts.localAddress,
      remoteAddress: opts.remoteAddress,
      feeSats: fee,
      policy: Object.assign({}, this.policy, opts.policy || {})
    }, this._sessionDeps()));
    this.add(session, opts.aliases || []);
    const body = session.open();
    this.publish(body, session);
    return { session, body };
  }

  /**
   * Route an inbound `Channel*` body. Unknown channels are accepted only on
   * `ChannelOpen` addressed to our key (we become the non-funding side).
   * Settlements on a forwarded downstream HTLC propagate upstream.
   * @param {object} body signed artifact
   * @param {object} [meta] `{ sellerId? }` alias for the counterparty
   * @returns {object|null} reply body (already published through the hook)
   */
  ingest (body = {}, meta = {}) {
    if (!body || typeof body.type !== 'string' || !body.type.startsWith('Channel')) return null;
    let session = this.sessions.get(String(body.channelId));
    let fresh = false;
    if (!session) {
      if (body.type !== CHANNEL_BODY_TYPES.Open || !body.funding) return null;
      const f = body.funding;
      if (String(f.remotePubkey).toLowerCase() !== this.localPubkey) return null;
      if (String(f.network) !== this.network) return null;
      const funding = Channel.buildFunding({ network: f.network, localPubkey: this.localPubkey, remotePubkey: f.localPubkey, expireAfter: f.expireAfter, capacitySats: f.capacitySats, toSelfDelay: f.toSelfDelay, funder: f.funder === f.localPubkey ? 'remote' : 'local' });
      if (funding.channelId !== String(body.channelId)) return null;
      session = new ChannelSession(Object.assign({
        funding,
        fundedTxHex: body.fundedTxHex,
        localPrivateKey: this.localPrivateKey,
        localSats: Number(body.remoteSats) || 0,
        remoteSats: Number(body.localSats) || 0,
        localAddress: body.remoteAddress,
        remoteAddress: body.localAddress,
        feeSats: body.feeSats,
        policy: this.policy
      }, this._sessionDeps()));
      fresh = true;
    }
    const wasBusy = session.busy;
    // Validate first: a fresh session is registered only once its opening
    // body verified, so a malformed `ChannelOpen` cannot park a dead entry
    // under our counterparty's key.
    const reply = session.ingest(body);
    if (fresh) this.add(session, meta.sellerId ? [meta.sellerId] : []);
    if (reply) this.publish(reply, session);
    if (body.type === CHANNEL_BODY_TYPES.HtlcFulfill || body.type === CHANNEL_BODY_TYPES.HtlcFail) {
      const row = session.state.settled.slice().reverse().find((x) => x.id === String(body.htlcId));
      if (row) {
        const ev = this._htlcEvent(session, Object.assign({ direction: 'offered' }, row), { outcome: row.outcome, reason: row.reason || null, preimageHex: row.outcome === 'fulfilled' ? session.preimageFor(row.paymentHashHex) : null });
        if (row.outcome === 'fulfilled') this.emit('htlcFulfilled', ev);
        this.emit('htlcSettled', ev);
      }
      this._propagate(session, body);
    }
    // A received HTLC becomes irrevocably committed once the round that
    // added it has completed on both sides (`busy` cleared).
    if (wasBusy && !session.busy) {
      for (const h of session.state.htlcs) {
        const key = `${session.channelId}:${h.id}`;
        if (h.direction !== 'received' || this._announced.has(key)) continue;
        this._announced.add(key);
        this.emit('htlcCommitted', this._htlcEvent(session, h));
      }
      this._autoFulfil(session);
    }
    return reply;
  }

  /** @private settle the upstream leg of a forwarded HTLC */
  _propagate (downstream, body) {
    const link = this.forwards.get(`${downstream.channelId}:${body.htlcId}`);
    if (!link) return;
    this.forwards.delete(`${downstream.channelId}:${body.htlcId}`);
    const upstream = this.sessions.get(link.channelId);
    if (!upstream) return;
    try {
      const out = body.type === CHANNEL_BODY_TYPES.HtlcFulfill
        ? upstream.fulfillHtlc(link.htlcId, body.preimageHex)
        : upstream.failHtlc(link.htlcId, body.reason || 'downstream-failed');
      this.publish(out, upstream);
    } catch (e) {
      this.pendingPropagation = (this.pendingPropagation || []).concat([{ link, body, error: e.message }]);
    }
  }

  /**
   * Forward a received HTLC onto another channel (multi-hop): enforces
   * {@link Channel.checkForward} with this node's policy, offers the
   * downstream HTLC with `forwardOf`, and links the two for settlement.
   * @param {ChannelSession} upstream
   * @param {string} upstreamHtlcId
   * @param {ChannelSession} downstream
   * @param {object} [policy] `{ feeSats, cltvDelta }` (defaults to `forwardPolicy`)
   * @returns {object} downstream `ChannelCommitment` body (published)
   */
  forward (upstream, upstreamHtlcId, downstream, policy = null) {
    const p = Object.assign({}, this.forwardPolicy, policy || {});
    const up = upstream.state.htlcs.find((h) => h.id === String(upstreamHtlcId) && h.direction === 'received');
    if (!up) throw new Error('forward: upstream HTLC not received on that channel');
    if (upstream === downstream) throw new Error('forward: cannot forward onto the same channel');
    const down = { amountSats: up.amountSats - Math.floor(Number(p.feeSats) || 0), expireAfter: { type: 'cltv', height: expireHeight(up) - Math.max(1, Math.floor(Number(p.cltvDelta) || 1)) }, paymentHashHex: up.paymentHashHex };
    if (down.amountSats < 1) throw new Error('forward: fee-short');
    const check = Channel.checkForward(up, down, p);
    if (!check.ok) throw new Error(`forward: ${check.reason}`);
    const body = downstream.offerHtlc({ amountSats: down.amountSats, paymentHashHex: up.paymentHashHex, blobHashHex: up.blobHashHex, expireAfter: down.expireAfter, forwardOf: { channelId: upstream.channelId, htlcId: up.id } });
    this.forwards.set(`${downstream.channelId}:${body.htlc.id}`, { channelId: upstream.channelId, htlcId: up.id });
    this.publish(body, downstream);
    return body;
  }

  /**
   * Tick every session with the current tip; publishes auto-fail bodies.
   * @returns {object[]} bodies published
   */
  tick () {
    const tip = this.tipHeight();
    const out = [];
    for (const session of this.sessions.values()) {
      const r = session.tick(tip || 0);
      for (const b of r.bodies) { this.publish(b, session); out.push(b); }
      if (r.timeouts.length) this.timeouts = (this.timeouts || []).concat(r.timeouts.map((t) => Object.assign({ channelId: session.channelId }, t)));
    }
    return out;
  }

  /**
   * Hand an observed transaction to every session (mempool / block hook).
   * @param {string} txHex
   * @param {object} [opts] `{ destinationAddress?, feeSats? }`
   * @returns {object[]} non-`unknown` observations
   */
  observe (txHex, opts = {}) {
    const out = [];
    for (const session of this.sessions.values()) {
      try {
        const r = session.observe(txHex, opts);
        if (r.kind !== 'unknown') out.push(Object.assign({ channelId: session.channelId }, r));
      } catch (_) { /* not ours */ }
    }
    return out;
  }

  /** @returns {object} persistence snapshot (no private key) */
  export () {
    return {
      type: 'ChannelBookState',
      version: 2,
      network: this.network,
      sessions: [...this.sessions.values()].map((s) => s.export()),
      peers: Object.fromEntries(this.peers),
      forwards: Object.fromEntries(this.forwards)
    };
  }

  /** @param {object} snapshot @returns {ChannelBook} */
  import (snapshot = {}) {
    for (const snap of snapshot.sessions || []) {
      try { this.add(ChannelSession.import(snap, this.localPrivateKey, this._sessionDeps())); } catch (_) { /* skip foreign */ }
    }
    for (const [alias, id] of Object.entries(snapshot.peers || {})) if (this.sessions.has(id)) this.peers.set(alias, id);
    for (const [k, v] of Object.entries(snapshot.forwards || {})) this.forwards.set(k, v);
    return this;
  }

  /** @returns {object[]} public summaries */
  list () {
    return [...this.sessions.values()].map((s) => ({
      channelId: s.channelId,
      remotePubkey: s.funding.remotePubkey,
      status: s.status,
      number: s.number,
      balances: s.balances,
      pendingHtlcs: s.state.htlcs.length,
      settled: s.state.settled.length,
      fullySigned: s.fullySigned,
      busy: s.busy,
      revokedStates: Object.keys(s.state.revoked).length
    }));
  }
}

Channel.Book = ChannelBook;

module.exports = Channel;
