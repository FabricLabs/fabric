'use strict';

/**
 * Deterministic Contract → P2TR spend policy (failover ladder) + composable trees.
 *
 * Tiers compile to tapscript leaves (k-of-n + optional CSV/CLTV `after`).
 * `until` expires tiers off-chain (and schedules decay migration leaves).
 * Optional hashlock / arbitrary script leaves compose via {@link composeTaprootTree}.
 *
 * @see docs/DISTRIBUTED_EXECUTION.md
 * @see docs/CONTRACTS.md
 * @see functions/contractTierWhen.js
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const { payments, networks, script, Psbt } = bitcoin;
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const { evaluateTierWhen } = require('./contractTierWhen');
const { sortPubkeysBip67 } = require('./bip67');
const { taprootPsbtInputFields } = require('./inventoryHtlc');
const { aggregateXonly } = require('./musig2');

bitcoin.initEccLib(ecc);

/** BIP341-style NUMS x-only internal key (script-path spend only). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

const DEFAULT_CSV_BLOCKS = 144;

/** BIP65 LOCKTIME_THRESHOLD: nLockTime / CLTV values ≥ this are unix timestamps. */
const CLTV_TIMESTAMP_THRESHOLD = Number('500000000');
/** nLockTime / nSequence max (2^32 − 1). Avoid a 32-bit hex literal. */
const MAX_LOCKTIME = (2 ** 32) - 1;
const SEQUENCE_NONFINAL = MAX_LOCKTIME - 1;

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  // Do not alias bare "test" — it is ambiguous (testnet tb1 vs regtest bcrt1).
  if (n === 'regtest') return networks.regtest;
  if (n === 'testnet' || n === 'signet') return networks.testnet;
  return networks.bitcoin;
}

function parseCompressedPubkeysSorted (hexList) {
  const out = [];
  for (const h of hexList || []) {
    const s = String(h || '').trim().toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/i.test(s)) {
      throw new Error(`Invalid pubkey (expect 33-byte compressed hex): ${String(s).slice(0, 18)}…`);
    }
    out.push(Buffer.from(s, 'hex'));
  }
  const sorted = sortPubkeysBip67(out);
  const uniq = [];
  for (const b of sorted) {
    if (!uniq.length || uniq[uniq.length - 1].compare(b) !== 0) uniq.push(b);
  }
  return uniq;
}

function toXOnly (pubkey33) {
  if (!Buffer.isBuffer(pubkey33) || pubkey33.length !== 33) return null;
  if (pubkey33[0] !== 0x02 && pubkey33[0] !== 0x03) return null;
  return pubkey33.subarray(1, 33);
}

function buildKOfNTapscript (sortedPubkeys33, threshold) {
  const keys = sortedPubkeys33.map(toXOnly).filter(Boolean);
  if (keys.length !== sortedPubkeys33.length) throw new Error('Internal pubkey parse error.');
  const k = Number(threshold);
  if (!Number.isInteger(k) || k < 1) {
    throw new Error('threshold must be a positive integer');
  }
  if (k > keys.length) {
    throw new Error(`threshold ${k} exceeds unique key count ${keys.length}`);
  }
  if (keys.length === 1) {
    return script.compile([keys[0], script.OPS.OP_CHECKSIG]);
  }
  const chunks = [keys[0], script.OPS.OP_CHECKSIG];
  for (let i = 1; i < keys.length; i++) {
    chunks.push(keys[i], script.OPS.OP_CHECKSIGADD);
  }
  chunks.push(script.number.encode(k), script.OPS.OP_NUMEQUAL);
  return script.compile(chunks);
}

/**
 * Normalize a lock descriptor `{ type: 'csv'|'cltv', blocks?|height?|unix? }`.
 * @returns {{ type: string, value: number }|null}
 */
function normalizeLock (raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (type === 'csv') {
    const blocks = Math.floor(Number(raw.blocks) || 0);
    // BIP68 relative-locktime low 16 bits (block-based CSV).
    if (!Number.isFinite(blocks) || blocks < 1 || blocks > 65535) return null;
    return { type: 'csv', value: blocks, blocks };
  }
  if (type === 'cltv') {
    // BIP65 type bit is the numeric threshold: height < 500000000, unix ≥ 500000000.
    // Reject mismatched representations so policy maturity matches OP_CHECKLOCKTIMEVERIFY.
    if (raw.height != null) {
      const height = Math.floor(Number(raw.height) || 0);
      if (!Number.isFinite(height) || height < 1 || height >= CLTV_TIMESTAMP_THRESHOLD) return null;
      return { type: 'cltv', value: height, height };
    }
    if (raw.unix != null) {
      const unix = Math.floor(Number(raw.unix) || 0);
      if (!Number.isFinite(unix) || unix < CLTV_TIMESTAMP_THRESHOLD || unix > MAX_LOCKTIME) return null;
      return { type: 'cltv', value: unix, unix };
    }
    return null;
  }
  return null;
}

function lockValue (lock) {
  if (!lock) return 0;
  return Number(lock.value || lock.blocks || lock.height || lock.unix) || 0;
}

/**
 * Whether a relative/absolute lock is mature given chain tip context.
 * CSV uses `utxoAgeBlocks` (confirmations / age of the UTXO).
 * CLTV uses tip height or median time.
 */
function timelockMature (lock, ctx = {}) {
  const n = normalizeLock(lock);
  if (!n) return true; // null after => immediate
  if (n.type === 'csv') {
    const age = Number(ctx.utxoAgeBlocks);
    if (!Number.isFinite(age)) return false;
    return age >= n.value;
  }
  if (n.type === 'cltv') {
    if (n.height != null || (lock && lock.height != null)) {
      const tip = Number(ctx.tipHeight);
      return Number.isFinite(tip) && tip >= n.value;
    }
    const mt = Number(ctx.medianTime);
    return Number.isFinite(mt) && mt >= n.value;
  }
  return false;
}

function resolveKeyList (keysRef, keySets, publisher) {
  if (keysRef === 'publisher') {
    if (!publisher) throw new Error('publisher pubkey required for keys: publisher');
    return [String(publisher).trim().toLowerCase()];
  }
  if (typeof keysRef === 'string') {
    const set = keySets && keySets[keysRef];
    if (!Array.isArray(set) || !set.length) {
      throw new Error(`Unknown or empty keySet: ${keysRef}`);
    }
    return set.map((k) => String(k).trim().toLowerCase());
  }
  if (Array.isArray(keysRef)) {
    return keysRef.map((k) => String(k).trim().toLowerCase());
  }
  throw new Error('tier.keys must be a keySet name, "publisher", or pubkey[]');
}

/**
 * Synthesize the canonical 2-tier authority spend ladder:
 *   t0-authority — k-of-n validators/signers (immediate)
 *   t1-soft      — after ~csvBlocks (default 144) CSV, a softer rule
 *                  (default: 1-of-publisher; optional reduced threshold)
 *
 * This is the single P2TR surface for Hub Beacon Federation vaults and ARC
 * contract spend addresses when keys + network + csvBlocks match.
 *
 * @param {object} opts
 * @param {string[]} [opts.validators]
 * @param {string[]} [opts.validatorPubkeysHex]
 * @param {number} [opts.threshold]
 * @param {string} [opts.publisher] soft-tier key when softMode=publisher
 * @param {number} [opts.csvBlocks=144] degradation window (BIP68 relative)
 * @param {string} [opts.network]
 * @param {string} [opts.softMode='publisher'] `publisher` | `reduced`
 * @param {number} [opts.softThreshold] when softMode=reduced (default ceil(k/2))
 * @param {object} [opts.hashlock] optional L1 hashlock leaf (`commitmentHex` / `runCommitmentHex`)
 * @param {object[]} [opts.extraLeaves] additional composable leaves (script / spend / hashlock)
 * @param {string} [opts.internalKeyMode] `musig2` (default when n≥2) | `nums` (legacy script-path-only).
 *   Historical NUMS vaults MUST pass `nums` — a rebuild does not migrate UTXOs.
 * @returns {object} normalized spend policy
 */
