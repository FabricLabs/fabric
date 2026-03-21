# The `fabric` binary
## What it is
The **`fabric`** command is the **Node.js harness** for the Fabric reference client:

1. **Runtime** — system `node` when installed via `npm i -g` / `npm link`, or an **embedded Node-compatible runtime** when built with **`npm run make:binary`** ([pkg](https://github.com/vercel/pkg)).
2. **Harness** — `scripts/fabric.js` (Commander): subcommands (`setup`, `start`, `chat`, …).
3. **Default TUI** — the **`chat`** subcommand (also the default) loads the Blessed terminal UI via `contracts/chat.js` → `types/cli.js`.

The separate **C ncurses CLI** in `src/cli.c` is **not** this binary; it is a native example / alternate frontend.

## Optional native acceleration
The N-API addon (`fabric.node`) is **optional**. The harness does not require it to start the TUI.

A **narrow** JavaScript API wraps only whitelisted exports:

| Method | Role |
|--------|------|
| `doubleSha256` | Bitcoin-style double-SHA256 for message body hash (same as wire/C) |

Implementation: `functions/fabricNativeAccel.js`.
`Hash256.doubleDigest()` uses that helper (native if loadable, else @noble/hashes).

To load a specific `.node` file (e.g. next to a pkg binary):

```bash
export FABRIC_ADDON_PATH=/path/to/fabric.node
```

Debug probe (stderr):

```bash
FABRIC_DEBUG_NATIVE=1 fabric chat
```

**pkg note:** the compiled `fabric` executable does **not** embed `fabric.node`. Ship the addon beside the binary and set `FABRIC_ADDON_PATH`, or rely on pure-JS crypto.

## Build the standalone executable

```bash
npm ci
npm run make:binary
# output: assets/binaries/fabric (per pkg targets in package.json)
```

Targets are pinned in `package.json` under `"pkg"."@targets"`. Align them with the Node major you support when you bump `engines.node`.

## See also
- [BUILD.md](../BUILD.md) — compiling `fabric.node`
- [C-JS-PARITY.md](./C-JS-PARITY.md) — wire hash = double-SHA256
