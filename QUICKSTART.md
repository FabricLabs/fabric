# Fabric Quickstart

## Prerequisites
0. (optional) Install NVM: `https://nvm.sh`
1. Install Node 12.16 (use `nvm install 12.16` if using `nvm`)

## Instructions
0. Meet the prerequisites (above)
1. Install Fabric Core: `npm i --save @fabric/core`

_**Note:** for development releases, use `npm i --save FabricLabs/fabric#develop` instead._

## Sample Program
Create the file `scripts/quickstart.js` using the following code:

```js
const Bitcoin = require('@fabric/core/services/bitcoin');

async function main () {
  const bitcoin = new Bitcoin({
    verbosity: 3
  });

  await bitcoin.start();
}

main().catch((exception) => {
  console.error('[QUICKSTART]', 'Quick Start failed:', exception);
});
```

Finally, run the program:

```
> node scripts/quickstart.js
[AUDIT] Generating new HD key for wallet...
[AUDIT] Wallet account: {
  id: 'WLTTtuqaMtxMRiP33gLf1BN2js5HESWxHEhE',
  wid: 1,
  name: 'default',
  network: 'main',
  initialized: true,
  witness: false,
  watchOnly: false,
  type: 'pubkeyhash',
  m: 1,
  n: 1,
  accountIndex: 0,
  receiveDepth: 1,
  changeDepth: 1,
  nestedDepth: 0,
  lookahead: 10,
  receiveAddress: '1CxaBhXMiyNPGZ2K2gNprxY6BnCnKVoEgW',
  changeAddress: '1L3LYaPmHfUhLDtsjzw77bsqhzC5esx9qf',
  nestedAddress: null,
  accountKey: 'xpub6Cn1n6iWaPYRqoD4Ss9Sx4i2FLmdZ4ZSwb5NULg6DGCNXMVikaoRk3KFRihqRqLSPiNTDmVHgj7Ff1LMLidcveMf8kPHSX51CjBtZtCqiDU',
  keys: []
}
```



## Setup Local Bitcoin Node

  

For testing purposes, we recommend running `bitcoin-qt` using the bash command with `scripts/bitcoin-playnet.sh`. Follow these steps to get setup:

  

1. Download the [bitcoin-core client](https://bitcoin.org/bin/) to your system. 
2. (Recommended) Download SHA256SUMS.sig and SHA256SUMS to verify hashes match, using these commands in the terminal:
	```
	$ cat SHA256SUMS # view the sha-256 file hashes 
	$ sha256sum downloaded_file.name # compute hash of downloaded file
	```
3. (Recommended) Verify hashes with a Bitcoin Core Release Signing Key, keys to respective versions can be found [here](https://bitcoin.org/en/download).
	```
	$ gpg --verify SHA256SUMS.sig SHA256SUMS # verify file is signed
	```
4. Continue with the bitcoin-core installation to your system.
5. Check installation in terminal by running `bitcoind --version` or `bitcoin-qt --version`. If the terminal outputs something like `Bitcoin Core version vXX.X.X` then you are ready to run the scripts 
6. Navigate your terminal window to the [fabric](https://github.com/fabriclabs/fabric) directory and create a new directory named "bitcoin-playnet" inside "stores" 
	```
	$ cd stores && mkdir bitcoin-playnet
	```
	There should now be a directory path `/fabric/stores/bitcoin-playnet`. 	
	Return to the parent directory of the repo `cd ..`, now you are ready to run the script
7. Run the playnet bash script with 
	```
	$ ./scripts/bitcoin-playnet.sh
	```
	A bitcoin client should now pop up
8. Create or restore a dev wallet (not to be used with real funds)
9. (optional) view the debug log with this command in a new terminal window 
	```
	$ tail -f stores/bitcoin-playnet/regtest/debug.log
	```
You are now ready for playnet!