function synthesizeDefaultLadder (opts = {}) {
  const validators = Array.isArray(opts.validators)
    ? opts.validators
    : (Array.isArray(opts.validatorPubkeysHex) ? opts.validatorPubkeysHex : []);
  const threshold = Math.max(1, Math.floor(Number(opts.threshold) || 1));
  const sorted = parseCompressedPubkeysSorted(validators).map((b) => b.toString('hex'));
  if (!sorted.length) throw new Error('synthesizeDefaultLadder requires validators');
  if (threshold > sorted.length) {
    throw new Error(`threshold ${threshold} exceeds unique key count ${sorted.length}`);
  }
  const publisher = opts.publisher
    ? String(opts.publisher).trim().toLowerCase()
    : sorted[0];
  const csvBlocks = Math.max(1, Number(opts.csvBlocks) || DEFAULT_CSV_BLOCKS);
  const network = opts.network || opts.networkName || null;
  if (!network) {
    throw new Error('synthesizeDefaultLadder: bitcoin network required (no silent regtest default)');
  }
  if (!publisher) throw new Error('synthesizeDefaultLadder requires publisher');

  const softMode = String(opts.softMode || 'publisher').toLowerCase();
  let softTier;
  if (softMode === 'reduced' || softMode === 'threshold') {
    const softThr = Math.max(
      1,
      Math.floor(Number(opts.softThreshold) || Math.max(1, Math.ceil(threshold / 2)))
    );
    if (softThr > sorted.length) {
      throw new Error(`softThreshold ${softThr} exceeds unique key count ${sorted.length}`);
    }
    softTier = {
      id: 't1-soft',
      threshold: softThr,
      keys: 'full',
      after: { type: 'csv', blocks: csvBlocks },
      until: null
    };
  } else {
    softTier = {
      id: 't1-soft',
      threshold: 1,
      keys: 'publisher',
      after: { type: 'csv', blocks: csvBlocks },
      until: null
    };
  }

  const policyIn = {
    version: 1,
    network,
    publisher,
    keySets: {
      full: sorted
    },
    decay: { mode: 'policy' },
    tiers: [
      {
        id: 't0-authority',
        threshold,
        keys: 'full',
        after: null,
        until: null
      },
      softTier
    ],
    hashlock: opts.hashlock || null,
    extraLeaves: Array.isArray(opts.extraLeaves) ? opts.extraLeaves : null,
    // n>=2: MuSig2 of the full validator set as the Taproot internal key
    // (cooperative n-of-n key-path). t-of-n and CSV soft-tier stay script-path.
    // Pass internalKeyMode: 'nums' to keep the historical NUMS-only address.
    internalKeyMode: opts.internalKeyMode || (sorted.length >= 2 ? 'musig2' : 'nums')
  };
  return normalizeContractSpendPolicy(policyIn);
}

/**
 * @param {object} raw
 * @returns {object} normalized policy
 */
function normalizeContractSpendPolicy (raw = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('spend policy required');

  if (!Array.isArray(raw.tiers) || !raw.tiers.length) {
    if (raw.validators || raw.validatorPubkeysHex) {
      return synthesizeDefaultLadder(raw);
    }
    throw new Error('spend policy requires tiers[] or validators');
  }

  const publisher = raw.publisher
    ? String(raw.publisher).trim().toLowerCase()
    : null;
  const keySets = {};
  if (raw.keySets && typeof raw.keySets === 'object') {
    for (const [name, list] of Object.entries(raw.keySets)) {
      keySets[name] = parseCompressedPubkeysSorted(list).map((b) => b.toString('hex'));
    }
  }

  const tiers = [];
  let prevAfterLock = null;
  for (let i = 0; i < raw.tiers.length; i++) {
    const t = raw.tiers[i] || {};
    const keysHex = resolveKeyList(t.keys, keySets, publisher);
    const pks = parseCompressedPubkeysSorted(keysHex);
    const thr = Number(t.threshold);
    if (!Number.isInteger(thr) || thr < 1) {
      throw new Error(`tier[${i}] threshold must be a positive integer`);
    }
    if (thr > pks.length) {
      throw new Error(`tier[${i}] threshold ${thr} exceeds unique key count ${pks.length}`);
    }
    const after = normalizeLock(t.after);
    const until = normalizeLock(t.until);
    const afterVal = lockValue(after);
    if (after && prevAfterLock) {
      if (after.type !== prevAfterLock.type) {
        throw new Error(`tier[${i}] after lock type must match previous tier (${prevAfterLock.type})`);
      }
      if (afterVal < lockValue(prevAfterLock)) {
        throw new Error(`tier[${i}] after must be >= previous tier after`);
      }
    } else if (!after && prevAfterLock) {
      throw new Error(`tier[${i}] after must be >= previous tier after`);
    }
    if (until && after) {
      if (until.type !== after.type) {
        throw new Error(`tier[${i}] until lock type must match after (${after.type})`);
      }
      if (lockValue(until) <= afterVal) {
        throw new Error(`tier[${i}] until must be strictly after after`);
      }
    }
    if (after) prevAfterLock = after;
    const id = t.id != null && String(t.id).trim()
      ? String(t.id).trim().slice(0, 128)
      : `t${i}`;
    tiers.push({
      id,
      index: i,
      threshold: thr,
      keys: pks.map((b) => b.toString('hex')),
      after,
      until,
      when: t.when && typeof t.when === 'object' ? t.when : null
    });
  }

  const hasUntil = tiers.some((t) => t.until);
  let decayMode = raw.decay && raw.decay.mode
    ? String(raw.decay.mode).toLowerCase()
    : (hasUntil ? 'both' : 'policy');
  if (!['policy', 'migrate', 'both'].includes(decayMode)) decayMode = 'policy';

  let migrateKeys = null;
  let migrateThreshold = 1;
  if (decayMode === 'migrate' || decayMode === 'both') {
    const mk = (raw.decay && raw.decay.migrateKeys != null)
      ? raw.decay.migrateKeys
      : (keySets.mid ? 'mid' : (tiers[Math.min(1, tiers.length - 1)] ? tiers[Math.min(1, tiers.length - 1)].keys : tiers[0].keys));
    const resolved = Array.isArray(mk) || typeof mk === 'string'
      ? resolveKeyList(mk, keySets, publisher)
      : mk;
    const mpks = parseCompressedPubkeysSorted(resolved);
    migrateKeys = mpks.map((b) => b.toString('hex'));
    const mtRaw = raw.decay && raw.decay.migrateThreshold != null
      ? Number(raw.decay.migrateThreshold)
      : Math.ceil(mpks.length / 2);
    if (!Number.isInteger(mtRaw) || mtRaw < 1) {
      throw new Error('decay.migrateThreshold must be a positive integer');
    }
    if (mtRaw > mpks.length) {
      throw new Error(`decay.migrateThreshold ${mtRaw} exceeds unique key count ${mpks.length}`);
    }
    migrateThreshold = mtRaw;
  }

  return {
    version: 1,
    network: String(raw.network || raw.networkName || 'regtest'),
    publisher,
    keySets,
    decay: {
      mode: decayMode,
      migrateKeys,
      migrateThreshold
    },
    tiers,
    hashlock: raw.hashlock ? normalizeHashlockSpec(raw.hashlock) : null,
    extraLeaves: normalizeExtraLeafSpecs(raw.extraLeaves),
    internalKeyMode: normalizeInternalKeyMode(raw.internalKeyMode)
  };
}

/**
 * @param {string} [mode]
 * @returns {string} `nums` | `musig2`
 * @private
 */
function normalizeInternalKeyMode (mode) {
  if (mode == null || String(mode).trim() === '') return 'nums';
  const m = String(mode).trim().toLowerCase();
  if (m === 'musig2' || m === 'auto') return 'musig2';
  if (m === 'nums') return 'nums';
  throw new Error('internalKeyMode must be "musig2", "auto", or "nums"');
}

