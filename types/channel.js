'use strict';

// Constants
const {
  MAX_CHANNEL_VALUE,
  BITCOIN_DUST_SATS,
  HTLC_MINIMUM_SATS
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
const { taprootPsbtInputFields } = require('../functions/bip371');
const { BIP125_SEQUENCE_LOCKTIME_ONLY } = require('../functions/bip125');
const Htlc = require('./htlc');
const { buildInclusion } = require('../functions/bitcoinTxInclusion');
const ecc = require('./ecc');

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
} = require('./policy');
const { assertTestNetwork } = require('../functions/bitcoinNetworkAllowlist');

// Locals
const HEX64 = /^[0-9a-f]{64}$/;
const SIG64 = /^[0-9a-f]{128}$/i;
const COMPRESSED = /^(02|03)[0-9a-f]{64}$/;
const HTLC_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DUST = BITCOIN_DUST_SATS;
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
  Close: 'ChannelClose',
  Reestablish: 'ChannelReestablish'
});

/**
 * Channel defaults (Lightning-derived). Policy fields are negotiated at
 * `ChannelOpen` — the stricter value wins. HTLCs are never trimmed: every one
 * carries at least `HTLC_MINIMUM_SATS`, so it has a commitment output its
 * receiver can claim on-chain.
 *
 * `htlcClaimWindowBlocks` is part of the HTLC script (not negotiated): on the
 * receiver's own commitment the sender's timeout waits `toSelfDelay +
 * htlcClaimWindowBlocks` after confirmation, so the receiver's CSV-delayed
 * claim always has that many blocks to itself, whatever the CLTV.
 * `minToSelfDelay` / `maxToSelfDelay` / `minChannelLifetimeBlocks` are local
 * (non-funder) acceptance limits, never negotiated.
 */
const CHANNEL_DEFAULTS = Object.freeze({
  toSelfDelay: 144,
  anchorSats: 330,
  minCommitFeeSats: 200,
  maxCommitFeeSats: 50000,
  minFeerate: 1,
  maxAcceptedHtlcs: 30,
  htlcMinimumSats: HTLC_MINIMUM_SATS,
  minCltvDelta: 6,
  closeMarginBlocks: 144,
  htlcSafetyBlocks: 12,
  htlcClaimWindowBlocks: 18,
  minToSelfDelay: 144,
  maxToSelfDelay: 2016,
  minChannelLifetimeBlocks: 1008,
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
 * Allowlist test networks (regtest / signet / testnet / testnet4); mainnet and
 * unknown names are refused.
 * @param {string} network
 * @returns {string} normalised network name
 * @private
 */
function refuseMainnet (network) {
  return assertTestNetwork(network, 'Channel');
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
    htlcMinimumSats: Math.max(HTLC_MINIMUM_SATS, pick('htlcMinimumSats', d.htlcMinimumSats, 'max')),
    channelReserveSats: pick('channelReserveSats', defaultReserve, 'max'),
    minCommitFeeSats: pick('minCommitFeeSats', d.minCommitFeeSats, 'max'),
    maxCommitFeeSats: pick('maxCommitFeeSats', d.maxCommitFeeSats, 'min'),
    minCltvDelta: pick('minCltvDelta', d.minCltvDelta, 'max'),
    closeMarginBlocks: pick('closeMarginBlocks', d.closeMarginBlocks, 'max'),
    htlcSafetyBlocks: Math.max(1, pick('htlcSafetyBlocks', d.htlcSafetyBlocks, 'max')),
    minFeerate: Math.max(1, pick('minFeerate', d.minFeerate, 'max'))
  };
  if (policy.maxAcceptedHtlcs < 1) policy.maxAcceptedHtlcs = 1;
  if (policy.minCommitFeeSats > policy.maxCommitFeeSats) policy.maxCommitFeeSats = policy.minCommitFeeSats;
  return policy;
};

/**
 * Smallest `expireAfter − tip` an HTLC may be offered or accepted with:
 * `toSelfDelay + closeMarginBlocks + htlcSafetyBlocks` (never below
 * `minCltvDelta`). Hosts pricing HTLCs (the market) should add a few blocks
 * of slack for tip skew between peers.
 * @param {object} source a {@link ChannelSession}, `{ funding, policy }`, or a funding record
 * @returns {number} blocks
 */
Channel.minHtlcExpiryDelta = function minHtlcExpiryDelta (source = {}) {
  const d = CHANNEL_DEFAULTS;
  const funding = source.funding || source;
  const policy = source.policy || (source.state && source.state.policy) || {};
  const num = (v, dflt) => (v == null || !Number.isFinite(Number(v)) ? dflt : Math.floor(Number(v)));
  const toSelfDelay = num(funding.toSelfDelay, d.toSelfDelay);
  const delta = toSelfDelay + num(policy.closeMarginBlocks, d.closeMarginBlocks) + num(policy.htlcSafetyBlocks, d.htlcSafetyBlocks);
  return Math.max(delta, num(policy.minCltvDelta, d.minCltvDelta));
};

/**
 * Smallest CLTV delta a forwarding node must keep between the HTLC it receives
 * and the one it offers downstream: the downstream receiver may claim as late
 * as `expire + toSelfDelay + htlcClaimWindowBlocks` (on its own commitment),
 * after which we still need `htlcSafetyBlocks` to claim upstream.
 * @param {object} source downstream {@link ChannelSession} or funding record
 * @returns {number} blocks
 */
Channel.minForwardCltvDelta = function minForwardCltvDelta (source = {}) {
  const d = CHANNEL_DEFAULTS;
  const funding = source.funding || source;
  const policy = source.policy || (source.state && source.state.policy) || {};
  const toSelfDelay = Math.floor(Number(funding.toSelfDelay) || d.toSelfDelay);
  return toSelfDelay + d.htlcClaimWindowBlocks + Math.floor(Number(policy.htlcSafetyBlocks) || d.htlcSafetyBlocks);
};

/**
 * Estimated vsize of a commitment transaction: one 2-of-2 tapscript input,
 * `toLocal` + `toRemote` + two anchors + one output per HTLC (P2TR sizes).
 * @param {number} htlcCount
 * @returns {number} vbytes
 */
Channel.estimateCommitmentVsize = function estimateCommitmentVsize (htlcCount = 0) {
  const n = Math.max(0, Math.floor(Number(htlcCount) || 0));
  // base: version + vin/vout counts + input + locktime + 43-byte P2TR outputs;
  // witness: marker/flag + 2 sigs + 2-of-2 script + depth-1 control block.
  const weight = 4 * (51 + 43 * (4 + n)) + 270;
  return Math.ceil(weight / 4);
};

/**
 * Commitment fee for a feerate (sat/vB) and HTLC count.
 * @param {number} feerate sat/vB (integer ≥ 1)
 * @param {number} htlcCount
 * @returns {number} sats
 */
Channel.commitmentFeeSats = function commitmentFeeSats (feerate, htlcCount = 0) {
  const rate = Math.floor(Number(feerate));
  if (!(rate >= 1)) throw new Error('commitmentFeeSats: feerate must be an integer ≥ 1 sat/vB');
  return Math.ceil(rate * Channel.estimateCommitmentVsize(htlcCount));
};

/**
 * Deterministic channel id over the funding address, both keys, the
 * negotiated `toSelfDelay` (so neither party can re-interpret the delay) and,
 * once known, the funding outpoint (so two fundings of one address never share
 * an id).
 * @param {object} funding
 * @returns {string}
 */
Channel.idFor = function idFor (funding) {
  const keys = [funding.localPubkey, funding.remotePubkey].map((k) => String(k).toLowerCase()).sort();
  const outpoint = funding.fundingTxid ? `:${String(funding.fundingTxid).toLowerCase()}:${Number(funding.fundingVout)}` : '';
  return sha256Hex(Buffer.from(`${String(funding.address)}:${keys.join(':')}:${Number(funding.toSelfDelay) || 0}${outpoint}`));
};

/**
 * Locate the funding output in a funding transaction: the declared vout when
 * given (must pay the channel address), else the single output that does.
 * @param {object} funding
 * @param {string} fundedTxHex
 * @returns {{ txid: string, vout: number, value: number }}
 */
Channel.fundingOutpoint = function fundingOutpoint (funding, fundedTxHex) {
  const network = networkForFabricName(funding.network);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const script = bitcoin.address.toOutputScript(funding.address, network);
  const pays = (i) => !!tx.outs[i] && Buffer.from(tx.outs[i].script).equals(script);
  let vout;
  if (funding.fundingVout != null) {
    vout = Math.floor(Number(funding.fundingVout));
    if (!pays(vout)) throw new Error(`fundingOutpoint: output ${vout} does not pay the channel address`);
  } else {
    const matches = tx.outs.map((_, i) => i).filter(pays);
    if (!matches.length) throw new Error('fundingOutpoint: funding tx has no output for the channel address');
    if (matches.length > 1) throw new Error('fundingOutpoint: funding tx pays the channel address more than once (declare fundingVout)');
    vout = matches[0];
  }
  const txid = tx.getId();
  if (funding.fundingTxid && String(funding.fundingTxid).toLowerCase() !== txid) throw new Error('fundingOutpoint: fundingTxid does not match the funding tx');
  return { txid, vout, value: Number(tx.outs[vout].value) };
};

/**
 * Refuse funding transactions whose txid a third party could malleate: every
 * input must spend a segwit output (empty scriptSig, or a P2SH push of a v0
 * witness program) and, once signed, carry a witness.
 * @param {string} fundedTxHex
 * @private
 */
function assertSegwitFunding (fundedTxHex) {
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const signed = tx.ins.some((i) => i.witness && i.witness.length);
  tx.ins.forEach((input, vin) => {
    const scriptSig = Buffer.from(input.script || []);
    if (scriptSig.length) {
      const chunks = bitcoin.script.decompile(scriptSig) || [];
      const push = chunks.length === 1 && chunks[0] instanceof Uint8Array ? Buffer.from(chunks[0]) : null;
      const v0 = push && push[0] === 0x00 && ((push[1] === 0x14 && push.length === 22) || (push[1] === 0x20 && push.length === 34));
      if (!v0) throw new Error(`funding input ${vin} is not segwit (txid malleable)`);
    }
    if (signed && !(input.witness && input.witness.length)) throw new Error(`funding input ${vin} has no witness (txid malleable)`);
  });
}

/**
 * P2TR funding output: `cooperative` 2-of-2 leaf (every commitment and the
 * cooperative close spend through it) plus a `refund` leaf for the funder
 * after `expireAfter` (block height) so funds never strand.
 * @param {object} opts `{ network, localPubkey, remotePubkey, expireAfter, capacitySats, funder?, toSelfDelay?, fundingTxid?, fundingVout? }`
 * @returns {object} `ChannelFunding` record (`_leaves` carries scripts; drop before gossip)
 */
Channel.buildFunding = function buildFunding (opts = {}) {
  const network = refuseMainnet(opts.network || 'regtest');
  const local = compressedOrThrow('localPubkey', opts.localPubkey);
  const remote = compressedOrThrow('remotePubkey', opts.remotePubkey);
  const expireAfter = heightLock(opts.expireAfter);
  if (!expireAfter) throw new Error('buildFunding: expireAfter height required');
  const funder = opts.funder === 'remote' ? remote : local;
  const toSelfDelay = Math.floor(Number(opts.toSelfDelay != null ? opts.toSelfDelay : CHANNEL_DEFAULTS.toSelfDelay));
  const maxDelay = 65535 - CHANNEL_DEFAULTS.htlcClaimWindowBlocks;
  if (!(toSelfDelay >= 1 && toSelfDelay <= maxDelay)) throw new Error(`buildFunding: toSelfDelay must be 1..${maxDelay} blocks`);
  let outpoint = null;
  if (opts.fundingTxid != null) {
    const txid = String(opts.fundingTxid).toLowerCase();
    const vout = Number(opts.fundingVout);
    if (!HEX64.test(txid) || !Number.isInteger(vout) || vout < 0) throw new Error('buildFunding: fundingTxid (hex) + fundingVout (integer) required together');
    outpoint = { fundingTxid: txid, fundingVout: vout };
  }
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
  if (outpoint) Object.assign(funding, outpoint);
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
  const network = refuseMainnet(opts.network || 'regtest');
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
  const network = refuseMainnet(opts.network || 'regtest');
  const pubkey = compressedOrThrow('pubkey', opts.pubkey);
  const leaves = [buildSpendLeaf({ id: 'anchor', keys: [pubkey], threshold: 1 })];
  const tree = composeTaprootTree({ network, leaves });
  return { pubkey, address: tree.address, internalPubkeyHex: tree.internalPubkeyHex, _leaves: tree.leafScripts };
};

/**
 * Per-HTLC P2TR output on a commitment. Symmetric form (no `revocationPubkey`):
 * `claim` hashlock leaf for the receiver and `timeout` leaf for the sender
 * after `expireAfter`. Holder-aware form adds a `revocation` leaf and a
 * `toSelfDelay` CSV on whichever leaf pays the commitment *holder*: the
 * holder is punished for a stale broadcast and must wait on their own tx.
 *
 * On the **receiver's** commitment the sender's timeout additionally waits
 * `toSelfDelay + htlcClaimWindowBlocks` (CSV) after confirmation, so the
 * receiver's CSV-delayed claim can never be raced by a CLTV-only timeout —
 * this replaces BOLT 3's second-stage HTLC-success transaction. On the
 * sender's commitment the receiver claims immediately and the sender's
 * timeout waits `toSelfDelay`.
 * @param {object} opts `{ network, paymentHashHex, receiverPubkey, senderPubkey, expireAfter, holder?: 'receiver'|'sender', toSelfDelay?, revocationPubkey? }`
 * @returns {object} includes `claimCsv` / `timeoutCsv` (relative locks, `null` when none)
 */
Channel.buildHtlcOutput = function buildHtlcOutput (opts = {}) {
  const network = refuseMainnet(opts.network || 'regtest');
  const paymentHashHex = String(opts.paymentHashHex || '').toLowerCase();
  if (!HEX64.test(paymentHashHex)) throw new Error('buildHtlcOutput: paymentHashHex must be 32-byte hex');
  const receiver = compressedOrThrow('receiverPubkey', opts.receiverPubkey);
  const sender = compressedOrThrow('senderPubkey', opts.senderPubkey);
  const expireAfter = heightLock(opts.expireAfter);
  if (!expireAfter) throw new Error('buildHtlcOutput: expireAfter height required');
  const leaves = [];
  const toSelfDelay = Math.floor(Number(opts.toSelfDelay) || CHANNEL_DEFAULTS.toSelfDelay);
  let claimCsv = null;
  let timeoutCsv = null;
  const timeoutLeaf = (csvBlocks) => {
    const inner = buildSpendLeaf({ id: 'timeout', keys: [sender], threshold: 1, after: expireAfter }).script;
    return buildScriptLeaf({ id: 'timeout', script: inner, after: { type: 'csv', blocks: csvBlocks }, witnessShape: 'sigs' });
  };
  if (opts.revocationPubkey) {
    const revocation = compressedOrThrow('revocationPubkey', opts.revocationPubkey);
    const holder = opts.holder === 'sender' ? 'sender' : 'receiver';
    if (holder === 'receiver') {
      claimCsv = toSelfDelay;
      timeoutCsv = toSelfDelay + CHANNEL_DEFAULTS.htlcClaimWindowBlocks;
      leaves.push(buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHashHex, pubkeyHex: receiver, after: { type: 'csv', blocks: claimCsv } }));
    } else {
      timeoutCsv = toSelfDelay;
      leaves.push(buildHashlockLeaf({ id: 'claim', commitmentHex: paymentHashHex, pubkeyHex: receiver }));
    }
    leaves.push(timeoutLeaf(timeoutCsv));
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
    toSelfDelay: opts.revocationPubkey ? toSelfDelay : null,
    claimCsv,
    timeoutCsv,
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
  let vout;
  try {
    vout = Channel.fundingOutpoint(funding, state.fundedTxHex).vout;
  } catch (e) {
    throw new Error(`buildCommitment: ${e.message.replace(/^fundingOutpoint: /, '')}`);
  }
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
    sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
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
  for (const h of sorted) {
    const amount = Math.floor(Number(h.amountSats) || 0);
    // No trimmed HTLCs: one without a claimable output would be trusted.
    if (amount < HTLC_MINIMUM_SATS) throw new Error(`buildCommitment: HTLC ${h.id} below ${HTLC_MINIMUM_SATS} sats has no claimable output`);
    const offered = h.direction !== 'received'; // offered by the local party
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
    txHex: unsigned.toHex(),
    fundingTxid: tx.getId(),
    fundingVout: vout,
    inputSats,
    feeSats: fee,
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
  psbt.signInput(0, Htlc.signerFromPriv32(Buffer.isBuffer(priv32) ? priv32 : Buffer.from(String(priv32), 'hex')));
  return psbt.toBase64();
};

/**
 * Leaf hash of the (single) tapscript leaf input 0 of a PSBT spends.
 * @param {Object} psbt bitcoinjs Psbt
 * @returns {string|null} hex
 * @private
 */
function inputLeafHashHex (psbt) {
  const leaf = (psbt.data.inputs[0].tapLeafScript || [])[0];
  if (!leaf) return null;
  return Buffer.from(bip341.tapleafHash({ output: Buffer.from(leaf.script), version: leaf.leafVersion })).toString('hex');
}

/**
 * Extract the counterparty's raw signature from a body: a 64-byte hex string,
 * or a PSBT whose only accepted entry is a 64-byte (SIGHASH_DEFAULT)
 * `tapScriptSig` for (`xOnly`, `leafHashHex`). Nothing else of the PSBT is
 * kept.
 * @param {string} signature hex or psbt base64
 * @param {string} xOnly hex
 * @param {string} leafHashHex expected leaf
 * @param {Object} net bitcoinjs network
 * @param {string} txid expected unsigned txid (PSBT form)
 * @returns {{ sig: (Buffer|undefined), reason: (string|undefined) }}
 * @private
 */
function extractTapscriptSig (signature, xOnly, leafHashHex, net, txid) {
  const s = String(signature || '').trim();
  if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length <= 132) {
    if (!SIG64.test(s)) return { reason: `signature must be 64 bytes (SIGHASH_DEFAULT), got ${s.length / 2}` };
    return { sig: Buffer.from(s, 'hex') };
  }
  let theirs;
  try {
    theirs = bitcoin.Psbt.fromBase64(s, { network: net });
  } catch (e) {
    return { reason: `psbt: ${e.message}` };
  }
  if (theirs.__CACHE.__TX.getId() !== txid) return { reason: 'signature is on a different transaction' };
  const mine = (theirs.data.inputs[0].tapScriptSig || []).filter((x) => Buffer.from(x.pubkey).toString('hex') === xOnly && Buffer.from(x.leafHash).toString('hex') === leafHashHex);
  if (!mine.length) return { reason: 'no signature from the counterparty key' };
  if (mine.length > 1) return { reason: 'multiple signatures from the counterparty key' };
  const sig = Buffer.from(mine[0].signature);
  if (sig.length !== 64) return { reason: `signature must be 64 bytes (SIGHASH_DEFAULT), got ${sig.length}` };
  return { sig };
}

