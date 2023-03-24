# Installing Fabric
## Prerequisites
- Node.js 16.15.x

## Quick Start
You can install Fabric by running:
```
npm i -g FabricLabs/fabric
```

This will make the `fabric` binary available on your system, after which you should run:
```
fabric setup
```

Now, you'll have a newly-generated Fabric address and you can run:
```
fabric
```

## Playnet
By default, the Fabric CLI connects to `playnet` for an initial set of peers.  You can add new peers manually by running `/connect <address>` where `<address`> is the peer's public hostname and port.

## Notes
If you don't have Node.js, or an incorrect version, we recommend [installing NVM][installing-nvm].  Once complete, you can install and set the default node version:
```
nvm install 16.17.1
nvm alias default 16.17.1 # optional
```

[installing-nvm]: https://nvm.sh