/**
 * Keys used for a MuSig2 Taproot internal key (full authority set).
 *
 * @param {object} policy
 * @returns {string[]|null}
 * @private
 */
function musig2InternalKeySources (policy) {
  if (!policy) return null;
  if (policy.keySets && Array.isArray(policy.keySets.full) && policy.keySets.full.length) {
    return policy.keySets.full;
  }
  if (policy.tiers && policy.tiers[0] && Array.isArray(policy.tiers[0].keys)) {
    return policy.tiers[0].keys;
  }
  return null;
}

/**
 * @param {object} [opts]
 * @param {object} [policy]
 * @returns {Buffer} 32-byte x-only
 * @private
 */
function resolveTaprootInternalPubkey (opts, policy) {
  if (opts && opts.internalPubkeyHex) {
    const hex = String(opts.internalPubkeyHex).trim().toLowerCase().replace(/^0x/i, '');
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error('composeTaprootTree: internalPubkeyHex must be 32-byte x-only hex');
    }
    return Buffer.from(hex, 'hex');
  }
  const mode = normalizeInternalKeyMode(
    (opts && opts.internalKeyMode) || (policy && policy.internalKeyMode)
  );
  if (mode === 'musig2') {
    const keys = musig2InternalKeySources(policy);
    if (keys && keys.length >= 2) {
      return aggregateXonly(keys);
    }
  }
  return TAPROOT_INTERNAL_NUMS;
}

/**
 * Drop tiers whose until <= trigger lock; clear migrate leaf schedule for child.
 */
function policyAfterDecay (policy, atLock) {
  const p = normalizeContractSpendPolicy(policy);
  const trigger = normalizeLock(atLock) || atLock;
  const triggerVal = lockValue(trigger);
  const remaining = p.tiers.filter((t) => {
    if (!t.until) return true;
    return lockValue(t.until) > triggerVal;
  }).map((t, i) => ({
    id: t.id,
    threshold: t.threshold,
    keys: t.keys,
    after: t.after,
    until: t.until,
    when: t.when,
    index: i
  }));
  if (!remaining.length) {
    throw new Error('policyAfterDecay would leave no spend tiers');
  }
  // Child policy: no migrate until it has its own until windows
  const childHasUntil = remaining.some((t) => t.until);
  return normalizeContractSpendPolicy({
    version: 1,
    network: p.network,
    publisher: p.publisher,
    keySets: Object.fromEntries(
      Object.entries(p.keySets || {}).map(([k, v]) => [k, v])
    ),
    // Inline keys on tiers already resolved
    decay: childHasUntil
      ? {
        mode: p.decay.mode === 'policy' ? 'policy' : p.decay.mode,
        migrateKeys: p.decay.migrateKeys,
        migrateThreshold: p.decay.migrateThreshold
      }
      : { mode: 'policy' },
    tiers: remaining.map((t) => ({
      id: t.id,
      threshold: t.threshold,
      keys: t.keys,
      after: t.after,
      until: t.until,
      when: t.when
    })),
    hashlock: p.hashlock || null,
    extraLeaves: p.extraLeaves || null,
    internalKeyMode: p.internalKeyMode || 'nums'
  });
}

function prependLock (lock, innerScript) {
  const n = normalizeLock(lock);
  if (!n) return innerScript;
  if (n.type === 'csv') {
    return script.compile([
      script.number.encode(n.value),
      script.OPS.OP_CHECKSEQUENCEVERIFY,
      script.OPS.OP_DROP,
      ...script.decompile(innerScript)
    ]);
  }
  if (n.type === 'cltv') {
    return script.compile([
      script.number.encode(n.value),
      script.OPS.OP_CHECKLOCKTIMEVERIFY,
      script.OPS.OP_DROP,
      ...script.decompile(innerScript)
    ]);
  }
  return innerScript;
}

/**
 * Normalize optional hashlock leaf options (JSON-safe).
 * `commitmentHex` MAY be Machine `runCommitmentHex` or SHA256(preimage).
 * @param {object} raw
 * @returns {{ commitmentHex: string, pubkeyHex: string|null, after: object|null, id: string }|null}
 */
function normalizeHashlockSpec (raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') throw new Error('hashlock must be an object');
  const commitmentHex = String(
    raw.commitmentHex || raw.runCommitmentHex || raw.paymentHashHex || ''
  ).trim().toLowerCase().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/.test(commitmentHex)) {
    throw new Error('hashlock.commitmentHex must be 32-byte hex');
  }
  let pubkeyHex = null;
  const pkRaw = raw.pubkeyHex || raw.pubkey || null;
  if (pkRaw) {
    const s = String(pkRaw).trim().toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/.test(s)) {
      throw new Error('hashlock.pubkeyHex must be 33-byte compressed hex');
    }
    pubkeyHex = s;
  } else if (raw.requirePubkey === true) {
    throw new Error('hashlock.requirePubkey set but pubkeyHex missing');
  }
  const id = raw.id != null && String(raw.id).trim()
    ? String(raw.id).trim().slice(0, 128)
    : 'hashlock';
  return {
    commitmentHex,
    pubkeyHex,
    after: normalizeLock(raw.after),
    id
  };
}

/**
 * @param {unknown} list
 * @returns {object[]}
 */
function normalizeExtraLeafSpecs (list) {
  if (!Array.isArray(list) || !list.length) return [];
  return list.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`extraLeaves[${i}] must be an object`);
    }
    const kind = String(raw.kind || 'script').toLowerCase();
    if (kind === 'hashlock') {
      const spec = normalizeHashlockSpec(raw);
      return Object.assign({ kind: 'hashlock' }, spec);
    }
    if (kind === 'spend') {
      const keys = parseCompressedPubkeysSorted(raw.keys || raw.validators || [])
        .map((b) => b.toString('hex'));
      if (!keys.length) throw new Error(`extraLeaves[${i}] spend leaf requires keys`);
      const threshold = Math.max(1, Number(raw.threshold) || 1);
      if (threshold > keys.length) {
        throw new Error(`extraLeaves[${i}] threshold exceeds key count`);
      }
      return {
        kind: 'spend',
        id: raw.id != null && String(raw.id).trim()
          ? String(raw.id).trim().slice(0, 128)
          : `extra-spend-${i}`,
        keys,
        threshold,
        after: normalizeLock(raw.after)
      };
    }
    const scriptHex = String(raw.scriptHex || raw.tapscriptHex || '').trim().replace(/^0x/i, '');
    const asm = raw.asm != null ? String(raw.asm).trim() : '';
    if (!scriptHex && !asm && !Buffer.isBuffer(raw.script)) {
      throw new Error(`extraLeaves[${i}] script leaf requires scriptHex, asm, or script`);
    }
    return {
      kind: 'script',
      id: raw.id != null && String(raw.id).trim()
        ? String(raw.id).trim().slice(0, 128)
        : `extra-script-${i}`,
      scriptHex: scriptHex || (Buffer.isBuffer(raw.script) ? raw.script.toString('hex') : ''),
      asm: asm || null,
      after: normalizeLock(raw.after),
      witnessShape: raw.witnessShape ? String(raw.witnessShape) : 'custom',
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : null
    };
  });
}

/**
 * Hashlock tapscript: SHA256(preimage) == commitment [+ optional CHECKSIG].
 * @param {{ commitmentHex: string, pubkeyHex?: string|null }} opts
 * @returns {Buffer}
 */
function buildHashlockTapscript (opts = {}) {
  const commitmentHex = String(opts.commitmentHex || '').trim().toLowerCase().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/.test(commitmentHex)) {
    throw new Error('buildHashlockTapscript: commitmentHex must be 32-byte hex');
  }
  const commitment = Buffer.from(commitmentHex, 'hex');
  if (opts.pubkeyHex) {
    const pk = Buffer.from(String(opts.pubkeyHex).trim().toLowerCase(), 'hex');
    const x = toXOnly(pk);
    if (!x) throw new Error('buildHashlockTapscript: invalid pubkeyHex');
    return script.compile([
      script.OPS.OP_SHA256,
      commitment,
      script.OPS.OP_EQUALVERIFY,
      x,
      script.OPS.OP_CHECKSIG
    ]);
  }
  return script.compile([
    script.OPS.OP_SHA256,
    commitment,
    script.OPS.OP_EQUAL
  ]);
}

