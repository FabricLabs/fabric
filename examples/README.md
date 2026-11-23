# Fabric Examples
Short programs that show the current JavaScript library. The supported path is this repository: [VISION.md](../VISION.md), [QUICKSTART.md](../QUICKSTART.md), and [DEVELOPERS.md](../DEVELOPERS.md). Install from the repository root (`npm install`, Node.js 26.13.0). No C build is required for these scripts.

## Run the offline set

```bash
npm run example:tutorials
```

That is also `npm run example:smoke`. Each script exits on its own. It does not open a port and it does not start Bitcoin or Lightning.

Four of them have their own commands:

```bash
npm run example:basic    # sign and verify one message
npm run example:chat     # print one message, then exit
npm run example:demo     # a collection and one message
npm run example:onion    # peel a P2P_FORWARD path
```

## What each script covers

- [fabric-basic-usage.js](fabric-basic-usage.js) — one key, one signed message, one verify
- [onion-forward.js](onion-forward.js) — two hops, then the payload
- [fabric-demo.js](fabric-demo.js) — a Collection plus one message
- [index.js](index.js) — in-memory get and set

## Reading them in a browser

`home.html` links the tutorial names. Literate HTML for a script appears after `npm run make:examples` (docco). That command rewrites `assets/examples/`.

```bash
npm run examples
```

serves this directory on port 8000 after regenerating those literate pages.

## Older scripts

These stay in the tree. They are not part of `example:tutorials`.

Print-and-exit demos: `fabric.js`, `message.js`, `environment.js`, `collection.js`, `store.js`, `witness.js`, `blockchain.js`, `chain.js`, `p2pkh.js`, `game.js`, `service.js`.

Stay running, or need a local Bitcoin or Lightning node: `bitcoin.js`, `lightning.js`, `network.js`, `swarm.js`, `relay.js`, `heartbeat.js`, `http.js`, `cli.js`, `oracle.js`, `agents.js`. `npm run example:agents:smoke` is the agents check and is separate from the tutorial runner. `examples/cluster/` is five long-running peers. `examples/app.js` expects a browser `window`.
