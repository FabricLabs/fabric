# Building `@fabric/core`
## JavaScript library (default)

```bash
npm ci
npm test
```

No native compile is required for the core JS unit/integration tests in this repo.

## `fabric` CLI binary
The **`fabric`** npm binary is the **Node harness** (`scripts/fabric.js`) for the Blessed TUI (`chat` default). Optional **`fabric.node`** accelerates a tiny API surface: **`doubleSha256`** (opt-in `FABRIC_NATIVE_DOUBLE_SHA256=1`) and **Bech32 / native segwit** via vendored **`native/sipa/segwit_addr.c`** (opt-in `FABRIC_NATIVE_BECH32=1`). See [`docs/CLI-BINARY.md`](docs/CLI-BINARY.md) and `functions/fabricNativeAccel.js`.

Bundled executable: `npm run make:binary` (pkg).

## Native addon (`fabric.node`)
The Node N-API addon implements peer/message helpers and Bitcoin-related bindings (`binding.gyp`), and compiles Pieter Wuille’s **`segwit_addr.c`** (Bech32 / Bech32m / segwit address helpers) from `native/sipa/`. Build when you need C parity features or JS access to `binding.cc` exports.

```bash
npm ci
npm run build:c
```

Outputs under `build/Release/fabric.node` (ignored by git — see `.gitignore`).

### Dependencies
| Component | Linux (typical) | macOS (Homebrew) |
|-----------|-----------------|------------------|
| **Node** | 24.14.1 (see `.nvmrc` / `package.json` `engines`) | same |
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