/**
 * First-class hashlock leaf (optional on authority trees).
 * @param {object} opts
 * @returns {object}
 */
function buildHashlockLeaf (opts = {}) {
  const spec = normalizeHashlockSpec(opts);
  if (!spec) throw new Error('buildHashlockLeaf: options required');
  let body = buildHashlockTapscript(spec);
  body = prependLock(spec.after, body);
  return {
    kind: 'hashlock',
    id: spec.id,
    script: Buffer.from(body),
    after: spec.after,
    until: null,
    commitmentHex: spec.commitmentHex,
    pubkeyHex: spec.pubkeyHex,
    witnessShape: spec.pubkeyHex ? 'preimage+sig' : 'preimage',
    meta: {
      commitmentHex: spec.commitmentHex,
      pubkeyHex: spec.pubkeyHex
    }
  };
}

/**
 * First-class k-of-n spend leaf (composable outside policy tiers).
 * @param {object} opts
 * @returns {object}
 */
function buildSpendLeaf (opts = {}) {
  const keysHex = parseCompressedPubkeysSorted(opts.keys || opts.validators || [])
    .map((b) => b.toString('hex'));
  if (!keysHex.length) throw new Error('buildSpendLeaf: keys required');
  const threshold = Math.max(1, Number(opts.threshold) || 1);
  if (threshold > keysHex.length) {
    throw new Error('buildSpendLeaf: threshold exceeds key count');
  }
  const after = normalizeLock(opts.after);
  const id = opts.id != null && String(opts.id).trim()
    ? String(opts.id).trim().slice(0, 128)
    : 'spend';
  let body = buildKOfNTapscript(parseCompressedPubkeysSorted(keysHex), threshold);
  body = prependLock(after, body);
  return {
    kind: 'spend',
    id,
    script: Buffer.from(body),
    after,
    until: null,
    threshold,
    keys: keysHex,
    witnessShape: 'sigs'
  };
}

/**
 * Arbitrary tapscript leaf from hex / ASM / Buffer (wallet UI composition).
 * @param {object} opts
 * @returns {object}
 */
function buildScriptLeaf (opts = {}) {
  let scriptBuf = null;
  if (Buffer.isBuffer(opts.script)) {
    scriptBuf = Buffer.from(opts.script);
  } else if (opts.scriptHex || opts.tapscriptHex) {
    scriptBuf = Buffer.from(
      String(opts.scriptHex || opts.tapscriptHex).trim().replace(/^0x/i, ''),
      'hex'
    );
  } else if (opts.asm) {
    scriptBuf = script.fromASM(String(opts.asm).trim());
  }
  if (!scriptBuf || !scriptBuf.length) {
    throw new Error('buildScriptLeaf: script, scriptHex, or asm required');
  }
  const after = normalizeLock(opts.after);
  if (after) scriptBuf = prependLock(after, scriptBuf);
  const id = opts.id != null && String(opts.id).trim()
    ? String(opts.id).trim().slice(0, 128)
    : 'script';
  return {
    kind: 'script',
    id,
    script: Buffer.from(scriptBuf),
    after,
    until: null,
    witnessShape: opts.witnessShape ? String(opts.witnessShape) : 'custom',
    meta: opts.meta && typeof opts.meta === 'object' ? opts.meta : null
  };
}

/**
 * Normalize a leaf descriptor into a Buffer-backed leaf.
 * @param {object} raw
 * @returns {object}
 */
function normalizeLeaf (raw = {}) {
  if (raw && Buffer.isBuffer(raw.script) && raw.kind) {
    return {
      kind: String(raw.kind),
      id: raw.id != null ? String(raw.id) : 'leaf',
      script: Buffer.from(raw.script),
      after: raw.after || null,
      until: raw.until || null,
      decayAt: raw.decayAt || null,
      threshold: raw.threshold,
      keys: raw.keys,
      commitmentHex: raw.commitmentHex || null,
      pubkeyHex: raw.pubkeyHex || null,
      witnessShape: raw.witnessShape || null,
      meta: raw.meta || null,
      tierIndex: raw.tierIndex
    };
  }
  const kind = String((raw && raw.kind) || 'script').toLowerCase();
  if (kind === 'hashlock') {
    if (raw.commitmentHex || raw.runCommitmentHex || raw.paymentHashHex) {
      return buildHashlockLeaf(raw);
    }
    // Rehydrate from compiled hex (wallet UI round-trip).
    const leaf = buildScriptLeaf(Object.assign({}, raw, {
      id: raw.id || 'hashlock',
      witnessShape: raw.witnessShape || (raw.pubkeyHex ? 'preimage+sig' : 'preimage')
    }));
    leaf.kind = 'hashlock';
    leaf.commitmentHex = raw.commitmentHex || null;
    leaf.pubkeyHex = raw.pubkeyHex || null;
    leaf.meta = raw.meta || {
      commitmentHex: leaf.commitmentHex,
      pubkeyHex: leaf.pubkeyHex
    };
    return leaf;
  }
  if (kind === 'spend') return buildSpendLeaf(raw);
  if (kind === 'migrate') {
    // Migrate leaves are normally produced by compileLeaves; allow explicit rebuild.
    return buildSpendLeaf(Object.assign({}, raw, {
      id: raw.id || 'migrate',
      keys: raw.keys,
      threshold: raw.threshold
    }));
  }
  return buildScriptLeaf(raw);
}

function leafPublicView (l) {
  return {
    kind: l.kind,
    id: l.id,
    tierIndex: l.tierIndex,
    tapscriptHex: l.script.toString('hex'),
    after: l.after || null,
    until: l.until || null,
    decayAt: l.decayAt || null,
    threshold: l.threshold,
    keys: l.keys,
    commitmentHex: l.commitmentHex || (l.meta && l.meta.commitmentHex) || null,
    pubkeyHex: l.pubkeyHex || (l.meta && l.meta.pubkeyHex) || null,
    witnessShape: l.witnessShape || null,
    meta: l.meta || null
  };
}

/**
 * Build leaf descriptors for a normalized policy (+ optional hashlock / extras).
 * @returns {object[]}
 */
function compileLeaves (policy) {
  const p = normalizeContractSpendPolicy(policy);
  const leaves = [];
  for (const t of p.tiers) {
    const pks = parseCompressedPubkeysSorted(t.keys);
    let body = buildKOfNTapscript(pks, t.threshold);
    body = prependLock(t.after, body);
    leaves.push({
      kind: 'spend',
      id: t.id,
      tierIndex: t.index,
      script: Buffer.from(body),
      after: t.after,
      until: t.until,
      threshold: t.threshold,
      keys: t.keys,
      witnessShape: 'sigs'
    });
  }

  if (p.decay.mode === 'migrate' || p.decay.mode === 'both') {
    const boundaries = [];
    for (const t of p.tiers) {
      if (!t.until) continue;
      const u = t.until;
      const key = `${u.type}:${lockValue(u)}`;
      if (!boundaries.find((b) => b.key === key)) {
        boundaries.push({ key, until: u });
      }
    }
    boundaries.sort((a, b) => lockValue(a.until) - lockValue(b.until));
    const mpks = parseCompressedPubkeysSorted(p.decay.migrateKeys || []);
    if (mpks.length && boundaries.length) {
      for (const b of boundaries) {
        let body = buildKOfNTapscript(mpks, p.decay.migrateThreshold);
        body = prependLock(b.until, body);
        leaves.push({
          kind: 'migrate',
          id: `decay@${lockValue(b.until)}`,
          script: Buffer.from(body),
          after: b.until,
          decayAt: b.until,
          threshold: p.decay.migrateThreshold,
          keys: p.decay.migrateKeys,
          witnessShape: 'sigs'
        });
      }
    }
  }

  if (p.hashlock) {
    leaves.push(buildHashlockLeaf(p.hashlock));
  }
  for (const spec of p.extraLeaves || []) {
    leaves.push(normalizeLeaf(spec));
  }

  const seen = new Set();
  for (const l of leaves) {
    if (seen.has(l.id)) throw new Error(`duplicate leaf id: ${l.id}`);
    seen.add(l.id);
  }
  return leaves;
}

