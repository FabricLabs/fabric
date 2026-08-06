# Installing Fabric
## Prerequisites
- Node.js 24.15.0

## Quick Start
```
npm i -g @fabric/core
fabric setup
fabric
```

This installs the `fabric` binary, generates a wallet under `~/.fabric/`, then opens the interactive shell. For development from git, use e.g. `npm i -g FabricLabs/fabric#master` instead of the npm package.

## Playnet
By default, the Fabric CLI connects to `playnet` for an initial set of peers.  You can add new peers manually by running `/connect <address>` where `<address`> is the peer's public hostname and port.

## Notes
If you don't have Node.js, or an incorrect version, we recommend [installing NVM][installing-nvm].  Once complete, you can install and set the default node version:
```
nvm install 24.15.0
nvm alias default 24.15.0 # optional
```

[installing-nvm]: https://nvm.sh