/**
 * Verify a counterparty's tapscript signature on *our* commitment. Only a
 * 64-byte SIGHASH_DEFAULT signature by `signerPubkeyHex` over the commitment's
 * own leaf is accepted; it is checked against a fresh copy of our PSBT, never
 * merged with untrusted PSBT fields.
 * @param {string} commitmentPsbtBase64 unsigned (ours)
 * @param {string} signature counterparty signature: 64-byte hex, or partial PSBT base64
 * @param {string} signerPubkeyHex compressed
 * @param {string} network
 * @returns {{ ok: boolean, reason: (string|undefined), signatureHex: (string|undefined) }}
 */
Channel.verifyCommitmentSignature = function verifyCommitmentSignature (commitmentPsbtBase64, signature, signerPubkeyHex, network = 'regtest') {
  const net = networkForFabricName(network);
  let mine;
  try {
    mine = bitcoin.Psbt.fromBase64(String(commitmentPsbtBase64), { network: net });
  } catch (e) {
    return { ok: false, reason: `psbt: ${e.message}` };
  }
  const xOnly = xOnlyOf(compressedOrThrow('signerPubkey', signerPubkeyHex));
  const leafHashHex = inputLeafHashHex(mine);
  if (!leafHashHex) return { ok: false, reason: 'commitment has no tapscript leaf' };
  const { sig, reason } = extractTapscriptSig(signature, xOnly, leafHashHex, net, mine.__CACHE.__TX.getId());
  if (!sig) return { ok: false, reason };
  try {
    mine.updateInput(0, { tapScriptSig: [{ pubkey: Buffer.from(xOnly, 'hex'), leafHash: Buffer.from(leafHashHex, 'hex'), signature: sig }] });
    const ok = mine.validateSignaturesOfInput(0, (pubkey, msghash, s) => ecc.verifySchnorr(msghash, pubkey, s), Buffer.from(xOnly, 'hex'));
    return ok ? { ok: true, signatureHex: sig.toString('hex') } : { ok: false, reason: 'invalid tapscript signature' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
};

/**
 * Add a verified 64-byte counterparty signature to a copy of our commitment
 * PSBT (local rebuild; nothing else is taken from the counterparty).
 * @param {string} commitmentPsbtBase64
 * @param {string} signatureHex 64-byte hex
 * @param {string} signerPubkeyHex compressed
 * @param {string} network
 * @returns {string} psbt base64
 */
Channel.withCommitmentSignature = function withCommitmentSignature (commitmentPsbtBase64, signatureHex, signerPubkeyHex, network = 'regtest') {
  const check = Channel.verifyCommitmentSignature(commitmentPsbtBase64, signatureHex, signerPubkeyHex, network);
  if (!check.ok) throw new Error(`withCommitmentSignature: ${check.reason}`);
  const psbt = bitcoin.Psbt.fromBase64(String(commitmentPsbtBase64), { network: networkForFabricName(network) });
  psbt.updateInput(0, {
    tapScriptSig: [{
      pubkey: Buffer.from(xOnlyOf(compressedOrThrow('signerPubkey', signerPubkeyHex)), 'hex'),
      leafHash: Buffer.from(inputLeafHashHex(psbt), 'hex'),
      signature: Buffer.from(check.signatureHex, 'hex')
    }]
  });
  return psbt.toBase64();
};

/**
 * Merge both parties' partial signatures and extract the broadcastable tx.
 * Only 64-byte signatures for the input's own leaf by the funding keys are
 * copied from `psbtB`; nothing else of it is used.
 * @param {string} psbtA base64 (ours, signed or unsigned)
 * @param {string} psbtB base64 (counterparty partial) — optional
 * @param {string} network
 * @returns {object} `{ txHex, txid }`
 */
Channel.finalizeCommitment = function finalizeCommitment (psbtA, psbtB, network = 'regtest') {
  const net = networkForFabricName(network);
  const a = bitcoin.Psbt.fromBase64(String(psbtA), { network: net });
  const leafHashHex = inputLeafHashHex(a);
  const keyOk = (x) => Buffer.from(x.leafHash).toString('hex') === leafHashHex && Buffer.from(x.signature).length === 64;
  const own = (a.data.inputs[0].tapScriptSig || []).filter(keyOk);
  if (own.length !== (a.data.inputs[0].tapScriptSig || []).length) throw new Error('finalizeCommitment: only 64-byte SIGHASH_DEFAULT signatures are accepted');
  if (psbtB) {
    const b = bitcoin.Psbt.fromBase64(String(psbtB), { network: net });
    if (b.__CACHE.__TX.getId() !== a.__CACHE.__TX.getId()) throw new Error('finalizeCommitment: psbts are for different transactions');
    const have = new Set(own.map((x) => Buffer.from(x.pubkey).toString('hex')));
    const add = (b.data.inputs[0].tapScriptSig || []).filter((x) => keyOk(x) && !have.has(Buffer.from(x.pubkey).toString('hex')));
    if (add.length) a.updateInput(0, { tapScriptSig: add.map((x) => ({ pubkey: Buffer.from(x.pubkey), leafHash: Buffer.from(x.leafHash), signature: Buffer.from(x.signature) })) });
  }
  const sigs = (a.data.inputs[0].tapScriptSig || []).length;
  if (sigs < 2) throw new Error(`finalizeCommitment: need 2 tapscript signatures, have ${sigs}`);
  if (!a.validateSignaturesOfInput(0, (pubkey, msghash, s) => ecc.verifySchnorr(msghash, pubkey, s))) throw new Error('finalizeCommitment: invalid tapscript signature');
  return finalizeSpendPsbt({ psbt: a });
};

/**
 * Find the on-chain HTLC output row for an id.
 * @param {Object} commitment built commitment
 * @param {string} htlcId
 * @param {string} label error prefix
 * @returns {Object} output row
 * @private
 */
function htlcRowOrThrow (commitment, htlcId, label) {
  const row = (commitment.outputs || []).find((o) => o.kind === 'htlc' && o.id === String(htlcId));
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
    after: delayed ? { type: 'csv', blocks: row._htlc.claimCsv || row._htlc.toSelfDelay } : undefined,
    preimage32: Buffer.from(preimageHex, 'hex')
  }), { leafId: 'claim', witnessShape: 'preimage+sig', htlcId: row.id, delayed });
};