/**
 * bitcoinjs-lib Taptree is a binary tree of leaves (not a flat list of >2).
 * @param {{ script: Buffer }[]} leaves
 * @returns {object}
 */
function scriptTreeFromLeaves (leaves) {
  if (!leaves.length) throw new Error('no leaves');
  if (leaves.length === 1) return { output: leaves[0].script };
  if (leaves.length === 2) {
    return [{ output: leaves[0].script }, { output: leaves[1].script }];
  }
  // Balanced binary tree over leaf order (ladder order preserved left-to-right).
  const mid = Math.ceil(leaves.length / 2);
  return [
    scriptTreeFromLeaves(leaves.slice(0, mid)),
    scriptTreeFromLeaves(leaves.slice(mid))
  ];
}

/**
 * Compose an arbitrary Taproot tree for wallet UIs / custom scripts.
 * Policy ladder leaves come first; `hashlock` / `extraLeaves` append.
 * Adding optional leaves **changes** the address vs ladder-only.
 *
 * @param {object} opts
 * @param {string} opts.network
 * @param {object} [opts.policy] spend policy (tiers / validators)
 * @param {object[]} [opts.leaves] full leaf list (skips policy compile when set alone)
 * @param {object} [opts.hashlock] optional hashlock sugar
 * @param {object[]} [opts.extraLeaves] additional leaves
 * @param {string} [opts.internalPubkeyHex] x-only; default NUMS or MuSig2 from policy
 * @param {string} [opts.internalKeyMode] `nums` | `musig2`
 * @returns {object}
 */
function composeTaprootTree (opts = {}) {
  const network = opts.network || opts.networkName;
  if (!network) throw new Error('composeTaprootTree: network required');

  let policy = null;
  let leaves = [];
  if (Array.isArray(opts.leaves) && opts.leaves.length && !opts.policy) {
    leaves = opts.leaves.map((l) => normalizeLeaf(l));
  } else if (opts.policy) {
    const policyInput = Object.assign({}, opts.policy, {
      network: opts.policy.network || opts.policy.networkName || network,
      hashlock: opts.policy.hashlock || opts.hashlock || null,
      extraLeaves: opts.policy.extraLeaves || opts.extraLeaves || null
    });
    // When compose passes hashlock/extraLeaves at top-level without policy.hashlock,
    // prefer top-level for extras-after-policy.
    if (opts.hashlock && !opts.policy.hashlock) {
      policyInput.hashlock = opts.hashlock;
    }
    if (Array.isArray(opts.extraLeaves) && !(opts.policy.extraLeaves && opts.policy.extraLeaves.length)) {
      policyInput.extraLeaves = opts.extraLeaves;
    }
    policy = normalizeContractSpendPolicy(policyInput);
    leaves = compileLeaves(policy);
  } else {
    if (opts.hashlock) leaves.push(buildHashlockLeaf(opts.hashlock));
    if (Array.isArray(opts.extraLeaves)) {
      for (const spec of opts.extraLeaves) leaves.push(normalizeLeaf(spec));
    }
  }

  if (!leaves.length) throw new Error('composeTaprootTree: no leaves');

  const seen = new Set();
  for (const l of leaves) {
    if (seen.has(l.id)) throw new Error(`duplicate leaf id: ${l.id}`);
    seen.add(l.id);
  }

  const internalPubkey = resolveTaprootInternalPubkey(opts, policy);

  const scriptTree = scriptTreeFromLeaves(leaves);
  const btcNet = networkForFabricName(network);
  const pay = payments.p2tr({
    internalPubkey,
    scriptTree,
    network: btcNet
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce address.');
  const hashTree = bip341.toHashTree(scriptTree);
  return {
    address: pay.address,
    spendAddress: pay.address,
    output: Buffer.isBuffer(pay.output) ? pay.output : Buffer.from(pay.output),
    network: String(network),
    policy,
    leaves: leaves.map(leafPublicView),
    /** Buffer-backed leaves for control-block / PSBT helpers. */
    leafScripts: leaves,
    scriptTree,
    merkleRootHex: hashTree && hashTree.hash
      ? Buffer.from(hashTree.hash).toString('hex')
      : null,
    internalPubkeyHex: internalPubkey.toString('hex'),
    scheme: policy ? 'taproot-authority-ladder-v1' : 'taproot-composed-v1'
  };
}

function buildControlBlockForLeaf (leaves, leafScript, internalPubkey) {
  const internal = Buffer.isBuffer(internalPubkey) && internalPubkey.length === 32
    ? internalPubkey
    : TAPROOT_INTERNAL_NUMS;
  const scriptTree = scriptTreeFromLeaves(leaves);
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: leafScript, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Leaf script not in tap tree.');
  const outputKey = bip341.tweakKey(internal, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed.');
  return Buffer.concat([
    Buffer.from([leafVersion | outputKey.parity]),
    internal,
    ...path
  ]);
}

/**
 * @param {object} policy
 * @returns {object}
 */
function buildContractTaproot (policy) {
  const p = normalizeContractSpendPolicy(policy);
  const composed = composeTaprootTree({ network: p.network, policy: p });
  return {
    address: composed.address,
    output: composed.output,
    network: composed.network,
    policy: p,
    leaves: composed.leaves,
    leafScripts: composed.leafScripts,
    internalPubkeyHex: composed.internalPubkeyHex,
    merkleRootHex: composed.merkleRootHex,
    scheme: composed.scheme
  };
}

function toAddress (policy) {
  return buildContractTaproot(policy).address;
}

/**
 * @param {object} policy
 * @param {{ tipHeight?: number, medianTime?: number, utxoAgeBlocks?: number, tipClock?: number, contractState?: object }} ctx
 */
function selectActiveTiers (policy, ctx = {}) {
  const p = normalizeContractSpendPolicy(policy);
  const enforceUntil = p.decay.mode === 'policy' || p.decay.mode === 'both';
  return p.tiers.filter((t) => {
    if (!timelockMature(t.after, ctx)) return false;
    if (enforceUntil && t.until && timelockMature(t.until, ctx)) return false;
    if (!evaluateTierWhen(t.when, ctx)) return false;
    return true;
  });
}

function selectMigrateTarget (policy, ctx = {}) {
  const p = normalizeContractSpendPolicy(policy);
  if (p.decay.mode !== 'migrate' && p.decay.mode !== 'both') return null;
  const boundaries = [];
  for (const t of p.tiers) {
    if (!t.until) continue;
    if (!timelockMature(t.until, ctx)) continue;
    boundaries.push(t.until);
  }
  if (!boundaries.length) return null;
  // Prefer the largest mature until (most tiers expired)
  boundaries.sort((a, b) => lockValue(b) - lockValue(a));
  const at = boundaries[0];
  const child = policyAfterDecay(p, at);
  return {
    decayAt: at,
    childPolicy: child,
    childAddress: toAddress(child)
  };
}

function findP2trVoutForAddress (tx, paymentAddress, network) {
  const addr = String(paymentAddress || '').trim();
  if (!addr) return -1;
  const want = Buffer.from(bitcoin.address.toOutputScript(addr, network));
  for (let i = 0; i < tx.outs.length; i++) {
    const sc = Buffer.from(tx.outs[i].script);
    if (sc.equals(want)) return i;
  }
  return -1;
}

function prepareLeafPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    vaultAddress,
    leafScript,
    leaves,
    destinationAddress,
    feeSats
  } = opts;
  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, vaultAddress, network);
  if (vout < 0) throw new Error('Funding tx has no P2TR output matching vault address.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid vault output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust; lower fee or use a larger UTXO.');

  let ms;
  if (Buffer.isBuffer(leafScript)) {
    ms = leafScript;
  } else if (leafScript instanceof Uint8Array) {
    ms = Buffer.from(leafScript);
  } else {
    ms = Buffer.from(String(leafScript || '').replace(/^0x/i, ''), 'hex');
  }
  if (!ms.length) throw new Error('leafScript is required.');

  const dest = String(destinationAddress || '').trim();
  if (!dest) throw new Error('destinationAddress is required.');

  const afterLock = normalizeLock(opts.after);
  let sequence = opts.sequence != null ? Number(opts.sequence) : undefined;
  let locktime;
  if (afterLock && afterLock.type === 'csv') {
    // BIP68 block-based relative locktime: low 16 bits = blocks; TYPE_FLAG
    // (0x00400000) is for seconds only. Disable-flag bit 31 must stay clear.
    if (sequence == null) sequence = afterLock.value;
  } else if (afterLock && afterLock.type === 'cltv') {
    locktime = afterLock.value;
    // CLTV requires a non-final nSequence on the input.
    if (sequence == null || sequence === MAX_LOCKTIME) sequence = SEQUENCE_NONFINAL;
  }

  const internalPubkey = resolveTaprootInternalPubkey(opts, opts.policy || null);
  const controlBlock = buildControlBlockForLeaf(leaves, ms, internalPubkey);
  const outScript = Buffer.isBuffer(out.script) ? out.script : Buffer.from(out.script);
  const input = {
    hash: tx.getId(),
    index: vout,
    witnessUtxo: {
      script: Uint8Array.from(outScript),
      value: BigInt(inputSats)
    },
    ...taprootPsbtInputFields({
      tapInternalKey: internalPubkey,
      script: ms,
      controlBlock,
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT
    })
  };
  if (sequence != null) input.sequence = Number(sequence);

  const psbt = new Psbt({ network });
  if (locktime != null) {
    if (typeof psbt.setLocktime === 'function') psbt.setLocktime(Number(locktime));
    else psbt.locktime = Number(locktime);
  }
  psbt.addInput(input);
  psbt.addOutput({
    address: dest,
    value: BigInt(destSats)
  });

  return {
    psbtBase64: psbt.toBase64(),
    vaultAddress: String(vaultAddress || '').trim(),
    vout,
    inputSats,
    destSats,
    feeSats: fee,
    tapscriptHex: ms.toString('hex'),
    controlBlockHex: controlBlock.toString('hex'),
    sequence: sequence != null ? Number(sequence) : undefined,
    locktime: locktime != null ? Number(locktime) : undefined,
    preimageHex: opts.preimage32
      ? (Buffer.isBuffer(opts.preimage32)
        ? opts.preimage32.toString('hex')
        : String(opts.preimage32).replace(/^0x/i, '').toLowerCase())
      : undefined
  };
}

