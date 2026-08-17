# Fabric Examples

Simple, robust demonstrations of `@fabric/core`. Prefer the **JavaScript** scripts below — no C build required for the flagship set.

## Live deploys

| Surface | URL | Source |
| --- | --- | --- |
| GitHub Pages (demos landing) | https://fabriclabs.github.io/fabric/ | `master` → Pages (`pages-build-deployment`) |
| Examples home | https://fabriclabs.github.io/fabric/examples/home.html | `examples/home.html` |
| Handbook host (may lag) | https://dev.fabric.pub/examples/ | Operator nginx copy of literate examples |
| Hub (product) | https://hub.fabric.pub | Hub repo / Vercel production |

After merging to `master`, confirm the Pages deployment URL in the Actions **pages-build-deployment** run (environment `github-pages`).

## Flagship demos (Node 24.15)

```bash
npm install
npm run example:basic    # Key + Schnorr chat sign/verify
npm run example:demo     # Collection + shoutbox line
npm run example:chat     # UTF-8 chat smoke via examples/message.js (add --interactive for REPL)
npm run example:onion    # Offline P2P_FORWARD peel
npm run example:smoke    # All of the above + message.js
```

Local literate browse (after regenerating):

```bash
npm run make:examples
npm run examples         # serves examples/ on :8000
# or full handbook:
npm run dev              # _book on :8000
```

## Other examples

| Script | Role |
| --- | --- |
| `index.js` | Fabric state `_SET` / `_GET` |
| `message.js` | Wire message sign/verify |
| `agents.js` | Distributor smoke (`npm run example:agents:smoke`) |
| `heartbeat.js` | Peer + Swarm heartbeat (needs ports) |
| `bitcoin.js` / `chain.js` / … | Deeper / optional surfaces |

C / native demos are optional and not on the JS release gate.

## Vision

Supported path: **[../VISION.md](../VISION.md)**, **[../QUICKSTART.md](../QUICKSTART.md)**, **[../DEVELOPERS.md](../DEVELOPERS.md)**.
