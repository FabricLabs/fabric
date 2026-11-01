# Fabric Examples
Short programs that show the current JavaScript library. The supported path is this repository: [VISION.md](../VISION.md), [QUICKSTART.md](../QUICKSTART.md), and [DEVELOPERS.md](../DEVELOPERS.md). Install from the repository root (`npm install`, Node.js 26.12.1). No C build is required for these scripts.

The map of core, `@fabric/http`, and `@fabric/hub` is [TUTORIALS.md](TUTORIALS.md). Scroll-driven pictures are in [gossip-network/](gossip-network/index.html).

## Run the offline set

```bash
npm run example:tutorials
```

That is also `npm run example:smoke`. Each script exits on its own. It does not open a port and it does not start Bitcoin or Lightning.

Four of them have their own commands:

```bash
npm run example:basic    # sign and verify one message
npm run example:chat     # one typed chat-sized body, then exit
npm run example:demo     # a collection and one message
npm run example:onion    # peel a P2P_FORWARD path
```

`example:chat` is [message-body.js](message-body.js). It is not an interactive prompt.

## What each new script covers

- [fabric-basic-usage.js](fabric-basic-usage.js) — one key, one signed message, one verify
- [message-body.js](message-body.js) — `P2P_PING` fields, genesis `parent`, zero `preimage`
- [keys.js](keys.js) — identity, wallet, and cosigner from one mnemonic
- [passport.js](passport.js) — challenge, assertion, verify
- [delegation.js](delegation.js) — pairing code, grant, request that is authorized and not yet signed
- [federation.js](federation.js) — descriptor id
- [sidechain.js](sidechain.js) — a patch and its digest
- [beacon-epoch.js](beacon-epoch.js) — the epoch string validators sign
- [program.js](program.js) — `OP_TRUE` on a local Machine
- [documents.js](documents.js) — seal a few bytes, unsigned publish envelope
- [coinjoin-fee.js](coinjoin-fee.js) — maker fee arithmetic
- [onion-forward.js](onion-forward.js) — two hops, then the payload

## Reading them in a browser

`home.html` links the walkthroughs and the tutorial names. Literate HTML for a script appears after `npm run make:examples` (docco). That command rewrites `assets/examples/`. The walkthroughs are hand-written and do not go through docco.

```bash
npm run examples
```

serves this directory on port 8000 after regenerating those literate pages. To read the walkthroughs without regenerating them, serve the directory with any static server and open `gossip-network/index.html`.

## Older scripts

These stay in the tree. They are not part of `example:tutorials`.

Print-and-exit demos: `index.js`, `fabric.js`, `fabric-demo.js`, `message.js`, `environment.js`, `collection.js`, `store.js`, `witness.js`, `blockchain.js`, `chain.js`, `p2pkh.js`, `game.js`, `service.js`.

Stay running, or need a local Bitcoin or Lightning node: `bitcoin.js`, `lightning.js`, `network.js`, `swarm.js`, `relay.js`, `heartbeat.js`, `http.js`, `cli.js`, `oracle.js`, `agents.js`. `npm run example:agents:smoke` is the agents check and is separate from the tutorial runner. `examples/cluster/` is five long-running peers. `examples/app.js` expects a browser `window`.