/**
 * Prepare withdrawal via a spend tier leaf.
 */
function prepareTierWithdrawalPsbt (opts = {}) {
  const built = buildContractTaproot(opts.policy);
  const ctx = opts.ctx || {};
  const active = selectActiveTiers(built.policy, ctx);
  let tier = null;
  if (opts.tierId) {
    tier = active.find((t) => t.id === opts.tierId);
    if (!tier) {
      const all = built.policy.tiers.find((t) => t.id === opts.tierId);
      if (all && all.until && timelockMature(all.until, ctx) &&
        (built.policy.decay.mode === 'policy' || built.policy.decay.mode === 'both')) {
        throw new Error(`tier ${opts.tierId} expired (until mature); use migrate`);
      }
      throw new Error(`tier ${opts.tierId} is not active`);
    }
  } else {
    tier = active[0];
  }
  if (!tier) throw new Error('No active spend tier');

  const leaves = compileLeaves(built.policy);
  const leaf = leaves.find((l) => l.kind === 'spend' && l.id === tier.id);
  if (!leaf) throw new Error('spend leaf missing');

  const result = prepareLeafPsbt({
    networkName: built.network,
    fundedTxHex: opts.fundedTxHex,
    vaultAddress: opts.vaultAddress || built.address,
    leafScript: leaf.script,
    leaves,
    destinationAddress: opts.destinationAddress,
    feeSats: opts.feeSats,
    after: tier.after,
    internalPubkeyHex: built.internalPubkeyHex,
    policy: built.policy
  });
  return {
    ...result,
    tierId: tier.id,
    action: 'spend',
    leafId: leaf.id,
    address: built.address,
    leaves: built.leaves,
    signingNotes: 'Co-sign tapscript leaf for active non-expired tier. Witness: sigs then script then control block.'
  };
}

/**
 * Prepare decay migration PSBT (output must be child policy address).
 */
function prepareDecayMigrationPsbt (opts = {}) {
  const built = buildContractTaproot(opts.policy);
  const ctx = opts.ctx || {};
  const target = selectMigrateTarget(built.policy, ctx);
  if (!target) throw new Error('No mature decay migration available');

  const leaves = compileLeaves(built.policy);
  const leaf = leaves.find((l) => l.kind === 'migrate' && lockValue(l.decayAt) === lockValue(target.decayAt));
  if (!leaf) throw new Error('migrate leaf missing for decay boundary');

  const childAddr = target.childAddress;
  if (opts.destinationAddress && String(opts.destinationAddress).trim() !== childAddr) {
    throw new Error(`migration destination must be child address ${childAddr}`);
  }

  const result = prepareLeafPsbt({
    networkName: built.network,
    fundedTxHex: opts.fundedTxHex,
    vaultAddress: opts.vaultAddress || built.address,
    leafScript: leaf.script,
    leaves,
    destinationAddress: childAddr,
    feeSats: opts.feeSats,
    after: target.decayAt,
    internalPubkeyHex: built.internalPubkeyHex,
    policy: built.policy
  });
  return {
    ...result,
    action: 'migrate',
    leafId: leaf.id,
    decayAt: target.decayAt,
    childAddress: childAddr,
    childPolicy: target.childPolicy,
    address: built.address,
    leaves: built.leaves,
    signingNotes: 'Decay migration: output is constrained to child toAddress(policyAfterDecay).'
  };
}

/**
 * Prepare hashlock-path PSBT. Pure hashlock needs only a preimage at finalize;
 * hashlock+pubkey needs a Schnorr sig then preimage (inventory-style).
 *
 * @param {object} opts
 * @param {object} [opts.policy]
 * @param {object[]} [opts.leaves] Buffer-backed or public leaves (+ tapscriptHex)
 * @param {string|Buffer} [opts.preimage32]
 * @returns {object}
 */
