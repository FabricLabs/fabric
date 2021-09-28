# Fabric Settings
Fabric works best when installed globally (or on your `$PATH`). For most use
cases, we can install Fabric with simply:

> `$ npm i -g FabricLabs/fabric`
> `$ fabric --keygen`

This should create (or read) a folder `~/.fabric` with a JSON configuration
file. Take care, as this file is not (currently) encrypted.

## Using Your Own Full Node
### Setup Bitcoin Core
First, we must ensure Bitcoin Core's RPC interface is available to us.  We
will rely on it to provide consensus over the Bitcoin blockchain.

1. Install Bitcoin Core `0.21.1`
2. Add `rpcuser` and `rpcpassword` to `bitcoin.conf`
3. Run `bitcoind -regtest -server -txindex=1`

### Configure Fabric
In your local Fabric repository, complete the following:

1. Configure `settings/local.json` with your Bitcoin RPC URL
2. Ensure global availability: `npm i -g`
3. Run `fabric chat`
