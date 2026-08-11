'use strict';

/**
 * Deterministic Contract → P2TR spend policy (failover ladder).
 *
 * Tiers compile to tapscript leaves (k-of-n + optional CSV/CLTV `after`).
 * `until` expires tiers off-chain (and schedules decay migration leaves).
 *
 * @see docs/DISTRIBUTED_EXECUTION.md
 * @see functions/contractTierWhen.js
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('../types/ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const { payments, networks, script, Psbt } = bitcoin;
const { evaluateTierWhen } = require('./contractTierWhen');

bitcoin.initEccLib(ecc);

/** BIP341-style NUMS x-only internal key (script-path spend only). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

const DEFAULT_CSV_BLOCKS = 144;

/** BIP65: nLockTime / CLTV values ≥ this threshold are unix timestamps. */
const CLTV_TIMESTAMP_THRESHOLD = 500000000;
const MAX_LOCKTIME = 0xffffffff;

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
  out.sort((a, b) => a.compare(b));
  const uniq = [];
  for (const b of out) {
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
 * Synthesize a 2-tier ladder from legacy vault fields.
 */
function synthesizeDefaultLadder (opts = {}) {
  const validators = Array.isArray(opts.validators)
    ? opts.validators
    : (Array.isArray(opts.validatorPubkeysHex) ? opts.validatorPubkeysHex : []);
  const threshold = Math.max(1, Number(opts.threshold) || 1);
  const publisher = opts.publisher
    ? String(opts.publisher).trim().toLowerCase()
    : (validators[0] ? String(validators[0]).trim().toLowerCase() : null);
  const csvBlocks = Math.max(1, Number(opts.csvBlocks) || DEFAULT_CSV_BLOCKS);
  const network = opts.network || opts.networkName || 'regtest';
  if (!validators.length) throw new Error('synthesizeDefaultLadder requires validators');
  if (!publisher) throw new Error('synthesizeDefaultLadder requires publisher');

  return normalizeContractSpendPolicy({
    version: 1,
    network,
    publisher,
    keySets: {
      full: validators.map((v) => String(v).trim().toLowerCase())
    },
    decay: { mode: 'policy' },
    tiers: [
      {
        id: 't0-federation',
        threshold,
        keys: 'full',
        after: null,
        until: null
      },
      {
        id: 't1-publisher',
        threshold: 1,
        keys: 'publisher',
        after: { type: 'csv', blocks: csvBlocks },
        until: null
      }
    ]
  });
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
    tiers
  };
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
    }))
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
 * Build leaf descriptors for a normalized policy.
 * @returns {{ kind: string, id: string, script: Buffer, after: object|null, tierIndex?: number, decayAt?: object }[]}
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
      keys: t.keys
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
          keys: p.decay.migrateKeys
        });
      }
    }
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

function buildControlBlockForLeaf (leaves, leafScript) {
  const scriptTree = scriptTreeFromLeaves(leaves);
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: leafScript, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Leaf script not in tap tree.');
  const outputKey = bip341.tweakKey(TAPROOT_INTERNAL_NUMS, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed.');
  return Buffer.concat([
    Buffer.from([leafVersion | outputKey.parity]),
    TAPROOT_INTERNAL_NUMS,
    ...path
  ]);
}

/**
 * @param {object} policy
 * @returns {object}
 */
function buildContractTaproot (policy) {
  const p = normalizeContractSpendPolicy(policy);
  const leaves = compileLeaves(p);
  const network = networkForFabricName(p.network);
  const scriptTree = scriptTreeFromLeaves(leaves);
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree,
    network
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce address.');
  return {
    address: pay.address,
    output: Buffer.isBuffer(pay.output) ? pay.output : Buffer.from(pay.output),
    network: p.network,
    policy: p,
    leaves: leaves.map((l) => ({
      kind: l.kind,
      id: l.id,
      tierIndex: l.tierIndex,
      tapscriptHex: l.script.toString('hex'),
      after: l.after,
      until: l.until,
      decayAt: l.decayAt,
      threshold: l.threshold,
      keys: l.keys
    })),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex')
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
    if (sequence == null || sequence === 0xffffffff) sequence = 0xfffffffe;
  }

  const controlBlock = buildControlBlockForLeaf(leaves, ms);
  const outScript = Buffer.isBuffer(out.script) ? out.script : Buffer.from(out.script);
  const input = {
    hash: tx.getId(),
    index: vout,
    witnessUtxo: {
      script: Uint8Array.from(outScript),
      value: BigInt(inputSats)
    },
    tapInternalKey: Uint8Array.from(TAPROOT_INTERNAL_NUMS),
    tapLeafScript: [{
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT,
      script: Uint8Array.from(ms),
      controlBlock: Uint8Array.from(controlBlock)
    }]
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
    locktime: locktime != null ? Number(locktime) : undefined
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
    after: tier.after
  });
  return {
    ...result,
    tierId: tier.id,
    action: 'spend',
    address: built.address,
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
    after: target.decayAt
  });
  return {
    ...result,
    action: 'migrate',
    decayAt: target.decayAt,
    childAddress: childAddr,
    childPolicy: target.childPolicy,
    address: built.address,
    signingNotes: 'Decay migration: output is constrained to child toAddress(policyAfterDecay).'
  };
}