function prepareHashlockWithdrawalPsbt (opts = {}) {
  let networkName = opts.networkName || opts.network;
  let vaultAddress = opts.vaultAddress || opts.address;
  let leaves;
  let publicLeaves = null;
  let internalPubkeyHex = opts.internalPubkeyHex || null;

  if (opts.policy) {
    const built = buildContractTaproot(opts.policy);
    networkName = networkName || built.network;
    vaultAddress = vaultAddress || built.address;
    leaves = compileLeaves(built.policy);
    publicLeaves = built.leaves;
    internalPubkeyHex = internalPubkeyHex || built.internalPubkeyHex;
  } else if (Array.isArray(opts.leaves) && opts.leaves.length) {
    leaves = opts.leaves.map((l) => {
      if (l && Buffer.isBuffer(l.script)) return normalizeLeaf(l);
      if (l && l.tapscriptHex) {
        return normalizeLeaf({
          kind: l.kind || 'hashlock',
          id: l.id,
          scriptHex: l.tapscriptHex,
          after: l.after,
          commitmentHex: l.commitmentHex,
          pubkeyHex: l.pubkeyHex,
          witnessShape: l.witnessShape,
          meta: l.meta
        });
      }
      return normalizeLeaf(l);
    });
  } else {
    throw new Error('prepareHashlockWithdrawalPsbt: policy or leaves required');
  }
  if (!networkName) throw new Error('prepareHashlockWithdrawalPsbt: network required');
  if (!vaultAddress) throw new Error('prepareHashlockWithdrawalPsbt: vaultAddress required');

  const leafId = opts.leafId || opts.hashlockId || null;
  const leaf = leaves.find((l) => l.kind === 'hashlock' && (!leafId || l.id === leafId));
  if (!leaf) throw new Error('hashlock leaf missing from tree');

  let preimage32 = opts.preimage32 || null;
  if (typeof preimage32 === 'string') {
    const hex = preimage32.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('preimage32 must be 32-byte hex when provided as string');
    }
    preimage32 = Buffer.from(hex, 'hex');
  }

  const result = prepareLeafPsbt({
    networkName,
    fundedTxHex: opts.fundedTxHex,
    vaultAddress,
    leafScript: leaf.script,
    leaves,
    destinationAddress: opts.destinationAddress,
    feeSats: opts.feeSats,
    after: leaf.after,
    preimage32: preimage32 || undefined,
    internalPubkeyHex: internalPubkeyHex || undefined,
    policy: opts.policy || undefined
  });

  const witnessShape = leaf.witnessShape
    || (leaf.pubkeyHex ? 'preimage+sig' : 'preimage');

  return {
    ...result,
    action: 'hashlock',
    leafId: leaf.id,
    commitmentHex: leaf.commitmentHex || (leaf.meta && leaf.meta.commitmentHex) || null,
    pubkeyHex: leaf.pubkeyHex || (leaf.meta && leaf.meta.pubkeyHex) || null,
    witnessShape,
    address: vaultAddress,
    leaves: publicLeaves || leaves.map(leafPublicView),
    signingNotes: witnessShape === 'preimage+sig'
      ? 'Witness: <schnorr_sig> <preimage32> <script> <controlBlock>. Sign then finalizeHashlockPsbt.'
      : 'Witness: <preimage32> <script> <controlBlock>. Call finalizeHashlockPsbt with preimage (no co-signer).'
  };
}

/**
 * Finalize a hashlock script-path PSBT (pure preimage or preimage+sig).
 * @param {object} opts
 * @param {string} opts.psbtBase64
 * @param {string|Buffer} opts.preimage32
 * @param {string} [opts.witnessShape='preimage']
 * @returns {{ txHex: string, txid: string }}
 */
function finalizeHashlockPsbt (opts = {}) {
  const psbt = Psbt.fromBase64(String(opts.psbtBase64 || '').trim());
  let preimage = opts.preimage32;
  if (typeof preimage === 'string') {
    preimage = Buffer.from(String(preimage).trim().replace(/^0x/i, ''), 'hex');
  }
  if (!Buffer.isBuffer(preimage) || preimage.length !== 32) {
    throw new Error('finalizeHashlockPsbt: preimage32 must be 32 bytes');
  }
  const shape = String(opts.witnessShape || 'preimage').toLowerCase();

  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    let witness;
    if (shape === 'preimage+sig' || shape === 'sig+preimage') {
      const lh = Buffer.from(bip341.tapleafHash({
        output: leaf.script,
        version: leaf.leafVersion
      }));
      const tss = (input.tapScriptSig || []).find((t) => Buffer.from(t.leafHash).equals(lh));
      if (!tss) throw new Error('Missing tapscript signature for hashlock+pubkey leaf.');
      const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
      witness = [sig, preimage, leaf.script, leaf.controlBlock];
    } else {
      witness = [preimage, leaf.script, leaf.controlBlock];
    }
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

/**
 * Collect x-only pubkeys from a k-of-n spend tapscript (`CHECKSIG` /
 * `CHECKSIGADD`), skipping a leading CSV/CLTV prefix when present.
 * @param {Buffer|Uint8Array} scriptBuf
 * @returns {Buffer[]}
 */
function parseXOnlyPubkeysFromSpendScript (scriptBuf) {
  const raw = Buffer.isBuffer(scriptBuf) ? scriptBuf : Buffer.from(scriptBuf || []);
  const chunks = script.decompile(raw) || [];
  const keys = [];
  for (let i = 0; i < chunks.length - 1; i++) {
    const chunk = chunks[i];
    const op = chunks[i + 1];
    const asBuf = Buffer.isBuffer(chunk)
      ? chunk
      : (chunk instanceof Uint8Array ? Buffer.from(chunk) : null);
    if (
      asBuf &&
      asBuf.length === 32 &&
      (op === script.OPS.OP_CHECKSIG || op === script.OPS.OP_CHECKSIGADD)
    ) {
      keys.push(Buffer.from(asBuf));
    }
  }
  return keys;
}

/**
 * Finalize a k-of-n (CHECKSIG / CHECKSIGADD) script-path PSBT after co-signers
 * have called `signInput`. Unused keys become empty witness elements (BIP342).
 *
 * Witness stack (before script + control block) is signatures in **reverse**
 * script-pubkey order so the first `CHECKSIG` pops the last stack item.
 *
 * @param {object} opts
 * @param {string} [opts.psbtBase64]
 * @param {object} [opts.psbt] bitcoinjs-lib `Psbt`
 * @returns {{ txHex: string, txid: string, witnessCount: number }}
 */
function finalizeSpendPsbt (opts = {}) {
  const psbt = opts.psbt
    ? opts.psbt
    : Psbt.fromBase64(String(opts.psbtBase64 || '').trim());

  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('finalizeSpendPsbt: missing tapLeafScript on PSBT input');
    }
    const scriptBuf = Buffer.from(leaf.script);
    const control = Buffer.from(leaf.controlBlock);
    const pubkeys = parseXOnlyPubkeysFromSpendScript(scriptBuf);
    if (!pubkeys.length) {
      throw new Error('finalizeSpendPsbt: no CHECKSIG pubkeys in leaf script');
    }
    const lh = Buffer.from(bip341.tapleafHash({
      output: leaf.script,
      version: leaf.leafVersion
    }));
    const sigByX = new Map();
    for (const tss of input.tapScriptSig || []) {
      if (!tss || !tss.leafHash || !tss.pubkey || !tss.signature) continue;
      if (!Buffer.from(tss.leafHash).equals(lh)) continue;
      const pk = Buffer.from(tss.pubkey);
      const x = pk.length === 33 ? pk.subarray(1, 33) : pk;
      if (x.length !== 32) continue;
      const sig = Buffer.from(tss.signature);
      sigByX.set(x.toString('hex'), sig.length >= 64 ? sig.subarray(0, 64) : sig);
    }
    const stack = [];
    for (let i = pubkeys.length - 1; i >= 0; i--) {
      const sig = sigByX.get(pubkeys[i].toString('hex'));
      stack.push(sig && sig.length ? sig : Buffer.alloc(0));
    }
    const signed = [...sigByX.keys()].length;
    if (signed < 1) {
      throw new Error('finalizeSpendPsbt: no tapscript signatures on input');
    }
    const witness = stack.concat([scriptBuf, control]);
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return {
    txHex: extracted.toHex(),
    txid: extracted.getId(),
    witnessCount: extracted.ins[0].witness.length
  };
}

/**
 * Authority P2TR vault from validator/signer set.
 *
 * **Default (RC):** 2-tier ladder — k-of-n authority now; softer rule after
 * `csvBlocks` (default 144) CSV. Same tree as {@link synthesizeDefaultLadder} /
 * {@link module:functions/contractSpend.resolveSpend} when inputs match.
 *
 * **Legacy:** pass `{ legacySingleLeaf: true }` for the pre-ladder single k-of-n
 * leaf address (opt-in only; not used by Hub vault summary).
 *
 * **Internal key:** default n≥2 uses the MuSig2 aggregate (`internalKeyMode:
 * 'musig2'`) — a **new address** vs historical NUMS. Pass `internalKeyMode:
 * 'nums'` to keep coins at the old script-path-only vault. Rebuilds do not
 * migrate UTXOs.
 *
 * @param {object} opts
 * @param {string} [opts.internalKeyMode] `musig2` | `nums`
 * @returns {object}
 */
