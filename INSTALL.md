# Installing Fabric
## Prerequisites
- Node.js 24.15.0
- npm 12+ (`npm -v`); Node 24.15.0 may ship npm 11.x — upgrade with `npm install -g npm@12`. `@fabric/core` keeps npm’s default `allow-git=none` (no git deps).

## Quick Start
```
npm i -g @fabric/core
fabric setup
fabric
```

This installs the `fabric` binary, opens `fabric setup` (TTY: lightweight key TUI; generates a password-sealed `~/.fabric/wallet.json` if needed), then opens the interactive shell. For development from git, use e.g. `npm i -g FabricLabs/fabric#master` instead of the npm package.

## Playnet
By default, the Fabric CLI connects to `playnet` for an initial set of peers.  You can add new peers manually by running `/connect <address>` where `<address`> is the peer's public hostname and port.

## Notes
If you don't have Node.js, or an incorrect version, we recommend [installing NVM][installing-nvm].  Once complete, you can install and set the default node version:
```
nvm install 24.15.0
nvm alias default 24.15.0 # optional
```

[installing-nvm]: https://nvm.sh
