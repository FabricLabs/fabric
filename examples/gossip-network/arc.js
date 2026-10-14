'use strict';

var EDGES = [
  ['you', 'alice'],
  ['you', 'relay'],
  ['alice', 'relay'],
  ['alice', 'bob'],
  ['relay', 'bob'],
  ['relay', 'dest'],
  ['bob', 'dest']
];

var NS = 'ns · 0f3a…c21d';
var EMPTY = {
  ns: NS,
  clock: 0,
  digest: 'digest · genesis',
  journal: [],
  roster: [],
  note: '',
  spend: ''
};

function arc (extra) {
  var out = {};
  Object.keys(EMPTY).forEach(function (k) { out[k] = EMPTY[k]; });
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

window.WALKTHROUGH = {
  edges: EDGES,
  captions: {
    idea: 'Gossip is the road. An ARC is the notebook.',
    outer: 'Still three outer types. No new opcode family.',
    genesis: 'Primitives, members, spend, Bitcoin anchor.',
    namespace: 'Id = Actor(genesis). First writer wins.',
    tip: 'clock, stateDigest, bitcoinBlockHash.',
    fold: 'Same signed bytes, fold by hash.',
    unknown: 'Unknown namespaces: carry, do not keep.',
    members: 'Readers, signers, Token grants.',
    change: 'GroupChange needs a current signer.',
    chat: 'GroupChat is in-bounds chat under the id.',
    proposal: 'Propose, then vote. Threshold cannot drop.',
    withdraw: 'Spend binds the tip you claim.',
    machine: 'Machine computes. Taproot spends.',
    close: 'Hub Accept overlays spend. Beacon is an ARC.'
  },
  scenes: {
    idea: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      packets: 'flood-slow',
      dimMesh: false
    },
    outer: {
      glow: ['you', 'alice', 'relay'],
      links: EDGES,
      packets: 'flood-slow',
      dimMesh: true,
      arc: arc({
        note: 'CONTRACT_PUBLISH · CONTRACT_MESSAGE · CONTRACT_PROPOSAL',
        journal: [
          { text: '0x5f  CONTRACT_PUBLISH   genesis', tone: 'ok' },
          { text: '0x60  CONTRACT_MESSAGE  events', tone: '' },
          { text: '0x8a  CONTRACT_PROPOSAL batch + patch', tone: '' }
        ]
      })
    },
    genesis: {
      glow: ['you', 'alice'],
      links: [['you', 'alice']],
      packets: 'none',
      dimMesh: true,
      arc: arc({
        note: 'Genesis declares the rules before anyone writes.',
        roster: ['signers  You, Alice', 'readers  *', 'threshold  1'],
        journal: [
          { text: 'primitives.messageTypes  listed or deny-all', tone: 'ok' },
          { text: 'members.signers / readers / threshold', tone: '' },
          { text: 'spendPolicy → P2TR', tone: '' },
          { text: 'bitcoinAnchor.blockHash  64-hex', tone: 'ok' }
        ]
      })
    },
    namespace: {
      glow: ['you'],
      links: EDGES,
      packets: 'flood',
      dimMesh: true,
      arc: arc({
        note: 'A second genesis for the same id is dropped.',
        journal: [
          { text: 'You  CONTRACT_PUBLISH  accepted', tone: 'ok' },
          { text: 'Dest  CONTRACT_PUBLISH  same id — ignored', tone: 'deny' }
        ]
      })
    },
    tip: {
      glow: ['you', 'alice'],
      links: [['you', 'alice']],
      packets: 'none',
      dimMesh: true,
      arc: arc({
        clock: 3,
        digest: 'digest · SHA256({ version, clock, content })',
        note: 'Withdrawals must cite this tip, not a memory of it.',
        journal: [
          { text: 'clock  3', tone: 'ok' },
          { text: 'stateDigest  of canonical content', tone: 'ok' },
          { text: 'bitcoinBlockHash  current L1 tip', tone: '' }
        ]
      })
    },
    fold: {
      glow: ['you', 'alice', 'relay', 'bob'],
      links: EDGES,
      packets: 'flood',
      dimMesh: true,
      arc: arc({
        clock: 4,
        digest: 'digest · same on every honest fold',
        note: 'Mesh, hub queue, or fabric:<hex> — identity is the AMP hash.',
        journal: [
          { text: 'ingest  hash a1…  GroupChat', tone: '' },
          { text: 'ingest  hash b7…  GroupChange', tone: '' },
          { text: 'fold sorted by hash, not arrival', tone: 'ok' }
        ]
      })
    },
    unknown: {
      glow: ['relay'],
      links: EDGES,
      packets: 'flood-slow',
      dimMesh: false,
      arc: arc({
        ns: 'ns · unknown',
        note: 'Relay floods. Applications ignore unknown contract ids.',
        journal: [
          { text: 'Peer  validate + carry', tone: 'ok' },
          { text: 'app   contract not local — skip fold', tone: 'warn' }
        ]
      })
    },
    members: {
      glow: ['you', 'alice', 'bob'],
      links: [['you', 'alice'], ['alice', 'bob']],
      packets: 'none',
      dimMesh: true,
      arc: arc({
        clock: 5,
        note: 'OP_CONTRACT_READ / OP_CONTRACT_SIGN Tokens, bound to this id.',
        roster: [
          'You   signer',
          'Alice signer',
          'Bob   reader (grant)'
        ],
        journal: [
          { text: 'ContractCapabilityGrant  Bob may read', tone: 'ok' }
        ]
      })
    },
    change: {
      glow: ['you', 'dest'],
      links: [['you', 'relay'], ['relay', 'dest']],
      packets: 'burst',
      dimMesh: true,
      arc: arc({
        clock: 5,
        note: 'AMP signature alone is not membership.',
        roster: ['signers  You, Alice', 'readers  You, Alice, Bob'],
        journal: [
          { text: 'You   GroupChange  folded', tone: 'ok' },
          { text: 'Dest  GroupChange  not a signer — rejected', tone: 'deny' }
        ]
      })
    },
    chat: {
      glow: ['you', 'alice', 'bob'],
      links: EDGES,
      packets: 'session',
      dimMesh: true,
      arc: arc({
        clock: 6,
        note: 'Optional groupChatSeal is wave-1 confidential. Relays need not open it.',
        roster: ['You, Alice  signers', 'Bob  reader'],
        journal: [
          { text: 'GroupChat  append (reader ∪ signer)', tone: 'ok' },
          { text: 'MessageReceived / Receipt  sidecar, clock stays', tone: '' }
        ]
      })
    },
    proposal: {
      glow: ['you', 'alice'],
      links: [['you', 'alice']],
      packets: 'session',
      dimMesh: true,
      arc: arc({
        clock: 7,
        note: 'Proposer threshold cannot lower the bar.',
        roster: ['validators  You, Alice  ·  2-of-2'],
        journal: [
          { text: 'GroupChangeProposal  members + signers bound', tone: '' },
          { text: 'GroupChangeVote  You', tone: 'ok' },
          { text: 'GroupChangeVote  Alice  — adopt', tone: 'ok' }
        ]
      })
    },
    withdraw: {
      glow: ['you', 'alice'],
      links: [['you', 'alice']],
      packets: 'none',
      dimMesh: true,
      arc: arc({
        clock: 8,
        digest: 'digest · tip you must cite',
        spend: 'P2TR  authority ladder from resolveSpend(genesis, tip)',
        note: 'Stale digest or block hash is refused at ingest.',
        journal: [
          { text: 'ContractWithdrawalRequest  binds digest + block', tone: 'ok' },
          { text: 'ContractWithdrawalWitness  same tip + requestId', tone: '' }
        ]
      })
    },
    machine: {
      glow: ['you'],
      links: [],
      packets: 'none',
      dimMesh: true,
      arc: arc({
        clock: 8,
        spend: 'address unchanged by a program run unless a hashlock leaf is in the tree',
        note: 'opcodes[] fail closed when the genesis lists them.',
        journal: [
          { text: 'Machine + Program  compute + commitment', tone: '' },
          { text: 'Taproot  the spend surface', tone: 'ok' }
        ]
      })
    },
    close: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      packets: 'flood-slow',
      dimMesh: true,
      arc: arc({
        ns: 'ns · fabric-beacon',
        clock: 12,
        spend: 'Hub Accept overlays network + spendAddress',
        note: 'Beacon epoch sealing stays on the Beacon service. The ARC is the authority surface.',
        roster: ['validators  federation set', 'Actor id  network-stable'],
        journal: [
          { text: 'CONTRACT_PUBLISH  accepted into Beacon contracts root', tone: 'ok' },
          { text: 'sidechain  /namespaces/<id>', tone: '' }
        ]
      })
    }
  }
};