function buildFederationVaultFromPolicy (opts = {}) {
  const {
    threshold,
    networkName,
    publisher,
    csvBlocks,
    failover,
    softMode,
    softThreshold,
    legacySingleLeaf,
    internalKeyMode
  } = opts;
  const validatorPubkeysHex = opts.validatorPubkeysHex || opts.validators || [];
  const pks = parseCompressedPubkeysSorted(validatorPubkeysHex);
  if (!pks.length) throw new Error('At least one validator pubkey is required.');
  const thr = Number(threshold);
  if (!Number.isInteger(thr) || thr < 1) {
    throw new Error('threshold must be a positive integer');
  }
  if (thr > pks.length) {
    throw new Error(`threshold ${thr} exceeds unique key count ${pks.length}`);
  }

  const network = networkName || opts.network;
  if (!network) {
    throw new Error('buildFederationVaultFromPolicy: networkName required');
  }

  const useLegacy = legacySingleLeaf === true
    && failover !== true
    && !(publisher && csvBlocks != null && Number(csvBlocks) > 0);

  if (!useLegacy) {
    const built = buildContractTaproot(synthesizeDefaultLadder({
      validators: validatorPubkeysHex,
      threshold: thr,
      network,
      publisher: publisher || pks[0].toString('hex'),
      csvBlocks: csvBlocks != null ? csvBlocks : DEFAULT_CSV_BLOCKS,
      softMode,
      softThreshold,
      internalKeyMode
    }));
    const t0 = built.leaves.find((l) => l.kind === 'spend' && (l.id === 't0-authority' || l.id === 't0-federation'))
      || built.leaves.find((l) => l.kind === 'spend');
    const soft = built.policy && built.policy.tiers
      ? built.policy.tiers.find((t) => t.id === 't1-soft' || t.id === 't1-publisher')
      : null;
    return {
      address: built.address,
      /** Alias aligned with ARC / tracked summaries. */
      spendAddress: built.address,
      output: built.output,
      multisigScript: Buffer.from(t0.tapscriptHex, 'hex'),
      network,
      threshold: thr,
      validators: pks.map((b) => b.toString('hex')),
      validatorsSortedHex: pks.map((b) => b.toString('hex')),
      publisher: String(publisher || pks[0].toString('hex')).toLowerCase(),
      softMode: softMode
        ? (String(softMode).toLowerCase() === 'reduced' ? 'reduced' : 'publisher')
        : 'publisher',
      internalPubkeyHex: built.internalPubkeyHex,
      depositMaturityBlocks: csvBlocks != null ? Number(csvBlocks) : DEFAULT_CSV_BLOCKS,
      csvBlocks: soft && soft.after && soft.after.blocks != null
        ? Number(soft.after.blocks)
        : DEFAULT_CSV_BLOCKS,
      softTier: soft || null,
      scheme: 'taproot-authority-ladder-v1',
      spendPolicy: {
        publisher: String(publisher || pks[0].toString('hex')).toLowerCase(),
        validators: pks.map((b) => b.toString('hex')),
        threshold: thr,
        csvBlocks: soft && soft.after && soft.after.blocks != null
          ? Number(soft.after.blocks)
          : (csvBlocks != null ? Number(csvBlocks) : DEFAULT_CSV_BLOCKS),
        softMode: softMode
          ? (String(softMode).toLowerCase() === 'reduced' ? 'reduced' : 'publisher')
          : 'publisher',
        network,
        internalKeyMode: built.internalPubkeyHex === TAPROOT_INTERNAL_NUMS.toString('hex')
          ? 'nums'
          : 'musig2'
      },
      policy: built.policy,
      leaves: built.leaves
    };
  }

  const multisigScript = buildKOfNTapscript(pks, thr);
  const btcNet = networkForFabricName(network);
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree: { output: multisigScript },
    network: btcNet
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce vault address.');
  const msBuf = Buffer.isBuffer(multisigScript) ? multisigScript : Buffer.from(multisigScript);
  const outBuf = Buffer.isBuffer(pay.output) ? pay.output : Buffer.from(pay.output);
  return {
    address: pay.address,
    output: outBuf,
    multisigScript: msBuf,
    network,
    threshold: thr,
    validatorsSortedHex: pks.map((b) => b.toString('hex')),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
    depositMaturityBlocks: DEFAULT_CSV_BLOCKS,
    scheme: 'taproot-tapscript-k-of-n-legacy-v0',
    policy: null,
    leaves: [{ kind: 'spend', id: 't0-federation', tapscriptHex: msBuf.toString('hex') }]
  };
}

function buildVaultControlBlock (multisigScript) {
  const ms = Buffer.isBuffer(multisigScript)
    ? multisigScript
    : Buffer.from(String(multisigScript || ''), 'hex');
  return buildControlBlockForLeaf([{ script: ms }], ms);
}

function prepareVaultWithdrawalPsbt (opts = {}) {
  // Prefer full policy / composed leaves (authority ladder + optional extras).
  if (opts.policy) {
    if (opts.action === 'hashlock' || opts.leafKind === 'hashlock' || opts.leafId === 'hashlock') {
      return prepareHashlockWithdrawalPsbt(opts);
    }
    if (opts.leafId) {
      const built = buildContractTaproot(opts.policy);
      const leaves = compileLeaves(built.policy);
      const leaf = leaves.find((l) => l.id === opts.leafId);
      if (!leaf) throw new Error(`leaf ${opts.leafId} not in tree`);
      if (leaf.kind === 'hashlock') {
        return prepareHashlockWithdrawalPsbt(Object.assign({}, opts, {
          policy: built.policy,
          leafId: leaf.id
        }));
      }
      if (leaf.kind === 'migrate') {
        return prepareDecayMigrationPsbt(opts);
      }
      return prepareTierWithdrawalPsbt(Object.assign({}, opts, { tierId: leaf.id }));
    }
    return prepareTierWithdrawalPsbt(opts);
  }
  // Legacy: single leaf tree
  if (opts.multisigScript) {
    const ms = Buffer.isBuffer(opts.multisigScript)
      ? opts.multisigScript
      : Buffer.from(String(opts.multisigScript || '').replace(/^0x/i, ''), 'hex');
    return {
      ...prepareLeafPsbt({
        networkName: opts.networkName,
        fundedTxHex: opts.fundedTxHex,
        vaultAddress: opts.vaultAddress,
        leafScript: ms,
        leaves: [{ script: ms }],
        destinationAddress: opts.destinationAddress,
        feeSats: opts.feeSats
      }),
      signingNotes: 'Validators partially sign the same PSBT input (tapscript leaf).'
    };
  }
  throw new Error('prepareVaultWithdrawalPsbt: policy or multisigScript required');
}

module.exports = {
  TAPROOT_INTERNAL_NUMS,
  DEFAULT_CSV_BLOCKS,
  CLTV_TIMESTAMP_THRESHOLD,
  MAX_LOCKTIME,
  networkForFabricName,
  parseCompressedPubkeysSorted,
  buildKOfNTapscript,
  normalizeLock,
  timelockMature,
  lockValue,
  synthesizeDefaultLadder,
  normalizeContractSpendPolicy,
  policyAfterDecay,
  compileLeaves,
  scriptTreeFromLeaves,
  composeTaprootTree,
  normalizeHashlockSpec,
  normalizeLeaf,
  buildHashlockTapscript,
  buildHashlockLeaf,
  buildSpendLeaf,
  buildScriptLeaf,
  buildContractTaproot,
  toAddress,
  selectActiveTiers,
  selectMigrateTarget,
  prepareLeafPsbt,
  prepareTierWithdrawalPsbt,
  prepareDecayMigrationPsbt,
  prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt,
  finalizeSpendPsbt,
  parseXOnlyPubkeysFromSpendScript,
  buildFederationVaultFromPolicy,
  prepareVaultWithdrawalPsbt,
  buildVaultControlBlock,
  buildControlBlockForLeaf
};
