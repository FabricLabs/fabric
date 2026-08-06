'use strict';

/**
 * Build an auditable report of Beacon epochs ↔ real regtest L1 blocks/txs.
 * Long campaigns (≥1000 epochs) use light L1 inspect + deep samples.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Beacon = require('../../../types/beacon');
const sidechainState = require('../../../functions/sidechainState');

const DEFAULT_AUDIT_JSON = path.join(__dirname, '../../../reports/simulator-beacon-audit-latest.json');
const DEFAULT_AUDIT_MD = path.join(__dirname, '../../../reports/simulator-beacon-audit-latest.md');

/**
 * Light L1 inspect (verbosity 1) — scalable for 1000+ epochs.
 * @param {object} bitcoin Bitcoin service
 * @param {string} blockHash
 * @returns {Promise<object>}
 */
async function inspectL1BlockLight (bitcoin, blockHash) {
  const hash = String(blockHash || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    return { ok: false, error: 'invalid blockHash', depth: 'light' };
  }
  const block = await bitcoin._makeRPCRequest('getblock', [hash, 1]);
  const txids = Array.isArray(block.tx) ? block.tx.filter((t) => typeof t === 'string') : [];
  let confirmed = false;
  try {
    const tipHash = await bitcoin._makeRPCRequest('getblockhash', [block.height]);
    confirmed = String(tipHash).toLowerCase() === hash.toLowerCase();
  } catch (_) {
    confirmed = false;
  }
  return {
    ok: true,
    depth: 'light',
    height: block.height,
    hash: block.hash || hash,
    time: block.time,
    nTx: block.nTx != null ? block.nTx : txids.length,
    merkleroot: block.merkleroot || null,
    previousblockhash: block.previousblockhash || null,
    txids,
    coinbase: { txid: txids[0] || null },
    confirmedOnActiveChain: confirmed
  };
}

/**
 * Deep L1 inspect (verbosity 2) — coinbase value + vouts.
 * @param {object} bitcoin Bitcoin service
 * @param {string} blockHash
 * @returns {Promise<object>}
 */
async function inspectL1Block (bitcoin, blockHash) {
  const hash = String(blockHash || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    return { ok: false, error: 'invalid blockHash', depth: 'deep' };
  }
  const block = await bitcoin._makeRPCRequest('getblock', [hash, 2]);
  const txids = Array.isArray(block.tx)
    ? block.tx.map((t) => (typeof t === 'string' ? t : t.txid)).filter(Boolean)
    : [];
  const coinbase = Array.isArray(block.tx) && block.tx[0] && typeof block.tx[0] === 'object'
    ? {
      txid: block.tx[0].txid,
      voutCount: Array.isArray(block.tx[0].vout) ? block.tx[0].vout.length : 0,
      valueBtc: Array.isArray(block.tx[0].vout)
        ? block.tx[0].vout.reduce((s, o) => s + (Number(o.value) || 0), 0)
        : null
    }
    : { txid: txids[0] || null };

  let confirmed = false;
  try {
    const tipHash = await bitcoin._makeRPCRequest('getblockhash', [block.height]);
    confirmed = String(tipHash).toLowerCase() === hash.toLowerCase();
  } catch (_) {
    confirmed = false;
  }

  return {
    ok: true,
    depth: 'deep',
    height: block.height,
    hash: block.hash || hash,
    time: block.time,
    nTx: block.nTx != null ? block.nTx : txids.length,
    merkleroot: block.merkleroot || null,
    previousblockhash: block.previousblockhash || null,
    txids,
    coinbase,
    confirmedOnActiveChain: confirmed
  };
}

function pickDeepSampleIndexes (n, maxDeep = 24) {
  if (n <= maxDeep) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const set = new Set([0, 1, n - 2, n - 1]);
  const stride = Math.max(1, Math.floor(n / (maxDeep - 4)));
  for (let i = 0; i < n && set.size < maxDeep; i += stride) set.add(i);
  return Array.from(set).filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
}

/**
 * Enrich sealed epoch payloads with L1 inspection + local beacon chain entry ids.
 * @param {object} harness from startRegtestBeaconHarness
 * @param {object[]} epochs sealed BEACON_EPOCH payloads
 * @param {{ deepIndexes?: Set<number> }} [opts]
 */
