'use strict';

const assert = require('assert');
const {
  listPlaynetChaosConditions,
  planDominantDesktopClients,
  planPlaynetChaosBlast,
  emptyChaosCrashReport,
  classifyChaosPeerError,
  chaosMessageBody,
  DEFAULT_PLAYNET_PEERS,
  DEFAULT_LOCAL_PEERS
} = require('../../functions/playnetChaosNeighbors');

describe('playnet chaos neighbors (unit)', function () {
  it('lists all network conditions used for crash capture', function () {
    const ids = listPlaynetChaosConditions().map((c) => c.id);
    assert.ok(ids.includes('signed-typed-storm'));
    assert.ok(ids.includes('oversized-chat-burst'));
    assert.ok(ids.includes('raw-amp-noise'));
    assert.ok(ids.includes('concurrent-noisy-neighbors'));
    assert.ok(ids.includes('reconnect-flap'));
    assert.ok(ids.includes('inventory-shape-noise'));
    assert.ok(ids.includes('unknown-opcode-spray'));
    const typed = listPlaynetChaosConditions().find((c) => c.id === 'signed-typed-storm');
    assert.ok(typed.types.includes('P2P_INVENTORY_REQUEST'));
  });

  it('plans dominant Hub + GoonCitizen desktops with ephemeral chaos keys', function () {
    const plan = planDominantDesktopClients({
      hubPeer: '127.0.0.1:7777',
      goonCitizenPeer: '127.0.0.1:7778'
    });
    assert.strictEqual(plan.role, 'dominant-desktop-clients');
    assert.strictEqual(plan.networkAlwaysExists, true);
    assert.strictEqual(plan.management.shortTerm, 'local-lead');
    assert.strictEqual(plan.management.longTerm, 'hub.fabric.pub');
    assert.strictEqual(plan.operatorKeySource, 'FABRIC_XPRV');
    assert.strictEqual(plan.sharedIdentity, true);
    assert.strictEqual(plan.hubDesktop.app, '@fabric/hub');
    assert.strictEqual(plan.hubDesktop.role, 'playnet-registry');
    assert.strictEqual(plan.goonCitizenDesktop.app, 'GoonCitizen');
    assert.strictEqual(plan.noisyNeighbors.keySource, 'ephemeral');
    assert.strictEqual(plan.noisyNeighbors.neverOperatorKey, true);
    assert.ok(plan.noisyNeighbors.conditions.includes('raw-amp-noise'));
  });

  it('plans short-term local lead and long-term hub.fabric.pub management', function () {
    const { planPlaynetLeadCapture } = require('../../functions/playnetChaosNeighbors');
    const local = planPlaynetLeadCapture({ horizon: 'local-lead' });
    assert.strictEqual(local.networkAlwaysExists, true);
    assert.strictEqual(local.horizon, 'local-lead');
    assert.strictEqual(local.active.omitProductionHubPeer, true);
    assert.ok(local.active.deployFlags.includes('--local-registry'));
    const remote = planPlaynetLeadCapture({ horizon: 'hub.fabric.pub' });
    assert.strictEqual(remote.horizon, 'hub.fabric.pub');
    assert.strictEqual(remote.active.registryPeer, 'hub.fabric.pub:7777');
    assert.ok(remote.active.deployFlags.includes('--production'));
  });

  it('plans a local chaos blast that never uses the operator key', function () {
    const plan = planPlaynetChaosBlast({
      production: false,
      peers: DEFAULT_LOCAL_PEERS.slice(),
      neighbors: 2,
      iterations: 16
    });
    assert.strictEqual(plan.role, 'playnet-chaos-blast');
    assert.strictEqual(plan.production, false);
    assert.deepStrictEqual(plan.targets, DEFAULT_LOCAL_PEERS.slice());
    assert.strictEqual(plan.useOperatorKey, false);
    assert.ok(plan.forbiddenWire.includes('P2P_FLUSH_CHAIN'));
    assert.ok(plan.forbiddenWire.includes('P2P_FILE_SEND'));
    assert.strictEqual(plan.dominant.noisyNeighbors.neverOperatorKey, true);
  });

  it('isolated blast does not default to desktop or public peers', function () {
    const plan = planPlaynetChaosBlast({ isolated: true, peers: [] });
    assert.strictEqual(plan.isolated, true);
    assert.strictEqual(plan.production, false);
    assert.deepStrictEqual(plan.targets, []);
    assert.strictEqual(plan.reportName, 'playnet-chaos-neighbors-isolated.json');
    assert.strictEqual(plan.useOperatorKey, false);
  });

  it('defaults production blast targets to public playnet peers', function () {
    const plan = planPlaynetChaosBlast({ production: true, peers: [] });
    assert.strictEqual(plan.production, true);
    assert.deepStrictEqual(plan.targets, DEFAULT_PLAYNET_PEERS.slice());
  });

  it('classifies peer errors and builds crash report skeleton', function () {
    assert.strictEqual(classifyChaosPeerError('read ECONNRESET'), 'reset');
    assert.strictEqual(classifyChaosPeerError('Attempted to write to a closed connection'), 'soft');
    assert.strictEqual(classifyChaosPeerError('unexpected boom'), 'hard');
    const plan = planPlaynetChaosBlast({ production: false });
    const report = emptyChaosCrashReport(plan);
    assert.strictEqual(report.operatorKeyUsed, false);
    assert.strictEqual(report.econnreset, 0);
    assert.ok(Array.isArray(report.disconnects));
  });

  it('builds chat / inventory chaos bodies without file bytes', function () {
    const chat = chaosMessageBody({ id: 'oversized-chat-burst', chatBytes: 128 }, 'P2P_CHAT_MESSAGE', 1);
    assert.ok(chat.indexOf('playnet-chaos-oversized-chat-burst') === 0);
    assert.ok(chat.length > 40);
    const inv = chaosMessageBody({ id: 'inventory-shape-noise', inventoryShape: true }, 'P2P_BASE_MESSAGE', 2);
    const parsed = JSON.parse(inv);
    assert.strictEqual(parsed.type, 'INVENTORY_REQUEST');
    assert.ok(parsed.object && Array.isArray(parsed.object.documents));
    const firstClass = chaosMessageBody({ id: 'signed-typed-storm' }, 'P2P_INVENTORY_REQUEST', 3);
    const invReq = JSON.parse(firstClass);
    assert.strictEqual(invReq.type, 'INVENTORY_REQUEST');
    assert.strictEqual(invReq.object.kind, 'documents');
  });
});