/**
 * Legacy Hub vault API: single k-of-n leaf (address-stable with prior Hub vault).
 * Pass `{ failover: true }` or `publisher` + positive `csvBlocks` to use the full default ladder.
 */
function buildFederationVaultFromPolicy (opts = {}) {
  const {
    validatorPubkeysHex,
    threshold,
    networkName,
    publisher,
    csvBlocks,
    failover
  } = opts;
  const pks = parseCompressedPubkeysSorted(validatorPubkeysHex);
  if (!pks.length) throw new Error('At least one validator pubkey is required.');
  const thr = Number(threshold);
  if (!Number.isInteger(thr) || thr < 1) {
    throw new Error('threshold must be a positive integer');
  }
  if (thr > pks.length) {
    throw new Error(`threshold ${thr} exceeds unique key count ${pks.length}`);
  }

  if (failover || (publisher && csvBlocks != null && Number(csvBlocks) > 0)) {
    const built = buildContractTaproot(synthesizeDefaultLadder({
      validators: validatorPubkeysHex,
      threshold: thr,
      network: networkName,
      publisher: publisher || pks[0].toString('hex'),
      csvBlocks: csvBlocks != null ? csvBlocks : DEFAULT_CSV_BLOCKS
    }));
    const t0 = built.leaves.find((l) => l.kind === 'spend');
    return {
      address: built.address,
      output: built.output,
      multisigScript: Buffer.from(t0.tapscriptHex, 'hex'),
      network: networkName,
      threshold: thr,
      validatorsSortedHex: pks.map((b) => b.toString('hex')),
      internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
      depositMaturityBlocks: DEFAULT_CSV_BLOCKS,
      policy: built.policy,
      leaves: built.leaves
    };
  }

  const multisigScript = buildKOfNTapscript(pks, thr);
  const network = networkForFabricName(networkName);
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree: { output: multisigScript },
    network
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce vault address.');
  const msBuf = Buffer.isBuffer(multisigScript) ? multisigScript : Buffer.from(multisigScript);
  const outBuf = Buffer.isBuffer(pay.output) ? pay.output : Buffer.from(pay.output);
  return {
    address: pay.address,
    output: outBuf,
    multisigScript: msBuf,
    network: networkName,
    threshold: thr,
    validatorsSortedHex: pks.map((b) => b.toString('hex')),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
    depositMaturityBlocks: DEFAULT_CSV_BLOCKS,
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
  // Legacy: single leaf tree
  if (opts.multisigScript && !opts.policy) {
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
  return prepareTierWithdrawalPsbt(opts);
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
  buildContractTaproot,
  toAddress,
  selectActiveTiers,
  selectMigrateTarget,
  prepareTierWithdrawalPsbt,
  prepareDecayMigrationPsbt,
  buildFederationVaultFromPolicy,
  prepareVaultWithdrawalPsbt,
  buildVaultControlBlock,
  buildControlBlockForLeaf
};
