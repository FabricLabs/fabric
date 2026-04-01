# Fabric Agents
See also [DEVELOPERS.md](DEVELOPERS.md) (repo layout, tests) and [docs/PRODUCTION.md](docs/PRODUCTION.md) (release gate).

Fabric enables automated payments between node instances, which we can leverage for distributing load across multiple cores.

Fabric Agents are long-running services that can:

- hold identity (`agent.identity.address`)
- exchange messages with peers
- expose deterministic behavior through service lifecycle methods
- coordinate compute work and value transfer between nodes

Peer and bridge traffic is carried as **`Message`** instances (**AMP** — see **`types/message.js`**): typed opcodes, verifiable headers, and **BIP-340 Schnorr** over the **`Fabric/Message`** tagged hash. When you model state that must sync or audit across nodes, align with **`Actor`**: JSON-shaped content, **`commit()`** for patch history, and **`id`** from the canonical **`toGenericMessage()`** envelope — not ad-hoc string hashes. **Bitcoin Signed Message** and similar wallet-RPC formats are **not** Fabric **`Message`** signing; keep those code paths and user-facing labels distinct.

## Scope
This specification applies to:

- services that extend `types/service`
- local agents (single process)
- distributed agents (multiple processes, peers, or cores)

## Agent Contract
An agent SHOULD implement the following interface:

- **Constructor:** `new Agent(settings = {})`
- **Lifecycle:** `async start()`, `async stop()`
- **Optional scheduler:** `tick()`
- **State:** mutable service state under `this._state.content`
- **Events:** emits `debug`, `error`, and domain-specific events

### Recommended `settings` shape

```js
{
  function: () => {}, // optional unit of work
  ...otherSettings
}
```

## Runtime Behavior

Common behavior expected from Fabric agents:

1. initialize state in constructor
2. validate required settings before startup
3. emit traceable startup/shutdown logs
4. isolate failures (worker/process error handlers)
5. clean up resources on stop

## Safety and Reliability

Agents SHOULD follow these operational rules:

- never assume remote input is trusted
- wrap async boundaries with error handling
- fail noisy (`error` events) and recover where possible
- avoid mutating shared state without clear ownership
- make start/stop idempotent when practical

## Observability
At minimum, agents SHOULD:

- emit `debug` logs for lifecycle transitions
- emit `error` logs with enough context to diagnose failures
- expose useful identifiers (for example, payment or identity address)

## Example: Multi-Core Distributor
Reference implementation: `examples/agents.js`.

The example demonstrates common agent elements from this specification:

- extends `Service`
- keeps explicit internal state in `this._state.content`
- exposes `address` from identity
- starts workers across available CPU cores via `worker_threads`
- handles `message`, `error`, and `exit` events
- provides `start()` and `stop()` lifecycle methods

### agents.js: Bitcoin + Lightning integration
The example runs a Bitcoin regtest node, Master Lightning node, and Alice Lightning node. Flow:

1. **Bitcoin** — Start, mine 101 blocks if no spendable UTXOs, then mine one block every 10s.
2. **Master Lightning** — Start, deposit 50% of spendable BTC if needed, confirm with 6 blocks.
3. **Alice Lightning** — Start after 3s stagger; optionally clean datadir when `FABRIC_CLEAN_ALICE=1`.
4. **Channels** — Master→Alice and Alice→Master, each funded with 50% of available Lightning funds, with push_msat for balanced liquidity.

Configuration: `FABRIC_MNEMONIC` for deterministic keys; `ALICE_LIGHTNING_PORT` (default 19735); `MIN_CHANNEL_FUNDING_SATS` (default 10000); `MAX_ALICE_DEPOSIT_BTC` (default 1) caps Alice's on-chain deposit to avoid "Fee exceeds maximum" when the wallet has many UTXOs.

### Lightning: multi-node setup
When running multiple Lightning nodes (Master + Alice) against one bitcoind:

- **`disablePlugins: ['cln-grpc']`** — Required for secondary nodes to avoid conflicts.
- **Stagger startup** — 3s between Master and Alice to reduce bitcoind contention.
- **Clean datadir** — Run with `FABRIC_CLEAN_ALICE=1` if Alice fails with ECONNREFUSED or socket errors (stale state from prior runs).

### Lightning: troubleshooting
The Lightning service uses timeouts and retries to avoid hangs:

- **RPC timeout** — 30s default; if `getinfo` blocks (e.g. during chain sync), the call fails and retries.
- **Socket wait** — Up to 60s polling for the RPC socket; stale sockets are removed before spawning.
- Check `[FABRIC:LIGHTNING] [ERROR]` stderr from the lightningd child for startup failures.

## Testing instructions
- Basic test: `npm test`

## Example
```js
'use strict';

const os = require('os');
const cluster = require('cluster');
const Service = require('../types/service');

const numberOfCores = os.cpus().length;

class Distributor extends Service {
  constructor (settings = {}) {
    super(settings);

    this._state.content = {
      cores: [],
      function: (settings.function) ? settings.function.bind({}) : (() => {}).bind({})
    };
  }

  get address () {
    return this.identity.address;
  }

  async start () {
    this.emit('debug', 'Starting Distributor...');

    for (let i = 0; i < numberOfCores; i++) {
      const instance = this.settings.function.bind({});
      const core = new cluster.Worker(instance);

      core.on('message', (message) => this.emit('debug', 'Core message:', message));
      core.on('error', (error) => this.emit('error', 'Core error:', error));
      core.on('exit', (code, signal) => this.emit('debug', 'Core exited:', code, signal));
      core.send('start');
    }

    this.emit('debug', `Distributor started. Fund this address: ${this.address}`);
    return this;
  }
}
```

## Release verification
```bash
npm run ci    # NODE_ENV=test mocha --recursive tests
```

Operator and marketing context: [docs/PRODUCTION.md](docs/PRODUCTION.md), [docs/MARKETING_OVERVIEW.md](docs/MARKETING_OVERVIEW.md), [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Authoring Checklist
Before merging a new Fabric agent:

- constructor initializes explicit state shape
- lifecycle methods are present and tested
- startup failure paths are handled
- logs/events are sufficient for diagnosis
- example usage is documented (inline or in `examples/`)
