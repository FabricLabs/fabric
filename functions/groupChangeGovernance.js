'use strict';

/**
 * ARC GroupChangeProposal / GroupChangeVote helpers.
 *
 * Canonical BIP340 signing string is shared with application vote helpers so
 * validator votes interoperate across the mesh. Fold applies an adopted
 * proposal as the equivalent GroupChange (k-of-n) without a second AMP frame.
 *
 * @module functions/groupChangeGovernance
 */

const Key = require('../types/key');
const { pubkeyXOnly } = require('./groupChatSeal');

const GOVERNANCE_ACTIONS = Object.freeze(['member.add', 'member.remove', 'members.set', 'signers.set', 'update']);

/**
 * Canonical unique sorted x-only pubkeys for BIP340 proposal votes.
 * @param {*} list
 * @returns {string[]|null}
 * @private
 */
function canonicalPubkeyList (list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const x = pubkeyXOnly(item);
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  out.sort();
  return out;
}

/**
 * Canonical UTF-8 string validators BIP340-sign for a proposal.
 * v2 binds `members` / `signers` so votes cannot be reused on a colliding
 * `id` with a swapped roster (`members.set` / `signers.set`).
 * @param {object} proposal
 * @returns {string}
 */
function signingStringForGroupChangeProposal (proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  const body = {
    type: 'GroupChangeProposal',
    v: 2,
    id: String(p.id || ''),
    contractId: String(p.contractId || '').toLowerCase(),
    groupId: String(p.groupId || ''),
    action: String(p.action || ''),
    member: p.member != null ? String(p.member).toLowerCase() : null,
    role: p.role != null ? String(p.role) : null,
    members: canonicalPubkeyList(p.members),
    signers: canonicalPubkeyList(p.signers),
    patch: p.patch && typeof p.patch === 'object' ? p.patch : null,
    proposedBy: String(p.proposedBy || '').toLowerCase(),
    createdAt: String(p.createdAt || '')
  };
  return JSON.stringify(body);
}

/**
 * @param {object} obj proposal wire object
 * @returns {string}
 */
function proposalIdOf (obj) {
  return String((obj && obj.id) || '').trim();
}

/**
 * @param {object} key Fabric Key with private material
 * @param {object} proposal
 * @returns {{ pubkey: string, signature: string, message: string }}
 */
function signProposalVote (key, proposal) {
  if (!key || typeof key.signSchnorr !== 'function') {
    throw new Error('signProposalVote: Key required');
  }
  const message = signingStringForGroupChangeProposal(proposal);
  const signature = Buffer.from(key.signSchnorr(Buffer.from(message, 'utf8'))).toString('hex');
  return {
    pubkey: String(key.pubkey || '').toLowerCase(),
    signature,
    message
  };
}

/**
 * @param {object} proposal
 * @param {string} pubkey compressed or x-only hex
 * @param {string} signatureHex
 * @returns {boolean}
 */
function verifyProposalVote (proposal, pubkey, signatureHex) {
  try {
    const pk = String(pubkey || '').trim();
    const sig = String(signatureHex || '').trim().toLowerCase();
    if (!pk || !sig || sig.startsWith('local:')) return false;
    if (!/^[0-9a-f]{128}$/.test(sig)) return false;
    const x = pubkeyXOnly(pk);
    if (!x) return false;
    const key = new Key({ public: `02${x}` });
    const message = signingStringForGroupChangeProposal(proposal);
    return key.verifySchnorr(message, Buffer.from(sig, 'hex')) === true;
  } catch (_) {
    return false;
  }
}

/**
 * Apply a GroupChange-shaped object onto fold sets.
 * @param {object} ctx
 * @param {Set<string>} ctx.members
 * @param {Set<string>} ctx.signers
 * @param {boolean} ctx.readerOnlyAdds
 * @param {number|null} ctx.threshold
 * @param {object} obj
 * @returns {object} ctx
 */
function applyGroupChangeAction (ctx, obj) {
  const action = String((obj && obj.action) || '');
  const role = String((obj && obj.role) || 'signer').toLowerCase() === 'reader' ? 'reader' : 'signer';
  if (action === 'member.add' && obj.member) {
    const x = pubkeyXOnly(obj.member);
    if (x) {
      ctx.members.add(x);
      if (role === 'signer') ctx.signers.add(x);
      else ctx.readerOnlyAdds = true;
    }
  } else if (action === 'member.remove' && obj.member) {
    const x = pubkeyXOnly(obj.member);
    if (x) {
      ctx.members.delete(x);
      ctx.signers.delete(x);
    }
  } else if (action === 'members.set' && Array.isArray(obj.members)) {
    ctx.members.clear();
    ctx.signers.clear();
    ctx.readerOnlyAdds = false;
    for (const m of obj.members) {
      const x = pubkeyXOnly(m);
      if (x) {
        ctx.members.add(x);
        ctx.signers.add(x);
      }
    }
  } else if (action === 'signers.set' && Array.isArray(obj.signers)) {
    ctx.signers.clear();
    ctx.readerOnlyAdds = true;
    for (const m of obj.signers) {
      const x = pubkeyXOnly(m);
      if (x) {
        ctx.signers.add(x);
        ctx.members.add(x);
      }
    }
  } else if (action === 'update' && obj.patch && typeof obj.patch === 'object') {
    const patch = obj.patch;
    if (patch.threshold != null && Number.isFinite(Number(patch.threshold))) {
      ctx.threshold = Math.max(1, Math.floor(Number(patch.threshold)));
    }
    if (Array.isArray(patch.signers)) {
      applyGroupChangeAction(ctx, { action: 'signers.set', signers: patch.signers });
    }
    if (Array.isArray(patch.members)) {
      applyGroupChangeAction(ctx, { action: 'members.set', members: patch.members });
    }
  }
  return ctx;
}

