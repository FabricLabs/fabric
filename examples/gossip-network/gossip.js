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

window.WALKTHROUGH = {
  edges: EDGES,
  chips: [
    'P2P_PEER_GOSSIP',
    'P2P_PEERING_OFFER',
    'P2P_PEER_ALIAS',
    'P2P_CHAT_MESSAGE',
    'CONTRACT_PUBLISH',
    'CONTRACT_MESSAGE',
    'CONTRACT_PROPOSAL',
    'BITCOIN_BLOCK',
    'DOCUMENT_REQUEST',
    'P2P_RELAY'
  ],
  captions: {
    island: 'A handful of Peers, not a crowd.',
    you: 'You are the key on the left.',
    noise: 'A NOISE hallway opens to Alice.',
    session: 'SESSION_OFFER then SESSION_OPEN.',
    amp: '208-byte header, then the body.',
    validate: 'Size, hash, signature — then carry.',
    types: 'Ten types are public flood.',
    identical: 'Same bytes at every hop.',
    layers: 'Discovery, shoutbox, namespaces.',
    directed: 'Onion takes one next hop, not the square.',
    budget: 'Duplicates drop. Origins are rate-limited.',
    journey: 'A shoutbox frame floods the mesh.',
    relay: 'The middle node can be only a carrier.',
    close: 'JavaScript is still the protocol oracle.'
  },
  scenes: {
    island: { glow: [], links: [], dash: [], packets: 'none' },
    you: { glow: ['you'], links: [], dash: [], packets: 'none' },
    noise: { glow: ['you', 'alice'], links: [['you', 'alice']], dash: [], packets: 'none' },
    session: { glow: ['you', 'alice'], links: [['you', 'alice']], dash: [], packets: 'session' },
    amp: { glow: ['you'], links: [['you', 'alice']], dash: [], packets: 'none', show: ['amp'] },
    validate: {
      glow: ['you', 'alice'],
      links: [['you', 'alice']],
      dash: [],
      packets: 'none',
      show: ['amp', 'gates']
    },
    types: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      dash: [],
      packets: 'none',
      show: ['chips']
    },
    identical: {
      glow: ['you', 'alice', 'relay'],
      links: [['you', 'alice'], ['you', 'relay'], ['alice', 'relay']],
      dash: [],
      packets: 'flood-slow',
      show: ['hash']
    },
    layers: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      dash: [],
      packets: 'none',
      show: ['chips'],
      chips: ['P2P_PEER_GOSSIP', 'P2P_CHAT_MESSAGE', 'CONTRACT_PUBLISH', 'CONTRACT_MESSAGE']
    },
    directed: {
      glow: ['you', 'alice', 'bob'],
      links: [],
      dash: [['you', 'alice'], ['alice', 'bob']],
      packets: 'onion'
    },
    budget: { glow: ['alice', 'relay'], links: [['alice', 'relay']], dash: [], packets: 'burst' },
    journey: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      dash: [],
      packets: 'flood'
    },
    relay: { glow: ['relay'], links: EDGES, dash: [], packets: 'flood-slow' },
    close: {
      glow: ['you', 'alice', 'relay', 'bob', 'dest'],
      links: EDGES,
      dash: [],
      packets: 'none'
    }
  }
};
