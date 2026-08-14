'use strict';

const assert = require('assert');
const Key = require('../types/key');
const {
  signingStringForGroupChangeProposal,
  signProposalVote,
  verifyProposalVote,
  applyGroupChangeAction,
  foldProposals
} = require('../functions/groupChangeGovernance');
const { pubkeyXOnly } = require('../functions/groupChatSeal');

describe('@fabric/core groupChangeGovernance', function () {
  it('signs and verifies a proposal vote (canonical application string)', function () {
    const a = new Key();
    const proposal = {
      id: 'gprop-test',
      contractId: 'ab'.repeat(32),
      groupId: 'group-1',
      action: 'member.add',
      member: new Key().pubkey,
      role: 'signer',
      patch: null,
      proposedBy: pubkeyXOnly(a.pubkey),
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    const signed = signProposalVote(a, proposal);
    assert.ok(signed.signature);
    assert.strictEqual(signed.message, signingStringForGroupChangeProposal(proposal));
    assert.strictEqual(verifyProposalVote(proposal, a.pubkey, signed.signature), true);
    assert.strictEqual(verifyProposalVote(proposal, a.pubkey, 'ab'.repeat(64)), false);
    assert.strictEqual(verifyProposalVote(proposal, new Key().pubkey, signed.signature), false);
  });

  it('applyGroupChangeAction member.add / remove / set', function () {
    const a = pubkeyXOnly(new Key().pubkey);
    const b = pubkeyXOnly(new Key().pubkey);
    const ctx = { members: new Set(), signers: new Set(), readerOnlyAdds: false, threshold: null };
    applyGroupChangeAction(ctx, { action: 'member.add', member: a, role: 'signer' });
    applyGroupChangeAction(ctx, { action: 'member.add', member: b, role: 'reader' });
    assert.ok(ctx.members.has(a) && ctx.members.has(b));
    assert.ok(ctx.signers.has(a) && !ctx.signers.has(b));
    applyGroupChangeAction(ctx, { action: 'member.remove', member: b });
    assert.ok(!ctx.members.has(b));
    applyGroupChangeAction(ctx, { action: 'members.set', members: [a, b] });
    assert.ok(ctx.signers.has(b));
  });

  it('foldProposals adopts at threshold using genesis signers', function () {
    const owner = new Key();
    const recruit = new Key();
    const ox = pubkeyXOnly(owner.pubkey);
    const rx = pubkeyXOnly(recruit.pubkey);
    const ctx = { members: new Set(), signers: new Set(), readerOnlyAdds: false, threshold: 1 };
    const entries = [{
      hash: 'aa',
      type: 'GroupChangeProposal',
      author: ox,
      object: {
        id: 'p1',
        action: 'member.add',
        member: rx,
        role: 'signer',
        proposedBy: ox,
        threshold: 1
      }
    }];
    const out = foldProposals(entries, ctx, 1, [ox]);
    assert.strictEqual(out[0].status, 'adopted');
    assert.ok(ctx.members.has(ox) && ctx.members.has(rx));
  });

  it('foldProposals adopts member.remove and update threshold (Federation actions)', function () {
    const owner = new Key();
    const extra = new Key();
    const ox = pubkeyXOnly(owner.pubkey);
    const ex = pubkeyXOnly(extra.pubkey);
    const ctx = { members: new Set([ox, ex]), signers: new Set([ox, ex]), readerOnlyAdds: false, threshold: 2 };
    const remove = {
      hash: '11',
      type: 'GroupChangeProposal',
      author: ox,
      object: {
        id: 'p-remove',
        action: 'member.remove',
        member: ex,
        proposedBy: ox,
        threshold: 1
      }
    };
    const removed = foldProposals([remove], ctx, 1, [ox, ex]);
    assert.strictEqual(removed[0].status, 'adopted');
    assert.ok(!ctx.members.has(ex));

    const update = {
      hash: '22',
      type: 'GroupChangeProposal',
      author: ox,
      object: {
        id: 'p-update',
        action: 'update',
        patch: { threshold: 1, pinnedChannels: ['discord:ops'] },
        proposedBy: ox,
        threshold: 1
      }
    };
    const updated = foldProposals([update], ctx, 1, [ox]);
    assert.strictEqual(updated[0].status, 'adopted');
    assert.strictEqual(ctx.threshold, 1);
  });

  it('foldProposals ignores a proposer-chosen threshold below genesis k-of-n', function () {
    const owner = new Key();
    const co = new Key();
    const ox = pubkeyXOnly(owner.pubkey);
    const cx = pubkeyXOnly(co.pubkey);
    const ctx = { members: new Set([ox, cx]), signers: new Set([ox, cx]), readerOnlyAdds: false, threshold: 2 };
    const entries = [{
      hash: 'cc',
      type: 'GroupChangeProposal',
      author: ox,
      object: {
        id: 'p-bypass',
        action: 'members.set',
        members: [ox],
        proposedBy: ox,
        threshold: 1
      }
    }];
    const out = foldProposals(entries, ctx, 2, [ox, cx]);
    assert.strictEqual(out[0].status, 'pending');
    assert.ok(ctx.members.has(cx));
    assert.ok(ctx.signers.has(cx));
  });

  it('signing string v2 binds members/signers (order-insensitive)', function () {
    const a = pubkeyXOnly(new Key().pubkey);
    const b = pubkeyXOnly(new Key().pubkey);
    const first = [a, b].sort();
    const second = [b, a];
    const left = JSON.parse(signingStringForGroupChangeProposal({
      id: 'p-set',
      action: 'members.set',
      members: first
    }));
    const right = JSON.parse(signingStringForGroupChangeProposal({
      id: 'p-set',
      action: 'members.set',
      members: second
    }));
    assert.strictEqual(left.v, 2);
    assert.deepStrictEqual(left.members, right.members);
    assert.strictEqual(left.signers, null);
  });

  it('foldProposals rejects votes when members.set roster is swapped after signing', function () {
    const owner = new Key();
    const co = new Key();
    const attacker = new Key();
    const ox = pubkeyXOnly(owner.pubkey);
    const cx = pubkeyXOnly(co.pubkey);
    const ax = pubkeyXOnly(attacker.pubkey);
    const ctx = { members: new Set([ox, cx]), signers: new Set([ox, cx]), readerOnlyAdds: false, threshold: 2 };
    const honest = {
      id: 'p-roster',
      action: 'members.set',
      members: [ox, cx],
      proposedBy: ox
    };
    const vote = signProposalVote(co, honest);
    const entries = [{
      hash: 'dd',
      type: 'GroupChangeProposal',
      author: ox,
      object: {
        id: 'p-roster',
        action: 'members.set',
        members: [ax],
        proposedBy: ox
      }
    }, {
      hash: 'ee',
      type: 'GroupChangeVote',
      author: cx,
      object: {
        proposalId: 'p-roster',
        voter: cx,
        signature: vote.signature
      }
    }];
    const out = foldProposals(entries, ctx, 2, [ox, cx]);
    assert.strictEqual(out[0].status, 'pending');
    assert.ok(ctx.members.has(ox) && ctx.members.has(cx));
    assert.strictEqual(ctx.members.has(ax), false);
  });
});
