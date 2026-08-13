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
  it('signs and verifies a proposal vote (GoonCitizen string)', function () {
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
});