async function buildEpochAuditRows (harness, epochs = [], opts = {}) {
  const rows = [];
  const chainMessages = harness.beacon._epochChain
    ? harness.beacon._epochChain.toBeaconMessages()
    : [];
  const deepIndexes = opts.deepIndexes || null;

  for (let idx = 0; idx < epochs.length; idx++) {
    const payload = epochs[idx];
    if (!payload || payload.pending) continue;
    const useDeep = !deepIndexes || deepIndexes.has(idx);
    const l1 = useDeep
      ? await inspectL1Block(harness.bitcoin, payload.blockHash)
      : await inspectL1BlockLight(harness.bitcoin, payload.blockHash);
    const entry = chainMessages.find((m) =>
      m && m.payload && m.payload.clock === payload.clock
    );
    const snap = sidechainState.loadSnapshotForBeaconClock(harness.fs, payload.clock);
    const stateAtSeal = snap || null;
    const digestCheck = stateAtSeal
      ? sidechainState.stateDigest(stateAtSeal) === String(payload.sidechain && payload.sidechain.stateDigest)
      : false;

    rows.push({
      beaconClock: payload.clock,
      beaconTimestamp: payload.timestamp || null,
      beaconEntryId: entry && entry.id ? entry.id : null,
      balanceSats: payload.balanceSats != null ? payload.balanceSats : null,
      sidechain: payload.sidechain || null,
      sidechainDigestMatchesSnapshot: digestCheck,
      snapshotPresent: !!snap,
      l1: {
        height: payload.height,
        blockHash: payload.blockHash,
        ...l1
      }
    });
  }
  return rows;
}

/**
 * @param {object} ctx simulator ctx after beacon-registry setup
 * @param {object} [simReport] metrics.toReport() result
 * @returns {object}
 */