/**
 * Fold proposals + votes from hash-sorted entries; adopt when votes ≥ threshold.
 * @param {object[]} entries
 * @param {object} ctx member/signer sets after explicit GroupChange
 * @param {number} [genesisThreshold]
 * @param {Iterable<string>} [genesisSigners]
 * @returns {object[]} proposal summaries (sorted by id)
 */
function foldProposals (entries, ctx, genesisThreshold, genesisSigners) {
  const proposals = Object.create(null);
  const pendingVotes = [];

  for (const row of entries || []) {
    const type = String(row.type || '');
    const obj = row.object && typeof row.object === 'object' ? row.object : {};
    if (type === 'GroupChangeProposal') {
      const id = proposalIdOf(obj);
      if (!id || !GOVERNANCE_ACTIONS.includes(String(obj.action || ''))) continue;
      const proposedBy = pubkeyXOnly(obj.proposedBy || row.author) || String(obj.proposedBy || '').toLowerCase();
      const voters = new Set();
      const author = String(row.author || '').toLowerCase();
      if (author && author === proposedBy) voters.add(author);
      proposals[id] = {
        id,
        action: String(obj.action || ''),
        member: obj.member != null ? String(obj.member).toLowerCase() : null,
        role: obj.role != null ? String(obj.role) : null,
        patch: obj.patch && typeof obj.patch === 'object' ? obj.patch : null,
        proposedBy,
        createdAt: obj.createdAt != null ? String(obj.createdAt) : null,
        threshold: Number.isFinite(Number(obj.threshold)) ? Number(obj.threshold) : null,
        status: 'pending',
        voters,
        object: obj
      };
    } else if (type === 'GroupChangeVote') {
      pendingVotes.push(row);
    } else if (type === 'GroupChange' && obj.proposalId && proposals[String(obj.proposalId)]) {
      proposals[String(obj.proposalId)].status = 'adopted';
    }
  }

  for (const row of pendingVotes) {
    const obj = row.object && typeof row.object === 'object' ? row.object : {};
    const pid = String(obj.proposalId || '').trim();
    const rec = proposals[pid];
    if (!rec || rec.status !== 'pending') continue;
    const voter = pubkeyXOnly(obj.voter || row.author) || String(row.author || '').toLowerCase();
    if (!voter || voter !== String(row.author || '').toLowerCase()) continue;
    const sig = String(obj.signature || '').trim().toLowerCase();
    if (!verifyProposalVote(rec.object, voter, sig)) continue;
    rec.voters.add(voter);
  }

  const signerList = () => {
    const fromTip = Array.from(ctx.signers);
    if (fromTip.length) return fromTip;
    const seeded = [];
    for (const s of genesisSigners || []) {
      const x = pubkeyXOnly(s);
      if (x) seeded.push(x);
    }
    return seeded;
  };

  const ids = Object.keys(proposals).sort();
  for (const id of ids) {
    const rec = proposals[id];
    if (rec.status === 'adopted') continue;
    // Quorum is genesis/ctx threshold. Proposal `threshold` is not in the
    // BIP340 signing string — never let a proposer lower the bar.
    const genesisNeed = Math.max(1, Number(
      (genesisThreshold != null && Number.isFinite(Number(genesisThreshold)))
        ? genesisThreshold
        : ctx.threshold
    ) || 1);
    const proposedNeed = Number(rec.threshold);
    const need = Number.isFinite(proposedNeed)
      ? Math.max(genesisNeed, Math.max(1, proposedNeed))
      : genesisNeed;
    let n = 0;
    const signers = signerList();
    if (!signers.length) continue;
    for (const s of signers) {
      if (rec.voters.has(s)) n += 1;
    }
    if (n < need) continue;
    if (!ctx.members.size && !ctx.signers.size) {
      for (const s of signers) {
        ctx.members.add(s);
        ctx.signers.add(s);
      }
    }
    applyGroupChangeAction(ctx, rec.object);
    rec.status = 'adopted';
  }

  return ids.map((id) => {
    const rec = proposals[id];
    return {
      id: rec.id,
      action: rec.action,
      member: rec.member,
      role: rec.role,
      patch: rec.patch,
      proposedBy: rec.proposedBy,
      createdAt: rec.createdAt,
      threshold: rec.threshold,
      status: rec.status,
      voters: Array.from(rec.voters).sort()
    };
  });
}

module.exports = {
  GOVERNANCE_ACTIONS,
  signingStringForGroupChangeProposal,
  proposalIdOf,
  signProposalVote,
  verifyProposalVote,
  applyGroupChangeAction,
  foldProposals
};
