# Building `@fabric/core`
## JavaScript library (default)

```bash
npm ci
npm test
```

No native compile is required for the core JS unit/integration tests in this repo.

## `fabric` CLI binary
The **`fabric`** npm binary is the **Node harness** (`scripts/fabric.js`) for the Blessed TUI (`chat` default). Optional **`fabric.node`** accelerates a tiny API surface (e.g. `doubleSha256`); see [`docs/CLI-BINARY.md`](docs/CLI-BINARY.md) and `functions/fabricNativeAccel.js`.

Bundled executable: `npm run make:binary` (pkg).

## Native addon (`fabric.node`) — optional
The Node N-API addon is **not** built on `npm install`. JavaScript (`types/message.js`,
`types/peer.js`) is the **canonical** wire protocol for `@fabric/core` 0.1.0. C sources
stay in the repo for experiments and optional acceleration.

```bash
npm ci
npm run build:c
# or: FABRIC_BUILD_NATIVE=1 npm install
```

Outputs under `build/Release/fabric.node` (ignored by git — see `.gitignore`).

### Dependencies
| Component | Linux (typical) | macOS (Homebrew) |
|-----------|-----------------|------------------|
| **Node** | 24.15.x (see `.nvmrc` / `package.json` `engines`) | same |
| **Build** | `build-essential`, Python 3.x (for `node-gyp`) | Xcode CLT |
| **secp256k1** | `libsecp256k1-dev` where available, or install to `/usr/local` | `brew install secp256k1` |
| **libwally-core** | Build from [libwally-core](https://github.com/ElementsProject/libwally-core) or distro packages if present | `brew install libwally-core` |
| **noise** | Static or shared `libnoiseprotocol` / `libnoisekeys` on linker path | Install to `/usr/local/lib` (e.g. from source) |

Headers and library search paths are defined in `binding.gyp` under `conditions` for `OS=='linux'` and `OS=='mac'`. On Apple Silicon, Homebrew often uses `/opt/homebrew/opt/...`; on Intel macOS or custom installs, `/usr/local` may be used instead — adjust `binding.gyp` or use symlinks if the linker reports missing `-lwallycore` or `-lsecp256k1`.

### Verify
```bash
node -e "console.log(require('fs').existsSync('build/Release/fabric.node') ? 'ok' : 'run npm run build:c')"
```

## Cross-stack messaging
Wire-format and body-hash alignment between C and JS are summarized in [`docs/C-JS-PARITY.md`](docs/C-JS-PARITY.md).

## Release hygiene

See [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md).