async function buildBeaconAuditReport (ctx, simReport = null) {
  const br = ctx && ctx.state && ctx.state.beaconRegistry;
  if (!br || br.skipped || !br.harness) {
    return {
      generatedAt: new Date().toISOString(),
      kind: 'FabricBeaconAuditReport',
      version: 2,
      skipped: true,
      reason: 'FABRIC_E2E_REGTEST not set or harness absent'
    };
  }

  const harness = br.harness;
  const epochs = br.epochs || [];
  const deepIdxList = pickDeepSampleIndexes(epochs.length);
  const deepIndexes = new Set(deepIdxList);
  const auditRows = await buildEpochAuditRows(harness, epochs, { deepIndexes });
  const merkleRoot = harness.beacon.merkleRoot;
  const chainLen = harness.beacon.getEpochChainSummary().length;
  const tipState = harness.state;
  const tipDigest = sidechainState.stateDigest(tipState);

  const allL1Confirmed = auditRows.every((r) => r.l1 && r.l1.ok && r.l1.confirmedOnActiveChain);
  const allDigestsMatch = auditRows.every((r) => r.sidechainDigestMatchesSnapshot);
  const heights = auditRows.map((r) => r.l1 && r.l1.height).filter((h) => Number.isFinite(h));
  const heightsMonotone = heights.every((h, i) => i === 0 || h > heights[i - 1]);
  const coinbases = auditRows.map((r) => r.l1 && r.l1.coinbase && r.l1.coinbase.txid).filter(Boolean);
  const uniqueCoinbases = new Set(coinbases.map((t) => String(t).toLowerCase())).size;

  const campaign = {
    epochTarget: br.epochTarget || epochs.length,
    documentsPublished: br.metrics && br.metrics.documentsPublished,
    documentsRequested: br.metrics && br.metrics.documentsRequested,
    bytesPublished: br.metrics && br.metrics.bytesPublished,
    connectivityChanges: br.metrics && br.metrics.connectivityChanges,
    registryUpdates: br.metrics && br.metrics.registryUpdates,
    sizeHistogram: br.metrics && br.metrics.sizeHistogram,
    connectivityModes: (br.connectivityLog || []).map((c) => c.mode),
    exchangeBursts: (br.exchangeLog || []).length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    kind: 'FabricBeaconAuditReport',
    version: 2,
    scenario: 'beacon-registry',
    network: 'regtest',
    auditable: allL1Confirmed && allDigestsMatch && heightsMonotone &&
      auditRows.length >= 2 && uniqueCoinbases === coinbases.length,
    summary: {
      epochsSealed: auditRows.length,
      epochTarget: campaign.epochTarget,
      registryDocuments: br.metrics && br.metrics.registryDocs,
      sidechainClock: tipState.clock,
      tipStateDigest: tipDigest,
      beaconChainLength: chainLen,
      beaconMerkleRoot: merkleRoot,
      l1HeightFirst: heights[0] != null ? heights[0] : null,
      l1HeightLast: heights.length ? heights[heights.length - 1] : null,
      l1HeightCount: heights.length,
      heightsStrictlyIncreasing: heightsMonotone,
      allBlocksOnActiveChain: allL1Confirmed,
      allSidechainDigestsMatchSnapshots: allDigestsMatch,
      uniqueCoinbaseTxids: uniqueCoinbases,
      deepSampleCount: deepIdxList.length,
      campaign
    },
    registry: tipState.content && tipState.content.registry
      ? {
        sellerCount: tipState.content.registry.sellerCount,
        documentCount: Object.keys(tipState.content.registry.documents || {}).length,
        documentIdsSample: Object.keys(tipState.content.registry.documents || {}).slice(0, 40),
        updatedAt: tipState.content.registry.updatedAt || null
      }
      : null,
    epochs: auditRows,
    deepSampleIndexes: deepIdxList,
    simulator: simReport
      ? {
        seed: simReport.seed,
        peers: simReport.peers,
        steps: simReport.steps,
        actionsExecuted: simReport.actionsExecuted,
        elapsedMs: simReport.elapsedMs,
        hardErrors: simReport.hardErrors,
        events: simReport.events
      }
      : null,
    verificationNotes: [
      'Each Beacon epoch mines one regtest block (generatetoaddress) and records blockHash + height.',
      'l1.coinbase.txid is the coinbase transaction of that block (real L1 tx).',
      'Long runs use getblock verbosity 1 for all epochs; a deep sample uses verbosity 2 (coinbase value).',
      'sidechain.stateDigest is fabricCanonicalJson digest of sidechain/STATE at seal time.',
      'beaconMerkleRoot is Chain.digest() over the federation epoch chain (beacon/CHAIN).',
      'confirmedOnActiveChain uses getblockhash(height) === epoch.blockHash.',
      'Campaign metrics cover mixed-size document exchanges and connectivity perturbations between seals.'
    ]
  };

  // Compact hash payload for large epoch lists (heights + digests + coinbases).
  report.reportHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      kind: report.kind,
      version: report.version,
      tip: report.summary.tipStateDigest,
      merkle: report.summary.beaconMerkleRoot,
      sealed: report.summary.epochsSealed,
      heightFirst: report.summary.l1HeightFirst,
      heightLast: report.summary.l1HeightLast,
      digests: auditRows.map((r) => r.sidechain && r.sidechain.stateDigest),
      coinbases,
      campaign: report.summary.campaign
    }))
    .digest('hex');

  return report;
}

function formatEpochMd (e) {
  const lines = [];
  lines.push(`### Beacon clock ${e.beaconClock}`);
  lines.push('');
  lines.push(`- Timestamp: ${e.beaconTimestamp}`);
  lines.push(`- Beacon entry id: \`${e.beaconEntryId || 'n/a'}\``);
  lines.push(`- Sidechain digest: \`${e.sidechain && e.sidechain.stateDigest}\``);
  lines.push(`- Digest matches snapshot: ${e.sidechainDigestMatchesSnapshot}`);
  lines.push(`- L1 height: ${e.l1.height}`);
  lines.push(`- L1 block hash: \`${e.l1.blockHash || e.l1.hash}\``);
  lines.push(`- L1 inspect depth: ${e.l1.depth || 'n/a'}`);
  lines.push(`- L1 confirmed on active chain: ${e.l1.confirmedOnActiveChain}`);
  lines.push(`- L1 coinbase txid: \`${e.l1.coinbase && e.l1.coinbase.txid}\``);
  if (e.l1.coinbase && e.l1.coinbase.valueBtc != null) {
    lines.push(`- L1 coinbase value (BTC): ${e.l1.coinbase.valueBtc}`);
  }
  lines.push(`- L1 block merkle root: \`${e.l1.merkleroot}\``);
  lines.push(`- L1 nTx: ${e.l1.nTx}`);
  lines.push('');
  return lines;
}

