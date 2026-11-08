# Fabric Core Network Simulator

Standalone peer-network simulator for `@fabric/core`. Spins up real TCP + NOISE
peers on loopback, runs composable use-case packs with a seeded random action
schedule, and reports throughput / event metrics.

Serves as both a **benchmark** (actions/sec, connect latency) and a **fuzz**
driver (weighted random behaviors). Not included in default `npm test`.

Protocol context: [`docs/NETWORK_STATE_PROGRAM.md`](../../docs/NETWORK_STATE_PROGRAM.md),
[`contracts/protocol.dot`](../../contracts/protocol.dot).

## Quick start

```bash
# Mocha suite (smoke + document scenarios + shortened mesh/protocol/fuzz)
npm run test:simulator

# CLI
npm run simulator -- --scenario smoke
npm run simulator -- --all --no-report
node tests/simulator/run.js --scenario protocol-flow --steps 160 --seed 2026
node tests/simulator/run.js --scenario mesh-chat --steps 120 --seed 7
node tests/simulator/run.js --scenario mixed-fuzz --peers 5 --topology mesh --json
```

Writes `reports/simulator-latest.json` on CLI runs (unless `--no-report`).

## Scenarios

| Name | Topology | Default peers / steps | Packs |
|------|----------|------------------------|--------|
| `smoke` | star | 3 / 48 | chat, contracts, gossip, session |
| `mesh-chat` | mesh | 4 / 120 | chat, gossip |
| `contract-mesh` | star | 4 / 100 | contracts, chat, inventory |
| `protocol-flow` | star | 4 / 160 | session → chat → contracts → docs → peering → state → bitcoin |
| `mixed-fuzz` | mesh | 5 / 200 | all packs + extra chaos |
| `document-swarm` | star | 4 / 24 | document-market + gossip |
| `document-relay-private` | line | 3 / 12 | document-market (private hop rewrite + fee skim) |
| `beacon-registry` | star | 5 / 80 | **requires `FABRIC_E2E_REGTEST=1`** — default **1000** L1 seals (`FABRIC_SIM_BEACON_EPOCHS`); mixed-size doc exchanges + connectivity phases between seals; audit report |

## Action packs (`scenarios/packs/`)

| Pack | Actions (weighted) |
|------|--------------------|
| `session` | peer.alias, peer.announce, peer.ping |
| `chat` | chat.send, peer.ping |
| `contracts` | contract.publish / message (+ setup genesis) |
| `gossip` | gossip.peer, peering.offer |
| `inventory` | document.publish/request, inventory.request/response |
| `document-market` | setup: multi-seller publish + private relay settings; line probe for fee rewrite; adversarial doc weights |
| `beacon-registry` | setup: long campaign — document exchanges (64B–512KB) + connectivity (full/degraded/sparse/partitioned) between `createEpoch` seals; registry field updates; audit under `reports/simulator-beacon-audit-latest.{json,md}` |
| `state` | state.root / change / request |
| `bitcoin` | bitcoin.block |
| `chaos` | disconnect, reconnect, chaos.raw |
| `protocol` | balanced mix for end-to-end flow |

## Composing packs

Packs live under `scenarios/packs/` and export `{ name, weights, setup? }`. Scenarios
pull them in via `composeUseCases([...])`:

```js
const { composeUseCases } = require('./scenarios/packs');
const packs = composeUseCases(['chat', 'contracts', 'state']);

module.exports = {
  name: 'my-scenario',
  peerCount: 3,
  topology: 'star',
  steps: 80,
  seed: 1,
  weightMaps: packs.weightMaps,
  setup: packs.setup,
  weights: { 'chat.send': 20 } // optional overrides
};
```

## Environment / flags

| Flag / env | Meaning |
|------------|---------|
| `--scenario` / `FABRIC_SIM_SCENARIO` | Scenario name (default `smoke`) |
| `--steps` / `FABRIC_SIM_STEPS` | Action budget |
| `--seed` / `FABRIC_SIM_SEED` | PRNG seed (reproducible schedules) |
| `--peers` / `FABRIC_SIM_PEERS` | Peer count |
| `--topology` / `FABRIC_SIM_TOPOLOGY` | `star` \| `line` \| `mesh` |
| `--json` | Print full JSON report to stdout |
| `--no-report` | Skip writing `reports/simulator-latest.json` |
| `--list` | List scenario names |
| `FABRIC_E2E_REGTEST=1` | Enable managed bitcoind Beacon scenarios |
| `FABRIC_SIM_BEACON_EPOCHS` | Sealed epochs for `beacon-registry` (default **1000**; mocha smoke uses `3`) |
| `FABRIC_SIM_BEACON_EXCHANGE_EVERY` | Epochs between document-exchange bursts (default `5`) |
| `FABRIC_SIM_BEACON_CONNECT_EVERY` | Epochs between connectivity perturbations (default `15`) |
| `FABRIC_SIM_BEACON_REGISTRY_EVERY` | Epochs between registry field applies (default `25`) |

## Design notes

- Newly originated messages are signed by the **local** peer key. Relays in Core
  forward bit-identical frames (no hop re-sign); the simulator only originates.
- Prefer first-class opcodes (`P2P_CHAT_MESSAGE`, `CONTRACT_*`, `P2P_INVENTORY_*`,
  gossip/peering, `BITCOIN_BLOCK`).
- Peers use `peersDb: null`, `upnp: false`, `127.0.0.1`, ephemeral ports.
- Transient socket errors (`EPIPE`, `ECONNRESET`, …) are counted but do not fail
  the run; unexpected hard errors exit non-zero on the CLI.