/**
 * Sender reclaims an expired HTLC output of a broadcast commitment. The
 * timeout leaf is CSV-delayed on both commitments: `toSelfDelay` on the
 * sender's own, `toSelfDelay + htlcClaimWindowBlocks` on the receiver's.
 * @param {object} commitment
 * @param {object} opts `{ htlcId, commitmentTxHex, destinationAddress, feeSats, network }`
 * @returns {object}
 */
Channel.prepareHtlcTimeout = function prepareHtlcTimeout (commitment, opts = {}) {
  const row = htlcRowOrThrow(commitment, opts.htlcId, 'prepareHtlcTimeout');
  const leaf = row._htlc._leaves.find((l) => l.id === 'timeout');
  const csv = row._htlc.timeoutCsv != null ? row._htlc.timeoutCsv : (row._htlc.holder === 'sender' ? row._htlc.toSelfDelay : null);
  const delayed = csv != null;
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
    sequence: delayed ? csv : undefined
  }), { leafId: 'timeout', witnessShape: 'sigs', htlcId: row.id, delayed, csv });
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
 * `vouts` limits the sweep to those outputs and `excludeVouts` skips outputs
 * already spent (e.g. an HTLC the cheater claimed or timed out — sweep that
 * second-stage output separately), so one spent output cannot invalidate the
 * whole justice transaction.
 * @param {object} opts `{ funding, state, holderPoint, perCommitmentSecretHex, staleTxHex, localPrivateKey, destinationAddress, feeSats, network?, vouts?, excludeVouts? }` — `state` is the revoked state (local view)
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
  const signer = Htlc.signerFromPriv32(revPriv);
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
      sequence: BIP125_SEQUENCE_LOCKTIME_ONLY,
      witnessUtxo: { script: Uint8Array.from(out.script), value: BigInt(out.value) }
    }, taprootPsbtInputFields({ tapInternalKey: internal, script: leaf.script, controlBlock: control, leafVersion: bip341.LEAF_VERSION_TAPSCRIPT })));
    inputs.push({ vout: row.vout, kind: row.kind, id: row.id || null, amountSats: Number(out.value) });
    swept += Number(out.value);
  };
  const only = Array.isArray(opts.vouts) ? new Set(opts.vouts.map(Number)) : null;
  const skip = new Set((opts.excludeVouts || []).map(Number));
  for (const row of commitment.outputs) {
    if ((only && !only.has(row.vout)) || skip.has(row.vout)) continue;
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
 * One justice transaction **per** revocable output of a stale commitment, so
 * each confirms (or fails because already spent) independently. Outputs whose
 * value cannot cover `feeSats` above dust are skipped.
 * @param {object} opts same as {@link Channel.prepareJusticeSpend}
 * @returns {Object[]} `[{ vout, kind, txHex, txid, sweptSats }]`
 */
Channel.prepareJusticeSpends = function prepareJusticeSpends (opts = {}) {
  const funding = Array.isArray(opts.funding && opts.funding._leaves) ? opts.funding : Channel.fundingFromRecord(opts.funding);
  const commitment = Channel.buildCommitment(funding, opts.state, { holder: 'remote', holderPoint: opts.holderPoint });
  const skip = new Set((opts.excludeVouts || []).map(Number));
  const fee = Math.max(1, Math.floor(Number(opts.feeSats) || 500));
  const out = [];
  for (const row of commitment.outputs) {
    if (!(row.kind === 'toLocal' || row.kind === 'htlc') || skip.has(row.vout)) continue;
    if (row.amountSats - fee < DUST) continue;
    const spend = Channel.prepareJusticeSpend(Object.assign({}, opts, { funding, vouts: [row.vout], excludeVouts: [] }));
    out.push(Object.assign({ vout: row.vout, kind: row.kind, id: row.id || null }, spend));
  }
  return out;
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
  if (finalAmount < HTLC_MINIMUM_SATS) throw new Error(`planRoute: amountSats below the ${HTLC_MINIMUM_SATS}-sat HTLC minimum`);
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
 */
function expireHeight (h) {
  const lock = heightLock(h && h.expireAfter);
  return lock ? Number(lock.height) : 0;
}

Channel.expireHeight = expireHeight;

/** Balance transfers remembered per session (newest kept). */
const MAX_TRANSFERS = 1024;

/**
 * A transfer `ref`: what the payment is for, echoed to the receiver.
 * @param {*} ref
 * @param {string} label error prefix
 * @returns {string|null}
 * @private
 */
function transferRef (ref, label) {
  if (ref == null || ref === '') return null;
  const s = String(ref);
  if (s.length > 256 || /[\u0000-\u001f\u007f]/.test(s)) throw new Error(`${label}: transfer ref must be ≤ 256 printable characters`);
  return s;
}

/**
 * @param {Object} state session state
 * @param {Object} row `{ amountSats, ref, direction, number }`
 * @private
 */
function recordTransfer (state, row) {
  state.transfers = (state.transfers || []).concat([row]);
  if (state.transfers.length > MAX_TRANSFERS) state.transfers = state.transfers.slice(-MAX_TRANSFERS);
}

/**
 * Validate HTLC rows received from a counterparty: unique non-empty ids,
 * positive integer amounts, 32-byte payment hashes, a direction, an expiry.
 * @param {Object[]} rows
 * @param {string} label error prefix
 * @private
 */
function validateHtlcRows (rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}: htlcs must be an array`);
  const ids = new Set();
  for (const h of rows) {
    if (!h || typeof h !== 'object') throw new Error(`${label}: malformed HTLC row`);
    if (typeof h.id !== 'string' || !HTLC_ID.test(h.id)) throw new Error(`${label}: invalid HTLC id`);
    if (ids.has(h.id)) throw new Error(`${label}: duplicate HTLC id ${h.id}`);
    ids.add(h.id);
    if (typeof h.amountSats !== 'number' || !Number.isSafeInteger(h.amountSats) || h.amountSats <= 0) throw new Error(`${label}: HTLC ${h.id} amountSats must be a positive integer`);
    if (typeof h.paymentHashHex !== 'string' || !HEX64.test(h.paymentHashHex)) throw new Error(`${label}: HTLC ${h.id} paymentHashHex must be 32-byte lowercase hex`);
    if (h.direction !== 'offered' && h.direction !== 'received') throw new Error(`${label}: HTLC ${h.id} direction invalid`);
    if (!(expireHeight(h) > 0)) throw new Error(`${label}: HTLC ${h.id} expireAfter height required`);
  }
}

/**
 * @param {string} psbtBase64 signed by one key
 * @param {string} network
 * @returns {string|null} that key's 64-byte tapscript signature (hex)
 * @private
 */
function sigHexOf (psbtBase64, network) {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64), { network: networkForFabricName(network) });
  const tss = (psbt.data.inputs[0].tapScriptSig || [])[0];
  return tss ? Buffer.from(tss.signature).toString('hex') : null;
}

/** @private state number a (possibly wrapped) update body carries */
function bodyNumber (body) {
  if (!body) return -1;
  const inner = body.commitment && typeof body.commitment === 'object' ? body.commitment : body;
  return Math.floor(Number(inner.number));
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
 *
 * Both parties proposing state `n` at once is resolved deterministically:
 * the funder's proposal wins, the non-funder rolls its own back and replays
 * it ({@link ChannelSession#repropose}) once the round completes. After a
 * reconnect, {@link ChannelSession#reestablish} tells the peer which states we
 * hold signed and revoked; the answer resends whatever we missed.
 * @class ChannelSession
 */
class ChannelSession {
  /**
   * @param {object} opts `{ funding, fundedTxHex, localPrivateKey, localSats, remoteSats, localAddress, remoteAddress, feeSats?, feerate?, policy?, tipHeight?, confirmations?, fundingConfirmed?, minFundingConfirmations? }`
   *   `confirmations(txid)` gates the channel on the funding depth; without it
   *   only the funder (or `fundingConfirmed: true`, explicit trust) treats the
   *   funding as confirmed. `feerate` (sat/vB) derives the commitment fee from
   *   the HTLC count instead of a fixed `feeSats`.
   */
  constructor (opts = {}) {
    let funding = Array.isArray(opts.funding && opts.funding._leaves) ? opts.funding : Channel.fundingFromRecord(opts.funding);
    this.fundedTxHex = String(opts.fundedTxHex || '');
    this.fundingValue = null;
    if (this.fundedTxHex) {
      const outpoint = Channel.fundingOutpoint(funding, this.fundedTxHex);
      this.fundingValue = outpoint.value;
      if (!funding.fundingTxid) {
        const record = Object.assign({}, funding, { funder: funding.funder === funding.remotePubkey ? 'remote' : 'local', fundingTxid: outpoint.txid, fundingVout: outpoint.vout });
        delete record._leaves;
        funding = Channel.buildFunding(record);
      }
    }
    this.funding = funding;
    this.channelId = this.funding.channelId;
    this.network = this.funding.network;
    const priv = opts.localPrivateKey;
    this.localPrivateKey = Buffer.isBuffer(priv) ? priv : Buffer.from(String(priv || ''), 'hex');
    if (this.localPrivateKey.length !== 32) throw new Error('ChannelSession: localPrivateKey (32 bytes) required');
    const derived = Buffer.from(Htlc.signerFromPriv32(this.localPrivateKey).publicKey).toString('hex');
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
    const feerate = opts.feerate != null && Number(opts.feerate) > 0 ? Math.floor(Number(opts.feerate)) : null;
    this._state = {
      number: 0,
      localSats: Math.floor(Number(opts.localSats) || 0),
      remoteSats: Math.floor(Number(opts.remoteSats) || 0),
      feeSats: Math.floor(Number(opts.feeSats || 500)),
      feerate,
      policy: Channel.negotiatePolicy(this.localPolicy, {}, this.funding.capacitySats || 0),
      htlcs: [],
      settled: [],
      transfers: [],
      status: 'opening',
      fundingConfirmed: this._confirmations ? false : (opts.fundingConfirmed === true || (opts.fundingConfirmed !== false && this.isFunder)),
      remoteSig: null,
      lastSigned: null,
      pending: null,
      rollback: null,
      intent: null,
      rolledBack: [],
      outbox: { update: null },
      remotePoints: {},
      remoteCommitments: {},
      remoteAlternates: {},
      revoked: {},
      revokedSecrets: {},
      localRevokedThrough: -1,
      remoteRevokedThrough: -1,
      lastTipHeight: null,
      onChain: null
    };
    if (feerate && opts.feeSats == null) this._state.feeSats = this._feeFor(feerate, 0);
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
  _recordExit (n, commitment, sigHex) {
    try {
      const signed = Channel.withCommitmentSignature(commitment.psbtBase64, sigHex, this.funding.remotePubkey, this.network);
      const id = String(n);
      if (!this.resolutions.stateIds.includes(id)) this.resolutions.declare(id, n > 0 && this.resolutions.stateIds.includes(String(n - 1)) ? String(n - 1) : null);
      this.resolutions.addExit(id, { id: 'commitment', kind: Resolutions.KINDS.COMMITMENT, psbtBase64: signed, required: [this.funding.remotePubkey], meta: { toSelfDelay: this.funding.toSelfDelay } });
    } catch (_) { /* exits are advisory bookkeeping; the session state stays authoritative */ }
  }

  /** @returns {boolean} the last countersigned state has a unilateral exit */
  get resolvable () {
    const ls = this._state.lastSigned;
    return !!ls && this.resolutions.resolvable(String(ls.number));
  }

  get state () { return this._state; }
  get number () { return this._state.number; }
  get status () { return this._state.status; }
  get policy () { return this._state.policy; }
  get feeSats () { return this._state.feeSats; }
  get feerate () { return this._state.feerate; }
  get balances () { return { localSats: this._state.localSats, remoteSats: this._state.remoteSats }; }
  /** Balance transfers sent and received (`{ amountSats, ref, direction, number }`), newest last. */
  get transfers () { return (this._state.transfers || []).map((t) => Object.assign({}, t)); }
  /** @returns {object|null} our latest commitment (holder = local) */
  get commitment () { return this._localCommitment; }
  /** @returns {object|null} `{ number, txid, sig, htlcs, localSats, remoteSats, feeSats }` — newest of our commitments the counterparty signed */
  get lastSignedCommitment () { return this._state.lastSigned; }
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

  /** @private commitment fee for a feerate and HTLC count (never below `minCommitFeeSats`) */
  _feeFor (feerate, htlcCount) {
    return Math.max(Number(this._state.policy.minCommitFeeSats) || 0, Channel.commitmentFeeSats(feerate, htlcCount));
  }

  /**
   * Valid `expireAfter` heights for a new HTLC at a tip.
   * @param {number} [tip] defaults to the session tip
   * @returns {{ min: number, max: number }|null} `null` when the tip is unknown
   */
  htlcExpiryBounds (tip = this._tipHeight()) {
    if (tip == null) return null;
    return {
      min: tip + Channel.minHtlcExpiryDelta(this),
      max: Number(this.funding.expireAfter.height) - Number(this.funding.toSelfDelay) - this._state.policy.closeMarginBlocks
    };
  }

  /**
   * A received HTLC may be fulfilled off-chain only while the funding is
   * confirmed and `expireAfter − tip > toSelfDelay + htlcSafetyBlocks`;
   * otherwise the receiver must claim on-chain. Offered HTLCs (the sender
   * settling with a preimage it learned) are always allowed.
   * @param {object} row HTLC row
   * @param {number} [tip]
   * @returns {boolean}
   */
  canFulfil (row, tip = this._tipHeight()) {
    if (!row || row.direction !== 'received') return true;
    if (!this._state.fundingConfirmed || tip == null) return false;
    return expireHeight(row) - tip > Number(this.funding.toSelfDelay) + this._state.policy.htlcSafetyBlocks;
  }

  /**
   * Remember a preimage for one of this channel's HTLCs (e.g. learned
   * downstream) so the watchdog can claim it on-chain.
   * @param {string} paymentHashHex
   * @param {string} preimageHex
   * @returns {boolean} stored
   */
  learnPreimage (paymentHashHex, preimageHex) {
    const pre = String(preimageHex || '').toLowerCase();
    const hash = paymentHashHex ? String(paymentHashHex).toLowerCase() : null;
    if (!HEX64.test(pre)) return false;
    const actual = sha256Hex(Buffer.from(pre, 'hex'));
    if (hash && actual !== hash) return false;
    const known = this._state.htlcs.concat(this._state.lastSigned ? this._state.lastSigned.htlcs : []);
    if (!known.some((h) => h.paymentHashHex === actual)) return false;
    this._preimages.set(actual, pre);
    return true;
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

  /**
   * @private sign the counterparty's commitment and remember it for justice.
   * A different commitment already signed for the same number (a proposal
   * abandoned in a collision) is kept as an alternate: the counterparty can
   * still broadcast it, and the same revocation secret revokes it.
   */
  _signRemote (htlcs, number, balances, feeSats) {
    const s = this._state;
    const c = this._buildRemote(htlcs, number, balances, feeSats);
    const sig = Channel.signCommitment(c.psbtBase64, this.localPrivateKey, this.network);
    const snapshot = this._stateFor(cloneHtlcs(htlcs), number, balances, feeSats);
    delete snapshot.fundedTxHex;
    const prev = s.remoteCommitments[number];
    if (prev && prev.txid !== c.txid) s.remoteAlternates[number] = (s.remoteAlternates[number] || []).concat([prev]);
    s.remoteCommitments[number] = { txid: c.txid, pointHex: c.holderPoint, state: snapshot };
    return { commitment: c, sig, sigHex: sigHexOf(sig, this.network) };
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

  /** @private the counterparty signature on our current commitment is accepted: remember it apart from any later proposal */
  _noteSigned () {
    const s = this._state;
    const c = this._localCommitment;
    s.lastSigned = { number: c.number, txid: c.txid, sig: s.remoteSig, htlcs: cloneHtlcs(s.htlcs), localSats: s.localSats, remoteSats: s.remoteSats, feeSats: s.feeSats, feerate: s.feerate || null };
    this._recordExit(c.number, c, s.remoteSig);
  }

  /** @private record a revealed counterparty secret for state `n` (idempotent) */
  _applyRemoteRevoke (n, revoke) {
    const s = this._state;
    if (!revoke || revoke.type !== CHANNEL_BODY_TYPES.Revoke || !Witness.verifyArtifact(revoke, xOnlyOf(this.funding.remotePubkey))) {
      throw new Error('revoke: signed ChannelRevoke artifact required');
    }
    if (Math.floor(Number(revoke.number)) !== n) throw new Error(`revoke: expected state ${n}, got ${revoke.number}`);
    const secret = String(revoke.perCommitmentSecret || '').toLowerCase();
    if (!HEX64.test(secret)) throw new Error('revoke: perCommitmentSecret must be 32-byte hex');
    const known = s.revokedSecrets[n];
    if (known) {
      if (known !== secret) throw new Error(`revoke: conflicting secret for state ${n}`);
      return;
    }
    const expectedPoint = s.remotePoints[n];
    if (!expectedPoint) throw new Error(`revoke: no per-commitment point known for state ${n}`);
    if (Channel.commitmentPoint(secret) !== expectedPoint) throw new Error('revoke: secret does not match the per-commitment point');
    const targets = [s.remoteCommitments[n]].concat(s.remoteAlternates[n] || []).filter(Boolean);
    if (revoke.commitmentTxid && targets.length && !targets.some((t) => t.txid === String(revoke.commitmentTxid))) throw new Error('revoke: names a commitment txid we did not sign');
    for (const rc of targets) s.revoked[rc.txid] = { number: n, perCommitmentSecretHex: secret, pointHex: rc.pointHex, state: rc.state, revoke };
    delete s.remoteCommitments[n];
    delete s.remoteAlternates[n];
    s.revokedSecrets[n] = secret;
    if (n > s.remoteRevokedThrough) s.remoteRevokedThrough = n;
  }

  /** @private signed revoke payload for our state `n` (no state change) */
  _revokeBody (n) {
    const s = this._state;
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

  /** @private revoke our own state `n` */
  _localRevoke (n) {
    const s = this._state;
    if (n < 0) return null;
    s.localRevokedThrough = Math.max(s.localRevokedThrough, n);
    return this._revokeBody(n);
  }

  /** @private remember our own commitment txid per state (for ChannelRevoke) */
  _rememberLocal (commitment) {
    const s = this._state;
    if (!s.localTxids) s.localTxids = {};
    s.localTxids[commitment.number] = commitment.txid;
    for (const k of Object.keys(s.localTxids)) if (Number(k) < commitment.number - 2) delete s.localTxids[k];
  }

  /**
   * Initial `ChannelOpen` body (funder): the funding record (public fields,
   * funding outpoint included), balances, our policy proposal and first two
   * per-commitment points. No commitment signature yet — see the class
   * description.
   * @returns {object}
   */
  open () {
    if (!this.isFunder) throw new Error('open: only the funder opens');
    const s = this._state;
    if (s.pending) throw new Error('open: already opening');
    if (s.feerate && s.feeSats !== this._feeFor(s.feerate, 0)) throw new Error(`open: fee ${s.feeSats} does not match ${s.feerate} sat/vB`);
    this._localCommitment = this._buildLocal([], 0);
    this._rememberLocal(this._localCommitment);
    s.pending = 'proposed';
    const funding = Object.assign({}, this.funding);
    delete funding._leaves;
    const body = this._body(CHANNEL_BODY_TYPES.Open, {
      funding,
      fundedTxHex: this.fundedTxHex,
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      localAddress: this.localAddress,
      remoteAddress: this.remoteAddress,
      feeSats: s.feeSats,
      feerate: s.feerate || null,
      policy: this.localPolicy,
      perCommitmentPoint: this._localPoint(0),
      nextPerCommitmentPoint: this._localPoint(1)
    });
    s.outbox.update = body;
    return body;
  }

  /** @private checks on a newly offered HTLC (local or remote proposer). */
  _checkHtlcPolicy (row, htlcs, proposerBalanceAfter, proposer) {
    const p = this._state.policy;
    const label = proposer === 'local' ? 'offerHtlc' : 'receive';
    const minimum = Math.max(HTLC_MINIMUM_SATS, Number(p.htlcMinimumSats) || 0);
    if (row.amountSats < minimum) throw new Error(`${label}: HTLC below htlcMinimumSats ${minimum}`);
    if (htlcs.length > p.maxAcceptedHtlcs) throw new Error(`${label}: maxAcceptedHtlcs ${p.maxAcceptedHtlcs} exceeded`);
    if (htlcs.some((h) => h.id !== row.id && h.paymentHashHex === row.paymentHashHex)) throw new Error(`${label}: duplicate paymentHash in flight`);
    const inFlight = htlcs.filter((h) => h.direction === row.direction).reduce((n, h) => n + h.amountSats, 0);
    if (inFlight > p.maxHtlcValueInFlightSats) throw new Error(`${label}: maxHtlcValueInFlightSats ${p.maxHtlcValueInFlightSats} exceeded`);
    if (proposerBalanceAfter < p.channelReserveSats) throw new Error(`${label}: balance would drop below channelReserveSats ${p.channelReserveSats}`);
    const tip = this._tipHeight();
    if (tip == null) throw new Error(`${label}: chain tip unknown or stale — refusing new HTLC`);
    const expire = expireHeight(row);
    if (!(expire > 0)) throw new Error(`${label}: HTLC expireAfter height required`);
    const delta = Channel.minHtlcExpiryDelta(this);
    if (expire - tip < delta) throw new Error(`${label}: HTLC expires too soon (expireAfter − tip = ${expire - tip} < ${delta}: toSelfDelay + closeMarginBlocks + htlcSafetyBlocks)`);
    const latest = Number(this.funding.expireAfter.height) - Number(this.funding.toSelfDelay) - p.closeMarginBlocks;
    if (expire > latest) throw new Error(`${label}: HTLC expiry ${expire} past channel expiry window (${latest})`);
  }

  /**
   * Offer an HTLC (pay for one chunk): moves `amountSats` from our balance
   * into a pending HTLC and returns the `ChannelCommitment` proposal.
   * `expireAfter − tip` must be at least {@link Channel.minHtlcExpiryDelta}.
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
    if (!HTLC_ID.test(id)) throw new Error('offerHtlc: invalid HTLC id');
    if (this._state.htlcs.some((h) => h.id === id)) throw new Error('offerHtlc: duplicate HTLC id');
    const row = { id, amountSats: amount, paymentHashHex, blobHashHex: htlc.blobHashHex || null, direction: 'offered', expireAfter: heightLock(htlc.expireAfter), forwardOf: htlc.forwardOf || null };
    const htlcs = this._state.htlcs.concat([row]);
    this._checkHtlcPolicy(row, htlcs, this._state.localSats - amount, 'local');
    return this._propose(htlcs, { localSats: this._state.localSats - amount, remoteSats: this._state.remoteSats }, { extra: { htlc: Object.assign({}, row) }, intent: { kind: 'offer', htlc: Object.assign({}, row) } });
  }

  /**
   * Pay the counterparty from our balance with no HTLC: the next commitment
   * just moves `amountSats` to them (pay-after-verify credit — nothing to
   * claim, refund, or settle on chain, so no HTLC minimum). No HTLC or fee
   * change rides along, and our balance must stay above the reserve.
   * @param {object} opts `{ amountSats, ref? }` — `ref` names what is paid
   * for and reaches the receiver; a `ref` already sent is refused.
   * @returns {object} `ChannelCommitment` proposal carrying `transfer`
   */
  transfer (opts = {}) {
    const s = this._state;
    if (s.status !== 'open') throw new Error(`transfer: channel ${s.status}`);
    if (this.busy) throw new Error('transfer: channel busy (previous update not yet revoked)');
    const amount = Number(opts.amountSats);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('transfer: amountSats must be a positive integer');
    const ref = transferRef(opts.ref, 'transfer');
    if (s.localSats - amount < s.policy.channelReserveSats) throw new Error(`transfer: balance would drop below channelReserveSats ${s.policy.channelReserveSats}`);
    if (ref && (s.transfers || []).some((t) => t.direction === 'sent' && t.ref === ref)) throw new Error(`transfer: ref ${ref} already paid`);
    const row = { amountSats: amount, ref };
    const body = this._propose(s.htlcs.slice(), { localSats: s.localSats - amount, remoteSats: s.remoteSats + amount }, {
      extra: { transfer: Object.assign({}, row) },
      intent: { kind: 'transfer', amountSats: amount, ref }
    });
    recordTransfer(s, Object.assign({ direction: 'sent', number: s.number }, row));
    return body;
  }

  /** @private funder's balance after a fee change must stay above the reserve */
  _checkFunderCovers (fee, label) {
    const s = this._state;
    const after = s.localSats - (fee - s.feeSats);
    if (after < 0 || after < s.policy.channelReserveSats) throw new Error(`${label}: funder cannot cover the fee above channelReserveSats ${s.policy.channelReserveSats}`);
  }

  /**
   * Propose a new fixed commitment fee (funder only; bounded by the
   * negotiated policy and never below `minFeerate` for the HTLC count; the
   * funder's balance absorbs the difference and must stay above the reserve).
   * @param {number} feeSats
   * @returns {object} `ChannelCommitment` proposal
   */
  updateFee (feeSats) {
    if (!this.isFunder) throw new Error('updateFee: only the funder sets the commitment fee');
    if (this.busy) throw new Error('updateFee: channel busy');
    const s = this._state;
    if (s.feerate) throw new Error('updateFee: channel uses a feerate — call updateFeerate');
    const fee = Math.floor(Number(feeSats) || 0);
    const p = s.policy;
    if (fee < p.minCommitFeeSats || fee > p.maxCommitFeeSats) throw new Error(`updateFee: fee must be within [${p.minCommitFeeSats}, ${p.maxCommitFeeSats}]`);
    const floor = Channel.commitmentFeeSats(p.minFeerate, s.htlcs.length);
    if (fee < floor) throw new Error(`updateFee: fee below ${p.minFeerate} sat/vB (${floor} sats for ${s.htlcs.length} HTLCs)`);
    this._checkFunderCovers(fee, 'updateFee');
    return this._propose(s.htlcs.slice(), { localSats: s.localSats, remoteSats: s.remoteSats }, { feeSats: fee, intent: { kind: 'fee', feeSats: fee } });
  }

  /**
   * Switch to / change a commitment feerate (funder only): the fee becomes
   * `feerate × estimated vsize` (HTLC outputs included) on every later state.
   * @param {number} satPerVb integer ≥ policy `minFeerate`
   * @returns {object} `ChannelCommitment` proposal
   */
  updateFeerate (satPerVb) {
    if (!this.isFunder) throw new Error('updateFeerate: only the funder sets the feerate');
    if (this.busy) throw new Error('updateFeerate: channel busy');
    const s = this._state;
    const rate = Math.floor(Number(satPerVb) || 0);
    if (!(rate >= s.policy.minFeerate)) throw new Error(`updateFeerate: feerate must be ≥ ${s.policy.minFeerate} sat/vB`);
    const fee = this._feeFor(rate, s.htlcs.length);
    if (fee > s.policy.maxCommitFeeSats) throw new Error(`updateFeerate: fee ${fee} above maxCommitFeeSats ${s.policy.maxCommitFeeSats}`);
    this._checkFunderCovers(fee, 'updateFeerate');
    return this._propose(s.htlcs.slice(), { localSats: s.localSats, remoteSats: s.remoteSats }, { feerate: rate, intent: { kind: 'fee', feerate: rate } });
  }

  /**
   * @private sign the counterparty's next commitment + build ours; emit the
   * proposal. `balances` exclude fee changes: the funder pays any delta.
   * @param {Object[]} htlcs
   * @param {Object} balances
   * @param {Object} [opts] `{ feeSats?, feerate?, extra?, intent?, type? }`
   */
  _propose (htlcs, balances, opts = {}) {
    const s = this._state;
    const p = s.policy;
    const number = s.number + 1;
    const feerate = opts.feerate !== undefined ? opts.feerate : s.feerate;
    const fee = feerate ? this._feeFor(feerate, htlcs.length) : (opts.feeSats != null ? opts.feeSats : s.feeSats);
    if (fee > p.maxCommitFeeSats && fee !== s.feeSats) throw new Error(`commitment fee ${fee} above maxCommitFeeSats ${p.maxCommitFeeSats}`);
    if (!feerate && htlcs.length > s.htlcs.length && fee < Channel.commitmentFeeSats(p.minFeerate, htlcs.length)) {
      throw new Error(`commitment fee ${fee} below ${p.minFeerate} sat/vB for ${htlcs.length} HTLCs (raise it with updateFee)`);
    }
    const b = { localSats: balances.localSats, remoteSats: balances.remoteSats };
    const delta = fee - s.feeSats;
    if (this.isFunder) b.localSats -= delta; else b.remoteSats -= delta;
    if (b.localSats < 0 || b.remoteSats < 0) throw new Error('funder cannot cover the fee');
    const rollback = { number: s.number, htlcs: cloneHtlcs(s.htlcs), localSats: s.localSats, remoteSats: s.remoteSats, feeSats: s.feeSats, feerate: s.feerate || null, settledLength: s.settled.length, status: s.status };
    const remote = this._signRemote(htlcs, number, b, fee);
    const local = this._buildLocal(htlcs, number, b, fee);
    s.rollback = rollback;
    s.intent = opts.intent || null;
    s.htlcs = htlcs;
    s.localSats = b.localSats;
    s.remoteSats = b.remoteSats;
    s.feeSats = fee;
    s.feerate = feerate || null;
    s.number = number;
    s.remoteSig = null;
    s.pending = 'proposed';
    this._localCommitment = local;
    this._rememberLocal(local);
    const body = this._body(opts.type || CHANNEL_BODY_TYPES.Commitment, Object.assign({
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: fee,
      feerate: s.feerate,
      htlcs: htlcs.map((h) => Object.assign({}, h)),
      commitmentTxid: remote.commitment.txid,
      signatureHex: remote.sigHex,
      psbtBase64: remote.sig,
      nextPerCommitmentPoint: this._localPoint(number + 1)
    }, opts.extra || {}));
    s.outbox.update = body;
    return body;
  }

  /**
   * @private abandon our unanswered proposal (lost a simultaneous-proposal
   * tie-break): restore the last countersigned state and queue the intent for
   * {@link ChannelSession#repropose}.
   */
  _rollback () {
    const s = this._state;
    const r = s.rollback;
    if (!r || !s.pending) throw new Error('rollback: no proposal to roll back');
    s.number = r.number;
    s.htlcs = cloneHtlcs(r.htlcs);
    s.localSats = r.localSats;
    s.remoteSats = r.remoteSats;
    s.feeSats = r.feeSats;
    s.feerate = r.feerate || null;
    s.settled = s.settled.slice(0, r.settledLength);
    s.transfers = (s.transfers || []).filter((t) => t.number <= r.number);
    s.status = r.status;
    s.pending = null;
    s.remoteSig = s.lastSigned && s.lastSigned.number === r.number ? s.lastSigned.sig : null;
    this._localCommitment = this._buildLocal(s.htlcs, s.number, r, r.feeSats);
    this._rememberLocal(this._localCommitment);
    if (s.intent) s.rolledBack.push(s.intent);
    s.rollback = null;
    s.intent = null;
    s.outbox.update = null;
  }

  /**
   * Replay the first intent abandoned in a simultaneous-proposal tie-break
   * (offer / fulfill / fail / fee / transfer / close). Intents that no longer apply are
   * dropped into `state.droppedIntents`.
   * @returns {object|null} new proposal body, or `null`
   */
  repropose () {
    const s = this._state;
    if (this.busy) return null;
    while (s.rolledBack.length) {
      const intent = s.rolledBack.shift();
      try {
        switch (intent.kind) {
          case 'offer': return this.offerHtlc(intent.htlc);
          case 'fulfill': return this.fulfillHtlc(intent.id, intent.preimageHex);
          case 'fail': return this.failHtlc(intent.id, intent.reason);
          case 'fee': return intent.feerate ? this.updateFeerate(intent.feerate) : this.updateFee(intent.feeSats);
          case 'transfer': return this.transfer({ amountSats: intent.amountSats, ref: intent.ref });
          case 'close': return this.close();
          default: throw new Error(`unknown intent ${intent.kind}`);
        }
      } catch (e) {
        s.droppedIntents = (s.droppedIntents || []).concat([Object.assign({}, intent, { error: e.message })]).slice(-20);
      }
    }
    return null;
  }

  /**
   * Validate a counterparty proposal against our previous state: only the
   * transitions the protocol allows (they add HTLCs funded from their own
   * balance; HTLCs leave only through a settlement we can check; fee changes
   * come from the funder, or follow the feerate) and the resulting balances
   * must match exactly.
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
          if (this._preimages.has(h.paymentHashHex)) throw new Error('receive: counterparty failed an HTLC whose preimage we hold — claim it instead');
          remote += h.amountSats;
        } else {
          local += h.amountSats;
        }
      }
    }
    const p = this._state.policy;
    if (ctx.transfer) {
      // A balance transfer from the proposer: nothing else changes.
      const amount = Number(ctx.transfer.amountSats);
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('receive: transfer amountSats must be a positive integer');
      if (next.htlcs.length !== prev.htlcs.length || next.htlcs.some((h) => !prevById.has(h.id))) throw new Error('receive: a transfer cannot change HTLCs');
      if (next.feeSats !== prev.feeSats || (next.feerate || null) !== (prev.feerate || null)) throw new Error('receive: a transfer cannot change the commitment fee');
      remote -= amount;
      local += amount;
      if (remote < p.channelReserveSats) throw new Error(`receive: transfer would drop the counterparty below channelReserveSats ${p.channelReserveSats}`);
    }
    const prevRate = prev.feerate || null;
    const nextRate = next.feerate || null;
    if (nextRate !== prevRate) {
      if (this.isFunder) throw new Error('receive: only the funder may change the feerate');
      if (nextRate != null && !(Number.isSafeInteger(nextRate) && nextRate >= p.minFeerate)) throw new Error(`receive: feerate must be an integer ≥ ${p.minFeerate} sat/vB`);
    }
    if (nextRate) {
      const expected = this._feeFor(nextRate, next.htlcs.length);
      if (next.feeSats !== expected) throw new Error(`receive: commitment fee ${next.feeSats} does not follow ${nextRate} sat/vB (${expected})`);
      if (next.feeSats > p.maxCommitFeeSats) throw new Error('receive: fee outside negotiated bounds');
    } else if (next.feeSats !== prev.feeSats) {
      if (this.isFunder) throw new Error('receive: only the funder may change the commitment fee');
      if (next.feeSats < p.minCommitFeeSats || next.feeSats > p.maxCommitFeeSats) throw new Error('receive: fee outside negotiated bounds');
    }
    if (!nextRate && next.htlcs.length > prev.htlcs.length && next.feeSats < Channel.commitmentFeeSats(p.minFeerate, next.htlcs.length)) {
      throw new Error(`receive: commitment fee ${next.feeSats} below ${p.minFeerate} sat/vB for ${next.htlcs.length} HTLCs`);
    }
    const feeDelta = next.feeSats - prev.feeSats;
    if (this.isFunder) local -= feeDelta; else remote -= feeDelta;
    if (local !== next.localSats || remote !== next.remoteSats) {
      throw new Error(`receive: balances do not follow from the previous state (expected ${local}/${remote}, got ${next.localSats}/${next.remoteSats})`);
    }
  }

  /**
   * @private an update for a state we already hold countersigned: a replay /
   * resend, or a proposal the peer abandoned in a tie-break arriving late.
   */
  _isDuplicate (body) {
    const s = this._state;
    if (!body || (body.type !== CHANNEL_BODY_TYPES.Commitment && body.type !== CHANNEL_BODY_TYPES.Close)) return false;
    const n = Math.floor(Number(body.number));
    if (!Number.isFinite(n)) return false;
    if (n < s.number) return true;
    return n === s.number && !s.pending && !!s.lastSigned && s.lastSigned.number === n;
  }

  /** @private a counterparty proposal for the same state number as our unanswered one */
  _collides (body) {
    const s = this._state;
    if (!body || (body.type !== CHANNEL_BODY_TYPES.Commitment && body.type !== CHANNEL_BODY_TYPES.Close)) return false;
    if (s.pending !== 'proposed' || !this._localCommitment || s.number === 0) return false;
    if (Math.floor(Number(body.number)) !== s.number) return false;
    return !(body.commitmentTxid === this._localCommitment.txid && body.revoke);
  }

  /**
   * Ingest a counterparty `ChannelOpen` / `ChannelCommitment` / `ChannelClose`
   * / `ChannelRevoke` / `ChannelReestablish`. Returns the body we must send
   * back (countersignature with inline revoke, `ChannelRevoke`, or `null`) —
   * an array of bodies for `ChannelReestablish`.
   * @param {object} body signed artifact from the peer
   * @param {object} [ctx] `{ settlement }` from {@link ChannelSession#receiveSettlement}
   * @returns {object|object[]|null}
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
      case CHANNEL_BODY_TYPES.Reestablish:
        return this.handleReestablish(body);
      case CHANNEL_BODY_TYPES.Commitment:
      case CHANNEL_BODY_TYPES.Close:
        break;
      default:
        throw new Error(`receive: unexpected type ${body.type}`);
    }
    if (this._isDuplicate(body)) return null;
    // Reply / ack to a state we proposed.
    if (s.pending === 'proposed' && number === s.number && this._localCommitment && body.commitmentTxid === this._localCommitment.txid && (number === 0 || body.revoke)) {
      return this._receiveCountersignature(body);
    }
    if (this._collides(body)) {
      // Simultaneous proposals: the funder's wins.
      if (this.isFunder) return null;
      this._rollback();
    }
    if (s.pending) throw new Error('receive: channel busy (our proposal is unanswered)');
    if (number !== s.number + 1) throw new Error(`receive: expected state ${s.number + 1}, got ${number}`);
    if (s.remoteRevokedThrough < s.number - 1) throw new Error(`receive: counterparty has not revoked state ${s.number - 1}`);
    if (body.type === CHANNEL_BODY_TYPES.Close && (body.htlcs || []).length) throw new Error('receive: close with pending HTLCs');
    if (s.status !== 'open' && !(s.status === 'pending' && body.type === CHANNEL_BODY_TYPES.Close)) {
      throw new Error(`receive: channel ${s.status}`);
    }
    validateHtlcRows(body.htlcs || [], 'receive');
    const htlcs = cloneHtlcs(body.htlcs).map((h) => Object.assign(h, { direction: h.direction === 'offered' ? 'received' : 'offered' }));
    const next = {
      localSats: Math.floor(Number(body.remoteSats) || 0),
      remoteSats: Math.floor(Number(body.localSats) || 0),
      feeSats: body.feeSats != null ? Math.floor(Number(body.feeSats)) : s.feeSats,
      feerate: body.feerate !== undefined ? (body.feerate == null ? null : Number(body.feerate)) : (s.feerate || null),
      htlcs
    };
    let transfer = null;
    if (body.transfer != null) {
      if (body.type !== CHANNEL_BODY_TYPES.Commitment || typeof body.transfer !== 'object') throw new Error('receive: transfer only rides a ChannelCommitment');
      transfer = { amountSats: Number(body.transfer.amountSats), ref: transferRef(body.transfer.ref, 'receive') };
    }
    this._validateTransition({ localSats: s.localSats, remoteSats: s.remoteSats, feeSats: s.feeSats, feerate: s.feerate || null, htlcs: s.htlcs }, next, Object.assign({}, ctx, { transfer }));
    let local;
    try {
      local = this._buildLocal(htlcs, number, next, next.feeSats);
    } catch (e) {
      throw new Error(`receive: counterparty state invalid (${e.message})`);
    }
    if (body.commitmentTxid !== local.txid) throw new Error('receive: counterparty signed a commitment that does not match the derived state');
    const check = Channel.verifyCommitmentSignature(local.psbtBase64, body.signatureHex || body.psbtBase64, this.funding.remotePubkey, this.network);
    if (!check.ok) throw new Error(`receive: ${check.reason}`);
    if (!body.nextPerCommitmentPoint) throw new Error('receive: nextPerCommitmentPoint missing');
    const remote = this._signRemote(htlcs, number, next, next.feeSats);
    this._notePoint(number + 1, body.nextPerCommitmentPoint);
    s.htlcs = htlcs;
    s.localSats = next.localSats;
    s.remoteSats = next.remoteSats;
    s.feeSats = next.feeSats;
    s.feerate = next.feerate || null;
    s.number = number;
    s.remoteSig = check.signatureHex;
    this._localCommitment = local;
    this._noteSigned();
    this._rememberLocal(local);
    if (transfer) recordTransfer(s, Object.assign({ direction: 'received', number }, transfer));
    if (body.type === CHANNEL_BODY_TYPES.Close) s.status = 'closing';
    s.rollback = null;
    s.intent = null;
    const revoke = this._localRevoke(number - 1);
    const reply = this._body(body.type === CHANNEL_BODY_TYPES.Close ? CHANNEL_BODY_TYPES.Close : CHANNEL_BODY_TYPES.Commitment, {
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: s.feeSats,
      feerate: s.feerate,
      htlcs: htlcs.map((h) => Object.assign({}, h)),
      commitmentTxid: remote.commitment.txid,
      signatureHex: remote.sigHex,
      psbtBase64: remote.sig,
      revoke,
      nextPerCommitmentPoint: this._localPoint(number + 1)
    });
    s.outbox.update = reply;
    return reply;
  }

  /** @private */
  _notePoint (n, pointHex) {
    const p = compressedOrThrow('perCommitmentPoint', pointHex);
    const s = this._state;
    if (s.remotePoints[n] && s.remotePoints[n] !== p) throw new Error(`receive: counterparty changed its per-commitment point for state ${n}`);
    s.remotePoints[n] = p;
    for (const k of Object.keys(s.remotePoints)) if (Number(k) < s.remoteRevokedThrough) delete s.remotePoints[k];
  }

  /**
   * @private non-funder side of `ChannelOpen`. Refuses delays outside the
   * local `[minToSelfDelay, maxToSelfDelay]`, channels expiring within
   * `minChannelLifetimeBlocks`, malleable (non-segwit) funding inputs, and a
   * declared capacity that is not the funding output value.
   */
  _receiveOpen (body) {
    const s = this._state;
    if (this.isFunder) throw new Error('receive: funder received a ChannelOpen');
    if (s.number !== 0 || s.pending || this._localCommitment) {
      // Duplicate open (funder resent after a reconnect): resend our reply while unacked.
      return s.pending && s.outbox.update ? s.outbox.update : null;
    }
    if (!body.perCommitmentPoint || !body.nextPerCommitmentPoint) throw new Error('receive: ChannelOpen without per-commitment points');
    const lp = this.localPolicy;
    const d = CHANNEL_DEFAULTS;
    const num = (v, dflt) => (v == null || !Number.isFinite(Number(v)) ? dflt : Math.floor(Number(v)));
    const toSelfDelay = Number(this.funding.toSelfDelay);
    const minDelay = num(lp.minToSelfDelay, d.minToSelfDelay);
    const maxDelay = num(lp.maxToSelfDelay, d.maxToSelfDelay);
    if (toSelfDelay < minDelay || toSelfDelay > maxDelay) throw new Error(`receive: toSelfDelay ${toSelfDelay} outside [${minDelay}, ${maxDelay}]`);
    const tip = this._tipHeight();
    if (tip == null) throw new Error('receive: chain tip unknown — cannot check the channel lifetime');
    const lifetime = num(lp.minChannelLifetimeBlocks, d.minChannelLifetimeBlocks);
    if (Number(this.funding.expireAfter.height) - tip < lifetime) throw new Error(`receive: channel expires within ${lifetime} blocks (expireAfter ${this.funding.expireAfter.height}, tip ${tip})`);
    assertSegwitFunding(this.fundedTxHex);
    if (this.funding.capacitySats != null && this.fundingValue !== Number(this.funding.capacitySats)) throw new Error(`receive: capacitySats ${this.funding.capacitySats} is not the funding output value ${this.fundingValue}`);
    this._notePoint(0, body.perCommitmentPoint);
    this._notePoint(1, body.nextPerCommitmentPoint);
    s.policy = Channel.negotiatePolicy(this.localPolicy, body.policy || {}, this.funding.capacitySats || 0);
    s.feeSats = Math.floor(Number(body.feeSats || s.feeSats));
    s.feerate = body.feerate != null && Number(body.feerate) > 0 ? Number(body.feerate) : null;
    if (s.feerate != null) {
      if (!(Number.isSafeInteger(s.feerate) && s.feerate >= s.policy.minFeerate)) throw new Error(`receive: feerate must be an integer ≥ ${s.policy.minFeerate} sat/vB`);
      if (s.feeSats !== this._feeFor(s.feerate, 0)) throw new Error(`receive: opening fee does not follow ${s.feerate} sat/vB`);
    }
    if (s.feeSats < s.policy.minCommitFeeSats || s.feeSats > s.policy.maxCommitFeeSats) throw new Error('receive: opening fee outside negotiated bounds');
    s.localSats = Math.floor(Number(body.remoteSats) || 0);
    s.remoteSats = Math.floor(Number(body.localSats) || 0);
    if (s.localSats !== 0) throw new Error('receive: non-funder must open with a zero balance');
    const remote = this._signRemote([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
    this._localCommitment = this._buildLocal([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
    this._rememberLocal(this._localCommitment);
    s.pending = 'proposed';
    const reply = this._body(CHANNEL_BODY_TYPES.Commitment, {
      localSats: s.localSats,
      remoteSats: s.remoteSats,
      feeSats: s.feeSats,
      feerate: s.feerate,
      htlcs: [],
      policy: s.policy,
      commitmentTxid: remote.commitment.txid,
      signatureHex: remote.sigHex,
      psbtBase64: remote.sig,
      perCommitmentPoint: this._localPoint(0),
      nextPerCommitmentPoint: this._localPoint(1)
    });
    s.outbox.update = reply;
    return reply;
  }

  /** @private the counterparty signed the state we proposed */
  _receiveCountersignature (body) {
    const s = this._state;
    const check = Channel.verifyCommitmentSignature(this._localCommitment.psbtBase64, body.signatureHex || body.psbtBase64, this.funding.remotePubkey, this.network);
    if (!check.ok) throw new Error(`receive: ${check.reason}`);
    if (s.number === 0 && body.perCommitmentPoint) {
      // Reply to our ChannelOpen: learn their points + negotiated policy, then ack with our signature on their commitment #0.
      const negotiated = Channel.negotiatePolicy(this.localPolicy, body.policy || {}, this.funding.capacitySats || 0);
      const theirs = Channel.negotiatePolicy(body.policy || {}, {}, this.funding.capacitySats || 0);
      for (const k of Object.keys(negotiated)) if (theirs[k] !== negotiated[k]) throw new Error(`receive: counterparty policy ${k} is not the stricter negotiation`);
      s.policy = negotiated;
      this._notePoint(0, body.perCommitmentPoint);
      if (body.nextPerCommitmentPoint) this._notePoint(1, body.nextPerCommitmentPoint);
      s.remoteSig = check.signatureHex;
      this._noteSigned();
      const remote = this._signRemote([], 0, { localSats: s.localSats, remoteSats: s.remoteSats }, s.feeSats);
      s.pending = null;
      this._refreshStatus();
      const ack = this._body(CHANNEL_BODY_TYPES.Commitment, { commitmentTxid: remote.commitment.txid, signatureHex: remote.sigHex, psbtBase64: remote.sig, nextPerCommitmentPoint: this._localPoint(1) });
      s.outbox.update = ack;
      return ack;
    }
    if (s.number > 0) {
      if (!body.revoke || Number(body.revoke.number) !== s.number - 1) throw new Error(`receive: countersignature must revoke state ${s.number - 1}`);
      this._applyRemoteRevoke(s.number - 1, body.revoke);
    }
    s.remoteSig = check.signatureHex;
    this._noteSigned();
    if (body.nextPerCommitmentPoint) this._notePoint(s.number + 1, body.nextPerCommitmentPoint);
    s.pending = null;
    s.rollback = null;
    s.intent = null;
    if (s.number === 0) {
      // Ack on our reply to ChannelOpen.
      this._refreshStatus();
      return null;
    }
    if (body.type === CHANNEL_BODY_TYPES.Close || s.status === 'closing') s.status = 'closing';
    return this._localRevoke(s.number - 1);
  }

  /** @private poll the confirmations source for the funding depth */
  _pollFunding () {
    const s = this._state;
    if (s.fundingConfirmed || !this._confirmations || !this.funding.fundingTxid) return;
    const n = Number(this._confirmations(this.funding.fundingTxid));
    if (Number.isFinite(n) && n >= this.minFundingConfirmations) s.fundingConfirmed = true;
  }

  /** @private */
  _refreshStatus () {
    const s = this._state;
    if (s.status === 'closing' || s.status === 'closed') return;
    this._pollFunding();
    if (!s.lastSigned) { s.status = 'opening'; return; }
    s.status = s.fundingConfirmed ? 'open' : 'pending';
  }

  /**
   * Settle an HTLC with its preimage: the amount moves to the **receiver's**
   * balance and the proposal carries the preimage. Normally the receiver
   * reveals; the sender may also settle an HTLC it offered once it learned
   * the preimage elsewhere (e.g. the seller's public key reveal) — that only
   * ever pays the counterparty.
   *
   * The receiver reveals only while {@link ChannelSession#canFulfil}: once
   * the preimage is out, a sender that withholds its countersignature forces
   * the receiver on-chain, where the receiver's claim is CSV-delayed by
   * `toSelfDelay` on its own commitment. The sender's timeout there waits
   * `toSelfDelay + htlcClaimWindowBlocks`, and on the sender's commitment the
   * receiver claims immediately, so a fulfill with that margin cannot be
   * raced. Too close to expiry the preimage is only remembered and the
   * watchdog ({@link ChannelSession#tick}) asks the host to claim on-chain.
   * @param {string} id
   * @param {string} preimageHex
   * @returns {object} `ChannelHtlcFulfill` body (+ the new commitment via `commitment`)
   */
  fulfillHtlc (id, preimageHex) {
    const s = this._state;
    const row = s.htlcs.find((h) => h.id === String(id));
    if (!row) throw new Error('fulfillHtlc: unknown HTLC');
    const pre = String(preimageHex || '').toLowerCase();
    if (!HEX64.test(pre) || sha256Hex(Buffer.from(pre, 'hex')) !== row.paymentHashHex) throw new Error('fulfillHtlc: preimage does not match');
    if (row.direction === 'received') {
      this._preimages.set(row.paymentHashHex, pre);
      if (!s.fundingConfirmed) throw new Error('fulfillHtlc: funding not confirmed');
      if (!this.canFulfil(row)) throw new Error(`fulfillHtlc: HTLC ${row.id} expires too soon to settle off-chain (needs expireAfter − tip > toSelfDelay + htlcSafetyBlocks) — claim it on-chain`);
    }
    if (this.busy) throw new Error('fulfillHtlc: channel busy');
    this._preimages.set(row.paymentHashHex, pre);
    const rest = s.htlcs.filter((h) => h.id !== row.id);
    const balances = { localSats: s.localSats, remoteSats: s.remoteSats };
    if (row.direction === 'received') balances.localSats += row.amountSats; else balances.remoteSats += row.amountSats;
    const commitment = this._propose(rest, balances, { intent: { kind: 'fulfill', id: row.id, preimageHex: pre } });
    s.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, direction: row.direction, outcome: 'fulfilled', forwardOf: row.forwardOf || null });
    const body = this._body(CHANNEL_BODY_TYPES.HtlcFulfill, { htlcId: row.id, preimageHex: pre, commitment });
    s.outbox.update = body;
    return body;
  }

  /**
   * Fail an HTLC: the receiver may fail a received HTLC at any time; the
   * sender may fail its own offered HTLC only once expired at the known tip.
   * @param {string} id
   * @param {string} [reason]
   * @returns {object} `ChannelHtlcFail` body
   */
  failHtlc (id, reason = 'failed') {
    const s = this._state;
    const row = s.htlcs.find((h) => h.id === String(id));
    if (!row) throw new Error('failHtlc: unknown HTLC');
    if (this.busy) throw new Error('failHtlc: channel busy');
    if (row.direction === 'offered') {
      const tip = this._tipHeight();
      if (tip == null) throw new Error('failHtlc: chain tip unknown — cannot prove the offered HTLC expired');
      if (expireHeight(row) > tip) throw new Error('failHtlc: offered HTLC not yet expired');
    }
    const balances = { localSats: s.localSats, remoteSats: s.remoteSats };
    if (row.direction === 'offered') balances.localSats += row.amountSats; else balances.remoteSats += row.amountSats;
    const commitment = this._propose(s.htlcs.filter((h) => h.id !== row.id), balances, { intent: { kind: 'fail', id: row.id, reason } });
    s.settled.push({ id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, direction: row.direction, outcome: 'failed', reason, forwardOf: row.forwardOf || null });
    const body = this._body(CHANNEL_BODY_TYPES.HtlcFail, { htlcId: row.id, reason, commitment });
    s.outbox.update = body;
    return body;
  }

  /**
   * Apply a counterparty `ChannelHtlcFulfill` / `ChannelHtlcFail` body.
   * @param {object} body
   * @returns {object|null} our countersignature body
   */
  receiveSettlement (body = {}) {
    const remoteX = xOnlyOf(this.funding.remotePubkey);
    if (!Witness.verifyArtifact(body, remoteX)) throw new Error('receiveSettlement: bad signature');
    if (body.channelId !== this.channelId) throw new Error('receiveSettlement: channel id mismatch');
    const c = body.commitment;
    if (!c || typeof c !== 'object' || c.channelId !== this.channelId) throw new Error('receiveSettlement: commitment for another channel');
    if (!Witness.verifyArtifact(c, remoteX)) throw new Error('receiveSettlement: bad commitment signature');
    const fulfil = body.type === CHANNEL_BODY_TYPES.HtlcFulfill;
    if (!fulfil && body.type !== CHANNEL_BODY_TYPES.HtlcFail) throw new Error(`receiveSettlement: unexpected type ${body.type}`);
    const pre = fulfil ? String(body.preimageHex || '').toLowerCase() : null;
    if (this._isDuplicate(c)) {
      if (fulfil) this.learnPreimage(null, pre);
      return null;
    }
    if (this._collides(c)) {
      if (this.isFunder) {
        if (fulfil) this.learnPreimage(null, pre);
        return null;
      }
      this._rollback();
    }
    const row = this._state.htlcs.find((h) => h.id === String(body.htlcId));
    if (!row) throw new Error('receiveSettlement: unknown HTLC');
    const settled = { id: row.id, blobHashHex: row.blobHashHex, amountSats: row.amountSats, paymentHashHex: row.paymentHashHex, direction: row.direction, forwardOf: row.forwardOf || null };
    if (fulfil) {
      if (!HEX64.test(pre) || sha256Hex(Buffer.from(pre, 'hex')) !== row.paymentHashHex) throw new Error('receiveSettlement: preimage mismatch');
      const reply = this.receive(c, { settlement: { id: row.id, outcome: 'fulfilled' } });
      this._preimages.set(row.paymentHashHex, pre);
      this._state.settled.push(Object.assign(settled, { outcome: 'fulfilled' }));
      return reply;
    }
    const reply = this.receive(c, { settlement: { id: row.id, outcome: 'failed' } });
    this._state.settled.push(Object.assign(settled, { outcome: 'failed', reason: body.reason || null }));
    return reply;
  }

  /**
   * Dispatch any inbound `Channel*` body to the right handler.
   * @param {object} body
   * @param {object} [ctx]
   * @returns {object|object[]|null} reply body (array for `ChannelReestablish`)
   */
  ingest (body = {}, ctx = {}) {
    if (body.type === CHANNEL_BODY_TYPES.HtlcFulfill || body.type === CHANNEL_BODY_TYPES.HtlcFail) return this.receiveSettlement(body);
    return this.receive(body, ctx);
  }

  /**
   * `ChannelReestablish` body for a reconnect: our state number, the newest
   * of our commitments the peer has signed, and how far each side's states
   * are revoked. The peer answers with {@link ChannelSession#handleReestablish}.
   * @returns {object}
   */
  reestablish () {
    const s = this._state;
    return this._body(CHANNEL_BODY_TYPES.Reestablish, {
      lastSignedNumber: s.lastSigned ? s.lastSigned.number : -1,
      localRevokedThrough: s.localRevokedThrough,
      remoteRevokedThrough: s.remoteRevokedThrough,
      pending: !!s.pending
    });
  }

  /**
   * Answer a peer's `ChannelReestablish`: resend the revocations it has not
   * seen and, when it lacks a signature on our current state number, our last
   * update (proposal, countersignature, or settlement) for that state.
   * @param {object} body verified `ChannelReestablish`
   * @returns {object[]} bodies to send, in order
   */
  handleReestablish (body = {}) {
    const s = this._state;
    const out = [];
    const int = (v) => (v == null || !Number.isFinite(Number(v)) ? -1 : Math.floor(Number(v)));
    const theirRemoteRevoked = int(body.remoteRevokedThrough);
    for (let n = Math.max(0, theirRemoteRevoked + 1, s.localRevokedThrough - 2); n <= s.localRevokedThrough; n++) out.push(this._revokeBody(n));
    const update = s.outbox && s.outbox.update;
    if (update && int(body.lastSignedNumber) < s.number && bodyNumber(update) === s.number) out.push(update);
    return out;
  }

  /**
   * Chain-time watchdog. Polls funding confirmations, settles what it can
   * off-chain (fulfill received HTLCs whose preimage is known while the margin
   * allows; fail expired received HTLCs without one; fail expired offered
   * HTLCs) and returns the on-chain **actions** the host must take:
   *
   * - `{ type: 'forceClose', channelId, reason: 'channel-expiry'|'htlc-claim'|'htlc-timeout', deadline, tip }`
   *   — at `expireAfter − toSelfDelay − closeMarginBlocks` for the channel, when
   *   a received HTLC with a known preimage can no longer be fulfilled
   *   off-chain, or `htlcSafetyBlocks` after an offered HTLC expired unresolved;
   * - `{ type: 'claimHtlc', channelId, htlcId, paymentHashHex, preimageHex, amountSats, expireAfter, deadline }`
   *   ({@link Channel.prepareHtlcClaim});
   * - `{ type: 'timeoutHtlc', channelId, htlcId, paymentHashHex, amountSats, expireAfter }`
   *   ({@link Channel.prepareHtlcTimeout}).
   *
   * HTLCs are taken from the current state and the last countersigned one, so
   * an HTLC removed by a round still in flight is watched until it completes.
   * @param {number} [tipHeight] defaults to the session tip
   * @returns {{ bodies: object[], timeouts: object[], actions: object[], status: string }}
   */
  tick (tipHeight) {
    const s = this._state;
    let tip = Math.floor(Number(tipHeight) || 0);
    if (!(tip > 0)) tip = this._tipHeight() || 0;
    if (tip > 0) s.lastTipHeight = tip;
    this._refreshStatus();
    const bodies = [];
    const timeouts = [];
    const actions = [];
    if (!(tip > 0)) return { bodies, timeouts, actions, status: s.status };
    const id = this.channelId;
    const delay = Number(this.funding.toSelfDelay);
    const safety = s.policy.htlcSafetyBlocks;
    const live = s.status === 'open';
    const onChain = !!s.onChain;
    const rows = new Map();
    for (const h of (s.lastSigned ? s.lastSigned.htlcs : [])) rows.set(h.id, h);
    for (const h of s.htlcs) rows.set(h.id, h);
    let force = null;
    for (const h of rows.values()) {
      const expire = expireHeight(h);
      const current = s.htlcs.find((x) => x.id === h.id);
      const base = { channelId: id, htlcId: h.id, paymentHashHex: h.paymentHashHex, amountSats: h.amountSats, expireAfter: expire };
      if (h.direction === 'received') {
        const pre = this._preimages.get(h.paymentHashHex);
        if (pre) {
          if (!onChain && current && live && !this.busy && this.canFulfil(current, tip)) {
            try { bodies.push(this.fulfillHtlc(h.id, pre)); continue; } catch (_) { /* fall through to the on-chain path */ }
          }
          if (onChain || expire - tip <= delay + safety) {
            actions.push(Object.assign({ type: 'claimHtlc', preimageHex: pre, deadline: expire }, base));
            if (!force) force = { reason: 'htlc-claim', deadline: expire };
          }
        } else if (current && live && !this.busy && expire <= tip) {
          try { bodies.push(this.failHtlc(h.id, 'expired')); } catch (_) { /* busy */ }
        }
        continue;
      }
      if (expire > tip) continue;
      timeouts.push(Object.assign({}, h, { expired: true }));
      if (!onChain && current && live && !this.busy) {
        try { bodies.push(this.failHtlc(h.id, 'expired')); continue; } catch (_) { /* busy */ }
      }
      if (onChain || tip >= expire + safety) {
        actions.push(Object.assign({ type: 'timeoutHtlc' }, base));
        if (!force) force = { reason: 'htlc-timeout', deadline: expire + safety };
      }
    }
    const closeBy = Number(this.funding.expireAfter.height) - delay - s.policy.closeMarginBlocks;
    if (!force && s.lastSigned && s.status !== 'closing' && tip >= closeBy) force = { reason: 'channel-expiry', deadline: Number(this.funding.expireAfter.height) };
    if (force && !onChain) actions.unshift({ type: 'forceClose', channelId: id, reason: force.reason, deadline: force.deadline, tip });
    return { bodies, timeouts, actions, status: s.status };
  }

  /**
   * Classify an observed on-chain transaction: our/their latest commitment,
   * a **stale** (revoked) counterparty commitment — returning a signed
   * justice transaction and a `FraudProof` — or an HTLC spend whose witness
   * reveals preimages we are owed.
   * @param {string} txHex
   * @param {object} [opts] `{ destinationAddress?, feeSats?, excludeVouts?, perOutput?, inclusion?: { blockHeaderHex, txids } }` — `excludeVouts` skips stale outputs already spent; `perOutput` also returns one justice tx per output (`justiceSpends`); `inclusion` lets a stale-commitment proof carry an SPV branch binding the broadcast to a block header
   * @returns {object} `{ kind, txid, justice?, justiceSpends?, fraudProof?, preimages? }`
   */
  observe (txHex, opts = {}) {
    const tx = bitcoin.Transaction.fromHex(String(txHex).trim());
    const txid = tx.getId();
    const s = this._state;
    const fundingTxid = this.funding.fundingTxid || (this._localCommitment ? this._localCommitment.fundingTxid : bitcoin.Transaction.fromHex(this.fundedTxHex).getId());
    const fundingVout = this.funding.fundingVout != null ? Number(this.funding.fundingVout) : null;
    const spendsFunding = tx.ins.some((i) => Buffer.from(i.hash).reverse().toString('hex') === fundingTxid && (fundingVout == null || i.index === fundingVout));
    if (spendsFunding) {
      const mark = (kind, number) => { s.status = 'closing'; s.onChain = { txid, kind, number }; };
      if ((this._localCommitment && txid === this._localCommitment.txid) || (s.lastSigned && txid === s.lastSigned.txid)) {
        mark('local-latest', s.lastSigned && txid === s.lastSigned.txid ? s.lastSigned.number : s.number);
        return { kind: 'local-latest', txid };
      }
      const current = Object.entries(s.remoteCommitments).find(([, c]) => c.txid === txid);
      if (current) { mark('remote-latest', Number(current[0])); return { kind: 'remote-latest', txid }; }
      const alternate = Object.entries(s.remoteAlternates).find(([, list]) => list.some((c) => c.txid === txid));
      if (alternate) { mark('remote-alternate', Number(alternate[0])); return { kind: 'remote-alternate', txid, number: Number(alternate[0]) }; }
      const stale = s.revoked[txid];
      if (stale) {
        mark('stale', stale.number);
        const spendOpts = { funding: this.funding, state: Object.assign({ fundedTxHex: this.fundedTxHex }, stale.state), holderPoint: stale.pointHex, perCommitmentSecretHex: stale.perCommitmentSecretHex, staleTxHex: txHex, localPrivateKey: this.localPrivateKey, destinationAddress: opts.destinationAddress, feeSats: opts.feeSats, excludeVouts: opts.excludeVouts, network: this.network };
        let justice = null;
        let justiceSpends = null;
        if (opts.destinationAddress) {
          try { justice = Channel.prepareJusticeSpend(spendOpts); } catch (e) { if (!opts.perOutput) throw e; }
          if (opts.perOutput) justiceSpends = Channel.prepareJusticeSpends(spendOpts);
        }
        let inclusion = null;
        if (opts.inclusion && opts.inclusion.blockHeaderHex && Array.isArray(opts.inclusion.txids)) {
          try { inclusion = buildInclusion({ blockHeaderHex: opts.inclusion.blockHeaderHex, txids: opts.inclusion.txids, txid }); } catch (_) { inclusion = null; }
        }
        const fraudProof = new Witness.FraudProof({
          kind: Witness.FraudProof.KINDS.STALE_COMMITMENT,
          artifacts: Object.assign({ staleTxHex: txHex, revoke: stale.revoke }, inclusion ? { inclusion } : {}),
          claim: { channelId: this.channelId, offenderPubkey: this.funding.remotePubkey, staleNumber: stale.number, latestNumber: s.number, staleTxid: txid }
        }).toBody();
        return Object.assign({ kind: 'stale', txid, number: stale.number, justice, fraudProof, inclusion }, justiceSpends ? { justiceSpends } : {});
      }
      return { kind: 'unknown-funding-spend', txid };
    }
    const hashes = s.htlcs.map((h) => h.paymentHashHex)
      .concat(s.lastSigned ? s.lastSigned.htlcs.map((h) => h.paymentHashHex) : [])
      .concat(s.settled.map((x) => x.paymentHashHex));
    const preimages = Channel.harvestPreimages(tx, hashes);
    for (const p of preimages) this._preimages.set(p.paymentHashHex, p.preimageHex);
    return { kind: preimages.length ? 'htlc-spend' : 'unknown', txid, preimages };
  }

  /** @param {string} paymentHashHex @returns {string|null} preimage learned on this channel */
  preimageFor (paymentHashHex) {
    return this._preimages.get(String(paymentHashHex).toLowerCase()) || null;
  }

  /**
   * Broadcastable commitment: the current state when countersigned, else the
   * last countersigned one (mid-round, while our proposal is unanswered).
   * @returns {object} `{ txHex, txid, number, commitment }`
   */
  finalize () {
    const s = this._state;
    let commitment;
    let sig;
    if (this.fullySigned) {
      commitment = this._localCommitment;
      sig = s.remoteSig;
    } else if (s.lastSigned) {
      const ls = s.lastSigned;
      if (ls.number <= s.localRevokedThrough) throw new Error('finalize: last countersigned state is revoked');
      commitment = this._buildLocal(cloneHtlcs(ls.htlcs), ls.number, ls, ls.feeSats);
      if (commitment.txid !== ls.txid) throw new Error('finalize: last countersigned commitment does not rebuild');
      sig = ls.sig;
    } else {
      throw new Error('finalize: counterparty signature missing on current state');
    }
    const withRemote = Channel.withCommitmentSignature(commitment.psbtBase64, sig, this.funding.remotePubkey, this.network);
    const mine = Channel.signCommitment(withRemote, this.localPrivateKey, this.network);
    return Object.assign({ number: commitment.number, commitment }, Channel.finalizeCommitment(mine, null, this.network));
  }

  /**
   * Cooperative close: no HTLCs pending, latest balances. Returns a
   * `ChannelClose` proposal; the reply countersigns and both finalize.
   * @returns {object}
   */
  close () {
    if (this._state.htlcs.length) throw new Error('close: settle pending HTLCs first');
    if (this.busy) throw new Error('close: channel busy');
    const body = this._propose([], { localSats: this._state.localSats, remoteSats: this._state.remoteSats }, { type: CHANNEL_BODY_TYPES.Close, intent: { kind: 'close' } });
    this._state.status = 'closing';
    return body;
  }

  /**
   * Per-output justice transactions for every revoked counterparty commitment,
   * signed now so a watchtower can broadcast them without this channel key.
   * The commitment transaction is the unsigned one rebuilt from the revoked
   * state (its txid is already fixed). One transaction per output, so a spent
   * output does not take the others with it.
   * @param {object} [opts] `{ destinationAddress?, feeSats? }` — destination defaults to this session's `localAddress`
   * @returns {object[]} `[{ commitmentTxid, transactions }]`
   */
  penaltyFilings (opts = {}) {
    const dest = opts.destinationAddress || this.localAddress;
    if (!dest) return [];
    const fee = opts.feeSats != null ? Math.floor(Number(opts.feeSats)) : 500;
    const out = [];
    for (const [txid, stale] of Object.entries(this._state.revoked || {})) {
      if (!stale || !stale.perCommitmentSecretHex || !stale.pointHex) continue;
      const state = Object.assign({ fundedTxHex: this.fundedTxHex }, stale.state);
      let commitment;
      try {
        commitment = Channel.buildCommitment(this.funding, state, { holder: 'remote', holderPoint: stale.pointHex });
      } catch (_) { continue; }
      if (commitment.txid !== txid || !commitment.txHex) continue;
      let spends;
      try {
        spends = Channel.prepareJusticeSpends({
          funding: this.funding,
          state,
          holderPoint: stale.pointHex,
          perCommitmentSecretHex: stale.perCommitmentSecretHex,
          staleTxHex: commitment.txHex,
          localPrivateKey: this.localPrivateKey,
          destinationAddress: dest,
          feeSats: fee,
          network: this.network
        });
      } catch (_) { continue; }
      if (!spends.length) continue;
      out.push({ commitmentTxid: txid, transactions: spends.map((spend) => spend.txHex) });
    }
    return out;
  }

  /**
   * Broadcastable transactions for this session's watchdog actions: our own
   * force-close, and an HTLC claim or timeout spent from that commitment.
   * A remote commitment already on chain is left alone (its penalty is a
   * watchtower filing, not one of these).
   * @param {object[]} actions from {@link ChannelSession#tick}
   * @param {object} [opts] `{ destinationAddress?, feeSats? }`
   * @returns {string[]} raw transaction hex
   */
  actionTransactions (actions, opts = {}) {
    const dest = opts.destinationAddress || this.localAddress;
    if (!dest) return [];
    const fee = opts.feeSats != null ? Math.floor(Number(opts.feeSats)) : 500;
    const onChain = this._state.onChain;
    const out = [];
    let fin = null;
    const ours = () => {
      if (fin !== null) return fin || null;
      try { fin = this.finalize(); } catch (_) { fin = false; }
      return fin || null;
    };
    const net = networkForFabricName(this.network);
    for (const action of actions || []) {
      if (!action || action.channelId !== this.channelId) continue;
      if (action.type === 'forceClose') {
        if (onChain) continue;
        const built = ours();
        if (built && built.txHex) out.push(built.txHex);
        continue;
      }
      if (action.type !== 'claimHtlc' && action.type !== 'timeoutHtlc') continue;
      if (onChain && onChain.kind !== 'local-latest') continue;
      const built = ours();
      if (!built || !built.txHex || !built.commitment) continue;
      try {
        if (action.type === 'claimHtlc') {
          const prepared = Channel.prepareHtlcClaim(built.commitment, {
            htlcId: action.htlcId,
            commitmentTxHex: built.txHex,
            preimageHex: action.preimageHex,
            destinationAddress: dest,
            feeSats: fee,
            network: this.network
          });
          const psbt = bitcoin.Psbt.fromBase64(prepared.psbtBase64, { network: net });
          psbt.signInput(0, Htlc.signerFromPriv32(this.localPrivateKey));
          out.push(Channel.finalizeHtlcClaim(psbt.toBase64(), action.preimageHex).txHex);
        } else {
          const prepared = Channel.prepareHtlcTimeout(built.commitment, {
            htlcId: action.htlcId,
            commitmentTxHex: built.txHex,
            destinationAddress: dest,
            feeSats: fee,
            network: this.network
          });
          const psbt = bitcoin.Psbt.fromBase64(prepared.psbtBase64, { network: net });
          psbt.signInput(0, Htlc.signerFromPriv32(this.localPrivateKey));
          out.push(finalizeSpendPsbt({ psbt }).txHex);
        }
      } catch (_) { /* this output cannot be spent from our commitment */ }
    }
    return out;
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
    const st = snapshot.state || {};
    const s = new ChannelSession({
      funding: snapshot.funding,
      fundedTxHex: snapshot.fundedTxHex,
      localPrivateKey,
      localSats: st.localSats,
      remoteSats: st.remoteSats,
      localAddress: snapshot.localAddress,
      remoteAddress: snapshot.remoteAddress,
      feeSats: st.feeSats,
      feerate: st.feerate,
      policy: snapshot.localPolicy,
      tipHeight: deps.tipHeight,
      confirmations: deps.confirmations
    });
    const defaults = { outbox: { update: null }, rolledBack: [], remoteAlternates: {}, revokedSecrets: {}, lastSigned: null, rollback: null, intent: null, onChain: null, feerate: null, transfers: [] };
    s._state = Object.assign(s._state, defaults, JSON.parse(JSON.stringify(st)));
    s._state.htlcs = cloneHtlcs(s._state.htlcs);
    for (const [k, v] of Object.entries(snapshot.preimages || {})) s._preimages.set(k, v);
    if (s._state.status !== 'opening' || s._state.pending || s._state.lastSigned) {
      try { s._localCommitment = s._buildLocal(s._state.htlcs, s._state.number); } catch (_) { s._localCommitment = null; }
    }
    // Snapshots from before 64-byte signatures kept the counterparty PSBT.
    if (s._state.remoteSig && !SIG64.test(s._state.remoteSig)) {
      const check = s._localCommitment ? Channel.verifyCommitmentSignature(s._localCommitment.psbtBase64, s._state.remoteSig, s.funding.remotePubkey, s.network) : { ok: false };
      s._state.remoteSig = check.ok ? check.signatureHex : null;
    }
    if (!s._state.lastSigned && s._localCommitment && s._state.remoteSig) {
      s._noteSigned();
    } else if (s._state.lastSigned) {
      // Exits are not exported: rebuild the last countersigned state's,
      // rooted here (every earlier state is revoked).
      const ls = s._state.lastSigned;
      try {
        const c = s._buildLocal(cloneHtlcs(ls.htlcs), ls.number, ls, ls.feeSats);
        if (c.txid === ls.txid) s._recordExit(ls.number, c, ls.sig);
      } catch (_) { /* advisory */ }
    }
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

module.exports = Channel;