/**
 * Markdown view of the audit report (human-readable).
 * @param {object} report
 * @returns {string}
 */
function formatBeaconAuditMarkdown (report) {
  if (!report || report.skipped) {
    return '# Fabric Beacon audit report\n\n_Skipped (set `FABRIC_E2E_REGTEST=1`)._\n';
  }
  const lines = [];
  lines.push('# Fabric Beacon audit report');
  lines.push('');
  lines.push(`Generated: \`${report.generatedAt}\``);
  lines.push(`Auditable: **${report.auditable ? 'yes' : 'no'}**`);
  lines.push(`Report hash: \`${report.reportHash}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Epochs sealed: ${report.summary.epochsSealed} (target ${report.summary.epochTarget})`);
  lines.push(`- Registry documents: ${report.summary.registryDocuments}`);
  lines.push(`- Tip state digest: \`${report.summary.tipStateDigest}\``);
  lines.push(`- Beacon chain length: ${report.summary.beaconChainLength}`);
  lines.push(`- Beacon merkle root: \`${report.summary.beaconMerkleRoot}\``);
  lines.push(`- L1 height range: ${report.summary.l1HeightFirst} → ${report.summary.l1HeightLast} (${report.summary.l1HeightCount} tips)`);
  lines.push(`- Heights strictly increasing: ${report.summary.heightsStrictlyIncreasing}`);
  lines.push(`- All blocks on active chain: ${report.summary.allBlocksOnActiveChain}`);
  lines.push(`- Sidechain digests match snapshots: ${report.summary.allSidechainDigestsMatchSnapshots}`);
  lines.push(`- Unique coinbase txids: ${report.summary.uniqueCoinbaseTxids}`);
  lines.push('');

  const camp = report.summary.campaign;
  if (camp) {
    lines.push('## Campaign (exchanges & connectivity)');
    lines.push('');
    lines.push(`- Documents published: ${camp.documentsPublished}`);
    lines.push(`- Documents requested: ${camp.documentsRequested}`);
    lines.push(`- Bytes published: ${camp.bytesPublished}`);
    lines.push(`- Exchange bursts: ${camp.exchangeBursts}`);
    lines.push(`- Connectivity changes: ${camp.connectivityChanges}`);
    lines.push(`- Registry updates: ${camp.registryUpdates}`);
    lines.push(`- Connectivity modes: ${(camp.connectivityModes || []).join(' → ') || '(none)'}`);
    if (camp.sizeHistogram) {
      lines.push(`- Size histogram: \`${JSON.stringify(camp.sizeHistogram)}\``);
    }
    lines.push('');
  }

  if (report.registry) {
    lines.push('## Registry');
    lines.push('');
    lines.push(`- Seller count: ${report.registry.sellerCount}`);
    lines.push(`- Document count: ${report.registry.documentCount}`);
    lines.push(`- Sample ids: ${(report.registry.documentIdsSample || []).join(', ') || '(none)'}`);
    lines.push('');
  }

  const all = report.epochs || [];
  const sampleIdx = new Set(report.deepSampleIndexes || pickDeepSampleIndexes(all.length));
  lines.push(`## Epochs (deep sample: ${sampleIdx.size} of ${all.length})`);
  lines.push('');
  for (let i = 0; i < all.length; i++) {
    if (!sampleIdx.has(i)) continue;
    lines.push(...formatEpochMd(all[i]));
  }

  lines.push('## Verification notes');
  lines.push('');
  for (const n of report.verificationNotes || []) {
    lines.push(`- ${n}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {object} report
 * @param {{ jsonPath?: string, mdPath?: string }} [paths]
 */
function writeBeaconAuditReport (report, paths = {}) {
  const jsonPath = paths.jsonPath || DEFAULT_AUDIT_JSON;
  const mdPath = paths.mdPath || DEFAULT_AUDIT_MD;
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdPath, formatBeaconAuditMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}

module.exports = {
  DEFAULT_AUDIT_JSON,
  DEFAULT_AUDIT_MD,
  inspectL1Block,
  inspectL1BlockLight,
  pickDeepSampleIndexes,
  buildEpochAuditRows,
  buildBeaconAuditReport,
  formatBeaconAuditMarkdown,
  writeBeaconAuditReport,
  Beacon
};
